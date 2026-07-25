import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ulid } from "ulid"
import { createPatch } from "diff"
import { parseFrontmatter, dumpFrontmatter } from "../../parse/frontmatter.js"
import { loadCollectionSchema, validateFrontmatter, ValidationError } from "../../core/validate.js"
import { canonicalize } from "../../core/canonicalize.js"
import { writeRevision } from "../../core/revision.js"
import { logOp } from "../../core/op-log.js"
import { acquireLock, releaseLock } from "../../core/lock-client.js"
import type { Env } from "../../index.js"
import type { McpProps } from "../agent.js"

type IdentityInfo = McpProps["identity"]
type McpToolResult = { isError?: boolean; content: Array<{ type: "text"; text: string }> }

function okResult(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] }
}

function errorResult(message: string, code: string, details?: unknown): McpToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message, code, details }) }] }
}

function checkNamespaceCapability(identity: IdentityInfo, collection: string): McpToolResult | null {
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

async function resolveDoc(env: Env, id: string): Promise<{ docId: string; collection: string; slug: string; status: string; headRev: string } | null> {
  const isUlid = id.length === 26 && /^[0-9A-Z]+$/.test(id)
  if (isUlid) {
    const row = await env.DB.prepare(`SELECT id, collection, slug, status, head_rev FROM documents WHERE id=?`).bind(id).first<{ id: string; collection: string; slug: string; status: string; head_rev: string }>()
    if (!row) return null
    return { docId: row.id, collection: row.collection, slug: row.slug, status: row.status, headRev: row.head_rev }
  }
  const slashIdx = id.indexOf("/")
  if (slashIdx === -1) return null
  const collection = id.slice(0, slashIdx)
  const slug = id.slice(slashIdx + 1)
  const row = await env.DB.prepare(`SELECT id, collection, slug, status, head_rev FROM documents WHERE collection=? AND slug=?`).bind(collection, slug).first<{ id: string; collection: string; slug: string; status: string; head_rev: string }>()
  if (!row) return null
  return { docId: row.id, collection: row.collection, slug: row.slug, status: row.status, headRev: row.head_rev }
}

// history tool
export async function historyHandler(env: Env, identity: IdentityInfo, args: { id: string; limit?: number }): Promise<McpToolResult> {
  const doc = await resolveDoc(env, args.id)
  if (!doc) return errorResult("not found", "not_found")

  const limit = Math.min(args.limit ?? 20, 50)
  const rows = await env.DB.prepare(
    `SELECT rev, at, author_kind, principal, session, note, diff_stat FROM revisions WHERE doc_id=? ORDER BY at DESC LIMIT ?`
  ).bind(doc.docId, limit).all()

  logOp(env, { session: identity.session, tool: "history", docId: doc.docId, outcome: "ok" })
  return okResult({ doc_id: doc.docId, revisions: rows.results })
}

// diff tool
export async function diffHandler(env: Env, identity: IdentityInfo, args: { id: string; from_rev: string; to_rev?: string }): Promise<McpToolResult> {
  const doc = await resolveDoc(env, args.id)
  if (!doc) return errorResult("not found", "not_found")

  const fromKey = `revisions/${doc.collection}/${doc.slug}/${args.from_rev}.md`
  const toKey = args.to_rev
    ? `revisions/${doc.collection}/${doc.slug}/${args.to_rev}.md`
    : `content/${doc.collection}/${doc.slug}.md`

  const [fromObj, toObj] = await Promise.all([
    env.BUCKET.get(fromKey),
    env.BUCKET.get(toKey),
  ])

  if (!fromObj) return errorResult("from_rev not found", "not_found")
  if (!toObj) return errorResult("to_rev not found", "not_found")

  const [fromContent, toContent] = await Promise.all([fromObj.text(), toObj.text()])

  const toLabel = args.to_rev ?? doc.headRev
  const diffStr = createPatch(`${doc.collection}/${doc.slug}`, fromContent, toContent, args.from_rev, toLabel)

  logOp(env, { session: identity.session, tool: "diff", docId: doc.docId, outcome: "ok" })
  return okResult({ diff: diffStr })
}

// revert tool — copies old rev content through the normal write path
export async function revertHandler(env: Env, identity: IdentityInfo, args: { id: string; to_rev: string; note?: string }): Promise<McpToolResult> {
  const doc = await resolveDoc(env, args.id)
  if (!doc) return errorResult("not found", "not_found")

  const capCheck = checkNamespaceCapability(identity, doc.collection)
  if (capCheck) return capCheck

  // Fetch the target revision content
  const revKey = `revisions/${doc.collection}/${doc.slug}/${args.to_rev}.md`
  const revObj = await env.BUCKET.get(revKey)
  if (!revObj) return errorResult("revision not found", "not_found")

  const revContent = await revObj.text()
  const { frontmatter } = parseFrontmatter(revContent)

  // Strip system fields and rebuild as new revision
  const userFm: Record<string, unknown> = {}
  const systemKeys = ["_id", "_collection", "_status", "_rev", "_updated", "_created", "_author"]
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!systemKeys.includes(k)) userFm[k] = v
  }

  // Get body from old revision
  const { body: oldBody } = parseFrontmatter(revContent)

  // Build new content with updated _author
  const newFm = { ...userFm, _author: { kind: identity.kind, principal: identity.principal, session: identity.session } }
  const rawContent = dumpFrontmatter(newFm, oldBody)
  const canonicalized = await canonicalize(rawContent)

  const newRev = ulid()
  const now = new Date().toISOString()

  await writeRevision(env, {
    docId: doc.docId,
    collection: doc.collection,
    slug: doc.slug,
    rev: newRev,
    at: now,
    author: { kind: identity.kind, principal: identity.principal, session: identity.session },
    note: args.note ?? `revert to ${args.to_rev}`,
    status: doc.status,
  }, canonicalized)

  logOp(env, { session: identity.session, tool: "revert", docId: doc.docId, outcome: "ok" })
  return okResult({ id: doc.docId, rev: newRev, content: canonicalized })
}

