#!/usr/bin/env tsx
/**
 * mirror-to-remote.ts — Mirror local dev state (D1, R2, FTS, KV) to the remote instance.
 *
 * Re-runnable: all writes are idempotent (INSERT OR IGNORE for D1, put for R2/KV,
 * DELETE+INSERT for FTS).
 *
 * Usage:
 *   pnpm mirror:remote [--instance=aiuis-cms] [--dry-run]
 *
 * Security note: direct R2 puts bypass the worker's publish path.
 * schema/ and skills/ objects never auto-publish (T1 identity/credential separation holds),
 * and tokens are intentionally excluded from this mirror.
 */

import { execSync } from "node:child_process"
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import { randomBytes } from "node:crypto"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const cmsDir = path.resolve(__dirname, "..")
const wranglerPath = path.join(cmsDir, "wrangler.jsonc")

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): { instance: string; dryRun: boolean } {
  const args = process.argv.slice(2)
  let instance = "aiuis-cms"
  let dryRun = false

  for (const arg of args) {
    if (arg.startsWith("--instance=")) instance = arg.slice("--instance=".length)
    else if (arg === "--dry-run") dryRun = true
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }

  return { instance, dryRun }
}

// ── SQL value escaping ────────────────────────────────────────────────────────

function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return "NULL"
  if (typeof v === "number") return String(v)
  // Escape single quotes by doubling them; handles markdown, newlines, backticks safely
  return "'" + String(v).replace(/'/g, "''") + "'"
}

// ── Content-type derivation ───────────────────────────────────────────────────

function contentTypeFromKey(key: string, httpMetadata: string): string {
  // Try http_metadata JSON first
  if (httpMetadata && httpMetadata !== "{}") {
    try {
      const parsed = JSON.parse(httpMetadata) as Record<string, unknown>
      const ct = parsed["contentType"]
      if (ct && typeof ct === "string" && ct.trim() !== "") return ct.trim()
    } catch {
      // ignore
    }
  }
  // Derive from extension
  const ext = path.extname(key).toLowerCase()
  switch (ext) {
    case ".md":   return "text/markdown"
    case ".json": return "application/json"
    case ".txt":  return "text/plain"
    case ".png":  return "image/png"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".webp": return "image/webp"
    case ".mp4":  return "video/mp4"
    case ".webm": return "video/webm"
    default:      return "application/octet-stream"
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(msg)
}

function runCapture(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }) as string
}

