/**
 * bootstrap-admin.ts — mint an admin token for bootstrapping the CMS.
 *
 * Default capabilities: { publish: true, collections: "*", namespaces: ["content", "schema", "skills"], admin: true }
 *
 * Usage:
 *   pnpm bootstrap-admin                  # Runs against local D1
 *   pnpm bootstrap-admin --remote         # Prints the wrangler command for remote (copy-paste only)
 *   pnpm bootstrap-admin --principal alice --expires 2027-01-01T00:00:00Z
 */
import { randomBytes, createHash } from "node:crypto"
import { execSync } from "node:child_process"

const raw = randomBytes(32).toString("hex")
const hash = createHash("sha256").update(raw).digest("hex")

function arg(flag: string, envKey: string, defaultVal: string): string {
  const flagIdx = process.argv.indexOf(flag)
  if (flagIdx !== -1) return process.argv[flagIdx + 1] ?? defaultVal
  return process.env[envKey] ?? defaultVal
}

const principal = arg("--principal", "PRINCIPAL", "admin")
const kind = arg("--kind", "KIND", "human")
const audience = arg("--audience", "AUDIENCE", "any")
const expires = arg("--expires", "EXPIRES", "")

const capabilities = {
  publish: true,
  collections: "*",
  namespaces: ["content", "schema", "skills"],
  admin: true,
}
const capabilitiesStr = JSON.stringify(capabilities)

const now = new Date().toISOString()
const expiresValue = expires || null

const sql = `INSERT INTO tokens (token_hash, principal, kind, audience, capabilities, created, expires, revoked) VALUES ('${hash}', '${principal}', '${kind}', '${audience}', '${capabilitiesStr.replace(/'/g, "''")}', '${now}', ${expiresValue ? `'${expiresValue}'` : "NULL"}, 0);`

const isRemote = process.argv.includes("--remote")

if (isRemote) {
  console.log("\nTo insert this admin token into the REMOTE database, run:\n")
  console.log(`wrangler d1 execute aiuis-cms-db --remote --command "${sql.replace(/"/g, '\\"')}"`)
  console.log("\nToken (copy now — not stored):", raw)
} else {
  execSync(`wrangler d1 execute aiuis-cms-db --local --command "${sql.replace(/"/g, '\\"')}"`, {
    cwd: process.cwd(),
    stdio: "inherit",
  })
  console.log("\nAdmin token (copy now — not stored):", raw)
  console.log("Principal:", principal)
  console.log("Capabilities:", JSON.stringify(capabilities, null, 2))
}