// rename_doc tool — change slug, record redirect
export async function renameDocHandler(env: Env, identity: IdentityInfo, args: { id: string; new_slug: string }): Promise<McpToolResult> {
  const doc = await resolveDoc(env, args.id)
  if (!doc) return errorResult("not found", "not_found")

  const capCheck = checkNamespaceCapability(identity, doc.collection)
  if (capCheck) return capCheck

  // Check new slug not taken
  const existing = await env.DB.prepare(`SELECT id FROM documents WHERE collection=? AND slug=?`).bind(doc.collection, args.new_slug).first()
  if (existing) return errorResult("slug already in use", "slug_conflict")

  const now = new Date().toISOString()

  // Update documents table slug
  await env.DB.batch([
    env.DB.prepare(`UPDATE documents SET slug=?, updated=? WHERE id=?`).bind(args.new_slug, now, doc.docId),
    env.DB.prepare(`INSERT OR REPLACE INTO redirects (from_collection, from_slug, to_collection, to_slug, created) VALUES (?, ?, ?, ?, ?)`).bind(doc.collection, doc.slug, doc.collection, args.new_slug, now),
  ])

  // Move R2 content (copy to new path, old path becomes stale — revisions stay at old paths)
  const oldHeadKey = `content/${doc.collection}/${doc.slug}.md`
  const newHeadKey = `content/${doc.collection}/${args.new_slug}.md`
  const headObj = await env.BUCKET.get(oldHeadKey)
  if (headObj) {
    const content = await headObj.text()
    // Update slug in frontmatter
    const { frontmatter, body } = parseFrontmatter(content)
    const newFm = { ...frontmatter, _updated: now }
    const newContent = dumpFrontmatter(newFm, body)
    await env.BUCKET.put(newHeadKey, newContent)
    await env.BUCKET.delete(oldHeadKey)
  }

  logOp(env, { session: identity.session, tool: "rename_doc", docId: doc.docId, outcome: "ok" })
  return okResult({ id: doc.docId, old_slug: doc.slug, new_slug: args.new_slug })
}

