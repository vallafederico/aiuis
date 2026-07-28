import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import type { Env } from "../index.js"

function walkMdast(node: any, visitor: (n: any) => void) {
  visitor(node)
  if (node.children) {
    for (const child of node.children) walkMdast(child, visitor)
  }
}

export async function validateBodyImages(
  env: Env,
  body: string
): Promise<{ error: "asset_not_found"; path: string; field: "body" } | null> {
  const processor = unified().use(remarkParse).use(remarkGfm)
  const tree = processor.parse(body)

  const imageUrls: string[] = []
  walkMdast(tree, (node: any) => {
    if (node.type === "image" && typeof node.url === "string") {
      imageUrls.push(node.url)
    }
  })

  for (const url of imageUrls) {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      // External URLs are allowed as-is
      continue
    }
    if (url.startsWith("assets/")) {
      const row = await env.DB.prepare(
        "SELECT path FROM assets WHERE path=?"
      ).bind(url).first<{ path: string }>()
      if (!row) {
        return { error: "asset_not_found", path: url, field: "body" }
      }
    } else {
      // Relative but not assets/ — not allowed
      return { error: "asset_not_found", path: url, field: "body" }
    }
  }

  return null
}
