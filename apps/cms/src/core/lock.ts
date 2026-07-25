import type { Env } from "../index.js"

interface LockEntry {
  holder: string   // session id
  heldUntil: number  // Date.now() + 60000
}

export class LockRoom implements DurableObject {
  private locks = new Map<string, LockEntry>()

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const docId = url.searchParams.get("docId") ?? ""
    const session = url.searchParams.get("session") ?? ""
    const action = url.searchParams.get("action") ?? ""

    if (action === "acquire") {
      const existing = this.locks.get(docId)
      const now = Date.now()
      if (existing && existing.heldUntil > now && existing.holder !== session) {
        return new Response(JSON.stringify({ error: "LOCKED", holder: existing.holder }), {
          status: 409,
          headers: { "Content-Type": "application/json" }
        })
      }
      this.locks.set(docId, { holder: session, heldUntil: now + 60000 })
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })
    }

    if (action === "release") {
      const existing = this.locks.get(docId)
      if (existing && existing.holder === session) {
        this.locks.delete(docId)
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })
    }

    return new Response("bad request", { status: 400 })
  }
}
