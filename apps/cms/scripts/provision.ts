#!/usr/bin/env tsx
/**
 * provision.ts — Provision all Cloudflare resources for the CMS Worker.
 *
 * Usage:
 *   pnpm provision [--instance=aiuis-cms] [--domain=cms.aiu.is] [--zone=aiu.is] [--dry-run]
 */

import { execSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const cmsDir = path.resolve(__dirname, "..")
const wranglerPath = path.join(cmsDir, "wrangler.jsonc")
const devVarsPath = path.join(cmsDir, ".dev.vars")
const devVarsExamplePath = path.join(cmsDir, ".dev.vars.example")

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  let instance = "aiuis-cms"
  let domain = "cms.aiu.is"
  let zone = "aiu.is"
  let dryRun = false

  for (const arg of args) {
    if (arg.startsWith("--instance=")) instance = arg.slice("--instance=".length)
    else if (arg.startsWith("--domain=")) domain = arg.slice("--domain=".length)
    else if (arg.startsWith("--zone=")) zone = arg.slice("--zone=".length)
    else if (arg === "--dry-run") dryRun = true
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }

  return { instance, domain, zone, dryRun }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd: string, opts: { capture?: boolean } = {}): string {
  try {
    return execSync(cmd, {
      cwd: cmsDir,
      encoding: "utf-8",
      stdio: opts.capture ? ["pipe", "pipe", "pipe"] : ["inherit", "inherit", "pipe"],
    }) as string
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    throw Object.assign(new Error(`Command failed: ${cmd}\n${e.stderr ?? ""}\n${e.stdout ?? ""}`), {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    })
  }
}

function runCapture(cmd: string): { stdout: string; stderr: string; ok: boolean } {
  try {
    const stdout = execSync(cmd, {
      cwd: cmsDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }) as string
    return { stdout: stdout ?? "", stderr: "", ok: true }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", ok: false }
  }
}

function log(msg: string) {
  console.log(msg)
}

function editWranglerFile(
  transform: (text: string) => string,
  dryRun: boolean,
  description: string,
): void {
  const before = readFileSync(wranglerPath, "utf-8")
  const after = transform(before)
  if (before === after) {
    log(`  (no change needed: ${description})`)
    return
  }
  if (dryRun) {
    log(`  [dry-run] Would apply: ${description}`)
    const beforeLines = before.split("\n")
    const afterLines = after.split("\n")
    const changedIdxs = new Set<number>()
    const maxLen = Math.max(beforeLines.length, afterLines.length)
    for (let i = 0; i < maxLen; i++) {
      if (beforeLines[i] !== afterLines[i]) {
        for (let j = Math.max(0, i - 2); j <= Math.min(maxLen - 1, i + 2); j++) {
          changedIdxs.add(j)
        }
      }
    }
    log("  --- before/after snippet ---")
    const idxArr = Array.from(changedIdxs).sort((a, b) => a - b)
    idxArr.forEach((i) => {
      const b = beforeLines[i]
      const a = afterLines[i]
      if (b !== a) {
        if (b !== undefined) log(`  - ${b}`)
        if (a !== undefined) log(`  + ${a}`)
      } else if (b !== undefined) {
        log(`    ${b}`)
      }
    })
    log("  ---")
    return
  }
  writeFileSync(wranglerPath, after, "utf-8")
  log(`  Applied: ${description}`)
}

// ── Step 1 — D1 create ────────────────────────────────────────────────────────

