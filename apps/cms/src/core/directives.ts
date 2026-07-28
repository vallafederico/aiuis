import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkDirective from "remark-directive"
import { parseFrontmatter } from "../parse/frontmatter.js"
import type { Env } from "../index.js"

export interface DirectiveSchema {
  name: string
  form: string
  attributes: Record<string, unknown>
  intent: string
}

function walk(node: any, visitor: (n: any) => void) {
  visitor(node)
  if (node.children) {
    for (const child of node.children) walk(child, visitor)
  }
}

export async function loadDirectiveRegistry(env: Env): Promise<Map<string, DirectiveSchema>> {
  const registry = new Map<string, DirectiveSchema>()
  const list = await env.BUCKET.list({ prefix: "schema/directives/" })
  for (const obj of list.objects) {
    try {
      const item = await env.BUCKET.get(obj.key)
      if (!item) continue
      const raw = await item.text()
      const { frontmatter } = parseFrontmatter(raw)
      if (frontmatter._kind !== "directive_schema" || typeof frontmatter.name !== "string") continue
      const name = frontmatter.name as string
      registry.set(name, {
        name,
        form: typeof frontmatter.form === "string" ? frontmatter.form : "container",
        attributes: (frontmatter.attributes && typeof frontmatter.attributes === "object" && !Array.isArray(frontmatter.attributes))
          ? frontmatter.attributes as Record<string, unknown>
          : {},
        intent: typeof frontmatter.intent === "string" ? frontmatter.intent : "",
      })
    } catch {
      // skip malformed
    }
  }
  return registry
}

export type DirectiveValidationError =
  | { error: "slices_not_supported"; message: string }
  | { error: "unknown_directive"; name: string; known: string[] }
  | { error: "invalid_directive_attribute"; directive: string; attribute: string }

export function validateDirectives(body: string, registry: Map<string, DirectiveSchema>): DirectiveValidationError | null {
  // Check for slice containers (4+ colons)
  if (/^:{4,}/m.test(body)) {
    return { error: "slices_not_supported", message: "slices not yet supported" }
  }

  // Parse mdast
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)
  const mdast = processor.parse(body)

  const directiveTypes = new Set(["textDirective", "leafDirective", "containerDirective"])

  let found: DirectiveValidationError | null = null

  walk(mdast, (node: any) => {
    if (found) return
    if (!directiveTypes.has(node.type)) return

    const name: string = node.name

    if (!registry.has(name)) {
      found = { error: "unknown_directive", name, known: Array.from(registry.keys()) }
      return
    }

    const schema = registry.get(name)!
    const allowedAttrs = schema.attributes
    const nodeAttrs: Record<string, unknown> = node.attributes ?? {}

    // If attributes schema is empty object {}, no attributes are allowed
    const allowedKeys = Object.keys(allowedAttrs)

    for (const attrKey of Object.keys(nodeAttrs)) {
      if (allowedKeys.length === 0 || !Object.prototype.hasOwnProperty.call(allowedAttrs, attrKey)) {
        found = { error: "invalid_directive_attribute", directive: name, attribute: attrKey }
        return
      }
    }
  })

  return found
}
