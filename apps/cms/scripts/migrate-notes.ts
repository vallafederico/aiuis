import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const cmsDir = join(__dirname, "..")

function readDevSecret(): string {
  try {
    const devVars = readFileSync(join(cmsDir, ".dev.vars"), "utf-8")
    for (const line of devVars.split("\n")) {
      const match = line.match(/^CMS_DEV_SECRET=(.+)$/)
      if (match) return match[1].trim()
    }
  } catch {}
  return process.env.CMS_DEV_SECRET ?? ""
}

const secret = readDevSecret()
const cmsUrl = process.env.CMS_URL ?? "http://localhost:8787"

const res = await fetch(`${cmsUrl}/dev/migrate-notes`, {
  method: "POST",
  headers: { "X-Dev-Secret": secret },
})

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`)
  process.exit(1)
}

const data = await res.json() as {
  migrated: number
  skipped: number
  errors: number
  results: Array<{ slug: string; status: string; detail?: string; newRev?: string }>
}

for (const r of data.results) {
  const extra = r.detail ? ` (${r.detail})` : r.newRev ? ` → ${r.newRev}` : ""
  console.log(`[${r.status.padEnd(8)}] ${r.slug}${extra}`)
}

console.log(`\nDone: ${data.migrated} migrated, ${data.skipped} skipped, ${data.errors} errors`)
if (data.errors > 0) process.exit(1)
