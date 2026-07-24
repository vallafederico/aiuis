import type { Env } from "../index.js"

export function logOp(
  env: Env,
  entry: { session: string; tool: string; docId?: string; outcome: string; errorClass?: string }
): void {
  try {
    env.DB.prepare(
      `INSERT INTO op_log (at, session, tool, doc_id, outcome, error_class) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      new Date().toISOString(),
      entry.session,
      entry.tool,
      entry.docId ?? "",
      entry.outcome,
      entry.errorClass ?? ""
    ).run()
  } catch {
    // fire-and-forget, never throws
  }
}