function runWrangler(cmd: string): void {
  execSync(cmd, { cwd: cmsDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
}

function globSqlite(dir: string): string {
  if (!existsSync(dir)) throw new Error(`Directory not found: ${dir}`)
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
    .map((f) => path.join(dir, f))
  if (files.length === 0) throw new Error(`No sqlite files found in ${dir}`)
  if (files.length > 1) throw new Error(`Multiple sqlite files in ${dir}: ${files.join(", ")}`)
  return files[0]
}

function checkSqlite3(): void {
  try {
    runCapture("sqlite3 --version")
  } catch {
    throw new Error(
      "sqlite3 CLI not found. Install it via: brew install sqlite (macOS) or apt-get install sqlite3 (Linux)",
    )
  }
}

// ── Step 1 — Locate local sqlite files ───────────────────────────────────────

interface LocalPaths {
  d1Sqlite: string
  r2Sqlite: string
  r2BlobsDir: string
}

function locateLocalState(): LocalPaths {
  const stateBase = path.join(cmsDir, ".wrangler", "state", "v3")

  const d1Dir = path.join(stateBase, "d1", "miniflare-D1DatabaseObject")
  const d1Sqlite = globSqlite(d1Dir)

  const r2Dir = path.join(stateBase, "r2", "miniflare-R2BucketObject")
  const r2Sqlite = globSqlite(r2Dir)

  // Blob files live under r2/<bucket_name>/blobs — bucket name varies per
  // instance config, so discover it rather than hardcoding
  const r2Base = path.join(stateBase, "r2")
  const bucketDirs = readdirSync(r2Base).filter(
    (d) => d !== "miniflare-R2BucketObject" && existsSync(path.join(r2Base, d, "blobs")),
  )
  if (bucketDirs.length === 0) throw new Error(`No R2 blobs directory found under ${r2Base}`)
  if (bucketDirs.length > 1) {
    throw new Error(`Multiple R2 bucket state dirs under ${r2Base}: ${bucketDirs.join(", ")}`)
  }
  const r2BlobsDir = path.join(r2Base, bucketDirs[0], "blobs")

  return { d1Sqlite, r2Sqlite, r2BlobsDir }
}

// ── Step 2 — D1 data migration ────────────────────────────────────────────────

interface MirrorRow {
  [key: string]: unknown
}

interface D1Counts {
  documents: number
  revisions: number
  assets: number
}

// Tables to mirror — excludes tokens, op_log, d1_migrations, FTS shadow tables
const D1_TABLES: Array<{ name: string; columns: string[] }> = [
  {
    name: "documents",
    columns: ["id", "collection", "slug", "status", "head_rev", "title", "card", "created", "updated", "published_rev"],
  },
  {
    name: "revisions",
    columns: ["rev", "doc_id", "at", "author_kind", "principal", "session", "note", "diff_stat"],
  },
  {
    name: "assets",
    columns: ["path", "mime", "size", "width", "height", "lqip", "principal", "created"],
  },
]

function stepD1(
  d1Sqlite: string,
  instance: string,
  tmpDir: string,
  dryRun: boolean,
): D1Counts {
  log("\n[step 2] D1 data migration...")
  const counts: D1Counts = { documents: 0, revisions: 0, assets: 0 }

  for (const table of D1_TABLES) {
    const raw = runCapture(`sqlite3 -readonly "${d1Sqlite}" -json "SELECT * FROM ${table.name}"`)
    let rows: MirrorRow[] = []
    if (raw.trim()) {
      try {
        rows = JSON.parse(raw) as MirrorRow[]
      } catch {
        throw new Error(`Failed to parse sqlite3 JSON output for table ${table.name}`)
      }
    }

    const count = rows.length
    log(`  ${table.name}: ${count} rows`)
    counts[table.name as keyof D1Counts] = count

    if (count === 0) continue

    const cols = table.columns.join(", ")
    const valueRows = rows
      .map((row) => `(${table.columns.map((c) => sqlVal(row[c])).join(", ")})`)
      .join(",\n  ")

    const sql = `BEGIN;\nINSERT OR IGNORE INTO ${table.name} (${cols}) VALUES\n  ${valueRows};\nCOMMIT;\n`

    const sqlFile = path.join(tmpDir, `${table.name}.sql`)
    writeFileSync(sqlFile, sql, "utf-8")

    if (dryRun) {
      log(`  [dry-run] SQL written to: ${sqlFile}`)
    } else {
      log(`  Executing ${table.name} upsert...`)
      runWrangler(`wrangler d1 execute ${instance}-db --remote --file="${sqlFile}"`)
      log(`  Done`)
    }
  }

  return counts
}

// ── Step 3 — R2 object upload ─────────────────────────────────────────────────

interface R2Object {
  key: string
  blob_id: string
  http_metadata: string
}

interface PrefixCounts {
  [prefix: string]: number
}

function stepR2(
  r2Sqlite: string,
  r2BlobsDir: string,
  instance: string,
  dryRun: boolean,
): { counts: PrefixCounts; total: number; failures: number } {
  log("\n[step 3] R2 object upload...")

  const raw = runCapture(
    `sqlite3 -readonly "${r2Sqlite}" -json "SELECT key, blob_id, http_metadata FROM _mf_objects"`,
  )

  let objects: R2Object[] = []
  if (raw.trim()) {
    try {
      objects = JSON.parse(raw) as R2Object[]
    } catch {
      throw new Error("Failed to parse _mf_objects JSON output")
    }
  }

  const total = objects.length
  log(`  Total R2 objects: ${total}`)

  // Count by prefix for summary
  const counts: PrefixCounts = {}
  for (const obj of objects) {
    const prefix = obj.key.split("/")[0] ?? "root"
    counts[prefix] = (counts[prefix] ?? 0) + 1
  }

  if (dryRun) {
    log("  [dry-run] Per-prefix counts:")
    for (const [prefix, n] of Object.entries(counts)) {
      log(`    ${prefix}/: ${n}`)
    }
    return { counts, total, failures: 0 }
  }

  let failures = 0
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i]
    const blobPath = path.join(r2BlobsDir, obj.blob_id)
    if (!existsSync(blobPath)) {
      log(`  [${i + 1}/${total}] MISSING blob for key: ${obj.key} (blob_id: ${obj.blob_id})`)
      failures++
      continue
    }

    const ct = contentTypeFromKey(obj.key, obj.http_metadata)
    const cmd = `wrangler r2 object put "${instance}/${obj.key}" --remote --file="${blobPath}" --content-type "${ct}"`

    try {
      runWrangler(cmd)
      log(`  [${i + 1}/${total}] ${obj.key}`)
    } catch (err: unknown) {
      const e = err as { message?: string }
      log(`  [${i + 1}/${total}] FAILED: ${obj.key} — ${e.message ?? String(err)}`)
      failures++
    }
  }

  return { counts, total, failures }
}

