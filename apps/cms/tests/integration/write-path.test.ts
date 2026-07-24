/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import { writeRevision } from "../../src/core/revision.js"
import type { Env } from "../../src/index.js"

const testEnv = env as unknown as Env

beforeAll(async () => {
  // @ts-expect-error - inject is provided via vitest.config.ts
  await applyD1Migrations(testEnv.DB, inject("migrations"))
})

describe("writeRevision", () => {
  const docId = "01JTEST1234567890ABCDE"
  const collection = "posts"
  const slug = "test-post"
  const rev = "01JREV01234567890ABCDE"
  const at = new Date().toISOString()
  const content = "---\ntitle: Test Post\n---\nThis is the body text for searching.\n"
  const meta = {
    docId,
    collection,
    slug,
    rev,
    at,
    author: { kind: "human", principal: "federico", session: "abc12345" },
    note: "initial write",
    status: "draft",
  }

  beforeAll(async () => {
    await writeRevision(testEnv, meta, content)
  })

  it("R2 revision object exists and contains the docId in _id field", async () => {
    const obj = await testEnv.BUCKET.get(`revisions/${collection}/${slug}/${rev}.md`)
    expect(obj).not.toBeNull()
    const text = await obj!.text()
    expect(text).toContain("_id:")
    expect(text).toContain(docId)
    expect(text).toContain("title: Test Post")
  })

  it("R2 HEAD content object exists and contains system fields", async () => {
    const obj = await testEnv.BUCKET.get(`content/${collection}/${slug}.md`)
    expect(obj).not.toBeNull()
    const text = await obj!.text()
    expect(text).toContain("_id:")
    expect(text).toContain(docId)
  })

  it("documents row has correct head_rev", async () => {
    const row = await testEnv.DB.prepare(`SELECT * FROM documents WHERE id=?`).bind(docId).first<{ head_rev: string }>()
    expect(row).not.toBeNull()
    expect(row!.head_rev).toBe(rev)
  })

  it("FTS row found via MATCH query", async () => {
    const rows = await testEnv.DB.prepare(
      `SELECT * FROM documents_fts WHERE documents_fts MATCH ?`
    ).bind("body").all()
    expect(rows.results.length).toBeGreaterThan(0)
  })

  it("revisions row exists with correct doc_id", async () => {
    const row = await testEnv.DB.prepare(`SELECT * FROM revisions WHERE rev=?`).bind(rev).first<{ doc_id: string }>()
    expect(row).not.toBeNull()
    expect(row!.doc_id).toBe(docId)
  })

  it("two writes: head_rev moves to second rev, both revision rows retained", async () => {
    const rev2 = "01JREV02345678901BCDEF"
    const meta2 = { ...meta, rev: rev2, at: new Date().toISOString(), note: "second write" }
    await writeRevision(testEnv, meta2, content)

    const doc = await testEnv.DB.prepare(`SELECT head_rev FROM documents WHERE id=?`).bind(docId).first<{ head_rev: string }>()
    expect(doc!.head_rev).toBe(rev2)

    const rev1Row = await testEnv.DB.prepare(`SELECT rev FROM revisions WHERE rev=?`).bind(rev).first()
    const rev2Row = await testEnv.DB.prepare(`SELECT rev FROM revisions WHERE rev=?`).bind(rev2).first()
    expect(rev1Row).not.toBeNull()
    expect(rev2Row).not.toBeNull()
  })
})
