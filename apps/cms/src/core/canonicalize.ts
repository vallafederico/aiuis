import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkDirective from "remark-directive"
import remarkStringify from "remark-stringify"
import { parseFrontmatter, dumpFrontmatter } from "../parse/frontmatter.js"

const STRINGIFY_OPTIONS = {
  bullet: "-" as const,
  emphasis: "_" as const,
  strong: "*" as const,
  fence: "`" as const,
  fences: true,
  incrementListMarker: false,
  rule: "-" as const,
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkStringify, STRINGIFY_OPTIONS)

export async function canonicalize(raw: string): Promise<string> {
  const { frontmatter, body } = parseFrontmatter(raw)
  const processedBody = String(await processor.process(body))
  return dumpFrontmatter(frontmatter, processedBody)
}
