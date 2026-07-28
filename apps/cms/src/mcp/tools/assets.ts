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

function checkContentCapability(identity: IdentityInfo): McpToolResult | null {
  const caps = identity.capabilities as { namespaces?: string[] }
  const namespaces = caps?.namespaces ?? []
  if (!namespaces.includes("content")) {
    return errorResult(
      "capability denied: token cannot write assets without content namespace",
      "capability_denied"
    )
  }
  return null
}

const MIME_EXT_MAP: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/avif": [".avif"],
  "image/gif": [".gif"],
}

const SLUG_SAFE = /^[a-z0-9][a-z0-9._-]*$/

function getImageDimensions(
  bytes: Uint8Array,
  mime: string
): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      // PNG signature: 8 bytes, then IHDR chunk
      const sig = [137, 80, 78, 71, 13, 10, 26, 10]
      for (let i = 0; i < 8; i++) {
        if (bytes[i] !== sig[i]) return null
      }
      if (bytes.length < 24) return null
      const width =
        (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
      const height =
        (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
      return { width: width >>> 0, height: height >>> 0 }
    }

    if (mime === "image/jpeg") {
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
      let offset = 2
      while (offset < bytes.length - 1) {
        if (bytes[offset] !== 0xff) return null
        const marker = bytes[offset + 1]
        // SOF markers: C0, C1, C2
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          if (offset + 8 >= bytes.length) return null
          // length (2) + precision (1) + height (2) + width (2)
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
          return { width, height }
        }
        if (marker === 0xd9 || marker === 0xda) break // EOI or SOS
        const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3]
        offset += 2 + segLen
      }
      return null
    }

    if (mime === "image/webp") {
      if (bytes.length < 16) return null
      // RIFF....WEBP
      if (
        bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
        bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50
      ) return null

      const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])

      if (chunk === "VP8 ") {
        // Simple lossy: width/height at bytes 26-29
        if (bytes.length < 30) return null
        const width = ((bytes[27] << 8) | bytes[26]) & 0x3fff
        const height = ((bytes[29] << 8) | bytes[28]) & 0x3fff
        return { width, height }
      }

      if (chunk === "VP8L") {
        // Lossless: bytes 21-24 encode (width-1) in 14 bits, (height-1) in 14 bits
        if (bytes.length < 25) return null
        const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24]
        const bits = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
        const width = (bits & 0x3fff) + 1
        const height = ((bits >> 14) & 0x3fff) + 1
        return { width, height }
      }

      if (chunk === "VP8X") {
        // Extended: width at bytes 24-26 (3 bytes LE, +1), height at 27-29 (3 bytes LE, +1)
        if (bytes.length < 30) return null
        const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1
        const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1
        return { width, height }
      }

      return null
    }

    // AVIF, GIF: skip
    return null
  } catch {
    return null
  }
}

export type UploadAssetArgs = {
  path: string
  content_base64: string
  mime: string
  overwrite?: boolean
}

