import type { Env } from "../index.js"

function parseOrigins(env: Env): string[] {
  const raw = (env as unknown as { CORS_ORIGINS?: string }).CORS_ORIGINS
  if (!raw) return []
  return raw.split(",").map(o => o.trim()).filter(Boolean)
}

function matchOrigin(origins: string[], origin: string | null): string | null {
  if (!origin) return null
  return origins.includes(origin) ? origin : null
}

export function applyCors(request: Request, response: Response, env: Env): Response {
  const origins = parseOrigins(env)
  if (origins.length === 0) return response

  const requestOrigin = request.headers.get("Origin")
  const matched = matchOrigin(origins, requestOrigin)
  if (!matched) return response

  const newHeaders = new Headers(response.headers)
  newHeaders.set("Access-Control-Allow-Origin", matched)
  newHeaders.set("Vary", "Origin")
  newHeaders.set("Access-Control-Allow-Credentials", "true")
  // Streamable HTTP MCP clients must be able to read the session header
  newHeaders.set("Access-Control-Expose-Headers", "Mcp-Session-Id")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}

export function handlePreflight(request: Request, env: Env): Response | null {
  if (request.method !== "OPTIONS") return null

  const origins = parseOrigins(env)
  if (origins.length === 0) return null

  const requestOrigin = request.headers.get("Origin")
  const matched = matchOrigin(origins, requestOrigin)
  if (!matched) return null

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": matched,
      "Vary": "Origin",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    },
  })
}