function stepD1(instance: string, dryRun: boolean): string {
  log("\n[step 1/9] D1 database...")
  const dbName = `${instance}-db`

  if (dryRun) {
    log(`  [dry-run] Would run: wrangler d1 create ${dbName}`)
    log("  Would patch wrangler.jsonc database_id with returned id")
    return "<dry-run-d1-id>"
  }

  let databaseId: string

  const create = runCapture(`wrangler d1 create ${dbName}`)
  if (!create.ok) {
    const combined = create.stdout + create.stderr
    if (/already exists/i.test(combined)) {
      log(`  D1 database '${dbName}' already exists — fetching id...`)
      // NOT `d1 info <name>` — that resolves the id through wrangler.jsonc,
      // which still holds the placeholder before the first provision completes
      const listOut = run(`wrangler d1 list --json`, { capture: true })
      let entries: Array<Record<string, unknown>>
      try {
        const jsonMatch = listOut.match(/\[[\s\S]*\]/)
        if (!jsonMatch) throw new Error("no JSON array in output")
        entries = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>
      } catch {
        throw new Error(`Failed to parse wrangler d1 list output: ${listOut}`)
      }
      const entry = entries.find((e) => e["name"] === dbName)
      const id = entry?.["uuid"] ?? entry?.["database_id"] ?? entry?.["id"]
      if (!id || typeof id !== "string") {
        throw new Error(`Could not find database '${dbName}' in wrangler d1 list output`)
      }
      databaseId = id
      log(`  Reused existing D1 id: ${databaseId}`)
    } else {
      throw new Error(`wrangler d1 create failed:\n${create.stderr}\n${create.stdout}`)
    }
  } else {
    const combined = create.stdout + create.stderr
    // Try JSON block first
    const jsonMatch = combined.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
        const id = parsed["database_id"] ?? parsed["uuid"] ?? parsed["id"]
        if (id && typeof id === "string") {
          databaseId = id
        } else {
          throw new Error("no id field in JSON")
        }
      } catch {
        // Fallback to UUID regex
        const uuidMatch = combined.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        if (!uuidMatch) throw new Error(`Could not extract D1 id from output:\n${combined}`)
        databaseId = uuidMatch[0]
      }
    } else {
      const uuidMatch = combined.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (!uuidMatch) throw new Error(`Could not extract D1 id from output:\n${combined}`)
      databaseId = uuidMatch[0]
    }
    log(`  Created D1 database '${dbName}' with id: ${databaseId}`)
  }

  // Patch wrangler.jsonc — targeted replacement on the database_id line only
  editWranglerFile(
    (text) => text.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${databaseId}"`),
    false, // write immediately — we have a real id
    `database_id → ${databaseId}`,
  )

  return databaseId
}

// ── Step 2 — R2 bucket ────────────────────────────────────────────────────────

function stepR2(instance: string, dryRun: boolean): void {
  log("\n[step 2/9] R2 bucket...")
  if (dryRun) {
    log(`  [dry-run] Would run: wrangler r2 bucket create ${instance}`)
    return
  }
  const result = runCapture(`wrangler r2 bucket create ${instance}`)
  const combined = result.stdout + result.stderr
  if (!result.ok && !/already exists/i.test(combined)) {
    throw new Error(`wrangler r2 bucket create failed:\n${result.stderr}\n${result.stdout}`)
  }
  if (/already exists/i.test(combined)) {
    log(`  R2 bucket '${instance}' already exists — OK`)
  } else {
    log(`  Created R2 bucket '${instance}'`)
  }
}

// ── Step 3 — KV namespace ─────────────────────────────────────────────────────

