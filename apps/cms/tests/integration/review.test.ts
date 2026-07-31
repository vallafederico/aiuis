/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env, SELF } from "cloudflare:test"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { createDocHandler } from "../../src/mcp/tools/write.js"
import { publishHandler } from "../../src/mcp/tools/lifecycle.js"

const testEnv = env as unknown as Env

const identity = {
  principal: "test-user",
  kind: "human",
  session: "review-test-sess",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] as string[] },
}

function devAuthHeader(): Record<string, string> {
  const secret = testEnv.CMS_DEV_SECRET ?? ""
  return { Authorization: `Bearer ${secret}` }
}

const SCHEMA = `---
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
`

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  await testEnv.BUCKET.put("schema/articles.md", SCHEMA)
})

describe("Phase 6: Review page", () => {
  it("redirects to /review/login without secret", async () => {
    const res = await SELF.fetch("http://localhost/review", { redirect: "manual" })
    // Auth required — now redirects to /review/login instead of 401
    expect([302, 301]).toContain(res.status)
    expect(res.headers.get("location")).toContain("/review/login")
  })

  it("200 with secret, lists revision", async () => {
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: {
        title: "Review Test Article",
        slug: "review-test-article",
        date: "2024-06-01T00:00:00.000Z",
      },
      body: "Hello review world.",
    })
    expect(createResult.isError).toBeFalsy()
    const created = JSON.parse(createResult.content[0].text)
    expect(created.id).toBeTruthy()

    const res = await SELF.fetch("http://localhost/review", {
      headers: devAuthHeader(),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("review-test-article")
  })

  it("Diff page renders unified diff with @@ markers", async () => {
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: {
        title: "Diff Test Article",
        slug: "diff-test-article",
        date: "2024-06-01T00:00:00.000Z",
      },
      body: "Some content for diff.",
    })
    expect(createResult.isError).toBeFalsy()
    const created = JSON.parse(createResult.content[0].text)
    const docId = created.id as string
    const rev = created.rev as string

    const res = await SELF.fetch(`http://localhost/review/diff/${docId}/${rev}`, {
      headers: devAuthHeader(),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("<pre")
    expect(body).toContain("@@")
  })

  it("POST action publish actually publishes", async () => {
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: {
        title: "Publish Action Test",
        slug: "publish-action-test",
        date: "2024-06-01T00:00:00.000Z",
      },
      body: "Content to publish.",
    })
    expect(createResult.isError).toBeFalsy()
    const created = JSON.parse(createResult.content[0].text)
    const docId = created.id as string
    const rev = created.rev as string

    const formBody = new URLSearchParams({
      action: "publish",
      docId,
      rev,
    })

    const res = await SELF.fetch("http://localhost/review/action", {
      method: "POST",
      headers: {
        ...devAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
      redirect: "manual",
    })

    // Should redirect on success
    expect([302, 301, 303]).toContain(res.status)
    expect(res.headers.get("location")).toContain("published")

    // Check D1: published_rev should not be null
    const doc = await testEnv.DB.prepare(
      `SELECT published_rev FROM documents WHERE id=?`
    ).bind(docId).first<{ published_rev: string | null }>()
    expect(doc?.published_rev).not.toBeNull()

    // Check op_log: should have publish entry
    const opRow = await testEnv.DB.prepare(
      `SELECT tool FROM op_log WHERE doc_id=? AND tool='publish' LIMIT 1`
    ).bind(docId).first<{ tool: string }>()
    expect(opRow?.tool).toBe("publish")
  })

  it("XSS: title with <script> is escaped in inbox", async () => {
    const xssTitle = "<script>alert(1)</script>"
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "articles",
      frontmatter: {
        title: xssTitle,
        slug: "xss-test-article",
        date: "2024-06-01T00:00:00.000Z",
      },
      body: "XSS test body.",
    })
    expect(createResult.isError).toBeFalsy()

    const res = await SELF.fetch("http://localhost/review", {
      headers: devAuthHeader(),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("&lt;script&gt;")
    expect(body).not.toContain("<script>alert")
  })
})
