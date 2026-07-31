/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env, SELF } from "cloudflare:test"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"

const testEnv = env as unknown as Env

beforeAll(async () => {
  // @ts-expect-error
  await applyD1Migrations(testEnv.DB, inject("migrations"))
})

// Helper to fetch with CORS_ORIGINS set via custom env override
// Note: in vitest-pool-workers, env bindings come from wrangler.jsonc vars.
// We test behavior by exercising the actual cors.ts logic via SELF.fetch with Origin headers.
// Since CORS_ORIGINS is not set in wrangler.jsonc test vars, CORS headers should NOT appear
// (that is the default-off behavior). These tests verify the middleware is wired up.

describe("CORS middleware", () => {
  it("no CORS headers when CORS_ORIGINS is not set", async () => {
    const res = await SELF.fetch("http://localhost/api/v1/articles", {
      headers: { Origin: "https://example.com" },
    })
    // Response should succeed (or 404 due to no data) but no CORS headers
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("OPTIONS preflight without CORS_ORIGINS returns no CORS headers", async () => {
    const res = await SELF.fetch("http://localhost/api/v1/articles", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("/dev/* routes never get CORS headers (not wired)", async () => {
    const res = await SELF.fetch("http://localhost/dev/seed", {
      method: "POST",
      headers: {
        Origin: "https://example.com",
        Authorization: `Bearer ${testEnv.CMS_DEV_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files: [] }),
    })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})

describe("CORS unit logic", () => {
  it("applyCors adds header when origin matches allowlist", async () => {
    const { applyCors } = await import("../../src/core/cors.js")
    const req = new Request("http://localhost/api/v1/foo", {
      headers: { Origin: "https://allowed.example.com" },
    })
    const res = new Response("ok")
    const fakeEnv = { ...testEnv, CORS_ORIGINS: "https://allowed.example.com,https://other.example.com" } as unknown as Env
    const result = applyCors(req, res, fakeEnv)
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("https://allowed.example.com")
    expect(result.headers.get("Vary")).toBe("Origin")
    expect(result.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })

  it("applyCors does not add header when origin is not in allowlist", async () => {
    const { applyCors } = await import("../../src/core/cors.js")
    const req = new Request("http://localhost/api/v1/foo", {
      headers: { Origin: "https://evil.example.com" },
    })
    const res = new Response("ok")
    const fakeEnv = { ...testEnv, CORS_ORIGINS: "https://allowed.example.com" } as unknown as Env
    const result = applyCors(req, res, fakeEnv)
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("applyCors returns response unchanged when CORS_ORIGINS is not set", async () => {
    const { applyCors } = await import("../../src/core/cors.js")
    const req = new Request("http://localhost/api/v1/foo", {
      headers: { Origin: "https://example.com" },
    })
    const res = new Response("ok", { headers: { "X-Custom": "value" } })
    const fakeEnv = { ...testEnv } as unknown as Env
    const result = applyCors(req, res, fakeEnv)
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(result.headers.get("X-Custom")).toBe("value")
  })

  it("handlePreflight returns 204 with correct headers for matching origin", async () => {
    const { handlePreflight } = await import("../../src/core/cors.js")
    const req = new Request("http://localhost/api/v1/foo", {
      method: "OPTIONS",
      headers: { Origin: "https://allowed.example.com" },
    })
    const fakeEnv = { ...testEnv, CORS_ORIGINS: "https://allowed.example.com" } as unknown as Env
    const result = handlePreflight(req, fakeEnv)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(204)
    expect(result!.headers.get("Access-Control-Allow-Origin")).toBe("https://allowed.example.com")
    expect(result!.headers.get("Access-Control-Allow-Methods")).toContain("GET")
    expect(result!.headers.get("Access-Control-Allow-Methods")).toContain("POST")
    expect(result!.headers.get("Access-Control-Max-Age")).toBe("86400")
  })

  it("handlePreflight returns null for non-OPTIONS requests", async () => {
    const { handlePreflight } = await import("../../src/core/cors.js")
    const req = new Request("http://localhost/api/v1/foo", {
      method: "GET",
      headers: { Origin: "https://allowed.example.com" },
    })
    const fakeEnv = { ...testEnv, CORS_ORIGINS: "https://allowed.example.com" } as unknown as Env
    const result = handlePreflight(req, fakeEnv)
    expect(result).toBeNull()
  })

  it("handlePreflight returns null when origin not in allowlist", async () => {
    const { handlePreflight } = await import("../../src/core/cors.js")
    const req = new Request("http://localhost/api/v1/foo", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com" },
    })
    const fakeEnv = { ...testEnv, CORS_ORIGINS: "https://allowed.example.com" } as unknown as Env
    const result = handlePreflight(req, fakeEnv)
    expect(result).toBeNull()
  })
})
