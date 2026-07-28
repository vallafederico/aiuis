#!/usr/bin/env node
/**
 * demo-images.ts — Upload demo images to the local CMS dev instance.
 *
 * Usage:
 *   CMS_URL=http://localhost:8787 CMS_DEV_SECRET=dev-secret-change-me npx tsx scripts/demo-images.ts
 *
 * This script reads logo.png from apps/web/public/msdf/ and uploads it
 * to assets/demo/logo.png via the /dev/upload-asset convenience endpoint.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

const secret = process.env.CMS_DEV_SECRET ?? "dev-secret-change-me"
const cmsUrl = process.env.CMS_URL ?? "http://localhost:8787"

const assets: Array<{ localPath: string; remotePath: string; mime: string }> = [
  {
    localPath: join(__dirname, "../../web/public/msdf/logo.png"),
    remotePath: "assets/demo/logo.png",
    mime: "image/png",
  },
]

for (const asset of assets) {
  let imageBytes: Buffer
  try {
    imageBytes = readFileSync(asset.localPath)
  } catch (e) {
    console.warn(`Skipping ${asset.localPath}: file not found`)
    continue
  }

  const content_base64 = imageBytes.toString("base64")

  const res = await fetch(`${cmsUrl}/dev/upload-asset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-Secret": secret,
    },
    body: JSON.stringify({
      path: asset.remotePath,
      content_base64,
      mime: asset.mime,
      overwrite: true,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Failed to upload ${asset.remotePath}:`, text)
    continue
  }

  const data = await res.json()
  console.log(`Uploaded ${asset.remotePath}:`, data)
}
