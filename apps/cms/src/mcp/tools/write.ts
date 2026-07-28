import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ulid } from "ulid"
import { createPatch } from "diff"
import { parseFrontmatter, dumpFrontmatter, assertNoSystemFields } from "../../parse/frontmatter.js"
import { loadCollectionSchema, validateFrontmatter, ValidationError } from "../../core/validate.js"
import { applyEdits, OpsError } from "../../core/ops.js"
import { canonicalize } from "../../core/canonicalize.js"
import { writeRevision } from "../../core/revision.js"
import { logOp } from "../../core/op-log.js"
import { acquireLock, releaseLock } from "../../core/lock-client.js"
import { syncTaxonomyForDoc } from "../../core/taxonomy.js"
import { checkRefExistence, syncRefEdges } from "../../core/refs.js"
import type { Env } from "../../index.js"
import type { McpProps } from "../agent.js"
import { loadDirectiveRegistry, validateDirectives } from "../../core/directives.js"

type IdentityInfo = McpProps["identity"]
type McpToolResult = { isError?: boolean; content: Array<{ type: "text"; text: string }> }

type CreateDocArgs = { collection: string; frontmatter: Record<string, unknown>; body?: string }
type EditDocArgs = {
  id: string
  base_rev: string
  note?: string
  edits: Array<
    | { op: "str_replace"; old: string; new: string }
    | { op: "append"; text: string }
    | { op: "set_field"; field: string; value: unknown }
    | { op: "delete_field"; field: string }
  >
}

function okResult(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] }
}

function errorResult(message: string, code: string, details?: unknown): McpToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message, code, details }) }] }
}

export function checkNamespaceCapability(identity: IdentityInfo, collection: string): McpToolResult | null {
  const caps = identity.capabilities as { namespaces?: string[] }
  const namespaces = caps?.namespaces ?? []
  const protectedPrefixes = ["schema", "skills"]
  for (const prefix of protectedPrefixes) {
    if (collection.startsWith(prefix) && !namespaces.includes(prefix)) {
      return errorResult(`capability denied: token cannot write to '${prefix}' namespace`, "capability_denied")
    }
  }
  return null
}

