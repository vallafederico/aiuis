/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { createDocHandler } from "../../src/mcp/tools/write.js"
import { publishHandler, unpublishHandler } from "../../src/mcp/tools/lifecycle.js"
import { normalizeTerm, loadTaxonomy } from "../../src/core/taxonomy.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human",
  session: "taxonomy-test-session",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] }
}

const POSTS_SCHEMA = `---
_kind: schema
collection: posts
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
  tags:
    type: tax
    taxonomy: topics
    max_items: 4
indexes: [date, tags]
---
Guidelines.
`

const TOPICS_TAXONOMY = `---
_kind: taxonomy
name: topics
policy: propose
normalize: { case: lower, slugify: true }
aliases:
  llms: ai
  llm: ai
  ml: machine-learning
hierarchy: false
terms:
  - { slug: ai, title: AI }
  - { slug: machine-learning, title: Machine Learning }
  - { slug: webgl, title: WebGL }
---
Guidance.
`

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  await testEnv.BUCKET.put("schema/posts.md", POSTS_SCHEMA)
  await testEnv.BUCKET.put("schema/taxonomies/topics.md", TOPICS_TAXONOMY)
})

async function createAndPublish(slug: string, tags: string[]): Promise<{ id: string; rev: string }> {
  const createResult = await createDocHandler(testEnv, identity, {
    collection: "posts",
    frontmatter: {
      title: `Post ${slug}`,
      slug,
      date: "2024-01-01T00:00:00Z",
      tags,
    },
    body: "Body content.",
  })
  expect(createResult.isError).toBeFalsy()
  const createData = JSON.parse(createResult.content[0].text)

  const publishResult = await publishHandler(testEnv, identity, {
    id: createData.id,
    base_rev: createData.rev,
  })
  expect(publishResult.isError).toBeFalsy()
  const pubData = JSON.parse(publishResult.content[0].text)
  return { id: createData.id, rev: pubData.rev }
}

describe("taxonomy normalization", () => {
  it("normalizeTerm applies aliases", async () => {
    const taxDef = await loadTaxonomy(testEnv, "topics")
    expect(taxDef).not.toBeNull()
    expect(normalizeTerm("llms", taxDef!)).toBe("ai")
    expect(normalizeTerm("llm", taxDef!)).toBe("ai")
    expect(normalizeTerm("ml", taxDef!)).toBe("machine-learning")
  })

  it("normalizeTerm lowercases and slugifies", async () => {
    const taxDef = await loadTaxonomy(testEnv, "topics")
    expect(taxDef).not.toBeNull()
    expect(normalizeTerm("WebGL", taxDef!)).toBe("webgl")
    expect(normalizeTerm("My Term", taxDef!)).toBe("my-term")
  })
})

describe("taxonomy term counts", () => {
  it("create+publish two posts sharing tag 'ai' → count becomes 2", async () => {
    await createAndPublish("tax-post-a", ["ai"])
    await createAndPublish("tax-post-b", ["ai"])

    const term = await testEnv.DB.prepare(
      `SELECT count FROM terms WHERE taxonomy='topics' AND slug='ai'`
    ).first<{ count: number }>()
    expect(term).not.toBeNull()
    expect(term?.count).toBeGreaterThanOrEqual(2)
  })

  it("unpublish one post → count decreases", async () => {
    // Create two posts with tag "webgl"
    const post1 = await createAndPublish("tax-webgl-a", ["webgl"])
    await createAndPublish("tax-webgl-b", ["webgl"])

    // Get initial count
    const initialTerm = await testEnv.DB.prepare(
      `SELECT count FROM terms WHERE taxonomy='topics' AND slug='webgl'`
    ).first<{ count: number }>()
    const initialCount = initialTerm?.count ?? 0
    expect(initialCount).toBeGreaterThanOrEqual(2)

    // Unpublish one
    const unpubResult = await unpublishHandler(testEnv, identity, { id: post1.id })
    expect(unpubResult.isError).toBeFalsy()

    // Count should decrease by 1
    const afterTerm = await testEnv.DB.prepare(
      `SELECT count FROM terms WHERE taxonomy='topics' AND slug='webgl'`
    ).first<{ count: number }>()
    expect(afterTerm?.count).toBe(initialCount - 1)
  })

  it("tag 'llms' is normalized to 'ai' via alias", async () => {
    await createAndPublish("tax-alias-test", ["llms"])

    // doc_terms should have slug 'ai', not 'llms'
    const row = await testEnv.DB.prepare(
      `SELECT term_slug FROM doc_terms WHERE taxonomy='topics' AND term_slug='ai' LIMIT 1`
    ).first<{ term_slug: string }>()
    expect(row).not.toBeNull()

    // 'llms' should NOT be in doc_terms
    const wrongRow = await testEnv.DB.prepare(
      `SELECT term_slug FROM doc_terms WHERE taxonomy='topics' AND term_slug='llms' LIMIT 1`
    ).first()
    expect(wrongRow).toBeNull()
  })
})
