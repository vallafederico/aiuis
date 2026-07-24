import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ulid } from "ulid"
import { parseFrontmatter, dumpFrontmatter, assertNoSystemFields } from "../../parse/frontmatter.js"
import { loadCollectionSchema, validateFrontmatter, ValidationError } from "../../core/validate.js"
import { applyEdits, OpsError } from "../../core/ops.js"
import { canonicalize } from "../../core/canonicalize.js"
import { writeRevision } from "../../core/revision.js"
import { logOp } from "../../core/op-log.js"
import type { Env } from "../../index.js"
import type { McpProps } from "../agent.js"

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

export async function createDocHandler(env: Env, identity: IdentityInfo, args: CreateDocArgs): Promise<McpToolResult> {
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

  const isUlid = args.id.length === 26 && /^[0-9A-Z]+$/.test(args.id)

  if (isUlid) {
    const row = await env.DB.prepare(
      `SELECT id, collection, slug, status FROM documents WHERE id=?`
    ).bind(args.id).first<{ id: string; collection: string; slug: string; status: string }>()

    if (!row) {
      return errorResult("not found", "not_found")
    }

    docId = row.id
    collection = row.collection
    slug = row.slug
    currentStatus = row.status
  } else {
    const slashIdx = args.id.indexOf("/")
    if (slashIdx === -1) {
      return errorResult("not found", "not_found")
    }
    collection = args.id.slice(0, slashIdx)
    slug = args.id.slice(slashIdx + 1)

    const row = await env.DB.prepare(
      `SELECT id, collection, slug, status FROM documents WHERE collection=? AND slug=?`
    ).bind(collection, slug).first<{ id: string; collection: string; slug: string; status: string }>()

    if (!row) {
      return errorResult("not found", "not_found")
    }

    docId = row.id
    currentStatus = row.status
  }

  // 2. R2 GET content
  const obj = await env.BUCKET.get(`content/${collection}/${slug}.md`)
  if (!obj) {
    return errorResult("not found", "not_found")
  }
  const rawContent = await obj.text()

  // 3. Phase 3: enforce base_rev (skip for now)

  // 4. applyEdits
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

  // 5. Re-validate if any set_field ops
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

  // 6. Update _author
  const newFm = { ...editedFm, _author: { kind: identity.kind, principal: identity.principal, session: identity.session } }
  const newRaw = dumpFrontmatter(newFm, editedBody)

  // 7. New rev and timestamp
  const newRev = ulid()
  const now = new Date().toISOString()

  // 8. canonicalize
  const canonicalized = await canonicalize(newRaw)

  // 9. writeRevision
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

  // 10. logOp
  logOp(env, { session: identity.session, tool: "edit_doc", docId, outcome: "ok" })

  // 11. return
  return okResult({ id: docId, rev: newRev, content: canonicalized })
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
