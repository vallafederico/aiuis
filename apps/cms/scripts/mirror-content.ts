import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const cmsDir = join(__dirname, "..")
const mirrorDir = join(cmsDir, "mirror")

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

const README_CONTENT = `This directory is a generated read-only reflection of the CMS's R2 storage. Edits here do not flow back — edit via MCP tools + /review instead. Regenerate with: pnpm --filter cms run mirror`

/** Recursively collect all file paths under a directory */
function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full))
    } else {
      results.push(full)
    }
  }
  return results
}

async function runMirror(): Promise<boolean> {
  const secret = readDevSecret()
  const cmsUrl = process.env.CMS_URL ?? "http://localhost:8787"

  const res = await fetch(`${cmsUrl}/dev/export`, {
    headers: { "X-Dev-Secret": secret },
  })

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data = await res.json() as { files: Array<{ path: string; content: string }> }

  // Build set of expected local paths (relative to mirrorDir)
  const remotePathSet = new Set<string>()
  for (const f of data.files) {
    remotePathSet.add(f.path)
  }
  // Also README
  const readmePath = "README.md"

  // Collect existing local files (relative paths from mirrorDir)
  const existingFiles = collectFiles(mirrorDir)
    .map(f => relative(mirrorDir, f))

  let changed = false

  // Write/update remote files
  for (const f of data.files) {
    const localPath = join(mirrorDir, f.path)
    const dir = dirname(localPath)
    mkdirSync(dir, { recursive: true })

    let existing: string | null = null
    try {
      existing = readFileSync(localPath, "utf-8")
    } catch {}

    if (existing === null) {
      writeFileSync(localPath, f.content, "utf-8")
      console.log(`+ ${f.path}`)
      changed = true
    } else if (existing !== f.content) {
      writeFileSync(localPath, f.content, "utf-8")
      console.log(`~ ${f.path}`)
      changed = true
    }
  }

  // Always write/update README
  {
    const readmeLocalPath = join(mirrorDir, readmePath)
    let existingReadme: string | null = null
    try {
      existingReadme = readFileSync(readmeLocalPath, "utf-8")
    } catch {}
    if (existingReadme !== README_CONTENT) {
      mkdirSync(mirrorDir, { recursive: true })
      writeFileSync(readmeLocalPath, README_CONTENT, "utf-8")
      if (existingReadme === null) {
        console.log(`+ ${readmePath}`)
      } else {
        console.log(`~ ${readmePath}`)
      }
      changed = true
    }
  }

  // Delete local files that no longer exist remotely
  for (const relPath of existingFiles) {
    if (relPath === readmePath) continue // never delete README
    if (!remotePathSet.has(relPath)) {
      const localPath = join(mirrorDir, relPath)
      rmSync(localPath)
      console.log(`- ${relPath}`)
      changed = true
    }
  }

  return changed
}

const watchMode = process.argv.includes("--watch")

if (watchMode) {
  // One-shot first run (log everything)
  await runMirror()
  // Then poll every 3 seconds, log only on change
  setInterval(async () => {
    try {
      await runMirror()
    } catch (e) {
      console.error("mirror error:", e)
    }
  }, 3000)
} else {
  await runMirror()
}
