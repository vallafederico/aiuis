/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { createDocHandler, editDocHandler } from "../../src/mcp/tools/write.js"
import { queryHandler, readDocHandler, searchHandler } from "../../src/mcp/tools/read.js"
import { listCollectionsHandler, getSchemaHandler } from "../../src/mcp/tools/discovery.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human",
  session: "test1234",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] }
}

beforeAll(async () => {
  // @ts-expect-error - inject is provided via vitest.config.ts
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  // Seed schema for posts
  await testEnv.BUCKET.put("schema/posts.md", `---
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
indexes: []
---
Writing guidelines for posts.
`)
})

describe("tools integration", () => {
  let createdDocId: string
  let createdRev: string

  it("create_doc happy path", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Test Post",
        slug: "test-post",
        date: "2024-01-01T00:00:00Z",
      },
      body: "This is the body of the test post.",
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.id).toBeDefined()
    expect(data.rev).toBeDefined()
    createdDocId = data.id
    createdRev = data.rev
  })

  it("create_doc validation failure", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "a".repeat(121), // exceeds max 120
        slug: "another-post",
        date: "2024-01-01T00:00:00Z",
      },
    })
    expect(result.isError).toBe(true)
  })

  it("edit_doc str_replace", async () => {
    const result = await editDocHandler(testEnv, identity, {
      id: createdDocId,
      base_rev: createdRev,
      edits: [{ op: "str_replace", old: "body of the test post", new: "edited body content" }],
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.content).toContain("edited body content")
    createdRev = data.rev
  })

  it("edit_doc str_replace miss", async () => {
    const result = await editDocHandler(testEnv, identity, {
      id: createdDocId,
      base_rev: createdRev,
      edits: [{ op: "str_replace", old: "this text does not exist xyz", new: "y" }],
    })
    expect(result.isError).toBe(true)
  })

  it("edit_doc set_field", async () => {
    const result = await editDocHandler(testEnv, identity, {
      id: createdDocId,
      base_rev: createdRev,
      edits: [{ op: "set_field", field: "title", value: "Updated Title" }],
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.content).toContain("Updated Title")
    createdRev = data.rev
  })

  it("query: returns created doc", async () => {
    const result = await queryHandler(testEnv, identity, { collection: "posts" })
    const data = JSON.parse(result.content[0].text)
    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results.some((r: { id: string }) => r.id === createdDocId)).toBe(true)
  })

  it("read_doc: returns doc by id", async () => {
    const result = await readDocHandler(testEnv, identity, { id: createdDocId })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.frontmatter._id).toBe(createdDocId)
  })

  it("search: finds doc", async () => {
    const result = await searchHandler(testEnv, identity, { q: "edited body content" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    // data.results may be empty if FTS index hasn't updated yet, but the search should succeed
    expect(data).toHaveProperty("results")
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results.some((r: { id: string }) => r.id === createdDocId)).toBe(true)
  })

  it("list_collections: returns posts", async () => {
    const result = await listCollectionsHandler(testEnv)
    const data = JSON.parse(result.content[0].text)
    expect(data.some((c: { collection: string }) => c.collection === "posts")).toBe(true)
  })

  it("get_schema: returns posts schema", async () => {
    const result = await getSchemaHandler(testEnv, { collection: "posts" })
    const data = JSON.parse(result.content[0].text)
    expect(data.collection).toBe("posts")
    expect(data.fields).toBeDefined()
  })
})
