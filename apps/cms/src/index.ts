import { Hono } from "hono"
import { requireDevSecret, resolveIdentity } from "./core/auth.js"
import type { AuthedIdentity } from "./core/auth.js"
import { reindexFromR2 } from "./core/revision.js"
import { CmsMcpAgent } from "./mcp/agent.js"

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
}

export class LockRoom implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(_request: Request): Promise<Response> {
    return new Response("Not implemented", { status: 501 })
  }
}
