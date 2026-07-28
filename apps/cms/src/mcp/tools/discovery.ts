import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { parseFrontmatter } from "../../parse/frontmatter.js"
import { loadCollectionSchema } from "../../core/validate.js"
import type { Env } from "../../index.js"
import type { McpProps } from "../agent.js"

type McpToolResult = { isError?: boolean; content: Array<{ type: "text"; text: string }> }

function okResult(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] }
}

function errorResult(message: string, code: string, details?: unknown): McpToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message, code, details }) }] }
}

export async function listCollectionsHandler(env: Env): Promise<McpToolResult> {
  const list = await env.BUCKET.list({ prefix: "schema/" })
  const collections: Array<{ collection: string; description: string }> = []

  for (const obj of list.objects) {
    try {
      const item = await env.BUCKET.get(obj.key)
      if (!item) continue
      const raw = await item.text()
      const { frontmatter, body } = parseFrontmatter(raw)
      const collection = typeof frontmatter.collection === "string" ? frontmatter.collection : obj.key.replace("schema/", "").replace(/\.md$/, "")

      // Get description: first non-empty, non-heading line from guidelines body
      const lines = body.split("\n")
      let description = ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith("#")) {
          description = trimmed
          break
        }
      }

      collections.push({ collection, description })
    } catch {
      // skip malformed schema files
    }
  }

  return okResult(collections)
}

export async function getSchemaHandler(env: Env, args: { collection?: string }): Promise<McpToolResult> {
  if (args.collection) {
    try {
      const schema = await loadCollectionSchema(env, args.collection)

      // If slices exist, fetch each referenced slice schema
      if (schema.slices && typeof schema.slices === "object" && !Array.isArray(schema.slices)) {
        const sliceMap = schema.slices as Record<string, unknown>
        const sliceSchemas: Record<string, unknown> = {}
        for (const [sliceKey, sliceRef] of Object.entries(sliceMap)) {
          try {
            if (typeof sliceRef === "string") {
              const sliceSchema = await loadCollectionSchema(env, `slices/${sliceRef}`)
              sliceSchemas[sliceKey] = sliceSchema
            }
          } catch {
            // skip missing slice schemas
          }
        }
        if (Object.keys(sliceSchemas).length > 0) {
          return okResult({ schema, slices: sliceSchemas })
        }
      }

      return okResult(schema)
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : "Failed to load schema", "schema_not_found")
    }
  } else {
    // Return all schemas
    const list = await env.BUCKET.list({ prefix: "schema/" })
    const schemas: unknown[] = []

    for (const obj of list.objects) {
      // Skip directive schemas — handled separately below
      if (obj.key.startsWith("schema/directives/")) continue
      try {
        const key = obj.key.replace("schema/", "").replace(/\.md$/, "")
        const schema = await loadCollectionSchema(env, key)
        schemas.push(schema)
      } catch {
        // skip malformed schema files
      }
    }

    // Also include directive schemas
    try {
      const dirList = await env.BUCKET.list({ prefix: "schema/directives/" })
      for (const obj of dirList.objects) {
        try {
          const item = await env.BUCKET.get(obj.key)
          if (!item) continue
          const raw = await item.text()
          const { frontmatter, body } = parseFrontmatter(raw)
          if (frontmatter._kind === "directive_schema") {
            schemas.push({ _kind: "directive_schema", ...frontmatter, guidelines: body })
          }
        } catch {}
      }
    } catch {}

    return okResult(schemas)
  }
}

export function registerDiscoveryTools(
  server: McpServer,
  env: Env,
  getIdentity: () => McpProps["identity"]
): void {
  server.tool(
    "list_collections",
    "List all available content collections with their descriptions",
    {},
    async () => {
      return listCollectionsHandler(env)
    }
  )

  server.tool(
    "get_schema",
    "Get the schema for a collection, or all schemas if no collection specified",
    { collection: z.string().optional() },
    async (args) => {
      return getSchemaHandler(env, args)
    }
  )
}
