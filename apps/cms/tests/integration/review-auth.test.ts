/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env, SELF } from "cloudflare:test"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { mintTokenHandler } from "../../src/mcp/tools/tokens.js"

const testEnv = env as unknown as Env

const adminIdentity = {
  principal: "admin",
  kind: "human",
  audience: "any",
  session: "admin0001",
  capabilities: { publish: true, collections: "*" as const, namespaces: ["content", "schema", "skills"], admin: true },
}

function devAuthHeader(): Record<string, string> {
  return { Authorization: `Bearer ${testEnv.CMS_DEV_SECRET ?? ""}` }
}

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
})

describe("Review auth — dev secret path", () => {
  it("redirect to /review/login without credentials", async () => {
    const res = await SELF.fetch("http://localhost/review", { redirect: "manual" })
    // Without auth: redirect to /review/login
    expect([302, 301]).toContain(res.status)
    expect(res.headers.get("location")).toContain("/review/login")
  })

  it("200 with dev secret Bearer header (ENVIRONMENT=dev)", async () => {
    const res = await SELF.fetch("http://localhost/review", {
      headers: devAuthHeader(),
    })
    expect(res.status).toBe(200)
  })

  it("?key= redirect sets cms_review_key cookie (dev only)", async () => {
    const secret = testEnv.CMS_DEV_SECRET ?? ""
    const res = await SELF.fetch(`http://localhost/review?key=${secret}`, {
      redirect: "manual",
    })
    expect(res.status).toBe(302)
    const cookie = res.headers.get("set-cookie") ?? ""
    expect(cookie).toContain("cms_review_key=")
  })

  it("401 when ?key= is wrong (dev only)", async () => {
    const res = await SELF.fetch("http://localhost/review?key=wrong-secret", {
      redirect: "manual",
    })
    expect(res.status).toBe(401)
  })
})

describe("Review auth — login page", () => {
  it("GET /review/login shows form without auth", async () => {
    const res = await SELF.fetch("http://localhost/review/login")
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("<form")
    expect(body).toContain('name="token"')
  })

  it("POST /review/login with valid publisher token sets session cookie and redirects", async () => {
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "reviewer-login-test",
      kind: "human",
      audience: "any",
      capabilities: { publish: true, collections: "*", namespaces: [] },
    })
    expect(mintResult.isError).toBeFalsy()
    const { token } = JSON.parse(mintResult.content[0].text)

    const formBody = new URLSearchParams({ token })
    const res = await SELF.fetch("http://localhost/review/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      redirect: "manual",
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/review")
    const cookie = res.headers.get("set-cookie") ?? ""
    expect(cookie).toContain("cms_session=")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
  })

  it("POST /review/login with invalid token redirects to /review/login?error=invalid", async () => {
    const formBody = new URLSearchParams({ token: "not-a-real-token" })
    const res = await SELF.fetch("http://localhost/review/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      redirect: "manual",
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toContain("/review/login?error=invalid")
  })

  it("POST /review/login with non-publisher token redirects to error", async () => {
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "no-publish",
      kind: "agent",
      audience: "any",
      capabilities: { publish: false, collections: [], namespaces: [] },
    })
    const { token } = JSON.parse(mintResult.content[0].text)

    const formBody = new URLSearchParams({ token })
    const res = await SELF.fetch("http://localhost/review/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      redirect: "manual",
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toContain("error=invalid")
  })

  it("session cookie grants access to /review", async () => {
    // Mint a publisher token
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "session-test",
      kind: "human",
      audience: "any",
      capabilities: { publish: true, collections: "*", namespaces: [] },
    })
    const { token } = JSON.parse(mintResult.content[0].text)

    // Login to get session cookie
    const loginRes = await SELF.fetch("http://localhost/review/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      redirect: "manual",
    })
    const sessionCookie = loginRes.headers.get("set-cookie") ?? ""
    const cookieValue = sessionCookie.split(";")[0] // cms_session=<value>

    // Use session cookie to access /review
    const res = await SELF.fetch("http://localhost/review", {
      headers: { Cookie: cookieValue },
    })
    expect(res.status).toBe(200)
  })
})

describe("Review auth — CSRF protection", () => {
  it("POST /review/action without CSRF token returns 403 when using session cookie", async () => {
    // Mint and login
    const mintResult = await mintTokenHandler(testEnv, adminIdentity, {
      principal: "csrf-test",
      kind: "human",
      audience: "any",
      capabilities: { publish: true, collections: "*", namespaces: [] },
    })
    const { token } = JSON.parse(mintResult.content[0].text)

    const loginRes = await SELF.fetch("http://localhost/review/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      redirect: "manual",
    })
    const sessionCookie = loginRes.headers.get("set-cookie") ?? ""
    const cookieValue = sessionCookie.split(";")[0]

    // POST without CSRF token
    const res = await SELF.fetch("http://localhost/review/action", {
      method: "POST",
      headers: {
        Cookie: cookieValue,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ action: "publish", docId: "fake", rev: "fake" }).toString(),
      redirect: "manual",
    })
    expect(res.status).toBe(403)
  })

  it("POST /review/action with dev secret bypasses CSRF", async () => {
    // Dev secret path has csrfToken="dev-bypass" so CSRF is not enforced
    // A POST with dev auth but no _csrf should NOT 403 (it will fail for other reasons like invalid doc)
    const formBody = new URLSearchParams({ action: "publish", docId: "nonexistent", rev: "nonexistent" })
    const res = await SELF.fetch("http://localhost/review/action", {
      method: "POST",
      headers: {
        ...devAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
      redirect: "manual",
    })
    // Should redirect (error redirect due to nonexistent doc) but NOT 403
    expect(res.status).not.toBe(403)
    expect([302, 301, 303]).toContain(res.status)
  })
})

describe("requireDevSecret — env guard", () => {
  it("requireDevSecret passes when ENVIRONMENT=dev", async () => {
    const { requireDevSecret, AuthError } = await import("../../src/core/auth.js")
    const req = new Request("http://localhost/dev/seed", {
      headers: { Authorization: "Bearer dev-secret-change-me" },
    })
    // testEnv.ENVIRONMENT = "dev" from wrangler.jsonc
    expect(() => requireDevSecret(req, testEnv)).not.toThrow()

    // Simulate a prod env
    const prodEnv = { ...testEnv, ENVIRONMENT: "production" } as unknown as Env
    expect(() => requireDevSecret(req, prodEnv)).toThrow(AuthError)
  })
})