export async function uploadAssetHandler(
  env: Env,
  identity: IdentityInfo,
  args: UploadAssetArgs
): Promise<McpToolResult> {
  // 1. Capability check
  const capCheck = checkContentCapability(identity)
  if (capCheck) return capCheck

  // 2. Normalize and validate path
  const { path, content_base64, mime, overwrite } = args

  if (!path.startsWith("assets/")) {
    return errorResult("asset path must start with 'assets/'", "asset_path_invalid")
  }

  // 3. Validate path segments
  const segments = path.slice("assets/".length).split("/")
  for (const seg of segments) {
    if (!SLUG_SAFE.test(seg)) {
      return errorResult(
        `invalid path segment '${seg}': must match [a-z0-9][a-z0-9._-]*`,
        "asset_path_invalid"
      )
    }
  }

  // 4. Validate extension matches mime
  const allowedExts = MIME_EXT_MAP[mime]
  if (!allowedExts) {
    return errorResult(`unsupported mime type: ${mime}`, "mime_extension_mismatch")
  }
  const lastSeg = segments[segments.length - 1]
  const dotIdx = lastSeg.lastIndexOf(".")
  const ext = dotIdx !== -1 ? lastSeg.slice(dotIdx).toLowerCase() : ""
  if (!allowedExts.includes(ext)) {
    return errorResult(
      `extension '${ext}' does not match mime '${mime}' (expected: ${allowedExts.join(", ")})`,
      "mime_extension_mismatch"
    )
  }

  // 5. Decode base64
  const bytes = Buffer.from(content_base64, "base64")
  const size = bytes.length

  // 6. Size check
  if (size > 10 * 1024 * 1024) {
    return errorResult("asset exceeds 10MB limit", "asset_too_large")
  }

  // 7. Check for existing asset
  if (!overwrite) {
    const existing = await env.DB.prepare(
      "SELECT path FROM assets WHERE path=?"
    ).bind(path).first<{ path: string }>()
    if (existing) {
      return errorResult("asset already exists; use overwrite:true to replace", "asset_exists")
    }
  }

  // 8. Compute dimensions
  const uint8 = new Uint8Array(bytes)
  const dims = getImageDimensions(uint8, mime)
  const width = dims?.width ?? null
  const height = dims?.height ?? null

  // 9. LQIP: deferred — always null for now
  const lqip: string | null = null

  // 10. R2 put
  await env.BUCKET.put(path, bytes, {
    httpMetadata: { contentType: mime },
  })

  // 11. D1 insert (upsert on overwrite)
  const created = new Date().toISOString()
  if (overwrite) {
    await env.DB.prepare(
      `INSERT INTO assets (path, mime, size, width, height, lqip, principal, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         mime=excluded.mime, size=excluded.size, width=excluded.width,
         height=excluded.height, lqip=excluded.lqip, principal=excluded.principal, created=excluded.created`
    ).bind(path, mime, size, width, height, lqip, identity.principal, created).run()
  } else {
    await env.DB.prepare(
      `INSERT INTO assets (path, mime, size, width, height, lqip, principal, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(path, mime, size, width, height, lqip, identity.principal, created).run()
  }

  // 12. logOp
  logOp(env, { session: identity.session, tool: "upload_asset", outcome: "ok" })

  // 13. Return
  return okResult({ path, mime, size, width, height, lqip })
}

export type ListAssetsArgs = {
  prefix?: string
}

export async function listAssetsHandler(
  env: Env,
  identity: IdentityInfo,
  args: ListAssetsArgs
): Promise<McpToolResult> {
  const prefix = args.prefix ?? "assets/"
  const pattern = `${prefix}%`

  const rows = await env.DB.prepare(
    `SELECT path, mime, size, width, height, lqip, created
     FROM assets
     WHERE path LIKE ?
     ORDER BY created DESC
     LIMIT 100`
  ).bind(pattern).all<{
    path: string
    mime: string
    size: number
    width: number | null
    height: number | null
    lqip: string | null
    created: string
  }>()

  logOp(env, { session: identity.session, tool: "list_assets", outcome: "ok" })

  return okResult({ assets: rows.results })
}

export function registerAssetTools(
  server: McpServer,
  env: Env,
  getIdentity: () => IdentityInfo
): void {
  server.tool(
    "upload_asset",
    "Upload a binary asset (image) to R2 storage and register it in the CMS",
    {
      path: z.string(),
      content_base64: z.string(),
      mime: z.string(),
      overwrite: z.boolean().optional(),
    },
    async (args) => {
      return uploadAssetHandler(env, getIdentity(), args as UploadAssetArgs)
    }
  )

  server.tool(
    "list_assets",
    "List uploaded assets, optionally filtered by path prefix",
    {
      prefix: z.string().optional(),
    },
    async (args) => {
      return listAssetsHandler(env, getIdentity(), args as ListAssetsArgs)
    }
  )
}
