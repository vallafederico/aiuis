/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env, SELF } from "cloudflare:test"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"

const testEnv = env as unknown as Env

const PIECES_SCHEMA = `---
_kind: schema
collection: pieces
body: markdown
fields:
  title: { type: string, required: true, max: 120 }
  slug: { type: slug, required: true, from: title }
  section: { type: enum, values: [preface, foundations, uis], required: true }
  order: { type: number, required: true }
  description: { type: text, max: 200 }
indexes: [section, order]
---
# Writing guidelines for pieces.
`

function devAuthHeader(): Record<string, string> {
  const secret = testEnv.CMS_DEV_SECRET ?? ""
  return { "X-Dev-Secret": secret }
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  // Seed the pieces schema into BUCKET
  await testEnv.BUCKET.put("schema/pieces.md", PIECES_SCHEMA)
})

describe("pieces: /dev/seed-content route", () => {
  it("creates and publishes a new piece", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/dev/seed-content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devAuthHeader(),
        },
        body: JSON.stringify({
          action: "create_and_publish",
          doc: {
            collection: "pieces",
            frontmatter: {
              title: "Styleguides",
              slug: "styleguides",
              section: "foundations",
              order: 2,
            },
            body: "A styleguide for an AI-augmented product has to account for outputs it did not author.",
          },
        }),
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; id?: string }
    expect(body.status).toBe("created_and_published")
    expect(typeof body.id).toBe("string")
  })

  it("GET /api/v1/pieces returns array with at least 1 item containing section and slug", async () => {
    const res = await SELF.fetch(new Request("http://localhost/api/v1/pieces"))
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<{ slug: string; collection: string; id: string }> }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThanOrEqual(1)

    const item = body.items.find((i) => i.slug === "styleguides")
    expect(item).toBeDefined()
    expect(item!.collection).toBe("pieces")
    expect(typeof item!.slug).toBe("string")
  })

  it("the published piece is in section=foundations (via format=md)", async () => {
    const res = await SELF.fetch(new Request("http://localhost/api/v1/pieces/styleguides?format=md"))
    expect(res.status).toBe(200)
    const md = await res.text()
    expect(md).toContain("section: foundations")
  })

  it("second call to seed-content for same slug returns skipped", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/dev/seed-content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devAuthHeader(),
        },
        body: JSON.stringify({
          action: "create_and_publish",
          doc: {
            collection: "pieces",
            frontmatter: {
              title: "Styleguides",
              slug: "styleguides",
              section: "foundations",
              order: 2,
            },
            body: "A styleguide for an AI-augmented product has to account for outputs it did not author.",
          },
        }),
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; reason?: string }
    expect(body.status).toBe("skipped")
    expect(body.reason).toBe("already_published")
  })
})
