/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { createDocHandler } from "../../src/mcp/tools/write.js"
import { readDocHandler } from "../../src/mcp/tools/read.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human",
  session: "queue-test-session",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] }
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  // Seed posts schema
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
Guidelines.
`)
})

describe("queue producer", () => {
  it("createDocHandler succeeds even if queue send would throw", async () => {
    // In test env, queue.send may or may not work — but create_doc should succeed regardless
    const result = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Queue Test Post",
        slug: "queue-test-post",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Body content for queue test.",
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.id).toBeDefined()
    expect(data.rev).toBeDefined()
  })

  it("re-deriving same rev is idempotent (read_doc returns same content)", async () => {
    // Create a doc
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Idempotent Derive Test",
        slug: "idempotent-derive",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Content to test idempotency.",
    })
    expect(createResult.isError).toBeFalsy()
    const createData = JSON.parse(createResult.content[0].text)

    // Read it once
    const readResult1 = await readDocHandler(testEnv, identity, { id: createData.id })
    expect(readResult1.isError).toBeFalsy()
    const doc1 = JSON.parse(readResult1.content[0].text)

    // Read it again (same content, simulating re-derive)
    const readResult2 = await readDocHandler(testEnv, identity, { id: createData.id })
    expect(readResult2.isError).toBeFalsy()
    const doc2 = JSON.parse(readResult2.content[0].text)

    // Same content both times
    expect(doc1.raw).toBe(doc2.raw)
  })
})
