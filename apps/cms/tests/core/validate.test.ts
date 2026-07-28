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

describe("extended type validation", () => {
  it("string field receives non-string → expected string error", () => {
    try {
      validateFrontmatter(schema, { title: 123, slug: "hello", date: "2024-01-01T00:00:00Z" })
    } catch (e) {
      expect((e as ValidationError).errors).toContain("fields.title: expected string, got number")
    }
  })

  it("number field valid", () => {
    const numSchema: CollectionSchema = {
      collection: "test",
      fields: { count: { type: "number" } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    expect(() => validateFrontmatter(numSchema, { count: 42 })).not.toThrow()
  })

  it("number field receives string → expected number error", () => {
    const numSchema: CollectionSchema = {
      collection: "test",
      fields: { count: { type: "number" } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    try {
      validateFrontmatter(numSchema, { count: "42" })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("fields.count: expected number, got string"))).toBe(true)
    }
  })

  it("number field with integer:true rejects float", () => {
    const intSchema: CollectionSchema = {
      collection: "test",
      fields: { count: { type: "number", integer: true } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    try {
      validateFrontmatter(intSchema, { count: 3.14 })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("fields.count: expected integer"))).toBe(true)
    }
  })

  it("datetime receives non-string → expected string for datetime error", () => {
    const dtSchema: CollectionSchema = {
      collection: "test",
      fields: { date: { type: "datetime", required: true } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    try {
      validateFrontmatter(dtSchema, { date: 20240101 })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("expected string for datetime"))).toBe(true)
    }
  })

  it("enum receives non-string → expected string for enum error", () => {
    const enumSchema: CollectionSchema = {
      collection: "test",
      fields: { status: { type: "enum", values: ["a", "b"] } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    try {
      validateFrontmatter(enumSchema, { status: 1 })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("expected string for enum"))).toBe(true)
    }
  })

  it("array receives non-array → expected array error", () => {
    const arrSchema: CollectionSchema = {
      collection: "test",
      fields: { tags: { type: "array", max_items: 4 } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    try {
      validateFrontmatter(arrSchema, { tags: "not-an-array" })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("fields.tags: expected array, got string"))).toBe(true)
    }
  })

  it("tax field validates array of strings with slug format", () => {
    const taxSchema: CollectionSchema = {
      collection: "test",
      fields: { topics: { type: "tax", max_items: 3 } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    expect(() => validateFrontmatter(taxSchema, { topics: ["ai", "webgl"] })).not.toThrow()

    try {
      validateFrontmatter(taxSchema, { topics: "ai" })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("expected array for tax"))).toBe(true)
    }

    try {
      validateFrontmatter(taxSchema, { topics: ["AI CAPS"] })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("invalid slug format"))).toBe(true)
    }
  })

  it("ref field validates collection/slug format", () => {
    const refSchema: CollectionSchema = {
      collection: "test",
      fields: { related: { type: "ref" } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    expect(() => validateFrontmatter(refSchema, { related: "posts/my-post" })).not.toThrow()

    try {
      validateFrontmatter(refSchema, { related: 123 })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("expected string for ref"))).toBe(true)
    }

    try {
      validateFrontmatter(refSchema, { related: "no-slash" })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("invalid ref format"))).toBe(true)
    }
  })

  it("asset field receives non-string → expected string for asset", () => {
    const assetSchema: CollectionSchema = {
      collection: "test",
      fields: { cover: { type: "asset" } },
      body: "markdown",
      indexes: [],
      guidelines: "",
    }
    try {
      validateFrontmatter(assetSchema, { cover: 123 })
    } catch (e) {
      expect((e as ValidationError).errors.some(err => err.includes("expected string for asset"))).toBe(true)
    }
  })
})
