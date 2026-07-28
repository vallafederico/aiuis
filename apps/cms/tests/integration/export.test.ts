/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env, SELF } from "cloudflare:test"
import { applyD1Migrations } from "cloudflare:test"
import { writeRevision } from "../../src/core/revision.js"
import type { Env } from "../../src/index.js"

const testEnv = env as unknown as Env

function devAuthHeader(): Record<string, string> {
  const secret = testEnv.CMS_DEV_SECRET ?? ""
  return { "X-Dev-Secret": secret }
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))

  // Seed a content doc and a schema doc
  await writeRevision(testEnv, {
    docId: "01JEXPORT000000000000001",
    collection: "pieces",
    slug: "credits",
    rev: "01JEXPORTREV00000000001",
    at: "2026-01-01T00:00:00Z",
    author: { kind: "human", principal: "federico", session: "sess-export" },
    status: "published",
  }, "---\ntitle: Credits\nslug: credits\n---\nTooling used in this project is credited in the colophon.\n")

  // Seed a schema doc
  await testEnv.BUCKET.put("schema/pieces.md", "---\n_kind: schema\ncollection: pieces\n---\nSchema for pieces.\n")

  // Seed a revisions/ and derived/ doc that should be excluded
  await testEnv.BUCKET.put("revisions/pieces/credits/01JEXPORTREV00000000001.md", "should be excluded")
  await testEnv.BUCKET.put("derived/pieces/credits/01JEXPORTREV00000000001.json", "{\"excluded\": true}")
})

describe("GET /dev/export", () => {
  it("returns 401 without secret", async () => {
    const res = await SELF.fetch(new Request("http://localhost/dev/export"))
    expect(res.status).toBe(401)
  })

  it("returns 401 with wrong secret", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/dev/export", {
        headers: { "X-Dev-Secret": "wrong-secret" },
      })
    )
    expect(res.status).toBe(401)
  })

  it("with correct secret returns files including content/pieces/credits.md", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/dev/export", {
        headers: devAuthHeader(),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { files: Array<{ path: string; content: string }> }
    expect(Array.isArray(body.files)).toBe(true)

    const creditFile = body.files.find(f => f.path === "content/pieces/credits.md")
    expect(creditFile).toBeDefined()
    expect(creditFile!.content).toContain("Credits")
  })

  it("excludes revisions/ paths", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/dev/export", {
        headers: devAuthHeader(),
      })
    )
    const body = await res.json() as { files: Array<{ path: string; content: string }> }
    const revisionFiles = body.files.filter(f => f.path.startsWith("revisions/"))
    expect(revisionFiles).toHaveLength(0)
  })

  it("excludes derived/ paths", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/dev/export", {
        headers: devAuthHeader(),
      })
    )
    const body = await res.json() as { files: Array<{ path: string; content: string }> }
    const derivedFiles = body.files.filter(f => f.path.startsWith("derived/"))
    expect(derivedFiles).toHaveLength(0)
  })

  it("includes schema/ paths", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/dev/export", {
        headers: devAuthHeader(),
      })
    )
    const body = await res.json() as { files: Array<{ path: string; content: string }> }
    const schemaFiles = body.files.filter(f => f.path.startsWith("schema/"))
    expect(schemaFiles.length).toBeGreaterThanOrEqual(1)
  })
})
