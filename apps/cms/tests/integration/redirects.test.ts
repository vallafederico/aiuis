/// <reference types="@cloudflare/vitest-pool-workers" />
import { SELF } from "cloudflare:test"
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { createDocHandler } from "../../src/mcp/tools/write.js"
import { publishHandler, renameDocHandler } from "../../src/mcp/tools/lifecycle.js"
import { readDocHandler } from "../../src/mcp/tools/read.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human",
  session: "redirect-test-session",
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
indexes: []
---
Guidelines.
`

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  await testEnv.BUCKET.put("schema/posts.md", POSTS_SCHEMA)
})

describe("redirects", () => {
  let docId: string
  let docRev: string

  it("create and publish a post", async () => {
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Redirect Test Post",
        slug: "redirect-test-original",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Original body.",
    })
    expect(createResult.isError).toBeFalsy()
    const createData = JSON.parse(createResult.content[0].text)
    docId = createData.id
    docRev = createData.rev

    const publishResult = await publishHandler(testEnv, identity, {
      id: docId,
      base_rev: docRev,
    })
    expect(publishResult.isError).toBeFalsy()
    const pubData = JSON.parse(publishResult.content[0].text)
    docRev = pubData.rev
  })

  it("rename creates redirect row", async () => {
    const renameResult = await renameDocHandler(testEnv, identity, {
      id: docId,
      new_slug: "redirect-test-renamed",
    })
    expect(renameResult.isError).toBeFalsy()

    const redirect = await testEnv.DB.prepare(
      `SELECT * FROM redirects WHERE from_collection='posts' AND from_slug='redirect-test-original'`
    ).first<{ to_slug: string }>()
    expect(redirect).not.toBeNull()
    expect(redirect?.to_slug).toBe("redirect-test-renamed")
  })

  it("MCP read_doc on old slug follows redirect", async () => {
    const result = await readDocHandler(testEnv, identity, { id: "posts/redirect-test-original" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.redirected_from).toBe("posts/redirect-test-original")
    // The content should be the renamed doc
    expect(data.frontmatter.slug).toBe("redirect-test-renamed")
  })

  it("HTTP GET on old slug → 308 to new slug", async () => {
    const response = await SELF.fetch("http://example.com/api/v1/posts/redirect-test-original", {
      redirect: "manual",
    })
    expect(response.status).toBe(308)
    const location = response.headers.get("Location")
    expect(location).toContain("redirect-test-renamed")
  })

  it("rename again → chain compacted", async () => {
    // Rename again
    const renameResult = await renameDocHandler(testEnv, identity, {
      id: docId,
      new_slug: "redirect-test-final",
    })
    expect(renameResult.isError).toBeFalsy()

    // The original slug should now point directly to final
    const compacted = await testEnv.DB.prepare(
      `SELECT to_slug FROM redirects WHERE from_collection='posts' AND from_slug='redirect-test-original'`
    ).first<{ to_slug: string }>()
    // After compaction, original → final (skipping renamed)
    expect(compacted?.to_slug).toBe("redirect-test-final")
  })
})
