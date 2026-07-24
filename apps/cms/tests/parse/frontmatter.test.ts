/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest"
import { parseFrontmatter, dumpFrontmatter, FrontmatterError, assertNoSystemFields } from "../../src/parse/frontmatter.js"

describe("parseFrontmatter", () => {
  it("valid parse", () => {
    const { frontmatter, body } = parseFrontmatter("---\ntitle: Hello\n---\nBody")
    expect(frontmatter.title).toBe("Hello")
    expect(body).toBe("Body")
  })

  it("malformed YAML throws FrontmatterError", () => {
    expect(() => parseFrontmatter("---\n: invalid: yaml: {\n---\nbody")).toThrow(FrontmatterError)
  })

  it("assertNoSystemFields catches _author key", () => {
    expect(() => assertNoSystemFields({ _author: "me", title: "hi" })).toThrow(/_author/)
  })

  it("dump→parse round-trip", () => {
    const original = "---\ntitle: Hello\ntags:\n  - a\n  - b\n---\nBody text"
    const { frontmatter: fm1, body: b1 } = parseFrontmatter(original)
    const dumped = dumpFrontmatter(fm1, b1)
    const { frontmatter: fm2, body: b2 } = parseFrontmatter(dumped)
    expect(fm2.title).toBe(fm1.title)
    expect(fm2.tags).toEqual(fm1.tags)
    expect(b2).toBe(b1)
  })
})
