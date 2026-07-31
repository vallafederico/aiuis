import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkDirective from "remark-directive"
import remarkRehype from "remark-rehype"
import { defaultSchema } from "rehype-sanitize"
import rehypeSanitize from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"
import { parseFrontmatter } from "../parse/frontmatter.js"
import { logOp } from "../core/op-log.js"
import type { Env } from "../index.js"

export interface DeriveResult {
  body_html: string
  body_hast: unknown
  toc: Array<{ depth: number; text: string; slug: string }>
  excerpt: string
  reading_time: number
  title: string
  section: string
  slug: string
  assets: Array<{ path: string; width: number | null; height: number | null; lqip: string | null }>
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

function remarkNotesDirective() {
  return (tree: any) => {
    hastWalk(tree, (node: any) => {
      if (
        node.type === 'containerDirective' &&
        node.name === 'notes'
      ) {
        node.data = node.data ?? {}
        node.data.hName = 'aside'
        node.data.hProperties = { className: ['cms-notes'] }
      }
    })
  }
}

function remarkVideoDirective() {
  return (tree: any) => {
    hastWalk(tree, (node: any) => {
      if (node.type === 'leafDirective' && node.name === 'video') {
        const attrs = node.attributes ?? {}
        const src = typeof attrs.src === 'string' ? attrs.src : ''
        const poster = typeof attrs.poster === 'string' ? attrs.poster : undefined
        const caption = typeof attrs.caption === 'string' ? attrs.caption : undefined
        const ambient = attrs.ambient === '' || attrs.ambient === 'true' || attrs.ambient === true

        const resolvedSrc = src.startsWith('assets/') ? `/api/v1/${src}` : src
        const resolvedPoster = poster?.startsWith('assets/') ? `/api/v1/${poster}` : poster

        const videoProps: Record<string, unknown> = { src: resolvedSrc }
        if (resolvedPoster) videoProps.poster = resolvedPoster
        if (ambient) {
          videoProps.autoplay = true
          videoProps.muted = true
          videoProps.loop = true
          videoProps.playsinline = true
        } else {
          videoProps.controls = true
        }

        const videoEl: any = {
          type: 'element',
          tagName: 'video',
          properties: videoProps,
          children: [],
        }
        const children: any[] = [videoEl]
        if (caption) {
          children.push({
            type: 'element',
            tagName: 'figcaption',
            properties: {},
            children: [{ type: 'text', value: caption }],
          })
        }

        node.data = node.data ?? {}
        node.data.hName = 'figure'
        node.data.hProperties = { className: ['cms-figure', 'cms-video'] }
        node.data.hChildren = children
      }
    })
  }
}

type AssetMeta = { width: number | null; height: number | null; lqip: string | null }

function remarkImageTransform(assetMap: Map<string, AssetMeta>) {
  return (tree: any) => {
    hastWalk(tree, (node: any) => {
      if (node.type === "image" && typeof node.url === "string") {
        const orig = node.url
        node.data = node.data ?? {}
        node.data.hProperties = node.data.hProperties ?? {}
        if (orig.startsWith("assets/")) {
          node.data.hProperties.src = `/api/v1/${orig}`
          node.data.hProperties.loading = "lazy"
          node.data.hProperties.decoding = "async"
          const meta = assetMap.get(orig)
          if (meta?.width != null) node.data.hProperties.width = String(meta.width)
          if (meta?.height != null) node.data.hProperties.height = String(meta.height)
          if (meta?.lqip != null) node.data.hProperties["data-lqip"] = meta.lqip
        } else if (orig.startsWith("http://") || orig.startsWith("https://")) {
          node.data.hProperties.loading = "lazy"
          node.data.hProperties.decoding = "async"
        }
      }
    })
  }
}

function rehypeFigureWrap() {
  return (tree: any) => {
    hastWalk(tree, (node: any) => {
      if (
        node.type === "element" &&
        node.tagName === "p" &&
        node.children &&
        node.children.length === 1 &&
        node.children[0].type === "element" &&
        node.children[0].tagName === "img"
      ) {
        node.tagName = "figure"
        node.properties = { className: ["cms-figure"] }
      }
    })
  }
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
  const { body, frontmatter: fm } = parseFrontmatter(raw)
  const title = typeof fm.title === 'string' ? fm.title : ''
  const section = typeof fm.section === 'string' ? fm.section : ''

  // 3. Pre-scan mdast for asset references
  const preScanProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)
  const preScanTree = preScanProcessor.parse(body)
  const imageUrls: string[] = []
  hastWalk(preScanTree, (node: any) => {
    if (node.type === 'image' && typeof node.url === 'string' && node.url.startsWith('assets/')) {
      imageUrls.push(node.url)
    }
    if (node.type === 'leafDirective' && node.name === 'video') {
      const attrs = node.attributes ?? {}
      if (typeof attrs.src === 'string' && attrs.src.startsWith('assets/')) imageUrls.push(attrs.src)
      if (typeof attrs.poster === 'string' && attrs.poster.startsWith('assets/')) imageUrls.push(attrs.poster)
    }
  })