// ── Step 4 — FTS sync ─────────────────────────────────────────────────────────

function stepFTS(
  d1Sqlite: string,
  instance: string,
  tmpDir: string,
  dryRun: boolean,
): number {
  log("\n[step 4] FTS sync...")

  const raw = runCapture(
    `sqlite3 -readonly "${d1Sqlite}" -json "SELECT id, title, body_text FROM documents_fts"`,
  )

  let rows: Array<{ id: string; title: string; body_text: string }> = []
  if (raw.trim()) {
    try {
      rows = JSON.parse(raw) as Array<{ id: string; title: string; body_text: string }>
    } catch {
      throw new Error("Failed to parse documents_fts JSON output")
    }
  }

  log(`  FTS rows: ${rows.length}`)

  const valueRows = rows
    .map((r) => `(${sqlVal(r.id)}, ${sqlVal(r.title)}, ${sqlVal(r.body_text)})`)
    .join(",\n  ")

  const sql =
    rows.length === 0
      ? "BEGIN;\nDELETE FROM documents_fts;\nCOMMIT;\n"
      : `BEGIN;\nDELETE FROM documents_fts;\nINSERT INTO documents_fts (id, title, body_text) VALUES\n  ${valueRows};\nCOMMIT;\n`

  const sqlFile = path.join(tmpDir, "fts.sql")
  writeFileSync(sqlFile, sql, "utf-8")

  if (dryRun) {
    log(`  [dry-run] FTS SQL written to: ${sqlFile}`)
    return rows.length
  }

  log("  Executing FTS sync...")
  runWrangler(`wrangler d1 execute ${instance}-db --remote --file="${sqlFile}"`)
  log("  Done")

  return rows.length
}

// ── Step 5 — KV pointers ─────────────────────────────────────────────────────

function readKvId(): string {
  const text = readFileSync(wranglerPath, "utf-8")
  // Split at kv_namespaces to avoid matching d1 database_id
  const splitIdx = text.indexOf('"kv_namespaces"')
  if (splitIdx === -1) throw new Error('"kv_namespaces" not found in wrangler.jsonc')
  const kvSection = text.slice(splitIdx)
  const m = kvSection.match(/"id"\s*:\s*"([^"]+)"/)
  if (!m) throw new Error('Could not find "id" in kv_namespaces section of wrangler.jsonc')
  const id = m[1]
  if (id === "REPLACE_AFTER_PROVISION") {
    throw new Error(
      'KV namespace id is still "REPLACE_AFTER_PROVISION" in wrangler.jsonc.\n' +
        "Run: pnpm provision --instance=<instance> first, or set it manually.",
    )
  }
  return id
}

