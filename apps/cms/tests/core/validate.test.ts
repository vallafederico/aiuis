/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest"
import { validateFrontmatter, ValidationError } from "../../src/core/validate.js"
import type { CollectionSchema } from "../../src/core/validate.js"

const schema: CollectionSchema = {
  collection: "posts",
  fields: {
    title: { type: "string", required: true, max: 120 },
    slug: { type: "slug", required: true },
    date: { type: "datetime", required: true },
    tags: { type: "array", max_items: 4 },
    status: { type: "enum", values: ["draft", "published"] },
    body_text: { type: "text", max: 200 },
  },
  body: "markdown",
  indexes: [],
  guidelines: "Write good posts.",
}

describe("validateFrontmatter", () => {
  it("required field missing → error includes 'fields.title: required'", () => {
    expect(() => validateFrontmatter(schema, { slug: "hello", date: "2024-01-01T00:00:00Z" }))
      .toThrow(ValidationError)
    try {
      validateFrontmatter(schema, { slug: "hello", date: "2024-01-01T00:00:00Z" })
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      expect((e as ValidationError).errors).toContain("fields.title: required")
    }
  })

  it("string max exceeded → error mentions max", () => {
    const longTitle = "a".repeat(121)
    expect(() => validateFrontmatter(schema, { title: longTitle, slug: "hello", date: "2024-01-01T00:00:00Z" }))
      .toThrow(ValidationError)
    try {
      validateFrontmatter(schema, { title: longTitle, slug: "hello", date: "2024-01-01T00:00:00Z" })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("fields.title") && err.includes("max"))).toBe(true)
    }
  })

  it("datetime invalid → fields.date: invalid datetime", () => {
    try {
      validateFrontmatter(schema, { title: "Hello", slug: "hello", date: "not-a-date" })
    } catch (e) {
      expect((e as ValidationError).errors).toContain("fields.date: invalid datetime")
    }
  })

  it("slug invalid → fields.slug: invalid slug format", () => {
    try {
      validateFrontmatter(schema, { title: "Hello", slug: "Hello World!", date: "2024-01-01T00:00:00Z" })
    } catch (e) {
      expect((e as ValidationError).errors).toContain("fields.slug: invalid slug format")
    }
  })

  it("array max_items exceeded → error mentions max_items", () => {
    try {
      validateFrontmatter(schema, { title: "Hello", slug: "hello", date: "2024-01-01T00:00:00Z", tags: ["a","b","c","d","e"] })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("fields.tags") && err.includes("max_items"))).toBe(true)
    }
  })

  it("enum invalid value → fields.status: invalid enum value", () => {
    try {
      validateFrontmatter(schema, { title: "Hello", slug: "hello", date: "2024-01-01T00:00:00Z", status: "unknown" })
    } catch (e) {
      expect((e as ValidationError).errors).toContain("fields.status: invalid enum value")
    }
  })

  it("unknown field → fields.foo: unknown field", () => {
    try {
      validateFrontmatter(schema, { title: "Hello", slug: "hello", date: "2024-01-01T00:00:00Z", foo: "bar" })
    } catch (e) {
      expect((e as ValidationError).errors).toContain("fields.foo: unknown field")
    }
  })

  it("valid frontmatter → no error thrown", () => {
    expect(() => validateFrontmatter(schema, { title: "Hello", slug: "hello", date: "2024-01-01T00:00:00Z" })).not.toThrow()
  })
})
