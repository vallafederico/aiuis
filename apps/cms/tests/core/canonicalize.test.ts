/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest"
import { canonicalize } from "../../src/core/canonicalize.js"

describe("canonicalize", () => {
  it("idempotency: messy whitespace", async () => {
    const input = "---\ntitle: Test\n---\n\n\nHello   world\n\n\n* item one\n* item two\n\n*italic text*\n"
    const once = await canonicalize(input)
    const twice = await canonicalize(once)
    expect(once).toBe(twice)
  })

  it("idempotency: GFM table", async () => {
    const input = "---\ntitle: Table\n---\n| A | B |\n|---|---|\n| 1 | 2 |\n"
    const once = await canonicalize(input)
    const twice = await canonicalize(once)
    expect(once).toBe(twice)
  })

  it("idempotency: code fences", async () => {
    const input = "---\ntitle: Code\n---\n~~~js\nconsole.log('hello')\n~~~\n"
    const once = await canonicalize(input)
    const twice = await canonicalize(once)
    expect(once).toBe(twice)
  })

  it("idempotency: slice directive", async () => {
    const input = "---\ntitle: Page\n---\n::::slice{type=hero id=s_1}\ncontent\n::::\n"
    const once = await canonicalize(input)
    const twice = await canonicalize(once)
    expect(once).toBe(twice)
  })

  it("normalization: * bullet → - bullet", async () => {
    const input = "---\ntitle: List\n---\n* item\n"
    const result = await canonicalize(input)
    expect(result).toContain("- item")
  })

  it("normalization: *italic* → _italic_", async () => {
    const input = "---\ntitle: Emphasis\n---\n*italic*\n"
    const result = await canonicalize(input)
    expect(result).toContain("_italic_")
  })
})
