/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import { writeRevision, reindexFromR2 } from "../../src/core/revision.js"
import type { Env } from "../../src/index.js"

const testEnv = env as unknown as Env

beforeAll(async () => {
  // @ts-expect-error - inject is provided via vitest.config.ts
  await applyD1Migrations(testEnv.DB, inject("migrations"))
})

describe("reindexFromR2", () => {
  beforeAll(async () => {
    // Write 3 docs across 2 collections
    await writeRevision(testEnv, {
      docId: "01JRIDX0000000000000001",
      collection: "posts",
      slug: "alpha-post",
      rev: "01JRREV0000000000000001",
      at: "2026-01-01T00:00:00Z",
      author: { kind: "human", principal: "federico", session: "sess0001" },
      status: "draft",
    }, "---\ntitle: Alpha Post\n---\nAlpha content here.\n")

    await writeRevision(testEnv, {
      docId: "01JRIDX0000000000000002",
      collection: "posts",
      slug: "beta-post",
      rev: "01JRREV0000000000000002",
      at: "2026-01-02T00:00:00Z",
      author: { kind: "human", principal: "federico", session: "sess0002" },
      status: "draft",
    }, "---\ntitle: Beta Post\n---\nBeta content here.\n")

    await writeRevision(testEnv, {
      docId: "01JRIDX0000000000000003",
      collection: "pages",
      slug: "about",
      rev: "01JRREV0000000000000003",
      at: "2026-01-03T00:00:00Z",
      author: { kind: "human", principal: "federico", session: "sess0003" },
      status: "draft",
    }, "---\ntitle: About Page\n---\nAbout content here.\n")
  })

  it("reindex rebuilds documents table and FTS from R2", async () => {
    // Snapshot the documents table
    const snapshot = await testEnv.DB.prepare(`SELECT * FROM documents ORDER BY id`).all()

    // Wipe all D1 data
    await testEnv.DB.prepare(`DELETE FROM documents`).run()
    await testEnv.DB.prepare(`DELETE FROM documents_fts`).run()
    await testEnv.DB.prepare(`DELETE FROM revisions`).run()

    // Run reindex
    const result = await reindexFromR2(testEnv)
    expect(result.rebuilt).toBeGreaterThanOrEqual(3)
    expect(result.errors).toHaveLength(0)

    // Assert documents table matches snapshot
    const rebuilt = await testEnv.DB.prepare(`SELECT * FROM documents ORDER BY id`).all()
    expect(rebuilt.results.length).toBe(snapshot.results.length)

    for (let i = 0; i < snapshot.results.length; i++) {
      const orig = snapshot.results[i] as Record<string, unknown>
      const got = rebuilt.results[i] as Record<string, unknown>
      expect(got.id).toBe(orig.id)
      expect(got.slug).toBe(orig.slug)
      expect(got.head_rev).toBe(orig.head_rev)
      expect(got.title).toBe(orig.title)
      expect(got.status).toBe(orig.status)
    }

    // Assert FTS works
    const ftsResult = await testEnv.DB.prepare(
      `SELECT * FROM documents_fts WHERE documents_fts MATCH ?`
    ).bind("Alpha").all()
    expect(ftsResult.results.length).toBeGreaterThan(0)
  })
})
