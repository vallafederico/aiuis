/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { uploadAssetHandler, listAssetsHandler } from "../../src/mcp/tools/assets.js"
import { validateBodyImages } from "../../src/core/images.js"
import { deriveDoc } from "../../src/derive/pipeline.js"

const testEnv = env as unknown as Env

// Minimal 1x1 transparent PNG (known-good)
const PNG_1x1_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const devIdentity = {
  principal: "test-agent",
  kind: "agent" as const,
  session: "test-session",
  audience: "test",
  capabilities: { publish: true, collections: "*", namespaces: ["content"] as string[] },
}

const noContentIdentity = {
  principal: "no-content-agent",
  kind: "agent" as const,
  session: "test-session-nocap",
  audience: "test",
  capabilities: { publish: false, collections: "*", namespaces: [] as string[] },
}

beforeAll(async () => {
  // @ts-expect-error - inject is provided via vitest.config.ts
  await applyD1Migrations(testEnv.DB, inject("migrations"))

  // Seed a minimal schema for "pieces" collection (needed for body image validation tests)
  await testEnv.BUCKET.put(
    "schema/pieces.json",
    JSON.stringify({
      collection: "pieces",
      fields: [
        { name: "title", type: "string", required: true },
        { name: "slug", type: "string", required: true },
        { name: "section", type: "string", required: false },
      ],
    })
  )
})

describe("upload_asset", () => {
  it("happy path: uploads a 1x1 PNG and records D1 metadata", async () => {
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/test/sample.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.path).toBe("assets/test/sample.png")
    expect(data.mime).toBe("image/png")
    expect(data.size).toBeGreaterThan(0)
    // PNG 1x1 dimensions
    expect(data.width).toBe(1)
    expect(data.height).toBe(1)

    // Verify D1 row
    const row = await testEnv.DB.prepare(
      "SELECT path, mime, size, width, height FROM assets WHERE path=?"
    ).bind("assets/test/sample.png").first<{ path: string; mime: string; size: number; width: number; height: number }>()
    expect(row).not.toBeNull()
    expect(row!.path).toBe("assets/test/sample.png")
    expect(row!.mime).toBe("image/png")
    expect(row!.width).toBe(1)
    expect(row!.height).toBe(1)

    // Verify R2 object exists
    const obj = await testEnv.BUCKET.get("assets/test/sample.png")
    expect(obj).not.toBeNull()
  })

  it("bad path: path not starting with assets/ → asset_path_invalid", async () => {
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "public/image.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("asset_path_invalid")
  })

  it("mime/extension mismatch: .png path with image/jpeg → mime_extension_mismatch", async () => {
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/test/wrong.png",
      content_base64: PNG_1x1_B64,
      mime: "image/jpeg",
    })

    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("mime_extension_mismatch")
  })

  it("duplicate without overwrite → asset_exists", async () => {
    // First upload
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/test/dup.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    // Second upload without overwrite
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/test/dup.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("asset_exists")
  })

  it("duplicate with overwrite:true → succeeds", async () => {
    // First upload
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/test/overwrite.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    // Second upload with overwrite
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/test/overwrite.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
      overwrite: true,
    })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.path).toBe("assets/test/overwrite.png")
  })

  it("capability denial: no content namespace → capability_denied", async () => {
    const result = await uploadAssetHandler(testEnv, noContentIdentity, {
      path: "assets/test/denied.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("capability_denied")
  })
})

