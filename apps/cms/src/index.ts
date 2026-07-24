import { Hono } from "hono"
import { requireDevSecret } from "./core/auth.js"
import { reindexFromR2 } from "./core/revision.js"

export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  KV: KVNamespace
  DERIVE_QUEUE: Queue
  MCP_AGENT: DurableObjectNamespace
  LOCK_ROOM: DurableObjectNamespace
  CMS_DEV_SECRET: string
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

export default {
  fetch: app.fetch,
}

export class CmsMcpAgent implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("Not implemented", { status: 501 })
  }
}

export class LockRoom implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("Not implemented", { status: 501 })
  }
}