// delete_doc tool — two-step confirm; archives only (status flip)
export async function deleteDocHandler(env: Env, identity: IdentityInfo, args: { id: string; confirm?: string }): Promise<McpToolResult> {
  const doc = await resolveDoc(env, args.id)
  if (!doc) return errorResult("not found", "not_found")

  const capCheck = checkNamespaceCapability(identity, doc.collection)
  if (capCheck) return capCheck

  // Step 1: no confirm → return confirmation requirement
  if (!args.confirm) {
    return okResult({ confirm_required: true, message: `To delete, call again with confirm: "${doc.docId}"`, id: doc.docId })
  }

  // Step 2: confirm must equal the doc id
  if (args.confirm !== doc.docId) {
    return errorResult("confirm value must equal the document id", "confirm_mismatch")
  }

  // Archive: status flip only; R2 content stays, revisions stay
  const now = new Date().toISOString()
  await env.DB.prepare(`UPDATE documents SET status='archived', updated=? WHERE id=?`).bind(now, doc.docId).run()

  // Write a new revision recording the archive
  const headObj = await env.BUCKET.get(`content/${doc.collection}/${doc.slug}.md`)
  if (headObj) {
    const headContent = await headObj.text()
    const { frontmatter, body } = parseFrontmatter(headContent)
    const newFm = { ...frontmatter, _author: { kind: identity.kind, principal: identity.principal, session: identity.session } }
    const rawContent = dumpFrontmatter(newFm, body)
    const canonicalized = await canonicalize(rawContent)
    const newRev = ulid()
    await writeRevision(env, {
      docId: doc.docId,
      collection: doc.collection,
      slug: doc.slug,
      rev: newRev,
      at: now,
      author: { kind: identity.kind, principal: identity.principal, session: identity.session },
      note: "archived",
      status: "archived",
    }, canonicalized)
  }

  logOp(env, { session: identity.session, tool: "delete_doc", docId: doc.docId, outcome: "ok" })
  return okResult({ id: doc.docId, status: "archived" })
}

// publish tool — full validation incl. required-at-publish fields
export async function publishHandler(env: Env, identity: IdentityInfo, args: { id: string; base_rev: string }): Promise<McpToolResult> {
  const doc = await resolveDoc(env, args.id)
  if (!doc) return errorResult("not found", "not_found")

  const capCheck = checkNamespaceCapability(identity, doc.collection)
  if (capCheck) return capCheck

  // Publish requires publish capability
  const caps = identity.capabilities as { publish?: boolean }
  if (!caps?.publish) {
    return errorResult("publish capability required", "capability_denied")
  }

  // Check base_rev (optimistic lock for publish)
  if (doc.headRev !== args.base_rev) {
    return okResult({ error: "CONFLICT", current_rev: doc.headRev })
  }

  // Fetch current HEAD content
  const headObj = await env.BUCKET.get(`content/${doc.collection}/${doc.slug}.md`)
  if (!headObj) return errorResult("content not found", "not_found")
  const headContent = await headObj.text()
  const { frontmatter, body } = parseFrontmatter(headContent)

  // Full validation against schema at publish time
  try {
    const schema = await loadCollectionSchema(env, doc.collection)
    // Extract user fields for validation
    const systemKeys = ["_id", "_collection", "_status", "_rev", "_updated", "_created", "_author"]
    const userFm: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(frontmatter)) {
      if (!systemKeys.includes(k)) userFm[k] = v
    }
    validateFrontmatter(schema, userFm)
  } catch (e) {
    if (e instanceof ValidationError) {
      logOp(env, { session: identity.session, tool: "publish", docId: doc.docId, outcome: "validation_fail", errorClass: "ValidationError" })
      return errorResult("publish validation failed", "validation_fail", e.errors)
    }
    // Schema not found — allow publish (schema might be for schema/skills docs)
  }

  // Write new revision with published status
  const newFm = { ...frontmatter, _author: { kind: identity.kind, principal: identity.principal, session: identity.session } }
  const rawContent = dumpFrontmatter(newFm, body)
  const canonicalized = await canonicalize(rawContent)
  const newRev = ulid()
  const now = new Date().toISOString()

  await writeRevision(env, {
    docId: doc.docId,
    collection: doc.collection,
    slug: doc.slug,
    rev: newRev,
    at: now,
    author: { kind: identity.kind, principal: identity.principal, session: identity.session },
    note: "published",
    status: "published",
  }, canonicalized)

  logOp(env, { session: identity.session, tool: "publish", docId: doc.docId, outcome: "ok" })
  return okResult({ id: doc.docId, rev: newRev, status: "published" })
}

// unpublish tool
export async function unpublishHandler(env: Env, identity: IdentityInfo, args: { id: string }): Promise<McpToolResult> {
  const doc = await resolveDoc(env, args.id)
  if (!doc) return errorResult("not found", "not_found")

  const caps = identity.capabilities as { publish?: boolean }
  if (!caps?.publish) {
    return errorResult("publish capability required", "capability_denied")
  }

  const now = new Date().toISOString()
  // Fetch current content and write new revision with draft status
  const headObj = await env.BUCKET.get(`content/${doc.collection}/${doc.slug}.md`)
  if (headObj) {
    const headContent = await headObj.text()
    const { frontmatter, body } = parseFrontmatter(headContent)
    const newFm = { ...frontmatter, _author: { kind: identity.kind, principal: identity.principal, session: identity.session } }
    const rawContent = dumpFrontmatter(newFm, body)
    const canonicalized = await canonicalize(rawContent)
    const newRev = ulid()
    await writeRevision(env, {
      docId: doc.docId,
      collection: doc.collection,
      slug: doc.slug,
      rev: newRev,
      at: now,
      author: { kind: identity.kind, principal: identity.principal, session: identity.session },
      note: "unpublished",
      status: "draft",
    }, canonicalized)
    logOp(env, { session: identity.session, tool: "unpublish", docId: doc.docId, outcome: "ok" })
    return okResult({ id: doc.docId, rev: newRev, status: "draft" })
  }

  return errorResult("content not found", "not_found")
}

