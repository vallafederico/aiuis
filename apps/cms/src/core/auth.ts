import type { Env } from "../index.js"

export interface AuthedIdentity {
  principal: string
  kind: string
  audience: string
  capabilities: {
    publish: boolean
    collections: string[] | "*"
    namespaces: string[]
    admin?: boolean
  }
  session: string
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthError"
  }
}

export async function resolveIdentity(req: Request, env: Env): Promise<AuthedIdentity> {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header")
  }
  const token = authHeader.slice(7)

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  const hex = [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("")

  const now = new Date().toISOString()

  const row = await env.DB.prepare(
    `SELECT * FROM tokens WHERE token_hash=? AND (expires IS NULL OR expires > ?) AND revoked=0`
  ).bind(hex, now).first<{
    principal: string
    kind: string
    audience: string
    capabilities: string
  }>()

  if (!row) {
    throw new AuthError("Invalid or expired token")
  }

  // Fire-and-forget last_used stamp — do not await
  env.DB.prepare("UPDATE tokens SET last_used=? WHERE token_hash=?")
    .bind(now, hex)
    .run()
    .catch(() => {})

  const capabilities = JSON.parse(row.capabilities)
  const session = hex.slice(0, 8)

  return {
    principal: row.principal,
    kind: row.kind,
    audience: row.audience,
    capabilities,
    session,
  }
}

export function requireDevSecret(req: Request, env: Env): void {
  if ((env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT !== "dev") {
    throw new AuthError("Dev secret not available outside dev environment")
  }

  const fromHeader = req.headers.get("X-Dev-Secret")
  const fromAuth = req.headers.get("Authorization")?.replace("Bearer ", "")
  const provided = fromHeader ?? fromAuth ?? ""
  const expected = env.CMS_DEV_SECRET ?? ""

  // Constant-time comparison
  let match = provided.length === expected.length
  for (let i = 0; i < Math.max(provided.length, expected.length); i++) {
    if ((provided[i] ?? "") !== (expected[i] ?? "")) match = false
  }

  if (!match) {
    throw new AuthError("Invalid dev secret")
  }
}

export function requireAdmin(identity: AuthedIdentity): void {
  if (!identity.capabilities.admin) {
    throw new AuthError("admin capability required")
  }
}
