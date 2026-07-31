/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:test"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { mintTokenHandler, revokeTokenHandler, listTokensHandler } from "../../src/mcp/tools/tokens.js"

const testEnv = env as unknown as Env

const adminIdentity = {
  principal: "admin",
  kind: "human",
  audience: "any",
  session: "admin0000",
  capabilities: { publish: true, collections: "*" as const, namespaces: ["content", "schema", "skills"], admin: true },
}

const nonAdminIdentity = {
  principal: "user",
  kind: "human",
  audience: "any",
  session: "user0000",
  capabilities: { publish: true, collections: "*" as const, namespaces: [] },
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
})

describe("Token lifecycle tools", () => {
  it("mint_token requires admin capability", async () => {
    const result = await mintTokenHandler(testEnv, nonAdminIdentity, {
      principal: "test",
      kind: "human",
      audience: "any",
      capabilities: { publish: true, collections: "*", namespaces: [] },
    })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("capability_denied")
  })

  it("mint_token creates a token and returns the plaintext", async () => {
    const result = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "test-principal",
      kind: "human",
      audience: "any",
      capabilities: { publish: true, collections: "*", namespaces: ["content"] },
    })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.token).toBeTruthy()
    expect(typeof data.token).toBe("string")
    expect(data.token_id).toHaveLength(64) // SHA-256 hex
    expect(data.principal).toBe("test-principal")
    expect(data.note).toContain("not be shown again")
  })

  it("minted token resolves correctly via resolveIdentity", async () => {
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "resolve-test",
      kind: "agent",
      audience: "mcp",
      capabilities: { publish: false, collections: [], namespaces: [] },
    })
    expect(mintResult.isError).toBeFalsy()
    const { token } = JSON.parse(mintResult.content[0].text)

    const { resolveIdentity } = await import("../../src/core/auth.js")
    const req = new Request("http://localhost/", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const identity = await resolveIdentity(req, testEnv)
    expect(identity.principal).toBe("resolve-test")
    expect(identity.kind).toBe("agent")
  })

  it("list_tokens requires admin capability", async () => {
    const result = await listTokensHandler(testEnv, nonAdminIdentity)
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("capability_denied")
  })

  it("list_tokens returns token list with id field (token_hash)", async () => {
    const result = await listTokensHandler(testEnv, adminIdentity)
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(Array.isArray(data.tokens)).toBe(true)
    // All rows have 'id' not 'token_hash'
    for (const t of data.tokens) {
      expect(t.id).toBeTruthy()
      expect(t.token_hash).toBeUndefined()
      expect(t.id).toHaveLength(64)
    }
  })

  it("revoke_token requires admin capability", async () => {
    const result = await revokeTokenHandler(testEnv, nonAdminIdentity, { token_id: "a".repeat(64) })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("capability_denied")
  })

  it("revoke_token disables a token so resolveIdentity fails", async () => {
    // Mint a token
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "to-revoke",
      kind: "human",
      audience: "any",
      capabilities: { publish: true, collections: "*", namespaces: [] },
    })
    expect(mintResult.isError).toBeFalsy()
    const { token, token_id } = JSON.parse(mintResult.content[0].text)

    // Verify it works
    const { resolveIdentity, AuthError } = await import("../../src/core/auth.js")
    const req1 = new Request("http://localhost/", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const identity = await resolveIdentity(req1, testEnv)
    expect(identity.principal).toBe("to-revoke")

    // Revoke it
    const revokeResult = await revokeTokenHandler(testEnv, adminIdentity, { token_id })
    expect(revokeResult.isError).toBeFalsy()
    const revokeData = JSON.parse(revokeResult.content[0].text)
    expect(revokeData.revoked).toBe(true)

    // Now resolveIdentity should fail
    const req2 = new Request("http://localhost/", {
      headers: { Authorization: `Bearer ${token}` },
    })
    await expect(resolveIdentity(req2, testEnv)).rejects.toThrow(AuthError)
  })

  it("revoke_token returns not_found for nonexistent token_id", async () => {
    const result = await revokeTokenHandler(testEnv, adminIdentity, { token_id: "f".repeat(64) })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("not_found")
  })

  it("list_tokens shows revoked status", async () => {
    // Mint and revoke a fresh token
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "revoked-in-list",
      kind: "human",
      audience: "any",
      capabilities: { publish: false, collections: [], namespaces: [] },
    })
    const { token_id } = JSON.parse(mintResult.content[0].text)
    await revokeTokenHandler(testEnv, adminIdentity, { token_id })

    const listResult = await listTokensHandler(testEnv, adminIdentity)
    const data = JSON.parse(listResult.content[0].text)
    const revokedRow = data.tokens.find((t: { id: string; revoked: boolean }) => t.id === token_id)
    expect(revokedRow).toBeDefined()
    expect(revokedRow.revoked).toBe(true)
  })
})

describe("last_used stamp", () => {
  it("resolveIdentity updates last_used after successful auth", async () => {
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "last-used-test",
      kind: "human",
      audience: "any",
      capabilities: { publish: true, collections: "*", namespaces: [] },
    })
    const { token, token_id } = JSON.parse(mintResult.content[0].text)

    // Initially last_used is null
    const before = await testEnv.DB.prepare("SELECT last_used FROM tokens WHERE token_hash=?")
      .bind(token_id).first<{ last_used: string | null }>()
    expect(before?.last_used).toBeNull()

    // Use the token
    const { resolveIdentity } = await import("../../src/core/auth.js")
    const req = new Request("http://localhost/", {
      headers: { Authorization: `Bearer ${token}` },
    })
    await resolveIdentity(req, testEnv)

    // Give the fire-and-forget a tick to complete
    await new Promise(r => setTimeout(r, 10))

    const after = await testEnv.DB.prepare("SELECT last_used FROM tokens WHERE token_hash=?")
      .bind(token_id).first<{ last_used: string | null }>()
    expect(after?.last_used).not.toBeNull()
  })
})
