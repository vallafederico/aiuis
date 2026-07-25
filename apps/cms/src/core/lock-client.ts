import type { Env } from "../index.js"

export async function acquireLock(env: Env, docId: string, session: string): Promise<{ ok: true } | { error: "LOCKED"; holder: string }> {
  const id = env.LOCK_ROOM.idFromName("locks")
  const stub = env.LOCK_ROOM.get(id)
  const url = `https://lock-room/lock?action=acquire&docId=${encodeURIComponent(docId)}&session=${encodeURIComponent(session)}`
  const res = await stub.fetch(url)
  return res.json()
}

export async function releaseLock(env: Env, docId: string, session: string): Promise<void> {
  try {
    const id = env.LOCK_ROOM.idFromName("locks")
    const stub = env.LOCK_ROOM.get(id)
    const url = `https://lock-room/lock?action=release&docId=${encodeURIComponent(docId)}&session=${encodeURIComponent(session)}`
    await stub.fetch(url)
  } catch {
    // fire-and-forget
  }
}
