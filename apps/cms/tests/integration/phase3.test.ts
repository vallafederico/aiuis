/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { LockRoom } from "../../src/core/lock.js"
import { createDocHandler, editDocHandler } from "../../src/mcp/tools/write.js"
import {
  historyHandler,
  diffHandler,
  revertHandler,
  deleteDocHandler,
  publishHandler,
  getContextHandler,
} from "../../src/mcp/tools/lifecycle.js"

const testEnv = env as unknown as Env

const identity = {
  principal: "test-user",
  kind: "human",
  session: "phase3sess",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: [] as string[] }
}

const schemaIdentity = {
  principal: "schema-admin",
  kind: "human",
  session: "schemaadmin",
  audience: "any",
  capabilities: { publish: true, collections: "*", namespaces: ["schema", "skills"] }
}

beforeAll(async () => {
  // @ts-expect-error - inject is provided via vitest.config.ts
  await applyD1Migrations(testEnv.DB, inject("migrations"))
  // Seed schema for posts
  await testEnv.BUCKET.put("schema/posts.md", `---
_kind: schema
collection: posts
body: markdown
fields:
  title:
    type: string
    required: true
    max: 120
  slug:
    type: slug
    required: true
  date:
    type: datetime
    required: true
indexes: []
---
Writing guidelines for posts.
`)
  // Seed an always-mode skill
  await testEnv.BUCKET.put("skills/house-style.md", `---
mode: always
title: House Style
---
Always use active voice.
`)
})

// Create a mock state for LockRoom
const mockState = {} as DurableObjectState
const lockRoom = new LockRoom(mockState, testEnv)

async function testFetch(action: string, docId: string, session: string) {
  return lockRoom.fetch(new Request(`https://lock-room/lock?action=${action}&docId=${encodeURIComponent(docId)}&session=${encodeURIComponent(session)}`))
}

