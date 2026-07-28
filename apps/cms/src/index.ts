import { Hono } from "hono"
import { requireDevSecret, resolveIdentity } from "./core/auth.js"
import type { AuthedIdentity } from "./core/auth.js"
import { reindexFromR2 } from "./core/revision.js"
import { CmsMcpAgent } from "./mcp/agent.js"
import { deriveDoc } from "./derive/pipeline.js"
import { reviewApp } from "./review/handler.js"

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

// Mount review page
app.route("/review", reviewApp)

// GET /api/v1/search?q= — FTS5 over published docs
app.get('/api/v1/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q required' }, 400)
  const escaped = `"${q.replace(/"/g, '""')}"`
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.collection, d.slug, d.title, d.updated FROM documents_fts f JOIN documents d ON d.id=f.id WHERE documents_fts MATCH ? AND d.published_rev IS NOT NULL LIMIT 20`
  ).bind(escaped).all()
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
  const rows = await c.env.DB.prepare(
    `SELECT id, collection, slug, title, card, created, updated FROM documents WHERE collection=? AND published_rev IS NOT NULL ORDER BY updated DESC`
  ).bind(collection).all()
  return c.json({ items: rows.results })
})

// GET /api/v1/:collection/:slug — doc detail with format/rev params
app.get('/api/v1/:collection/:slug', async (c) => {
  const collection = c.req.param('collection')
  const slug = c.req.param('slug')
  const format = c.req.query('format') ?? 'html'
  const revParam = c.req.query('rev')

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
          return c.json({ error: 'not found', code: 'not_found' }, 404)
        }

        // Try auth for draft access
        try {
          await resolveIdentity(c.req.raw, c.env)
          rev = docRow.head_rev
        } catch {
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
        return c.json({ error: 'not found', code: 'not_found' }, 404)
      }
    }
  }

  if (format === 'hast') {
    const res = new Response(JSON.stringify(derived!.body_hast), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl }
    })
    return res
  }
  if (format === 'json') {
    const res = new Response(JSON.stringify(derived), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl }
    })
    return res
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