// get_context — Milestone 1 minimal: schema docs + always-mode skill raw bodies
export async function getContextHandler(env: Env, identity: IdentityInfo, args: { task: string; collection?: string }): Promise<McpToolResult> {
  const context: { schemas: unknown[]; skills: unknown[]; task: string; collection?: string } = {
    task: args.task,
    schemas: [],
    skills: [],
  }
  if (args.collection) context.collection = args.collection

  // Fetch schema docs
  try {
    if (args.collection) {
      const headObj = await env.BUCKET.get(`schema/${args.collection}.md`)
      if (headObj) {
        const raw = await headObj.text()
        const { frontmatter, body } = parseFrontmatter(raw)
        context.schemas.push({ collection: args.collection, frontmatter, guidelines: body })
      }
    } else {
      const list = await env.BUCKET.list({ prefix: "schema/" })
      for (const obj of list.objects) {
        try {
          const item = await env.BUCKET.get(obj.key)
          if (!item) continue
          const raw = await item.text()
          const { frontmatter, body } = parseFrontmatter(raw)
          context.schemas.push({ key: obj.key, frontmatter, guidelines: body })
        } catch {}
      }
    }
  } catch {}

  // Fetch always-mode skills (mode: always)
  try {
    const list = await env.BUCKET.list({ prefix: "skills/" })
    for (const obj of list.objects) {
      try {
        const item = await env.BUCKET.get(obj.key)
        if (!item) continue
        const raw = await item.text()
        const { frontmatter, body } = parseFrontmatter(raw)
        if (frontmatter.mode === "always") {
          context.skills.push({ key: obj.key, frontmatter, body })
        }
      } catch {}
    }
  } catch {}

  logOp(env, { session: identity.session, tool: "get_context", outcome: "ok" })
  return okResult(context)
}

export function registerLifecycleTools(
  server: McpServer,
  env: Env,
  getIdentity: () => IdentityInfo
): void {
  server.tool(
    "history",
    "Get revision history for a document (newest first)",
    {
      id: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (args) => historyHandler(env, getIdentity(), args)
  )

  server.tool(
    "diff",
    "Get unified diff between two revisions of a document",
    {
      id: z.string(),
      from_rev: z.string(),
      to_rev: z.string().optional(),
    },
    async (args) => diffHandler(env, getIdentity(), args)
  )

  server.tool(
    "revert",
    "Revert a document to an older revision (creates new revision, does not move pointer)",
    {
      id: z.string(),
      to_rev: z.string(),
      note: z.string().optional(),
    },
    async (args) => revertHandler(env, getIdentity(), args)
  )

  server.tool(
    "rename_doc",
    "Rename a document's slug (records a redirect)",
    {
      id: z.string(),
      new_slug: z.string(),
    },
    async (args) => renameDocHandler(env, getIdentity(), args)
  )

  server.tool(
    "delete_doc",
    "Archive a document (two-step: first call returns confirm token, second call with confirm actually archives)",
    {
      id: z.string(),
      confirm: z.string().optional(),
    },
    async (args) => deleteDocHandler(env, getIdentity(), args)
  )

  server.tool(
    "publish",
    "Publish a document (requires publish capability; full validation runs at publish time)",
    {
      id: z.string(),
      base_rev: z.string(),
    },
    async (args) => publishHandler(env, getIdentity(), args)
  )

  server.tool(
    "unpublish",
    "Revert a published document back to draft status",
    { id: z.string() },
    async (args) => unpublishHandler(env, getIdentity(), args)
  )

  server.tool(
    "get_context",
    "Get assembled briefing: schema docs + always-mode skill bodies for the given task/collection",
    {
      task: z.string(),
      collection: z.string().optional(),
    },
    async (args) => getContextHandler(env, getIdentity(), args)
  )
}
