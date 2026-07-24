/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import { resolveIdentity, AuthError } from "../../src/core/auth.js"
import type { Env } from "../../src/index.js"

const testEnv = env as unknown as Env

const TEST_TOKEN = "test-token-abc123-abcdef1234567890"

async function computeHash(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")
}

beforeAll(async () => {
  // @ts-expect-error - inject is provided via vitest.config.ts
  await applyD1Migrations(testEnv.DB, inject("migrations"))
})

describe("auth", () => {
  beforeAll(async () => {
    const hash = await computeHash(TEST_TOKEN)
    await testEnv.DB.prepare(
      `INSERT INTO tokens (token_hash, principal, kind, audience, capabilities, created) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(hash, "federico", "human", "any", JSON.stringify({ publish: true, collections: "*", namespaces: ["content"] }), new Date().toISOString()).run()
  })

  it("resolveIdentity with correct bearer returns AuthedIdentity", async () => {
    const req = new Request("http://localhost/", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    })
    const identity = await resolveIdentity(req, testEnv)
    expect(identity.principal).toBe("federico")
    expect(identity.kind).toBe("human")
    expect(identity.capabilities.publish).toBe(true)
    expect(identity.session).toHaveLength(8)
  })

  it("wrong token throws AuthError", async () => {
    const req = new Request("http://localhost/", {
      headers: { Authorization: "Bearer wrong-token-xyz" }
    })
    await expect(resolveIdentity(req, testEnv)).rejects.toThrow(AuthError)
  })

  it("expired token throws AuthError", async () => {
    const expiredToken = "expired-token-xyz-abcdef1234567890"
    const hash = await computeHash(expiredToken)
    await testEnv.DB.prepare(
      `INSERT INTO tokens (token_hash, principal, kind, audience, capabilities, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(hash, "federico", "human", "any", "{}", new Date().toISOString(), "2020-01-01T00:00:00Z").run()

    const req = new Request("http://localhost/", {
      headers: { Authorization: `Bearer ${expiredToken}` }
    })
    await expect(resolveIdentity(req, testEnv)).rejects.toThrow(AuthError)
  })
})