export async function createDocHandler(env: Env, identity: IdentityInfo, args: CreateDocArgs): Promise<McpToolResult> {
  // T2b: namespace capability check (collection known from args)
  const capCheck = checkNamespaceCapability(identity, args.collection)
  if (capCheck) return capCheck

  // 1. assertNoSystemFields
  try {
    assertNoSystemFields(args.frontmatter)
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "System field violation", "system_field_violation")
  }

  // 2. loadCollectionSchema + validateFrontmatter
  let schema
  try {
    schema = await loadCollectionSchema(env, args.collection)
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "Schema not found", "schema_not_found")
  }

  try {
    validateFrontmatter(schema, args.frontmatter)
  } catch (e) {
    if (e instanceof ValidationError) {
      logOp(env, { session: identity.session, tool: "create_doc", outcome: "validation_fail", errorClass: "ValidationError" })
      return errorResult("validation failed", "validation_fail", e.errors)
    }
    throw e
  }

  // 2b. Ref existence check
  const missingRefs = await checkRefExistence(env, schema, args.frontmatter)
  if (missingRefs.length > 0) {
    return errorResult("referenced documents not found", "ref_not_found", missingRefs)
  }

  // 3. Slug check
  const slug = typeof args.frontmatter.slug === "string" ? args.frontmatter.slug : null
  if (!slug) {
    return errorResult("slug is required", "validation_fail")
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM documents WHERE collection=? AND slug=?`
  ).bind(args.collection, slug).first()

  if (existing) {
    logOp(env, { session: identity.session, tool: "create_doc", outcome: "slug_conflict", errorClass: "SlugConflict" })
    return errorResult("slug already exists", "slug_conflict")
  }

  // 4. & 5. Create system fields and dump frontmatter with _author
  const _id = ulid()
  const _rev = ulid()
  const now = new Date().toISOString()

  const rawContent = dumpFrontmatter(
    {
      ...args.frontmatter,
      _author: { kind: identity.kind, principal: identity.principal, session: identity.session },
    },
    args.body ?? ""
  )

  // 6. canonicalize
  const canonicalized = await canonicalize(rawContent)

  // 6b. Validate directives — slice check on pre-canonicalize body (remark normalizes ::::→:::)
  // then full registry check on canonicalized body
  const preCanonBody = args.body ?? ""
  const directiveRegistry = await loadDirectiveRegistry(env)
  const directiveError = /^:{4,}/m.test(preCanonBody)
    ? { error: "slices_not_supported" as const, message: "slices not yet supported" }
    : validateDirectives(parseFrontmatter(canonicalized).body, directiveRegistry)
  if (directiveError) {
    const code = directiveError.error === "slices_not_supported" ? "slices_not_supported"
      : directiveError.error === "unknown_directive" ? "unknown_directive"
      : "invalid_directive_attribute"
    logOp(env, { session: identity.session, tool: "create_doc", outcome: "validation_fail", errorClass: code })
    return errorResult(
      directiveError.error === "slices_not_supported" ? directiveError.message : `directive validation failed: ${directiveError.error}`,
      code,
      directiveError
    )
  }

  // 7. writeRevision (injects _id, _collection, _status, _rev, _updated, _created)
  await writeRevision(
    env,
    {
      docId: _id,
      collection: args.collection,
      slug,
      rev: _rev,
      at: now,
      author: { kind: identity.kind, principal: identity.principal, session: identity.session },
      note: "create",
      status: "draft",
    },
    canonicalized
  )

  // Sync taxonomy terms (best-effort)
  try {
    const { frontmatter: canonFm } = parseFrontmatter(canonicalized)
    await syncTaxonomyForDoc(env, schema, _id, canonFm, false)
  } catch {
    // taxonomy sync is best-effort, never fail the write
  }

  // Sync ref_edges
  try {
    const { frontmatter: canonFm } = parseFrontmatter(canonicalized)
    await syncRefEdges(env, _id, schema, canonFm)
  } catch {
    // ref_edges sync is best-effort
  }

  // Fire-and-forget queue enqueue for background derive
  try {
    await env.DERIVE_QUEUE.send({ collection: args.collection, slug, rev: _rev })
  } catch {
    // queue delivery quirks must never fail a write
  }

  // 8. logOp
  logOp(env, { session: identity.session, tool: "create_doc", docId: _id, outcome: "ok" })

  // 9. return
  return okResult({ id: _id, rev: _rev, content: canonicalized })
}

export async function editDocHandler(env: Env, identity: IdentityInfo, args: EditDocArgs): Promise<McpToolResult> {
  // 1. Resolve id
  let docId: string
  let collection: string
  let slug: string
  let currentStatus: string
  let headRev: string

  const isUlid = args.id.length === 26 && /^[0-9A-Z]+$/.test(args.id)

  if (isUlid) {
    const row = await env.DB.prepare(
      `SELECT id, collection, slug, status, head_rev FROM documents WHERE id=?`
    ).bind(args.id).first<{ id: string; collection: string; slug: string; status: string; head_rev: string }>()

    if (!row) {
      return errorResult("not found", "not_found")
    }

    docId = row.id
    collection = row.collection
    slug = row.slug
    currentStatus = row.status
    headRev = row.head_rev
  } else {
    const slashIdx = args.id.indexOf("/")
    if (slashIdx === -1) {
      return errorResult("not found", "not_found")
    }
    collection = args.id.slice(0, slashIdx)
    slug = args.id.slice(slashIdx + 1)

    const row = await env.DB.prepare(
      `SELECT id, collection, slug, status, head_rev FROM documents WHERE collection=? AND slug=?`
    ).bind(collection, slug).first<{ id: string; collection: string; slug: string; status: string; head_rev: string }>()

    if (!row) {
      return errorResult("not found", "not_found")
    }

    docId = row.id
    currentStatus = row.status
    headRev = row.head_rev
  }

  // T2b: namespace capability check
  const capCheck = checkNamespaceCapability(identity, collection)
  if (capCheck) return capCheck

  // 2. Acquire lock (409-aware)
  const lockResult = await acquireLock(env, docId, identity.session)
  if ("error" in lockResult) {
    return errorResult(`document locked by another session: ${lockResult.holder}`, "locked", { holder: lockResult.holder })
  }

  try {
    // 3. Enforce base_rev — check for conflict
    if (headRev !== args.base_rev) {
      // Fetch caller's base revision content and HEAD content for diff
      const baseRevKey = `revisions/${collection}/${slug}/${args.base_rev}.md`
      const [baseObj, headObj] = await Promise.all([
        env.BUCKET.get(baseRevKey),
        env.BUCKET.get(`content/${collection}/${slug}.md`),
      ])
      const baseContent = baseObj ? await baseObj.text() : ""
      const headContent = headObj ? await headObj.text() : ""
      const diff = createPatch(`${collection}/${slug}`, baseContent, headContent, args.base_rev, headRev)

      return okResult({ error: "CONFLICT", current_rev: headRev, diff })
    }

    // 4. R2 GET content
    const obj = await env.BUCKET.get(`content/${collection}/${slug}.md`)
    if (!obj) {
      return errorResult("not found", "not_found")
    }
    const rawContent = await obj.text()

    // 5. applyEdits
    let editedFm: Record<string, unknown>
    let editedBody: string
    try {
      const editResult = applyEdits(rawContent, args.edits)
      editedFm = editResult.frontmatter
      editedBody = editResult.body
    } catch (e) {
      if (e instanceof OpsError) {
        logOp(env, { session: identity.session, tool: "edit_doc", docId, outcome: "ops_error", errorClass: e.code })
        return errorResult(e.message, e.code)
      }
      throw e
    }

    // 6. Re-validate if any set_field ops
    const hasSetField = args.edits.some(e => e.op === "set_field")
    if (hasSetField) {
      let schema
      try {
        schema = await loadCollectionSchema(env, collection)
      } catch {
        // if schema can't be loaded, skip validation
      }

      if (schema) {
        // Extract user fields only (no system fields)
        const userFm: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(editedFm)) {
          if (k !== "_id" && k !== "_collection" && k !== "_status" && k !== "_rev" && k !== "_updated" && k !== "_created" && k !== "_author") {
            userFm[k] = v
          }
        }

        try {
          validateFrontmatter(schema, userFm)
        } catch (e) {
          if (e instanceof ValidationError) {
            logOp(env, { session: identity.session, tool: "edit_doc", docId, outcome: "validation_fail", errorClass: "ValidationError" })
            return errorResult("validation failed", "validation_fail", e.errors)
          }
          throw e
        }
      }
    }

    // 6b. Ref existence check on edited frontmatter
    try {
      const editedSchema = await loadCollectionSchema(env, collection)
      // Extract user fields only
      const userFmForRefCheck: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(editedFm)) {
        if (!["_id", "_collection", "_status", "_rev", "_updated", "_created", "_author"].includes(k)) {
          userFmForRefCheck[k] = v
        }
      }
      const missingRefs = await checkRefExistence(env, editedSchema, userFmForRefCheck)
      if (missingRefs.length > 0) {
        return errorResult("referenced documents not found", "ref_not_found", missingRefs)
      }
    } catch (e) {
      // If schema not found, skip ref check
      if (!(e instanceof Error) || !e.message.includes("Schema not found")) {
        throw e
      }
    }

    // 7. Update _author
    const newFm = { ...editedFm, _author: { kind: identity.kind, principal: identity.principal, session: identity.session } }
    const newRaw = dumpFrontmatter(newFm, editedBody)

    // 8. New rev and timestamp
    const newRev = ulid()
    const now = new Date().toISOString()

    // 9. canonicalize
    const canonicalized = await canonicalize(newRaw)

    // 9b. Validate directives — slice check on pre-canonicalize body (remark normalizes ::::→:::)
    // then full registry check on canonicalized body
    const directiveRegistry2 = await loadDirectiveRegistry(env)
    const directiveError2 = /^:{4,}/m.test(editedBody)
      ? { error: "slices_not_supported" as const, message: "slices not yet supported" }
      : validateDirectives(parseFrontmatter(canonicalized).body, directiveRegistry2)
    if (directiveError2) {
      const code2 = directiveError2.error === "slices_not_supported" ? "slices_not_supported"
        : directiveError2.error === "unknown_directive" ? "unknown_directive"
        : "invalid_directive_attribute"
      logOp(env, { session: identity.session, tool: "edit_doc", docId, outcome: "validation_fail", errorClass: code2 })
      return errorResult(
        directiveError2.error === "slices_not_supported" ? directiveError2.message : `directive validation failed: ${directiveError2.error}`,
        code2,
        directiveError2
      )
    }

    // 10. writeRevision
    await writeRevision(
      env,
      {
        docId,
        collection,
        slug,
        rev: newRev,
        at: now,
        author: { kind: identity.kind, principal: identity.principal, session: identity.session },
        note: args.note,
        status: currentStatus,
      },
      canonicalized
    )

    // Sync taxonomy terms (best-effort)
    try {
      const { frontmatter: canonFm } = parseFrontmatter(canonicalized)
      let editSchema
      try {
        editSchema = await loadCollectionSchema(env, collection)
      } catch {}
      if (editSchema) {
        await syncTaxonomyForDoc(env, editSchema, docId, canonFm, currentStatus === "published")
      }
    } catch {
      // taxonomy sync is best-effort
    }

    // Sync ref_edges
    try {
      const refSchema = await loadCollectionSchema(env, collection)
      const { frontmatter: canonFm } = parseFrontmatter(canonicalized)
      const userFmForRefs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(canonFm)) {
        if (!["_id", "_collection", "_status", "_rev", "_updated", "_created", "_author"].includes(k)) {
          userFmForRefs[k] = v
        }
      }
      await syncRefEdges(env, docId, refSchema, userFmForRefs)
    } catch {
      // ref_edges sync is best-effort
    }

    // Fire-and-forget queue enqueue for background derive
    try {
      await env.DERIVE_QUEUE.send({ collection, slug, rev: newRev })
    } catch {
      // queue delivery quirks must never fail a write
    }

    // 11. logOp
    logOp(env, { session: identity.session, tool: "edit_doc", docId, outcome: "ok" })

    // 12. return
    return okResult({ id: docId, rev: newRev, content: canonicalized })
  } finally {
    // Always release lock
    await releaseLock(env, docId, identity.session)
  }
}

export function registerWriteTools(
  server: McpServer,
  env: Env,
  getIdentity: () => IdentityInfo
): void {
  server.tool(
    "create_doc",
    "Create a new document in a collection",
    {
      collection: z.string(),
      frontmatter: z.record(z.string(), z.unknown()),
      body: z.string().optional(),
    },
    async (args) => {
      return createDocHandler(env, getIdentity(), args)
    }
  )

  server.tool(
    "edit_doc",
    "Edit an existing document by applying a set of operations",
    {
      id: z.string(),
      base_rev: z.string(),
      note: z.string().optional(),
      edits: z.array(
        z.discriminatedUnion("op", [
          z.object({ op: z.literal("str_replace"), old: z.string(), new: z.string() }),
          z.object({ op: z.literal("append"), text: z.string() }),
          z.object({ op: z.literal("set_field"), field: z.string(), value: z.unknown() }),
          z.object({ op: z.literal("delete_field"), field: z.string() }),
        ])
      ),
    },
    async (args) => {
      return editDocHandler(env, getIdentity(), args as EditDocArgs)
    }
  )
}
