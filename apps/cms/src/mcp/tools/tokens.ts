import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { logOp } from "../../core/op-log.js"
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

function isAdmin(identity: IdentityInfo): boolean {
  // McpProps carries capabilities as unknown; narrow to the auth shape
  return !!(identity.capabilities as { admin?: boolean }).admin
}

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function mintTokenHandler(
  env: Env,
  identity: IdentityInfo,
  args: {
    principal: string
    kind: string
    audience: string
    capabilities: Record<string, unknown>
    expires?: string
  }
): Promise<McpToolResult> {
  if (!isAdmin(identity)) {
    return errorResult("admin capability required", "capability_denied")
  }

  // Generate 32 random bytes as hex
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const rawToken = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("")

  const tokenHash = await sha256hex(rawToken)
  const now = new Date().toISOString()
  const capabilitiesJson = JSON.stringify(args.capabilities)

  await env.DB.prepare(
    `INSERT INTO tokens (token_hash, principal, kind, audience, capabilities, created, expires, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).bind(
    tokenHash,
    args.principal,
    args.kind,
    args.audience,
    capabilitiesJson,
    now,
    args.expires ?? null
  ).run()

  logOp(env, { session: identity.session, tool: "mint_token", outcome: "ok" })

  return okResult({
    token: rawToken,
    token_id: tokenHash,
    principal: args.principal,
    kind: args.kind,
    audience: args.audience,
    capabilities: args.capabilities,
    created: now,
    expires: args.expires ?? null,
    note: "Store this token securely — it will not be shown again.",
  })
}

export async function revokeTokenHandler(
  env: Env,
  identity: IdentityInfo,
  args: { token_id: string }
): Promise<McpToolResult> {
  if (!isAdmin(identity)) {
    return errorResult("admin capability required", "capability_denied")
  }

  const result = await env.DB.prepare(
    `UPDATE tokens SET revoked=1 WHERE token_hash=?`
  ).bind(args.token_id).run()

  if (!result.meta?.changes) {
    return errorResult("token not found", "not_found")
  }

  logOp(env, { session: identity.session, tool: "revoke_token", outcome: "ok" })

  return okResult({ revoked: true, token_id: args.token_id })
}

export async function listTokensHandler(
  env: Env,
  identity: IdentityInfo
): Promise<McpToolResult> {
  if (!isAdmin(identity)) {
    return errorResult("admin capability required", "capability_denied")
  }

  const rows = await env.DB.prepare(
    `SELECT token_hash, principal, kind, audience, capabilities, created, expires, last_used, revoked
     FROM tokens ORDER BY created DESC`
  ).all<{
    token_hash: string
    principal: string
    kind: string
    audience: string
    capabilities: string
    created: string
    expires: string | null
    last_used: string | null
    revoked: number
  }>()

  const tokens = (rows.results ?? []).map(row => ({
    id: row.token_hash,
    principal: row.principal,
    kind: row.kind,
    audience: row.audience,
    capabilities: (() => { try { return JSON.parse(row.capabilities) } catch { return {} } })(),
    created: row.created,
    expires: row.expires,
    last_used: row.last_used,
    revoked: row.revoked === 1,
  }))

  logOp(env, { session: identity.session, tool: "list_tokens", outcome: "ok" })

  return okResult({ tokens })
}

export function registerTokenTools(
  server: McpServer,
  env: Env,
  getIdentity: () => IdentityInfo
): void {
  server.tool(
    "mint_token",
    "Create a new bearer token. Requires admin capability. Returns the plaintext token ONCE — store it securely.",
    {
      principal: z.string(),
      kind: z.string(),
      audience: z.string(),
      capabilities: z.record(z.string(), z.unknown()),
      expires: z.string().optional(),
    },
    async (args) => mintTokenHandler(env, getIdentity(), args as {
      principal: string
      kind: string
      audience: string
      capabilities: Record<string, unknown>
      expires?: string
    })
  )

  server.tool(
    "revoke_token",
    "Revoke a token by its token_id (the SHA-256 hash of the raw bearer, as returned by list_tokens). Requires admin capability.",
    {
      token_id: z.string().length(64),
    },
    async (args) => revokeTokenHandler(env, getIdentity(), args)
  )

  server.tool(
    "list_tokens",
    "List all tokens (active and revoked). Returns token_hash as 'id' field — use this as token_id when revoking. Never returns plaintext token values. Requires admin capability.",
    {},
    async () => listTokensHandler(env, getIdentity())
  )
}
