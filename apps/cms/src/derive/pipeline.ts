import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import { defaultSchema } from "rehype-sanitize"
import rehypeSanitize from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"
import { parseFrontmatter } from "../parse/frontmatter.js"
import type { Env } from "../index.js"

export interface DeriveResult {
  body_html: string
  body_hast: unknown
  toc: Array<{ depth: number; text: string; slug: string }>
  excerpt: string
  reading_time: number
}

function hastText(node: any): string {
  if (node.type === 'text') return node.value
  if (node.children) return node.children.map(hastText).join('')
  return ''
}

function hastWalk(node: any, visitor: (n: any, parent: any | null) => void, parent: any = null) {
  visitor(node, parent)
  if (node.children) {
    for (const child of node.children) hastWalk(child, visitor, node)
  }
}

function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

export async function deriveDoc(
  env: Env,
  collection: string,
  slug: string,
  rev: string,
  opts?: { skipCache?: boolean }
): Promise<DeriveResult> {
  // 1. Fetch content from R2
  const r2Key = `revisions/${collection}/${slug}/${rev}.md`
  const obj = await env.BUCKET.get(r2Key)
  if (!obj) throw new Error(`R2 object not found: ${r2Key}`)
  const raw = await obj.text()

  // 2. Parse frontmatter
  const { body } = parseFrontmatter(raw)

  // 3. Run unified pipeline
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, defaultSchema)

  const mdast = processor.parse(body)
  // 4. Get body_hast after sanitize but before stringify
  const body_hast = await processor.run(mdast)

  // 5. Extract TOC
  const toc: Array<{ depth: number; text: string; slug: string }> = []
  hastWalk(body_hast, (node) => {
    if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
      const depth = parseInt(node.tagName[1], 10)
      const text = hastText(node)
      const slugStr = toSlug(text)
      toc.push({ depth, text, slug: slugStr })
    }
  })

  // 6. Extract excerpt
  let excerpt = ''
  hastWalk(body_hast, (node) => {
    if (!excerpt && node.type === 'element' && node.tagName === 'p') {
      excerpt = hastText(node)
    }
  })

  // 7. Compute reading_time
  const wordCount = body.split(/\s+/).filter((w: string) => w.length > 0).length
  const reading_time = Math.max(0.5, Math.ceil(wordCount / 200 * 2) / 2)

  // 8. Shiki syntax highlighting
  try {
    const { createHighlighter } = await import('shiki')
    const highlighter = await createHighlighter({
      themes: ['github-dark'],
      langs: ['typescript', 'tsx', 'javascript', 'css', 'html', 'glsl', 'json', 'bash', 'markdown'],
    })

    const preNodes: Array<{ node: any; parent: any; index: number }> = []
    hastWalk(body_hast, (node, parent) => {
      if (
        node.type === 'element' &&
        node.tagName === 'pre' &&
        parent !== null
      ) {
        const codeNode = node.children?.find((c: any) => c.type === 'element' && c.tagName === 'code')
        if (codeNode) {
          const classes: string[] = codeNode.properties?.className ?? []
          const langClass = classes.find((cls: string) => cls.startsWith('language-'))
          if (langClass) {
            const idx = parent.children.indexOf(node)
            preNodes.push({ node, parent, index: idx })
          }
        }
      }
    })

    for (const { node, parent, index } of preNodes) {
      try {
        const codeNode = node.children.find((c: any) => c.type === 'element' && c.tagName === 'code')
        const classes: string[] = codeNode.properties?.className ?? []
        const langClass = classes.find((cls: string) => cls.startsWith('language-'))!
        const lang = langClass.replace('language-', '')
        const code = hastText(codeNode)
        const highlighted = highlighter.codeToHast(code, { theme: 'github-dark', lang })
        // highlighted is a Root node; use .children[0] (the <pre>) to replace
        if (highlighted.children?.[0]) {
          parent.children[index] = highlighted.children[0]
        }
      } catch {
        // skip individual block on error
      }
    }
  } catch {
    // createHighlighter not available in test env — skip
  }

  // 9. Serialize highlighted hast to HTML
  const body_html = unified().use(rehypeStringify).stringify(body_hast as any)

  const result: DeriveResult = {
    body_html,
    body_hast,
    toc,
    excerpt,
    reading_time,
  }

  // 10. Write artifact to R2
  await env.BUCKET.put(`derived/${collection}/${slug}/${rev}.json`, JSON.stringify(result))

  // 11. Mirror to KV
  await env.KV.put(`derived:${collection}/${slug}:${rev}`, JSON.stringify(result))

  return result
}

export async function deriveLqip(env: Env, imageKey: string): Promise<null> { return null }
export async function deriveSrcset(env: Env, imageKey: string): Promise<null> { return null }
export async function deriveEmbedding(env: Env, collection: string, slug: string, rev: string): Promise<null> { return null }
