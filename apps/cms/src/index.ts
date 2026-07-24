import { Hono } from "hono";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  KV: KVNamespace;
  DERIVE_QUEUE: Queue;
  MCP_AGENT: DurableObjectNamespace;
  LOCK_ROOM: DurableObjectNamespace;
  CMS_DEV_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ name: "aiuis-cms", ok: true });
});

export default {
  fetch: app.fetch,
};

export class CmsMcpAgent implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("Not implemented", { status: 501 });
  }
}

export class LockRoom implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("Not implemented", { status: 501 });
  }
}
