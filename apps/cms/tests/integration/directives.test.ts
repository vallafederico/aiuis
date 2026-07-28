/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { createDocHandler } from "../../src/mcp/tools/write.js"
import { getContextHandler } from "../../src/mcp/tools/lifecycle.js"

const testEnv = env as unknown as Env
const identity = {
  principal: "test-user",
  kind: "human" as const,
  session: "dir-test-sess",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] as string[] }
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  // Seed pieces schema
  await testEnv.BUCKET.put("schema/pieces.md", `---
_kind: schema
collection: pieces
body: markdown
fields:
  title:
    type: string
    required: true
    max: 120
  slug:
    type: slug
    required: true
  section:
    type: enum
    values: [preface, foundations, uis]
    required: true
  order:
    type: number
    required: true
indexes: [section, order]
---
Pieces guidelines.
`)
  // Seed directive schema for notes
  await testEnv.BUCKET.put("schema/directives/notes.md", `---
_kind: directive_schema
name: notes
form: container
attributes: {}
intent: "Endnote material — affiliations, caveats, methodology asides."
---
Notes directive guidelines.
`)
})

describe("directive registry validation", () => {
  it("create_doc with :::notes passes validation", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "pieces",
      frontmatter: { title: "Notes Test", slug: "notes-test", section: "foundations", order: 1 },
      body: "Main content.\n\n:::notes\nThis is a note.\n:::\n",
    })
    expect(result.isError).toBeFalsy()
  })

  it("create_doc with :::bogus → unknown_directive error listing notes", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "pieces",
      frontmatter: { title: "Bogus Directive", slug: "bogus-directive", section: "foundations", order: 2 },
      body: "Content.\n\n:::bogus\nSome content.\n:::\n",
    })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.details.error).toBe("unknown_directive")
    expect(data.details.name).toBe("bogus")
    expect(data.details.known).toContain("notes")
  })

  it("create_doc with :::notes{foo=bar} → attribute error", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "pieces",
      frontmatter: { title: "Attr Test", slug: "attr-test", section: "foundations", order: 3 },
      body: "Content.\n\n:::notes{foo=bar}\nNote content.\n:::\n",
    })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.details.error).toBe("invalid_directive_attribute")
    expect(data.details.directive).toBe("notes")
    expect(data.details.attribute).toBe("foo")
  })

  it("create_doc with ::::slice container → slices not yet supported", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "pieces",
      frontmatter: { title: "Slice Test", slug: "slice-test", section: "foundations", order: 4 },
      body: "Content.\n\n::::slice{type=hero id=s_1}\nTitle: Test\n::::\n",
    })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.details.error).toBe("slices_not_supported")
    expect(data.details.message).toContain("not yet supported")
  })

  it("get_context includes directive schema for notes", async () => {
    const result = await getContextHandler(testEnv, identity, { task: "write", collection: "pieces" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    const directiveSchemas = data.schemas.filter((s: any) => s.frontmatter?._kind === "directive_schema" || s._kind === "directive_schema")
    expect(directiveSchemas.length).toBeGreaterThan(0)
    const notesSchema = directiveSchemas.find((s: any) => (s.frontmatter?.name ?? s.name) === "notes")
    expect(notesSchema).toBeDefined()
  })
})