function stepKV(instance: string, dryRun: boolean): string {
  log("\n[step 3/9] KV namespace...")

  if (dryRun) {
    log(`  [dry-run] Would check: wrangler kv namespace list`)
    log(`  Would create if not found: wrangler kv namespace create ${instance}`)
    log("  Would patch wrangler.jsonc kv_namespaces[0].id")
    return "<dry-run-kv-id>"
  }

  let kvId: string | null = null

  // Check if namespace already exists (plain output is a JSON array; there is no --json flag)
  const listResult = runCapture("wrangler kv namespace list")
  if (listResult.ok) {
    const jsonMatch = listResult.stdout.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        const namespaces = JSON.parse(jsonMatch[0]) as Array<{ id: string; title: string }>
        const found = namespaces.find((ns) => ns.title === instance)
        if (found) {
          kvId = found.id
          log(`  KV namespace '${instance}' already exists — id: ${kvId}`)
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  if (!kvId) {
    const createOut = run(`wrangler kv namespace create ${instance}`, { capture: true })
    // Try JSON block
    const jsonMatch = createOut.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
        const id = parsed["id"]
        if (id && typeof id === "string") kvId = id
      } catch {
        // ignore
      }
    }
    if (!kvId) {
      // Try key=value text format wrangler sometimes uses
      const m = createOut.match(/"id"\s*:\s*"([^"]+)"/) ?? createOut.match(/id\s*=\s*"([^"]+)"/)
      if (m) kvId = m[1]
    }
    if (!kvId) {
      throw new Error(`Could not extract KV id from output:\n${createOut}`)
    }
    log(`  Created KV namespace '${instance}' with id: ${kvId}`)
  }

  // Patch wrangler.jsonc — only the kv_namespaces section to avoid matching d1 id
  const capturedKvId = kvId
  editWranglerFile(
    (text) => {
      const splitIdx = text.indexOf('"kv_namespaces"')
      if (splitIdx === -1) throw new Error("kv_namespaces not found in wrangler.jsonc")
      const head = text.slice(0, splitIdx)
      const tail = text.slice(splitIdx).replace(/"id"\s*:\s*"[^"]*"/, `"id": "${capturedKvId}"`)
      return head + tail
    },
    false,
    `kv_namespaces[0].id → ${kvId}`,
  )

  return kvId
}

// ── Step 4 — Queue ────────────────────────────────────────────────────────────

function stepQueue(instance: string, dryRun: boolean): void {
  log("\n[step 4/9] Queue...")
  const queueName = `${instance}-derive`
  if (dryRun) {
    log(`  [dry-run] Would run: wrangler queues create ${queueName}`)
    return
  }
  const result = runCapture(`wrangler queues create ${queueName}`)
  const combined = result.stdout + result.stderr
  const exists = /already exists|already taken/i.test(combined)
  if (!result.ok && !exists) {
    throw new Error(`wrangler queues create failed:\n${result.stderr}\n${result.stdout}`)
  }
  if (exists) {
    log(`  Queue '${queueName}' already exists — OK`)
  } else {
    log(`  Created queue '${queueName}'`)
  }
}

// ── Step 5 — wrangler.jsonc vars flip + .dev.vars sync ───────────────────────

