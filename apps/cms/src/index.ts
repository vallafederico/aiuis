import { Hono } from "hono"
import { requireDevSecret, resolveIdentity } from "./core/auth.js"
import type { AuthedIdentity } from "./core/auth.js"
import { reindexFromR2 } from "./core/revision.js"
import { CmsMcpAgent } from "./mcp/agent.js"
import { reviewApp } from "./review/handler.js"
import { logOp } from "./core/op-log.js"
import { deriveDoc } from "./derive/pipeline.js"

export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  KV: KVNamespace
  DERIVE_QUEUE: Queue
  MCP_AGENT: DurableObjectNamespace
  LOCK_ROOM: DurableObjectNamespace
  CMS_DEV_SECRET: string
}

// Re-export for wrangler DO binding
export { CmsMcpAgent }

interface DeriveMessage {
  collection: string
  slug: string
  rev: string
}

const app = new Hono<{ Bindings: Env }>()

app.get("/", (c) => {
  return c.json({ name: "aiuis-cms", ok: true })
})

app.post("/dev/seed", async (c) => {
  try {
    requireDevSecret(c.req.raw, c.env)
  } catch {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const body = await c.req.json<{ files: Array<{ path: string; content: string }> }>()
  for (const file of body.files) {
    await c.env.BUCKET.put(file.path, file.content)
  }
  return c.json({ written: body.files.length })
})

app.post("/dev/reindex", async (c) => {
  try {
    requireDevSecret(c.req.raw, c.env)
  } catch {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const result = await reindexFromR2(c.env)
  return c.json(result)
})

app.post("/dev/seed-content", async (c) => {
  try {
    requireDevSecret(c.req.raw, c.env)
  } catch {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const body = await c.req.json<{ action: string; doc: { collection: string; frontmatter: Record<string, unknown>; body?: string } }>()

  if (body.action !== "create_and_publish") {
    return c.json({ error: "unknown action" }, 400)
  }

  const identity = {
    principal: "seed",
    kind: "agent" as const,
    session: "seed-pieces",
    audience: "dev",
    capabilities: { publish: true, collections: "*", namespaces: ["content"] as string[] },
  }

  // Check if already exists
  const slug = typeof body.doc.frontmatter.slug === "string" ? body.doc.frontmatter.slug : null
  if (!slug) return c.json({ error: "slug required" }, 400)

  const existing = await c.env.DB.prepare(
    "SELECT id, published_rev FROM documents WHERE collection=? AND slug=?"
  ).bind(body.doc.collection, slug).first<{ id: string; published_rev: string | null }>()

  if (existing?.published_rev) {
    return c.json({ status: "skipped", reason: "already_published", id: existing.id })
  }

  if (existing) {
    // Draft exists — just publish it
    const { publishHandler } = await import("./mcp/tools/lifecycle.js")
    const row = await c.env.DB.prepare("SELECT head_rev FROM documents WHERE id=?").bind(existing.id).first<{ head_rev: string }>()
    const result = await publishHandler(c.env, identity, { id: existing.id, base_rev: row!.head_rev })
    const parsed = JSON.parse(result.content[0].text)
    if (result.isError) return c.json({ status: "error", detail: parsed }, 500)
    return c.json({ status: "published", id: existing.id })
  }

  // Create then publish
  const { createDocHandler } = await import("./mcp/tools/write.js")
  const { publishHandler } = await import("./mcp/tools/lifecycle.js")

  const createResult = await createDocHandler(c.env, identity, {
    collection: body.doc.collection,
    frontmatter: body.doc.frontmatter,
    body: body.doc.body ?? "",
  })
  const createParsed = JSON.parse(createResult.content[0].text)
  if (createResult.isError) return c.json({ status: "error", detail: createParsed }, 500)

  const pubResult = await publishHandler(c.env, identity, { id: createParsed.id, base_rev: createParsed.rev })
  const pubParsed = JSON.parse(pubResult.content[0].text)
  if (pubResult.isError) return c.json({ status: "error", detail: pubParsed }, 500)

  return c.json({ status: "created_and_published", id: createParsed.id })
})

app.post("/dev/migrate-notes", async (c) => {
  try {
    requireDevSecret(c.req.raw, c.env)
  } catch {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const identity = {
    principal: "migration",
    kind: "agent" as const,
    session: "migrate-notes",
    audience: "dev",
    capabilities: { publish: true, collections: "*", namespaces: ["content"] as string[] },
  }

  const { editDocHandler } = await import("./mcp/tools/write.js")
  const { publishHandler } = await import("./mcp/tools/lifecycle.js")

  // Fetch all pieces docs
  const rows = await c.env.DB.prepare(
    "SELECT id, slug, head_rev FROM documents WHERE collection='pieces' AND published_rev IS NOT NULL ORDER BY slug"
  ).all<{ id: string; slug: string; head_rev: string }>()

  const results: Array<{ slug: string; status: string; detail?: string; newRev?: string }> = []

  for (const row of rows.results) {
    // Fetch current HEAD content
    const obj = await c.env.BUCKET.get(`content/pieces/${row.slug}.md`)
    if (!obj) {
      results.push({ slug: row.slug, status: "error", detail: "content not found" })
      continue
    }
    const content = await obj.text()

    // Check if already migrated (idempotency)
    if (content.includes(":::notes")) {
      results.push({ slug: row.slug, status: "skipped", detail: "already migrated" })
      continue
    }

    // Check if has ## Notes section to migrate
    if (!content.includes("## Notes\n\n")) {
      results.push({ slug: row.slug, status: "skipped", detail: "no ## Notes section found" })
      continue
    }

    // Apply str_replace edit: ## Notes\n\n<paragraph> → :::notes\n<paragraph>\n:::
    const match = content.match(/## Notes\n\n([^\n]+(?:\n(?!\n)[^\n]+)*)\s*$/)
    if (!match) {
      results.push({ slug: row.slug, status: "skipped", detail: "## Notes pattern not matched" })
      continue
    }
    const notesParagraph = match[1].trim()
    const oldText = `## Notes\n\n${notesParagraph}`
    const newText = `:::notes\n${notesParagraph}\n:::`

    const editResult = await editDocHandler(c.env, identity, {
      id: row.id,
      base_rev: row.head_rev,
      note: "migrate ## Notes → :::notes directive",
      edits: [{ op: "str_replace", old: oldText, new: newText }],
    })
    const editParsed = JSON.parse(editResult.content[0].text)
    if (editResult.isError) {
      results.push({ slug: row.slug, status: "error", detail: editParsed.error })
      continue
    }

    // Re-publish with new head rev
    const pubResult = await publishHandler(c.env, identity, { id: row.id, base_rev: editParsed.rev })
    const pubParsed = JSON.parse(pubResult.content[0].text)
    if (pubResult.isError) {
      results.push({ slug: row.slug, status: "error", detail: pubParsed.error })
      continue
    }

    results.push({ slug: row.slug, status: "migrated", newRev: pubParsed.rev })
  }

  const migrated = results.filter(r => r.status === "migrated").length
  const skipped = results.filter(r => r.status === "skipped").length
  const errors = results.filter(r => r.status === "error").length

  return c.json({ migrated, skipped, errors, results })
})

app.post("/dev/rederive", async (c) => {
  try {
    requireDevSecret(c.req.raw, c.env)
  } catch {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const rows = await c.env.DB.prepare(
    "SELECT collection, slug, published_rev FROM documents WHERE published_rev IS NOT NULL"
  ).all<{ collection: string; slug: string; published_rev: string }>()

  let rederived = 0
  let errors = 0
  for (const row of rows.results) {
    try {
      await deriveDoc(c.env, row.collection, row.slug, row.published_rev)
      rederived++
    } catch {
      errors++
    }
  }

  return c.json({ rederived, errors })
})

app.get("/dev/export", async (c) => {
  try {
    requireDevSecret(c.req.raw, c.env)
  } catch {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const files: Array<{ path: string; content: string }> = []
  const EXCLUDED_PREFIXES = ["revisions/", "derived/"]

  let cursor: string | undefined
  do {
    const list = await c.env.BUCKET.list({ cursor })
    cursor = list.truncated ? list.cursor : undefined

    for (const obj of list.objects) {
      // Skip revisions/ and derived/ — only include content/, schema/, skills/
      if (EXCLUDED_PREFIXES.some(p => obj.key.startsWith(p))) continue
      // Only include .md files
      if (!obj.key.endsWith(".md")) continue

      const item = await c.env.BUCKET.get(obj.key)
      if (!item) continue
      files.push({ path: obj.key, content: await item.text() })
    }
  } while (cursor)

  return c.json({ files })
})

app.route("/review", reviewApp)

// GET /api/v1/search?q= — FTS5 over published docs
app.get('/api/v1/search', async (c) => {
  let session = "http"
  try {
    const identity = await resolveIdentity(c.req.raw, c.env)
    session = identity.session
  } catch {}

  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q required' }, 400)
  const escaped = `"${q.replace(/"/g, '""')}"`
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.collection, d.slug, d.title, d.updated FROM documents_fts f JOIN documents d ON d.id=f.id WHERE documents_fts MATCH ? AND d.published_rev IS NOT NULL LIMIT 20`
  ).bind(escaped).all()
  logOp(c.env, { session, tool: "http_search", outcome: "ok" })
  return c.json({ query: q, results: rows.results })
})

// GET /api/v1/taxonomy/:name — terms + counts
app.get('/api/v1/taxonomy/:name', async (c) => {
  const name = c.req.param('name')
  const rows = await c.env.DB.prepare(
    `SELECT slug, title, description, count FROM terms WHERE taxonomy=? AND status='active' ORDER BY count DESC, slug`
  ).bind(name).all()
  return c.json({ taxonomy: name, terms: rows.results })
})

// GET /api/v1/:collection — published docs only
app.get('/api/v1/:collection', async (c) => {
  const collection = c.req.param('collection')
  let session = "http"
  try {
    const identity = await resolveIdentity(c.req.raw, c.env)
    session = identity.session
  } catch {}

  const rows = await c.env.DB.prepare(
    `SELECT id, collection, slug, title, card, created, updated FROM documents WHERE collection=? AND published_rev IS NOT NULL ORDER BY updated DESC`
  ).bind(collection).all()

  const items = rows.results.map((row: Record<string, unknown>) => ({
    ...row,
    card: typeof row.card === 'string' ? (() => { try { return JSON.parse(row.card as string) } catch { return {} } })() : row.card
  }))

  logOp(c.env, { session, tool: "list_collection", outcome: "ok" })
  return c.json({ items })
})

// GET /api/v1/:collection/:slug — doc detail with format/rev params
app.get('/api/v1/:collection/:slug', async (c) => {
  const collection = c.req.param('collection')
  const slug = c.req.param('slug')
  const format = c.req.query('format') ?? 'html'
  const revParam = c.req.query('rev')
  let session = "http"
  try {
    const identity = await resolveIdentity(c.req.raw, c.env)
    session = identity.session
  } catch {}

  let rev: string | null = null
  let isRevAddressed = false

  if (revParam) {
    rev = revParam
    isRevAddressed = true
  } else {
    // Try KV pointer first, fallback to D1
    const kvRev = await c.env.KV.get(`ptr:${collection}/${slug}`)
    if (kvRev) {
      rev = kvRev
    } else {
      const doc = await c.env.DB.prepare(
        `SELECT published_rev FROM documents WHERE collection=? AND slug=?`
      ).bind(collection, slug).first<{ published_rev: string | null }>()

      if (doc?.published_rev) {
        rev = doc.published_rev
      } else {
        // Check if draft exists and request is authed
        const docRow = await c.env.DB.prepare(
          `SELECT id, head_rev, status FROM documents WHERE collection=? AND slug=?`
        ).bind(collection, slug).first<{ id: string; head_rev: string; status: string }>()

        if (!docRow) {
          // Follow redirect chain (up to 5 hops, cycle detection)
          const visited = new Set<string>([`${collection}/${slug}`])
          let curCollection = collection
          let curSlug = slug

          for (let hop = 0; hop < 5; hop++) {
            const redirect = await c.env.DB.prepare(
              `SELECT to_collection, to_slug FROM redirects WHERE from_collection=? AND from_slug=?`
            ).bind(curCollection, curSlug).first<{ to_collection: string; to_slug: string }>()

            if (!redirect) break

            const nextKey = `${redirect.to_collection}/${redirect.to_slug}`
            if (visited.has(nextKey)) break // cycle detected
            visited.add(nextKey)

            curCollection = redirect.to_collection
            curSlug = redirect.to_slug
          }

          if (curCollection !== collection || curSlug !== slug) {
            const targetUrl = `/api/v1/${curCollection}/${curSlug}`
            const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : ""
            logOp(c.env, { session, tool: "get_doc_http", outcome: "redirect" })
            return c.redirect(targetUrl + qs, 308)
          }

          logOp(c.env, { session, tool: "get_doc_http", outcome: "not_found" })
          return c.json({ error: 'not found', code: 'not_found' }, 404)
        }

        // Try auth for draft access
        try {
          await resolveIdentity(c.req.raw, c.env)
          rev = docRow.head_rev
        } catch {
          logOp(c.env, { session, tool: "get_doc_http", outcome: "not_found" })
          return c.json({ error: 'not found', code: 'not_found' }, 404)
        }
      }
    }
  }

  const cacheControl = isRevAddressed
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=60, stale-while-revalidate=600'

  if (format === 'md') {
    const obj = await c.env.BUCKET.get(`revisions/${collection}/${slug}/${rev}.md`)
    if (!obj) return c.json({ error: 'not found', code: 'not_found' }, 404)
    const content = await obj.text()
    logOp(c.env, { session, tool: "get_doc_http", outcome: "ok" })
    return new Response(content, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': cacheControl }
    })
  }

  // html/hast/json — serve from derived artifact
  let derived: Record<string, unknown> | null = null

  // Try KV first
  const kvVal = await c.env.KV.get(`derived:${collection}/${slug}:${rev}`)
  if (kvVal) {
    derived = JSON.parse(kvVal)
  } else {
    // Try R2
    const r2Obj = await c.env.BUCKET.get(`derived/${collection}/${slug}/${rev}.json`)
    if (r2Obj) {
      derived = JSON.parse(await r2Obj.text())
    } else {
      // Derive on demand
      try {
        derived = await deriveDoc(c.env, collection, slug, rev!) as unknown as Record<string, unknown>
      } catch {
        logOp(c.env, { session, tool: "get_doc_http", outcome: "not_found" })
        return c.json({ error: 'not found', code: 'not_found' }, 404)
      }
    }
  }

  logOp(c.env, { session, tool: "get_doc_http", outcome: "ok" })

  if (format === 'hast') {
    return new Response(JSON.stringify(derived!.body_hast), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl }
    })
  }
  if (format === 'json') {
    return new Response(JSON.stringify(derived), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl }
    })
  }
  // default: html
  return new Response(derived!.body_html as string, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl }
  })
})

// Streamable HTTP clients hit /mcp itself; Hono's "/mcp/*" alone would 404 it
app.on(["GET", "POST", "DELETE"], ["/mcp", "/mcp/*"], async (c) => {
  let identity: AuthedIdentity
  try {
    identity = await resolveIdentity(c.req.raw, c.env)
  } catch {
    return c.json({ error: "Unauthorized" }, 401)
  }
  // R1: pass identity via ctx.props so McpAgent.onStart receives it
  ;(c.executionCtx as unknown as { props: unknown }).props = { identity }
  return CmsMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }).fetch(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext)
})

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<DeriveMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { collection, slug, rev } = msg.body
      try {
        await deriveDoc(env, collection, slug, rev)
        msg.ack()
      } catch (e) {
        console.error('derive failed', msg.body, e)
        msg.retry()
      }
    }
  }
}

export { LockRoom } from "./core/lock.js"
