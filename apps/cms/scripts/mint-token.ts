import { randomBytes, createHash } from "node:crypto"
import { execSync } from "node:child_process"

const raw = randomBytes(32).toString("hex")
const hash = createHash("sha256").update(raw).digest("hex")

function arg(flag: string, envKey: string, defaultVal: string): string {
  const flagIdx = process.argv.indexOf(flag)
  if (flagIdx !== -1) return process.argv[flagIdx + 1] ?? defaultVal
  return process.env[envKey] ?? defaultVal
}

const principal = arg("--principal", "PRINCIPAL", "federico")
const kind = arg("--kind", "KIND", "human")
const audience = arg("--audience", "AUDIENCE", "any")
const capabilitiesStr = arg("--capabilities", "CAPABILITIES", JSON.stringify({
  publish: true,
  collections: "*",
  namespaces: ["content", "schema", "skills"]
}))

const now = new Date().toISOString()
const sql = `INSERT INTO tokens (token_hash, principal, kind, audience, capabilities, created) VALUES ('${hash}', '${principal}', '${kind}', '${audience}', '${capabilitiesStr.replace(/'/g, "''")}', '${now}');`

execSync(`wrangler d1 execute aiuis-cms-db --local --command "${sql.replace(/"/g, '\\"')}"`, {
  cwd: process.cwd(),
  stdio: "inherit",
})

console.log("Token:", raw)
