/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env, SELF } from "cloudflare:test"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { deriveDoc } from "../../src/derive/pipeline.js"
import { createDocHandler } from "../../src/mcp/tools/write.js"
import { publishHandler, unpublishHandler } from "../../src/mcp/tools/lifecycle.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human",
  session: "phase4sess",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] as string[] }
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  // Seed schema for articles
  await testEnv.BUCKET.put("schema/articles.md", `---
_kind: schema
collection: articles
body: markdown
fields:
  title:
    type: string
    required: true
    max: 120
  slug:
    type: slug
    required: true
  date:
    type: datetime
    required: true
indexes: []
---
Guidelines.
`)
})

describe("Phase 4: Derivation pipeline & read API", () => {
  it("deriveDoc: produces html, toc, excerpt, reading_time and writes artifacts", async () => {
    const rev = "01TESTREV0000000000000001"
    const rawContent = `---
title: Pipeline Test
slug: pipeline-test
date: 2024-01-01T00:00:00.000Z
---
Hello world, this is the first paragraph.

<script>alert('xss')</script>

## Section One

Some content here.

## Section Two

More content.
`
    await testEnv.BUCKET.put(`revisions/articles/pipeline-test/${rev}.md`, rawContent)

    const result = await deriveDoc(testEnv, "articles", "pipeline-test", rev)

    expect(result.body_html).toContain("<p>")
    expect(result.body_html).not.toContain("<script>")
    expect(result.toc).toEqual(expect.arrayContaining([
      expect.objectContaining({ depth: 2, text: "Section One", slug: "section-one" }),
      expect.objectContaining({ depth: 2, text: "Section Two", slug: "section-two" }),
    ]))
    expect(result.excerpt).toBe("Hello world, this is the first paragraph.")
    expect(result.reading_time).toBeGreaterThan(0)

    // Artifact in R2
    const r2Artifact = await testEnv.BUCKET.get(`derived/articles/pipeline-test/${rev}.json`)
    expect(r2Artifact).not.toBeNull()

    // Artifact in KV
    const kvArtifact = await testEnv.KV.get(`derived:articles/pipeline-test:${rev}`)
    expect(kvArtifact).not.toBeNull()
  })

  it("publish sets published_rev, KV ptr, and card", async () => {
    const created = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "Pub Test", slug: "pub-test", date: "2024-01-01T00:00:00.000Z" },
      body: "This is the body of the publish test article.",
    })
    const parsed = JSON.parse(created.content[0].text)
    const docId = parsed.id
    const baseRev = parsed.rev

    const result = await publishHandler(testEnv, identity, { id: docId, base_rev: baseRev })
    expect(result.isError).toBeFalsy()

    // Check published_rev in DB
    const row = await testEnv.DB.prepare("SELECT published_rev, card FROM documents WHERE id=?").bind(docId).first<{ published_rev: string | null; card: string }>()
    expect(row?.published_rev).not.toBeNull()

    // Check KV ptr
    const ptr = await testEnv.KV.get("ptr:articles/pub-test")
    expect(ptr).not.toBeNull()
    expect(ptr).toBe(row?.published_rev)

    // Check card
    const card = JSON.parse(row?.card ?? "{}")
    expect(card.title).toBe("Pub Test")
    expect(typeof card.excerpt).toBe("string")
    expect(typeof card.reading_time).toBe("number")
  })

  it("unpublish clears published_rev and KV ptr", async () => {
    // Create and publish
    const created = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "Unpub Test", slug: "unpub-test", date: "2024-01-01T00:00:00.000Z" },
      body: "Article content for unpublish test.",
    })
    const parsed = JSON.parse(created.content[0].text)
    await publishHandler(testEnv, identity, { id: parsed.id, base_rev: parsed.rev })

    // Get updated head rev after publish
    const afterPub = await testEnv.DB.prepare("SELECT head_rev FROM documents WHERE id=?").bind(parsed.id).first<{ head_rev: string }>()

    // Unpublish
    const result = await unpublishHandler(testEnv, identity, { id: parsed.id })
    expect(result.isError).toBeFalsy()

    // Check published_rev cleared
    const row = await testEnv.DB.prepare("SELECT published_rev FROM documents WHERE id=?").bind(parsed.id).first<{ published_rev: string | null }>()
    expect(row?.published_rev).toBeNull()

    // Check KV ptr deleted
    const ptr = await testEnv.KV.get("ptr:articles/unpub-test")
    expect(ptr).toBeNull()
  })

  it("Read API list returns only published docs", async () => {
    // Create two docs, publish only one
    const doc1 = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "List Published", slug: "list-published", date: "2024-01-01T00:00:00.000Z" },
      body: "Published article content.",
    })
    const doc2 = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "List Draft", slug: "list-draft", date: "2024-01-01T00:00:00.000Z" },
      body: "Draft article content.",
    })

    const parsed1 = JSON.parse(doc1.content[0].text)
    await publishHandler(testEnv, identity, { id: parsed1.id, base_rev: parsed1.rev })

    const res = await SELF.fetch(new Request("http://localhost/api/v1/articles"))
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<{ slug: string }> }
    const slugs = body.items.map((i) => i.slug)
    expect(slugs).toContain("list-published")
    expect(slugs).not.toContain("list-draft")
  })

  it("Read API slug route serves html", async () => {
    const created = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "Html Serve", slug: "html-serve", date: "2024-01-01T00:00:00.000Z" },
      body: "Serve me as HTML please.",
    })
    const parsed = JSON.parse(created.content[0].text)
    await publishHandler(testEnv, identity, { id: parsed.id, base_rev: parsed.rev })

    const res = await SELF.fetch(new Request("http://localhost/api/v1/articles/html-serve?format=html"))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("<p>")
  })

  it("Rev-addressed request returns immutable cache header", async () => {
    const created = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "Cache Test", slug: "cache-test", date: "2024-01-01T00:00:00.000Z" },
      body: "Test immutable cache header.",
    })
    const parsed = JSON.parse(created.content[0].text)
    await publishHandler(testEnv, identity, { id: parsed.id, base_rev: parsed.rev })

    // Get published rev
    const row = await testEnv.DB.prepare("SELECT published_rev FROM documents WHERE id=?").bind(parsed.id).first<{ published_rev: string }>()
    const rev = row!.published_rev

    const res = await SELF.fetch(new Request(`http://localhost/api/v1/articles/cache-test?rev=${rev}&format=html`))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
  })

  it("Draft not visible without auth", async () => {
    const created = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "Draft Invisible", slug: "draft-invisible", date: "2024-01-01T00:00:00.000Z" },
      body: "This is a draft that should not be visible.",
    })
    // Do NOT publish

    const res = await SELF.fetch(new Request("http://localhost/api/v1/articles/draft-invisible"))
    expect(res.status).toBe(404)
  })

  it("FTS search returns published docs and not drafts", async () => {
    const uniqueWord = "xyzuniqword99887766"
    const created = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "FTS Published", slug: "fts-published", date: "2024-01-01T00:00:00.000Z" },
      body: `Find me with search: ${uniqueWord}`,
    })
    const parsed = JSON.parse(created.content[0].text)
    await publishHandler(testEnv, identity, { id: parsed.id, base_rev: parsed.rev })

    // Also create a draft with the same unique word
    await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: { title: "FTS Draft", slug: "fts-draft", date: "2024-01-01T00:00:00.000Z" },
      body: `Draft with search: ${uniqueWord}`,
    })

    const res = await SELF.fetch(new Request(`http://localhost/api/v1/search?q=${uniqueWord}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { results: Array<{ slug: string }> }
    const slugs = body.results.map((r) => r.slug)
    expect(slugs).toContain("fts-published")
    expect(slugs).not.toContain("fts-draft")
  })

  it("deriveDoc: :::notes directive → <aside class=\"cms-notes\"> in html, absent from toc", async () => {
    const rev = "01TESTREV0000000000000099"
    const rawContent = `---
title: Notes Directive Test
slug: notes-directive-test
date: 2024-01-01T00:00:00.000Z
---
Opening paragraph.

## Section

Some content.

:::notes
This is a note. <script>alert('xss')</script>
:::
`
    await testEnv.BUCKET.put(`revisions/articles/notes-directive-test/${rev}.md`, rawContent)

    const result = await deriveDoc(testEnv, "articles", "notes-directive-test", rev)

    expect(result.body_html).toContain('<aside class="cms-notes">')
    expect(result.body_html).not.toContain('<script>')
    expect(result.body_html).toContain('This is a note.')
    // Notes aside should NOT appear in TOC (only headings do)
    const tocTexts = result.toc.map((t: any) => t.text)
    expect(tocTexts).toContain('Section')
    expect(tocTexts).not.toContain('Notes') // no h2 Notes heading anymore
    expect(tocTexts).not.toContain('This is a note.')
  })

  it("deriveDoc: :::foreword directive → <aside class=\"cms-foreword\"> in html", async () => {
    const rev = "01TESTREV0000000000000100"
    const rawContent = `---
title: Foreword Directive Test
slug: foreword-directive-test
date: 2024-01-01T00:00:00.000Z
---
:::foreword
A short lead-in before the body.
:::

Opening paragraph.
`
    await testEnv.BUCKET.put(`revisions/articles/foreword-directive-test/${rev}.md`, rawContent)

    const result = await deriveDoc(testEnv, "articles", "foreword-directive-test", rev)

    expect(result.body_html).toContain('<aside class="cms-foreword">')
    expect(result.body_html).toContain('A short lead-in before the body.')
  })
})

describe("migrate-notes route", () => {
  const migrateIdentity = {
    principal: "migration",
    kind: "agent" as const,
    session: "migrate-notes",
    audience: "dev",
    capabilities: { publish: true, collections: "*", namespaces: ["content"] as string[] },
  }

  beforeAll(async () => {
    // Seed directive schema for notes (required by editDocHandler directive validation)
    await testEnv.BUCKET.put("schema/directives/notes.md", `---
_kind: directive_schema
name: notes
form: container
attributes: {}
intent: "Endnote material."
---
Notes directive guidelines.
`)
    // Seed pieces schema
    await testEnv.BUCKET.put("schema/pieces.md", `---
_kind: schema
collection: pieces
body: markdown
fields:
  title:
    type: string
    required: true
    max: 120
  slug:
    type: slug
    required: true
  section:
    type: string
    required: true
  order:
    type: number
    required: true
indexes: []
---
Pieces guidelines.
`)
  })

  it("migrate-notes: migrates ## Notes → :::notes, idempotent on re-run", async () => {
    // Create and publish a piece with ## Notes
    const created = await createDocHandler(testEnv, migrateIdentity, {
      collection: "pieces",
      frontmatter: { title: "Migration Test Piece", slug: "migration-test-piece", section: "preface", order: 99 },
      body: "Main content.\n\n## Notes\n\nThis is the note text.",
    })
    const { id, rev: createRev } = JSON.parse(created.content[0].text)
    await publishHandler(testEnv, migrateIdentity, { id, base_rev: createRev })

    // Call migrate route
    const res1 = await SELF.fetch(new Request("http://localhost/dev/migrate-notes", {
      method: "POST",
      headers: { "X-Dev-Secret": testEnv.CMS_DEV_SECRET },
    }))
    expect(res1.status).toBe(200)
    const data1 = await res1.json() as { migrated: number; skipped: number; errors: number; results: any[] }

    // Find our piece in results
    const pieceResult = data1.results.find((r: any) => r.slug === "migration-test-piece")
    expect(pieceResult?.status).toBe("migrated")

    // Check the HTML now contains aside.cms-notes
    const htmlRes = await SELF.fetch(new Request("http://localhost/api/v1/pieces/migration-test-piece?format=html"))
    expect(htmlRes.status).toBe(200)
    const html = await htmlRes.text()
    expect(html).toContain('<aside class="cms-notes">')
    expect(html).not.toContain('<h2>Notes</h2>')

    // Re-run should be idempotent (skipped)
    const res2 = await SELF.fetch(new Request("http://localhost/dev/migrate-notes", {
      method: "POST",
      headers: { "X-Dev-Secret": testEnv.CMS_DEV_SECRET },
    }))
    expect(res2.status).toBe(200)
    const data2 = await res2.json() as { migrated: number; skipped: number; errors: number }
    // Our piece should now be skipped (already has :::notes)
    expect(data2.migrated).toBe(0)
  })
})
