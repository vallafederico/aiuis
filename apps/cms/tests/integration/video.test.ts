/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeAll, inject } from "vitest"
import { env } from "cloudflare:workers"
import { applyD1Migrations } from "cloudflare:test"
import type { Env } from "../../src/index.js"
import { uploadAssetHandler } from "../../src/mcp/tools/assets.js"
import { validateBodyImages } from "../../src/core/images.js"
import { deriveDoc } from "../../src/derive/pipeline.js"

const testEnv = env as unknown as Env

// Minimal base64 payload for upload tests (not a real video, but enough to test the upload path)
const DUMMY_B64 = "AAAA"

const devIdentity = {
  principal: "test-agent",
  kind: "agent" as const,
  session: "test-session",
  audience: "test",
  capabilities: { publish: true, collections: "*", namespaces: ["content"] as string[] },
}

beforeAll(async () => {
  // @ts-expect-error - inject is provided via vitest.config.ts
  await applyD1Migrations(testEnv.DB, inject("migrations"))

  // Seed a minimal schema for "pieces" collection
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

  // Seed the video directive schema
  await testEnv.BUCKET.put(
    "schema/directives/video.md",
    `---
_kind: directive_schema
name: video
form: leaf
attributes:
  src:
    type: string
    required: true
  poster:
    type: string
  caption:
    type: string
  ambient:
    type: boolean
intent: "Embed a video asset with optional poster, caption, and ambient (autoplay) mode."
---
Video directive guidelines.
`
  )
})

describe("::video derive pipeline — controls mode", () => {
  it("produces <video controls> wrapped in figure.cms-figure.cms-video", async () => {
    // Upload a video asset
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/clip.mp4",
      content_base64: DUMMY_B64,
      mime: "video/mp4",
    })

    const markdown = `---
title: Video Controls Test
slug: video-controls-test
section: test
---

::video{src="assets/video/clip.mp4"}
`
    await testEnv.BUCKET.put(
      "revisions/pieces/video-controls-test/VREV001.md",
      markdown
    )

    const result = await deriveDoc(testEnv, "pieces", "video-controls-test", "VREV001")

    expect(result.body_html).toContain("<video")
    expect(result.body_html).toContain("controls")
    expect(result.body_html).toContain("/api/v1/assets/video/clip.mp4")
    expect(result.body_html).toContain('class="cms-figure cms-video"')
    // ambient attributes should NOT be present
    expect(result.body_html).not.toContain("autoplay")
    expect(result.body_html).not.toContain("loop")
  })
})

describe("::video derive pipeline — ambient mode", () => {
  it("produces <video autoplay muted loop playsinline> without controls", async () => {
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/ambient.mp4",
      content_base64: DUMMY_B64,
      mime: "video/mp4",
    })

    const markdown = `---
title: Video Ambient Test
slug: video-ambient-test
section: test
---

::video{src="assets/video/ambient.mp4" ambient}
`
    await testEnv.BUCKET.put(
      "revisions/pieces/video-ambient-test/VREV002.md",
      markdown
    )

    const result = await deriveDoc(testEnv, "pieces", "video-ambient-test", "VREV002")

    expect(result.body_html).toContain("<video")
    expect(result.body_html).toContain("autoplay")
    expect(result.body_html).toContain("muted")
    expect(result.body_html).toContain("loop")
    expect(result.body_html).toContain("playsinline")
    // controls should NOT be present
    expect(result.body_html).not.toContain("controls")
  })
})

describe("::video derive pipeline — caption", () => {
  it("produces <figcaption> when caption attribute is set", async () => {
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/captioned.mp4",
      content_base64: DUMMY_B64,
      mime: "video/mp4",
    })

    const markdown = `---
title: Video Caption Test
slug: video-caption-test
section: test
---

::video{src="assets/video/captioned.mp4" caption="A captioned video"}
`
    await testEnv.BUCKET.put(
      "revisions/pieces/video-caption-test/VREV003.md",
      markdown
    )

    const result = await deriveDoc(testEnv, "pieces", "video-caption-test", "VREV003")

    expect(result.body_html).toContain("<figcaption>")
    expect(result.body_html).toContain("A captioned video")
    expect(result.body_html).toContain("</figcaption>")
  })
})

describe("::video derive pipeline — missing src", () => {
  it("does not crash when src is missing (graceful degradation)", async () => {
    const markdown = `---
title: Video No Src Test
slug: video-no-src-test
section: test
---

::video{}
`
    await testEnv.BUCKET.put(
      "revisions/pieces/video-no-src-test/VREV004.md",
      markdown
    )

    // Should not throw
    const result = await deriveDoc(testEnv, "pieces", "video-no-src-test", "VREV004")
    expect(result).toBeDefined()
    expect(result.body_html).toBeDefined()
  })
})

describe("validateBodyImages — ::video asset refs", () => {
  it("video src pointing to missing asset returns asset_not_found", async () => {
    const result = await validateBodyImages(
      testEnv,
      "::video{src=\"assets/video/missing.mp4\"}\n"
    )
    expect(result).not.toBeNull()
    expect(result!.error).toBe("asset_not_found")
    expect(result!.path).toBe("assets/video/missing.mp4")
    expect(result!.field).toBe("body")
  })

  it("video src pointing to existing asset passes validation", async () => {
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/valid.mp4",
      content_base64: DUMMY_B64,
      mime: "video/mp4",
    })

    const result = await validateBodyImages(
      testEnv,
      "::video{src=\"assets/video/valid.mp4\"}\n"
    )
    expect(result).toBeNull()
  })

  it("video poster pointing to missing asset returns asset_not_found", async () => {
    await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/src-ok.mp4",
      content_base64: DUMMY_B64,
      mime: "video/mp4",
    })

    const result = await validateBodyImages(
      testEnv,
      "::video{src=\"assets/video/src-ok.mp4\" poster=\"assets/video/missing-poster.png\"}\n"
    )
    expect(result).not.toBeNull()
    expect(result!.error).toBe("asset_not_found")
    expect(result!.path).toBe("assets/video/missing-poster.png")
  })
})

describe("upload_asset — video mime types", () => {
  it("video/mp4 with .mp4 extension is accepted", async () => {
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/upload-test.mp4",
      content_base64: DUMMY_B64,
      mime: "video/mp4",
    })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.path).toBe("assets/video/upload-test.mp4")
    expect(data.mime).toBe("video/mp4")
  })

  it("video/mp4 with wrong extension → mime_extension_mismatch", async () => {
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/wrong-ext.webm",
      content_base64: DUMMY_B64,
      mime: "video/mp4",
    })

    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.code).toBe("mime_extension_mismatch")
  })

  it("video/webm with .webm extension is accepted", async () => {
    const result = await uploadAssetHandler(testEnv, devIdentity, {
      path: "assets/video/upload-test.webm",
      content_base64: DUMMY_B64,
      mime: "video/webm",
    })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.path).toBe("assets/video/upload-test.webm")
    expect(data.mime).toBe("video/webm")
  })
})
