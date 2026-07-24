import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { parseFrontmatter } from "../../parse/frontmatter.js"
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

export async function queryHandler(
  env: Env,
  _identity: IdentityInfo,
  args: { collection: string; filter?: Record<string, unknown>; status?: string; sort?: "created" | "updated" | "title"; limit?: number; cursor?: string }
): Promise<McpToolResult> {
  const limit = Math.min(args.limit ?? 20, 50)
  const offset = parseInt(args.cursor ?? "0") || 0
  const sortMap: Record<string, string> = { created: "created", updated: "updated", title: "title" }
  const sort = sortMap[args.sort ?? ""] ?? "updated"

  let query = `SELECT id, collection, slug, status, title, created, updated, head_rev FROM documents WHERE collection=?`
  const params: unknown[] = [args.collection]

  if (args.status) {
    query += ` AND status=?`
    params.push(args.status)
  }

  query += ` ORDER BY ${sort} LIMIT ? OFFSET ?`
  params.push(limit, offset)

  const stmt = env.DB.prepare(query)
  const result = await stmt.bind(...params).all()
  const results = result.results

  const nextCursor = results.length === limit ? String(offset + limit) : null

  return okResult({ results, next_cursor: nextCursor })
}

export async function readDocHandler(
  env: Env,
  _identity: IdentityInfo,
  args: { id: string; rev?: string }
): Promise<McpToolResult> {
  let collection: string
  let slug: string

  const isUlid = args.id.length === 26 && /^[0-9A-Z]+$/.test(args.id)

  if (isUlid) {
    const row = await env.DB.prepare(
      `SELECT collection, slug FROM documents WHERE id=?`
    ).bind(args.id).first<{ collection: string; slug: string }>()

    if (!row) {
      return errorResult("not found", "not_found")
    }

    collection = row.collection
    slug = row.slug
  } else {
    const slashIdx = args.id.indexOf("/")
    if (slashIdx === -1) {
      return errorResult("not found", "not_found")
    }
    collection = args.id.slice(0, slashIdx)
    slug = args.id.slice(slashIdx + 1)
  }

  let key: string
  if (args.rev) {
    key = `revisions/${collection}/${slug}/${args.rev}.md`
  } else {
    key = `content/${collection}/${slug}.md`
  }

  const obj = await env.BUCKET.get(key)
  if (!obj) {
    return errorResult("not found", "not_found")
  }

  const raw = await obj.text()
  const { frontmatter, body } = parseFrontmatter(raw)

  return okResult({ frontmatter, body, raw })
}

export async function searchHandler(
  env: Env,
  _identity: IdentityInfo,
  args: { q: string; collection?: string; limit?: number }
): Promise<McpToolResult> {
  const limit = Math.min(args.limit ?? 20, 50)
  const sanitizedQ = `"${args.q.replace(/"/g, '""')}"`

  try {
    // Use subquery to avoid FTS5 MATCH alias issues in D1
    let query = `SELECT d.id, d.collection, d.slug, d.status, d.title, d.created, d.updated FROM documents d WHERE d.id IN (SELECT id FROM documents_fts WHERE documents_fts MATCH ?)`
    const params: unknown[] = [sanitizedQ]

    if (args.collection) {
      query += ` AND d.collection=?`
      params.push(args.collection)
    }

    query += ` LIMIT ?`
    params.push(limit)

    const stmt = env.DB.prepare(query)
    const result = await stmt.bind(...params).all()

    return okResult({ results: result.results })
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : "Search failed", "search_error")
  }
}

export function registerReadTools(
  server: McpServer,
  env: Env,
  getIdentity: () => IdentityInfo
): void {
  server.tool(
    "query",
    "Query documents in a collection with optional filtering and sorting",
    {
      collection: z.string(),
      filter: z.record(z.string(), z.unknown()).optional(),
      status: z.string().optional(),
      sort: z.enum(["created", "updated", "title"]).optional(),
      limit: z.number().int().min(1).max(50).optional().default(20),
      cursor: z.string().optional(),
    },
    async (args) => {
      return queryHandler(env, getIdentity(), args)
    }
  )

  server.tool(
    "read_doc",
    "Read a document by ID (ULID or collection/slug) with optional revision",
    {
      id: z.string(),
      rev: z.string().optional(),
    },
    async (args) => {
      return readDocHandler(env, getIdentity(), args)
    }
  )

  server.tool(
    "search",
    "Full-text search documents",
    {
      q: z.string(),
      collection: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().default(20),
    },
    async (args) => {
      return searchHandler(env, getIdentity(), args)
    }
  )
}