function stepVarsFlip(instance: string, domain: string, dryRun: boolean): void {
  log("\n[step 5/9] wrangler.jsonc vars flip + .dev.vars sync...")

  // Read current wrangler.jsonc vars values BEFORE mutating
  const wranglerText = readFileSync(wranglerPath, "utf-8")

  const extractVar = (key: string): string | null => {
    const m = wranglerText.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "m"))
    return m ? m[1] : null
  }

  const currentCmsDevSecret = extractVar("CMS_DEV_SECRET") ?? "dev-secret-change-me"
  const currentSessionSecret = extractVar("SESSION_SECRET") ?? "dev-session-secret-change-me"
  const currentEnvironment = extractVar("ENVIRONMENT") ?? "dev"

  // Sync .dev.vars — ensure all three keys present
  let devVarsMap = new Map<string, string>()
  if (existsSync(devVarsPath)) {
    const lines = readFileSync(devVarsPath, "utf-8").split("\n").filter((l) => l.trim() !== "")
    for (const line of lines) {
      const eq = line.indexOf("=")
      if (eq !== -1) devVarsMap.set(line.slice(0, eq).trim(), line.slice(eq + 1))
    }
  }

  let devVarsChanged = false
  if (!devVarsMap.has("CMS_DEV_SECRET")) {
    devVarsMap.set("CMS_DEV_SECRET", currentCmsDevSecret)
    devVarsChanged = true
  }
  if (!devVarsMap.has("SESSION_SECRET")) {
    devVarsMap.set("SESSION_SECRET", currentSessionSecret)
    devVarsChanged = true
  }
  if (!devVarsMap.has("ENVIRONMENT")) {
    // local dev keeps "dev" even though wrangler.jsonc will flip to "production"
    devVarsMap.set("ENVIRONMENT", currentEnvironment === "production" ? "dev" : currentEnvironment)
    devVarsChanged = true
  }

  if (devVarsChanged) {
    const newContent =
      Array.from(devVarsMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n"
    if (!dryRun) {
      writeFileSync(devVarsPath, newContent, "utf-8")
      log("  Updated .dev.vars with missing keys")
    } else {
      log("  [dry-run] Would update .dev.vars with missing keys")
    }
  } else {
    log("  .dev.vars already has all required keys")
  }

  // Update .dev.vars.example
  const exampleContent = [
    "CMS_DEV_SECRET=your-dev-secret-here",
    "SESSION_SECRET=your-session-secret-here",
    "ENVIRONMENT=dev",
    "",
  ].join("\n")
  if (!dryRun) {
    writeFileSync(devVarsExamplePath, exampleContent, "utf-8")
    log("  Updated .dev.vars.example")
  } else {
    log("  [dry-run] Would write .dev.vars.example")
  }

  // Mutate wrangler.jsonc (all edits are idempotent)

  // 1. Flip ENVIRONMENT to "production"
  editWranglerFile(
    (text) => text.replace(/"ENVIRONMENT"\s*:\s*"[^"]*"/, `"ENVIRONMENT": "production"`),
    dryRun,
    `ENVIRONMENT → "production"`,
  )

  // 2. Remove SESSION_SECRET line from vars
  editWranglerFile(
    (text) => text.replace(/[ \t]*"SESSION_SECRET"\s*:\s*"[^"]*",?\r?\n/, ""),
    dryRun,
    "Remove SESSION_SECRET from vars",
  )

  // 3. Remove CMS_DEV_SECRET line from vars
  editWranglerFile(
    (text) => text.replace(/[ \t]*"CMS_DEV_SECRET"\s*:\s*"[^"]*",?\r?\n/, ""),
    dryRun,
    "Remove CMS_DEV_SECRET from vars",
  )

  // 4. Add "workers_dev": false after "name": "..."
  editWranglerFile(
    (text) => {
      if (/"workers_dev"/.test(text)) return text
      return text.replace(/("name"\s*:\s*"[^"]*",)/, `$1\n  "workers_dev": false,`)
    },
    dryRun,
    `Add "workers_dev": false`,
  )

  // 5. Add routes block before "durable_objects"
  editWranglerFile(
    (text) => {
      if (/"routes"/.test(text)) return text
      const routeLine = `  "routes": [{ "pattern": "${domain}", "custom_domain": true }],\n`
      if (text.includes('"durable_objects"')) {
        return text.replace(/"durable_objects"/, `${routeLine}  "durable_objects"`)
      }
      // Fallback: append after vars block
      return text.replace(/([ \t]*"vars"\s*:\s*\{[^}]*\},)/, `$1\n${routeLine}`)
    },
    dryRun,
    `Add routes for ${domain}`,
  )

  void instance // suppress unused-var warning; instance used only for naming clarity above
}

// ── Step 6 — Secrets ──────────────────────────────────────────────────────────

