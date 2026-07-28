/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { createDocHandler, editDocHandler } from "../../src/mcp/tools/write.js"
import { deleteDocHandler } from "../../src/mcp/tools/lifecycle.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human",
  session: "refs-test-session",
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
  related:
    type: array
    items:
      type: ref
      collection: posts
indexes: []
---
Guidelines.
`

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  await testEnv.BUCKET.put("schema/posts.md", POSTS_SCHEMA)
})

describe("ref_edges", () => {
  let postAId: string
  let postARev: string
  let postBId: string
  let postBRev: string

  it("create post A (no refs) → no ref_edges", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Post A",
        slug: "ref-post-a",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Post A body.",
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    postAId = data.id
    postARev = data.rev

    const rows = await testEnv.DB.prepare(
      `SELECT * FROM ref_edges WHERE from_doc=?`
    ).bind(postAId).all()
    expect(rows.results.length).toBe(0)
  })

  it("create post B referencing A → ref_edges row exists", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Post B",
        slug: "ref-post-b",
        date: "2024-01-01T00:00:00Z",
        related: ["posts/ref-post-a"],
      },
      body: "Post B body.",
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    postBId = data.id
    postBRev = data.rev

    const rows = await testEnv.DB.prepare(
      `SELECT * FROM ref_edges WHERE from_doc=?`
    ).bind(postBId).all<{ from_doc: string; to_doc: string; field: string }>()
    expect(rows.results.length).toBe(1)
    expect(rows.results[0].to_doc).toBe(postAId)
    expect(rows.results[0].field).toBe("related")
  })

  it("edit B removing the ref → ref_edge row is gone", async () => {
    const result = await editDocHandler(testEnv, identity, {
      id: postBId,
      base_rev: postBRev,
      edits: [{ op: "set_field", field: "related", value: [] }],
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    postBRev = data.rev

    const rows = await testEnv.DB.prepare(
      `SELECT * FROM ref_edges WHERE from_doc=?`
    ).bind(postBId).all()
    expect(rows.results.length).toBe(0)
  })

  it("ref to nonexistent post → structured ref_not_found error", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Post C",
        slug: "ref-post-c",
        date: "2024-01-01T00:00:00Z",
        related: ["posts/no-such-post"],
      },
      body: "Post C body.",
    })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("ref_not_found")
  })

  it("delete A while B references it → response includes referenced_by", async () => {
    // Re-add the ref from B to A
    const editResult = await editDocHandler(testEnv, identity, {
      id: postBId,
      base_rev: postBRev,
      edits: [{ op: "set_field", field: "related", value: ["posts/ref-post-a"] }],
    })
    expect(editResult.isError).toBeFalsy()

    // First call to delete A (without confirm)
    const deleteResult1 = await deleteDocHandler(testEnv, identity, {
      id: postAId,
    })
    expect(deleteResult1.isError).toBeFalsy()
    const d1 = JSON.parse(deleteResult1.content[0].text)
    expect(d1.confirm_required).toBe(true)

    // Second call with confirm
    const deleteResult2 = await deleteDocHandler(testEnv, identity, {
      id: postAId,
      confirm: postAId,
    })
    expect(deleteResult2.isError).toBeFalsy()
    const d2 = JSON.parse(deleteResult2.content[0].text)
    expect(d2.referenced_by).toBeDefined()
    expect(Array.isArray(d2.referenced_by)).toBe(true)
    expect(d2.referenced_by.length).toBeGreaterThan(0)
    expect(d2.referenced_by[0].from_doc).toBe(postBId)
  })
})