describe("LockRoom", () => {
  it("acquire returns ok", async () => {
    const res = await testFetch("acquire", "doc-lock-1", "session-a")
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  it("second acquire from different session returns 409", async () => {
    const res = await testFetch("acquire", "doc-lock-2", "session-a")
    expect(res.status).toBe(200)
    const res2 = await testFetch("acquire", "doc-lock-2", "session-b")
    expect(res2.status).toBe(409)
    const data = await res2.json() as { error: string; holder: string }
    expect(data.error).toBe("LOCKED")
    expect(data.holder).toBe("session-a")
  })

  it("same session can re-acquire (idempotent)", async () => {
    const res1 = await testFetch("acquire", "doc-lock-3", "session-a")
    expect(res1.status).toBe(200)
    const res2 = await testFetch("acquire", "doc-lock-3", "session-a")
    expect(res2.status).toBe(200)
    const data = await res2.json() as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  it("release then re-acquire succeeds", async () => {
    const res1 = await testFetch("acquire", "doc-lock-4", "session-a")
    expect(res1.status).toBe(200)
    await testFetch("release", "doc-lock-4", "session-a")
    const res2 = await testFetch("acquire", "doc-lock-4", "session-b")
    expect(res2.status).toBe(200)
    const data = await res2.json() as { ok: boolean }
    expect(data.ok).toBe(true)
  })
})

describe("edit_doc conflict detection", () => {
  let docId: string
  let rev1: string

  it("create doc for conflict test", async () => {
    const result = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Conflict Test Post",
        slug: "conflict-test-post",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Original body content.",
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    docId = data.id
    rev1 = data.rev
  })

  it("edit with stale base_rev returns CONFLICT", async () => {
    // Simulate another write by updating head_rev in DB directly
    const fakeRev = "01JFAKE0000000000000000000"
    await testEnv.DB.prepare(`UPDATE documents SET head_rev=? WHERE id=?`).bind(fakeRev, docId).run()

    const result = await editDocHandler(testEnv, identity, {
      id: docId,
      base_rev: rev1, // stale: DB now has fakeRev
      edits: [{ op: "append", text: "New content." }],
    })
    // Should be okResult (structured conflict, not MCP error)
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.error).toBe("CONFLICT")
    expect(data.current_rev).toBe(fakeRev)
    expect(data.diff).toBeDefined()

    // Restore head_rev for further tests
    await testEnv.DB.prepare(`UPDATE documents SET head_rev=? WHERE id=?`).bind(rev1, docId).run()
  })

  it("edit with fresh base_rev succeeds and creates new revision", async () => {
    const result = await editDocHandler(testEnv, identity, {
      id: docId,
      base_rev: rev1,
      edits: [{ op: "append", text: "\nAdded content." }],
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.rev).toBeDefined()
    expect(data.rev).not.toBe(rev1)
  })
})

describe("history", () => {
  let docId: string
  let rev1: string
  let rev2: string

  it("create + edit → history shows 2 revisions, newest first", async () => {
    // Create doc
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "History Test Post",
        slug: "history-test-post",
        date: "2024-01-01T00:00:00Z",
      },
      body: "History test body.",
    })
    expect(createResult.isError).toBeFalsy()
    const createData = JSON.parse(createResult.content[0].text)
    docId = createData.id
    rev1 = createData.rev

    // Edit to create second revision
    const editResult = await editDocHandler(testEnv, identity, {
      id: docId,
      base_rev: rev1,
      edits: [{ op: "append", text: "\nEdited." }],
    })
    expect(editResult.isError).toBeFalsy()
    const editData = JSON.parse(editResult.content[0].text)
    rev2 = editData.rev

    // Get history
    const histResult = await historyHandler(testEnv, identity, { id: docId })
    expect(histResult.isError).toBeFalsy()
    const histData = JSON.parse(histResult.content[0].text)
    expect(histData.doc_id).toBe(docId)
    expect(histData.revisions.length).toBeGreaterThanOrEqual(2)
    // Newest first
    const revIds = histData.revisions.map((r: { rev: string }) => r.rev)
    expect(revIds[0]).toBe(rev2)
    expect(revIds).toContain(rev1)
  })
})

describe("revert", () => {
  let docId: string
  let rev1: string

  it("create, edit, revert to first rev → new revision with old content", async () => {
    // Create
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Revert Test Post",
        slug: "revert-test-post",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Original revert body.",
    })
    expect(createResult.isError).toBeFalsy()
    const createData = JSON.parse(createResult.content[0].text)
    docId = createData.id
    rev1 = createData.rev

    // Edit
    const editResult = await editDocHandler(testEnv, identity, {
      id: docId,
      base_rev: rev1,
      edits: [{ op: "str_replace", old: "Original revert body.", new: "Edited revert body." }],
    })
    expect(editResult.isError).toBeFalsy()
    const editData = JSON.parse(editResult.content[0].text)
    const rev2 = editData.rev

    // Revert to rev1
    const revertResult = await revertHandler(testEnv, identity, { id: docId, to_rev: rev1 })
    expect(revertResult.isError).toBeFalsy()
    const revertData = JSON.parse(revertResult.content[0].text)
    expect(revertData.rev).toBeDefined()
    expect(revertData.rev).not.toBe(rev1)
    expect(revertData.rev).not.toBe(rev2)
    // Content should contain original body
    expect(revertData.content).toContain("Original revert body.")
  })
})

describe("delete_doc two-step", () => {
  let docId: string
  let rev1: string

  beforeAll(async () => {
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Delete Test Post",
        slug: "delete-test-post",
        date: "2024-01-01T00:00:00Z",
      },
      body: "To be deleted.",
    })
    expect(createResult.isError).toBeFalsy()
    const data = JSON.parse(createResult.content[0].text)
    docId = data.id
    rev1 = data.rev
  })

  it("first call without confirm returns confirm_required", async () => {
    const result = await deleteDocHandler(testEnv, identity, { id: docId })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.confirm_required).toBe(true)
    expect(data.id).toBe(docId)
  })

  it("second call with wrong confirm returns error", async () => {
    const result = await deleteDocHandler(testEnv, identity, { id: docId, confirm: "wrong-id" })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("confirm_mismatch")
  })

  it("third call with correct id archives the doc", async () => {
    const result = await deleteDocHandler(testEnv, identity, { id: docId, confirm: docId })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.status).toBe("archived")
    expect(data.id).toBe(docId)
    // Verify in DB
    const row = await testEnv.DB.prepare(`SELECT status FROM documents WHERE id=?`).bind(docId).first<{ status: string }>()
    expect(row?.status).toBe("archived")
  })
})

