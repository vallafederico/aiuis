/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { readDocHandler, queryHandler, searchHandler } from "../../src/mcp/tools/read.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human",
  session: "op-log-test-session",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] }
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
})

describe("op_log for reads", () => {
  it("readDocHandler logs to op_log on not_found", async () => {
    await readDocHandler(testEnv, identity, { id: "posts/nonexistent-doc" })
    const row = await testEnv.DB.prepare(
      `SELECT * FROM op_log WHERE session=? AND tool='read_doc' ORDER BY at DESC LIMIT 1`
    ).bind(identity.session).first<{ outcome: string }>()
    expect(row).not.toBeNull()
    expect(row?.outcome).toBe("not_found")
  })

  it("queryHandler logs to op_log", async () => {
    await queryHandler(testEnv, identity, { collection: "posts" })
    const row = await testEnv.DB.prepare(
      `SELECT * FROM op_log WHERE session=? AND tool='query' ORDER BY at DESC LIMIT 1`
    ).bind(identity.session).first<{ outcome: string }>()
    expect(row).not.toBeNull()
    expect(row?.outcome).toBe("ok")
  })

  it("searchHandler logs to op_log", async () => {
    await searchHandler(testEnv, identity, { q: "test content" })
    const row = await testEnv.DB.prepare(
      `SELECT * FROM op_log WHERE session=? AND tool='search' ORDER BY at DESC LIMIT 1`
    ).bind(identity.session).first<{ outcome: string }>()
    expect(row).not.toBeNull()
    expect(row?.outcome).toBe("ok")
  })
})

describe("search status filter", () => {
  beforeAll(async () => {
    // Insert some test docs directly into DB for filtering
    const now = new Date().toISOString()
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO documents (id, collection, slug, status, head_rev, title, card, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind("doc-published-1", "testcol", "published-doc", "published", "rev1", "Published Doc", "{}", now, now).run()
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO documents (id, collection, slug, status, head_rev, title, card, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind("doc-draft-1", "testcol", "draft-doc", "draft", "rev2", "Draft Doc", "{}", now, now).run()
    // Insert into FTS
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO documents_fts (id, title, body_text) VALUES (?, ?, ?)`
    ).bind("doc-published-1", "Published Doc", "some searchable content about filtering").run()
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO documents_fts (id, title, body_text) VALUES (?, ?, ?)`
    ).bind("doc-draft-1", "Draft Doc", "some searchable content about filtering").run()
  })

  it("searchHandler with status=published only returns published docs", async () => {
    const result = await searchHandler(testEnv, identity, { q: "filtering", status: "published" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    const results = data.results as Array<{ id: string; status: string }>
    expect(results.every(r => r.status === "published")).toBe(true)
    expect(results.some(r => r.id === "doc-published-1")).toBe(true)
    expect(results.some(r => r.id === "doc-draft-1")).toBe(false)
  })

  it("searchHandler with status=draft only returns draft docs", async () => {
    const result = await searchHandler(testEnv, identity, { q: "filtering", status: "draft" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    const results = data.results as Array<{ id: string; status: string }>
    expect(results.every(r => r.status === "draft")).toBe(true)
    expect(results.some(r => r.id === "doc-draft-1")).toBe(true)
    expect(results.some(r => r.id === "doc-published-1")).toBe(false)
  })

  it("searchHandler with status=all returns all docs", async () => {
    const result = await searchHandler(testEnv, identity, { q: "filtering", status: "all" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    const results = data.results as Array<{ id: string; status: string }>
    expect(results.some(r => r.id === "doc-published-1")).toBe(true)
    expect(results.some(r => r.id === "doc-draft-1")).toBe(true)
  })
})