describe("asset serve route (GET /api/v1/assets/*)", () => {
  it("returns 200 with correct Content-Type and Cache-Control for existing asset", async () => {
    // Seed the asset
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/serve/test.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    // Import the worker default export for HTTP testing
    const worker = await import("../../src/index.js")
    const res = await (worker.default as any).fetch(
      new Request("http://localhost/api/v1/assets/serve/test.png"),
      testEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("image/png")
    expect(res.headers.get("Cache-Control")).toContain("immutable")
  })

  it("returns 404 JSON for nonexistent asset", async () => {
    const worker = await import("../../src/index.js")
    const res = await (worker.default as any).fetch(
      new Request("http://localhost/api/v1/assets/nonexistent/missing.png"),
      testEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    )

    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe("not found")
  })
})

describe("body image validation (validateBodyImages)", () => {
  it("missing asset reference returns asset_not_found error", async () => {
    const result = await validateBodyImages(
      testEnv,
      "# Title\n\n![alt](assets/missing/image.png)\n"
    )
    expect(result).not.toBeNull()
    expect(result!.error).toBe("asset_not_found")
    expect(result!.path).toBe("assets/missing/image.png")
    expect(result!.field).toBe("body")
  })

  it("external https URL passes without error", async () => {
    const result = await validateBodyImages(
      testEnv,
      "# Title\n\n![alt](https://example.com/img.png)\n"
    )
    expect(result).toBeNull()
  })

  it("uploaded asset passes validation", async () => {
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/test/validated.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    const result = await validateBodyImages(
      testEnv,
      "![alt](assets/test/validated.png)\n"
    )
    expect(result).toBeNull()
  })
})

describe("derive pipeline — image transforms", () => {
  it("block-level image gets wrapped in figure.cms-figure", async () => {
    // Upload a test asset
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/derive/figure.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    // Seed a revision in R2
    const markdown = `---
title: Figure Test
slug: figure-test
section: test
---

![A figure](assets/derive/figure.png)
`
    await testEnv.BUCKET.put(
      "revisions/pieces/figure-test/REV001.md",
      markdown
    )

    const result = await deriveDoc(testEnv, "pieces", "figure-test", "REV001")

    expect(result.body_html).toContain('<figure')
    expect(result.body_html).toContain('class="cms-figure"')
    expect(result.body_html).toContain('<img')
    expect(result.body_html).toContain('loading="lazy"')
    expect(result.body_html).toContain('decoding="async"')
    expect(result.body_html).toContain('/api/v1/assets/derive/figure.png')
  })

  it("derive injects width and height attributes from D1 metadata", async () => {
    // Upload a 1x1 PNG (dimensions will be recorded)
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/derive/dims.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    const markdown = `---
title: Dims Test
slug: dims-test
section: test
---

![An image with dims](assets/derive/dims.png)
`
    await testEnv.BUCKET.put(
      "revisions/pieces/dims-test/REV002.md",
      markdown
    )

    const result = await deriveDoc(testEnv, "pieces", "dims-test", "REV002")

    expect(result.body_html).toContain('width="1"')
    expect(result.body_html).toContain('height="1"')
  })

  it("sanitize strips javascript: src from img tags", async () => {
    const markdown = `---
title: XSS Test
slug: xss-test
section: test
---

<img src="javascript:alert(1)" alt="xss">
`
    await testEnv.BUCKET.put(
      "revisions/pieces/xss-test/REV003.md",
      markdown
    )

    const result = await deriveDoc(testEnv, "pieces", "xss-test", "REV003")

    expect(result.body_html).not.toContain("javascript:")
  })

  it("derive result includes assets array for referenced assets", async () => {
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/derive/listed.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    const markdown = `---
title: Assets List Test
slug: assets-list-test
section: test
---

![Listed](assets/derive/listed.png)
`
    await testEnv.BUCKET.put(
      "revisions/pieces/assets-list-test/REV004.md",
      markdown
    )

    const result = await deriveDoc(testEnv, "pieces", "assets-list-test", "REV004")

    expect(result.assets).toBeDefined()
    expect(result.assets.length).toBeGreaterThan(0)
    const asset = result.assets.find(a => a.path === "assets/derive/listed.png")
    expect(asset).toBeDefined()
    expect(asset!.width).toBe(1)
    expect(asset!.height).toBe(1)
  })
})

describe("list_assets", () => {
  it("returns uploaded assets in created DESC order", async () => {
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/list-test/a.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/list-test/b.png",
      content_base64: PNG_1x1_B64,
      mime: "image/png",
    })

    const result = await listAssetsHandler(testEnv, devIdentity, { prefix: "assets/list-test/" })
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.assets).toBeDefined()
    expect(data.assets.length).toBeGreaterThanOrEqual(2)
    const paths = data.assets.map((a: { path: string }) => a.path)
    expect(paths).toContain("assets/list-test/a.png")
    expect(paths).toContain("assets/list-test/b.png")
  })
})