function stepSecrets(dryRun: boolean): void {
  log("\n[step 6/9] Secrets...")

  if (dryRun) {
    log("  [dry-run] Would generate and upload SESSION_SECRET via wrangler secret put (stdin)")
    log("  [dry-run] Would generate and upload CMS_DEV_SECRET via wrangler secret put (stdin)")
    return
  }

  for (const secretName of ["SESSION_SECRET", "CMS_DEV_SECRET"]) {
    const secret = randomBytes(32).toString("hex")
    const result = spawnSync("wrangler", ["secret", "put", secretName], {
      cwd: cmsDir,
      input: secret,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    if (result.status !== 0) {
      throw new Error(
        `wrangler secret put ${secretName} failed:\n${result.stderr}\n${result.stdout}`,
      )
    }
    log(`  Secret ${secretName} set`)
  }
}

// ── Step 7 — D1 migrations ────────────────────────────────────────────────────

function stepMigrations(instance: string, dryRun: boolean): void {
  log("\n[step 7/9] D1 migrations (--remote)...")
  const dbName = `${instance}-db`
  if (dryRun) {
    log(`  [dry-run] Would run: wrangler d1 migrations apply ${dbName} --remote`)
    return
  }
  run(`wrangler d1 migrations apply ${dbName} --remote`)
  log("  Migrations applied")
}

// ── Step 8 — Deploy ───────────────────────────────────────────────────────────

function stepDeploy(instance: string, domain: string, zone: string, dryRun: boolean): void {
  log("\n[step 8/9] Deploy...")
  if (dryRun) {
    log("  [dry-run] Would run: wrangler deploy")
    return
  }

  const result = runCapture("wrangler deploy")
  const combined = result.stdout + result.stderr
  // Always surface output
  if (combined.trim()) process.stdout.write(combined)

  if (!result.ok) {
    if (/409/.test(combined)) {
      console.error(`
Custom domain 409: Cloudflare found orphaned DNS records.
Fix: In apps/cms/wrangler.jsonc, change routes to:
  "routes": [{ "pattern": "${domain}/*", "zone_name": "${zone}" }]
Then add a CNAME manually in the Cloudflare DNS dashboard:
  ${domain} CNAME ${instance}.workers.dev (proxied)
Then re-run: pnpm provision --instance=${instance} --domain=${domain} --zone=${zone}
`)
      process.exit(1)
    }
    throw new Error(`wrangler deploy failed:\n${combined}`)
  }
  log("  Deployed successfully")
}

// ── Step 9 — Epilogue ─────────────────────────────────────────────────────────

function printEpilogue(instance: string, domain: string): void {
  log(`
=== POST-PROVISION RUNBOOK ===

1. Bootstrap admin token (remote):
   cd apps/cms && pnpm bootstrap-admin --remote
   Then run the printed wrangler command.

2. Mirror local content to remote:
   cd apps/cms && pnpm mirror:remote --instance=${instance}

3. Set up Cloudflare Access for review routes (must use dashboard — OAuth token has no Access scope):
   Dashboard → Zero Trust → Access → Applications → Add
   - URL: https://${domain}/review*
   - Policy: your email or org

4. Add MCP server to Claude:
   claude mcp add --transport http cms-prod https://${domain}/mcp --header "Authorization: Bearer <YOUR_ADMIN_TOKEN>" --scope user

5. Verify endpoints:
   curl https://${domain}/                          # → 200 or redirect
   curl https://${domain}/api/v1/pieces             # → 200 JSON
   curl https://${domain}/dev/export                # → 401 (ENVIRONMENT=production gates /dev/*)
   curl https://${domain}/review                    # → Access login page
   curl https://${domain}/mcp                       # → MCP endpoint
`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { instance, domain, zone, dryRun } = parseArgs()

  log("=== CMS Provision ===")
  log(`instance: ${instance}`)
  log(`domain:   ${domain}`)
  log(`zone:     ${zone}`)
  if (dryRun) log("mode:     DRY RUN (no remote changes)")

  let deployFailed = false
  try {
    stepD1(instance, dryRun)
    stepR2(instance, dryRun)
    stepKV(instance, dryRun)
    stepQueue(instance, dryRun)
    stepVarsFlip(instance, domain, dryRun)
    stepSecrets(dryRun)
    stepMigrations(instance, dryRun)
    try {
      stepDeploy(instance, domain, zone, dryRun)
    } catch (err) {
      deployFailed = true
      throw err
    }
  } finally {
    log("\n[step 9/9] Post-provision runbook")
    printEpilogue(instance, domain)
  }

  if (!deployFailed) {
    log("=== Provision complete ===")
  }
}

main().catch((err: unknown) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