describe("publish validation fail", () => {
  it("create doc missing required date field, attempt publish → validation_fail", async () => {
    // Create doc bypassing schema validation by using schema/ collection (no schema loaded)
    // Instead create with all fields but then overwrite content without date
    const createResult = await createDocHandler(testEnv, identity, {
      collection: "posts",
      frontmatter: {
        title: "Publish Fail Post",
        slug: "publish-fail-post",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Will fail publish.",
    })
    expect(createResult.isError).toBeFalsy()
    const createData = JSON.parse(createResult.content[0].text)
    const docId = createData.id
    const rev = createData.rev

    // Overwrite content in R2 to remove the date field
    const currentObj = await testEnv.BUCKET.get(`content/posts/publish-fail-post.md`)
    expect(currentObj).not.toBeNull()
    const currentContent = await currentObj!.text()
    // Remove date line
    const modifiedContent = currentContent.replace(/^date:.*\n/m, "")
    await testEnv.BUCKET.put(`content/posts/publish-fail-post.md`, modifiedContent)

    // Attempt publish
    const publishResult = await publishHandler(testEnv, identity, { id: docId, base_rev: rev })
    expect(publishResult.isError).toBe(true)
    const publishData = JSON.parse(publishResult.content[0].text)
    expect(publishData.code).toBe("validation_fail")
  })
})

describe("namespace capability enforcement (T2b)", () => {
  it("identity with empty namespaces cannot edit schema/ doc", async () => {
    // First create a schema doc using schemaIdentity
    const createResult = await createDocHandler(testEnv, schemaIdentity, {
      collection: "schema",
      frontmatter: {
        title: "Test Schema Doc",
        slug: "test-schema-doc",
        date: "2024-01-01T00:00:00Z",
      },
      body: "Schema content.",
    })
    // Note: schema collection might not have a schema for it, so might fail schema_not_found
    // We test the namespace check which comes before schema validation
    // The error should be capability_denied, not schema_not_found
    // If schemaIdentity succeeds or fails for another reason, test identity should be denied

    // Try editing with regular identity (no "schema" in namespaces)
    const editResult = await editDocHandler(testEnv, identity, {
      id: "schema/test-schema-doc",
      base_rev: "anything",
      edits: [{ op: "append", text: "hack" }],
    })
    // Either not found (doc doesn't exist because create failed) or capability_denied
    // The namespace check runs after docId resolution, so if doc doesn't exist it's not_found
    // Let's create the doc directly in R2/DB to simulate it existing
    const schemaDocId = "01JSCHEMA00000000000000000"
    const schemaRev = "01JSCHEMAREV0000000000000"
    const now = new Date().toISOString()
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO documents (id, collection, slug, status, head_rev, title, card, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(schemaDocId, "schema", "protected-schema-doc", "draft", schemaRev, "Protected", "{}", now, now).run()
    await testEnv.BUCKET.put(`content/schema/protected-schema-doc.md`, `---\ntitle: Protected\nslug: protected-schema-doc\n_id: ${schemaDocId}\n_rev: ${schemaRev}\n---\nContent.\n`)

    const protectedEditResult = await editDocHandler(testEnv, identity, {
      id: schemaDocId,
      base_rev: schemaRev,
      edits: [{ op: "append", text: "hack" }],
    })
    expect(protectedEditResult.isError).toBe(true)
    const data = JSON.parse(protectedEditResult.content[0].text)
    expect(data.code).toBe("capability_denied")
  })
})

describe("get_context", () => {
  it("returns schema and always-mode skills", async () => {
    const result = await getContextHandler(testEnv, identity, { task: "write a post", collection: "posts" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.task).toBe("write a post")
    expect(data.collection).toBe("posts")
    expect(Array.isArray(data.schemas)).toBe(true)
    expect(data.schemas.length).toBeGreaterThan(0)
    expect(Array.isArray(data.skills)).toBe(true)
    expect(data.skills.length).toBeGreaterThan(0)
    expect(data.skills[0].frontmatter.mode).toBe("always")
  })
})