interface DocRow {
  collection: string
  slug: string
  published_rev: string
}

function stepKV(
  d1Sqlite: string,
  instance: string,
  dryRun: boolean,
): number {
  log("\n[step 5] KV pointers...")

  let kvId: string
  try {
    kvId = readKvId()
    log(`  KV namespace id: ${kvId}`)
  } catch (err) {
    if (!dryRun) throw err
    log(`  [dry-run] ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`)
    log("  [dry-run] Continuing — a real run needs the provisioned KV namespace id")
    kvId = "<unprovisioned>"
  }

  const raw = runCapture(
    `sqlite3 -readonly "${d1Sqlite}" -json ` +
      `"SELECT collection, slug, published_rev FROM documents WHERE published_rev IS NOT NULL"`,
  )

  let rows: DocRow[] = []
  if (raw.trim()) {
    try {
      rows = JSON.parse(raw) as DocRow[]
    } catch {
      throw new Error("Failed to parse documents JSON for KV pointers")
    }
  }

  // Exclude derived: collection keys
  const filtered = rows.filter((r) => r.collection !== "derived")
  log(`  Published documents to sync: ${filtered.length}`)

  if (dryRun) {
    log("  [dry-run] Would write KV ptr keys:")
    for (const row of filtered) {
      log(`    ptr:${row.collection}/${row.slug} → ${row.published_rev}`)
    }
    return filtered.length
  }

  for (const row of filtered) {
    const key = `ptr:${row.collection}/${row.slug}`
    const cmd = `wrangler kv key put "${key}" "${row.published_rev}" --namespace-id=${kvId} --remote`
    runWrangler(cmd)
    log(`  ptr:${row.collection}/${row.slug} → ${row.published_rev}`)
  }

  return filtered.length
}

// ── Step 6 — Summary ──────────────────────────────────────────────────────────

function printSummary(opts: {
  d1: D1Counts
  r2: { counts: PrefixCounts; total: number; failures: number }
  ftsCount: number
  kvCount: number
}): void {
  const { d1, r2, ftsCount, kvCount } = opts

  const prefixLine = ["content", "schema", "skills", "revisions", "derived", "assets"]
    .map((p) => `${p}/=${r2.counts[p] ?? 0}`)
    .join("  ")

  log(`
=== Mirror Summary ===
D1:  documents=${d1.documents}  revisions=${d1.revisions}  assets=${d1.assets}  FTS=${ftsCount}
R2:  ${prefixLine}  (total=${r2.total})
KV:  ${kvCount} ptr: keys written
Failures: ${r2.failures}`)

  if (r2.failures > 0) {
    log("Re-run is safe — all writes are idempotent.")
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { instance, dryRun } = parseArgs()

  log("=== CMS Mirror to Remote ===")
  log(`instance: ${instance}`)
  if (dryRun) log("mode:     DRY RUN (reads only, no remote writes)")

  // Pre-flight checks
  checkSqlite3()
  const { d1Sqlite, r2Sqlite, r2BlobsDir } = locateLocalState()
  log(`\nLocal state:`)
  log(`  D1:       ${d1Sqlite}`)
  log(`  R2 index: ${r2Sqlite}`)
  log(`  R2 blobs: ${r2BlobsDir}`)

  // Temp dir for SQL files
  const tmpDir = path.join(os.tmpdir(), `mirror-${randomBytes(4).toString("hex")}`)
  mkdirSync(tmpDir, { recursive: true })
  log(`  Temp SQL: ${tmpDir}`)

  const d1Counts = stepD1(d1Sqlite, instance, tmpDir, dryRun)
  const r2Result = stepR2(r2Sqlite, r2BlobsDir, instance, dryRun)
  const ftsCount = stepFTS(d1Sqlite, instance, tmpDir, dryRun)
  const kvCount = stepKV(d1Sqlite, instance, dryRun)

  printSummary({ d1: d1Counts, r2: r2Result, ftsCount, kvCount })

  if (r2Result.failures > 0) {
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
