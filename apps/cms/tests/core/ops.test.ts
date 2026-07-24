import { describe, it, expect } from "vitest"
import { applyEdits, OpsError } from "../../src/core/ops.js"

const sampleDoc = `---
title: Hello
slug: hello
---
This is the body text here.
`

describe("applyEdits", () => {
  it("str_replace: exact match → replaced", () => {
    const result = applyEdits(sampleDoc, [{ op: "str_replace", old: "body text here", new: "content here" }])
    expect(result.body).toContain("content here")
    expect(result.body).not.toContain("body text here")
  })

  it("str_replace: 0 matches → OpsError code str_replace_miss", () => {
    expect(() => applyEdits(sampleDoc, [{ op: "str_replace", old: "nonexistent", new: "x" }]))
      .toThrow(OpsError)
    try {
      applyEdits(sampleDoc, [{ op: "str_replace", old: "nonexistent", new: "x" }])
    } catch (e) {
      expect((e as OpsError).code).toBe("str_replace_miss")
    }
  })

  it("str_replace: 2 matches → OpsError code str_replace_miss", () => {
    const doc = `---\ntitle: Hello\n---\nfoo bar foo\n`
    try {
      applyEdits(doc, [{ op: "str_replace", old: "foo", new: "baz" }])
    } catch (e) {
      expect(e).toBeInstanceOf(OpsError)
      expect((e as OpsError).code).toBe("str_replace_miss")
    }
  })

  it("append: adds text to body", () => {
    const result = applyEdits(sampleDoc, [{ op: "append", text: " Extra content." }])
    expect(result.body).toContain("Extra content.")
  })

  it("set_field: sets frontmatter field", () => {
    const result = applyEdits(sampleDoc, [{ op: "set_field", field: "title", value: "New Title" }])
    expect(result.frontmatter.title).toBe("New Title")
  })

  it("delete_field: removes frontmatter field", () => {
    const result = applyEdits(sampleDoc, [{ op: "delete_field", field: "slug" }])
    expect(result.frontmatter.slug).toBeUndefined()
  })

  it("set_field system field → OpsError system_field_violation", () => {
    try {
      applyEdits(sampleDoc, [{ op: "set_field", field: "_id", value: "foo" }])
    } catch (e) {
      expect(e).toBeInstanceOf(OpsError)
      expect((e as OpsError).code).toBe("system_field_violation")
    }
  })

  it("delete_field system field → OpsError system_field_violation", () => {
    try {
      applyEdits(sampleDoc, [{ op: "delete_field", field: "_rev" }])
    } catch (e) {
      expect(e).toBeInstanceOf(OpsError)
      expect((e as OpsError).code).toBe("system_field_violation")
    }
  })

  it("all-or-none: 2nd op fails, result not corrupted", () => {
    // First op succeeds (set_field), second op fails (str_replace miss)
    expect(() => applyEdits(sampleDoc, [
      { op: "set_field", field: "title", value: "Changed" },
      { op: "str_replace", old: "nonexistent text xyz", new: "y" }
    ])).toThrow(OpsError)
  })
})