  // Batch-fetch asset metadata from D1
  const assetMap = new Map<string, AssetMeta>()
  const referencedPaths = [...new Set(imageUrls)]
  for (const url of referencedPaths) {
    const row = await env.DB.prepare(
      'SELECT width, height, lqip FROM assets WHERE path=?'
    ).bind(url).first<{ width: number | null; height: number | null; lqip: string | null }>()
    if (row) assetMap.set(url, row)
  }

  // 4. Build sanitize schema with img/figure support
  const notesSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'aside', 'figure', 'figcaption', 'img', 'video'],
    attributes: {
      ...(defaultSchema.attributes ?? {}),
      aside: [['className', 'cms-notes']] as Array<string | [string, ...string[]]>,
      figure: [['className', 'cms-figure', 'cms-video']] as Array<string | [string, ...string[]]>,
      figcaption: [] as Array<string | [string, ...string[]]>,
      img: [
        ['src', /^https?:\/\//, /^\/api\/v1\/assets\//],
        'alt', 'width', 'height', 'loading', 'decoding', 'data-lqip',
      ] as Array<string | [string, ...unknown[]]>,
      video: [
        ['src', /^\/api\/v1\/assets\//],
        ['poster', /^\/api\/v1\/assets\//],
        'controls', 'autoplay', 'muted', 'loop', 'playsinline',
      ] as Array<string | [string, ...unknown[]]>,
    },
  }

  // 5. Run unified pipeline
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkNotesDirective)
    .use(remarkVideoDirective)
    .use(remarkImageTransform, assetMap)
    .use(remarkRehype)
    .use(rehypeFigureWrap)
    .use(rehypeSanitize, notesSchema as Parameters<typeof rehypeSanitize>[0])

  const mdast = processor.parse(body)

  // Defensive: log any unregistered directives that reach derivation
  const directiveTypes = new Set(['textDirective', 'leafDirective', 'containerDirective'])
  hastWalk(mdast, (node: any) => {
    if (directiveTypes.has(node.type) && node.name !== 'notes' && node.name !== 'video') {
      logOp(env, { session: 'derive', tool: 'deriveDoc', outcome: 'dropped_directive', errorClass: `unregistered:${node.name}` })
    }
  })

  // 6. Get body_hast after sanitize but before stringify
  const body_hast = await processor.run(mdast)

  // 7. Extract TOC
  const toc: Array<{ depth: number; text: string; slug: string }> = []
  hastWalk(body_hast, (node) => {
    if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
      const depth = parseInt(node.tagName[1], 10)
      const text = hastText(node)
      const slugStr = toSlug(text)
      toc.push({ depth, text, slug: slugStr })
    }
  })

  // 8. Extract excerpt
  let excerpt = ''
  hastWalk(body_hast, (node) => {
    if (!excerpt && node.type === 'element' && node.tagName === 'p') {
      excerpt = hastText(node)
    }
  })

  // 9. Compute reading_time
  const wordCount = body.split(/\s+/).filter((w: string) => w.length > 0).length
  const reading_time = Math.max(0.5, Math.ceil(wordCount / 200 * 2) / 2)

  // 10. Shiki syntax highlighting
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

  // 11. Serialize highlighted hast to HTML
  const body_html = unified().use(rehypeStringify).stringify(body_hast as any)

  // 12. Build assets list (only referenced ones that were found in D1)
  const assets = referencedPaths
    .filter(p => assetMap.has(p))
    .map(p => {
      const meta = assetMap.get(p)!
      return { path: p, width: meta.width, height: meta.height, lqip: meta.lqip }
    })

  const result: DeriveResult = {
    body_html,
    body_hast,
    toc,
    excerpt,
    reading_time,
    title,
    section,
    slug,
    assets,
  }

  // 13. Write artifact to R2
  await env.BUCKET.put(`derived/${collection}/${slug}/${rev}.json`, JSON.stringify(result))

  // 14. Mirror to KV
  await env.KV.put(`derived:${collection}/${slug}:${rev}`, JSON.stringify(result))

  return result
}

export async function deriveLqip(env: Env, imageKey: string): Promise<null> { return null }
export async function deriveSrcset(env: Env, imageKey: string): Promise<null> { return null }
export async function deriveEmbedding(env: Env, collection: string, slug: string, rev: string): Promise<null> { return null }
