import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const cmsDir = join(__dirname, "..")
const seedsDir = join(cmsDir, "seeds")

// Parse .dev.vars for CMS_DEV_SECRET
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

function walkDir(dir: string, base: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walkDir(full, base))
    } else {
      const relativePath = full.slice(base.length + 1) // strip leading separator
      files.push({ path: relativePath, content: readFileSync(full, "utf-8") })
    }
  }
  return files
}

const secret = readDevSecret()
const cmsUrl = process.env.CMS_URL ?? "http://localhost:8787"
const files = walkDir(seedsDir, seedsDir)

const res = await fetch(`${cmsUrl}/dev/seed`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Dev-Secret": secret,
  },
  body: JSON.stringify({ files }),
})

if (!res.ok) {
  console.error("Seed failed:", await res.text())
  process.exit(1)
}

const data = await res.json() as { written: number }
console.log(`Seeded ${data.written} files`)
