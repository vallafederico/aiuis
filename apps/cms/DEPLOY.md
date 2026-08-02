# CMS deploy runbook

Worked example: `aiuis-cms` at `cms.aiu.is`, deployed 2026-08-02.

---

## 1. Prerequisites

- **Cloudflare account** — Workers Free is sufficient. All Durable Objects must be SQLite-backed (`new_sqlite_classes` in `wrangler.jsonc`); the storage API is the same. Attempting to use the older storage API on Free triggers error code 10097.
- **`wrangler login`** with OAuth scopes: `d1:write`, `kv:write`, `queues:write`, `workers:write`, `workers_routes:write`.
- **wrangler ≥ 4.118.** Version 4.114's D1-create API call fails with a spurious "Authentication error [code: 10000]" that has nothing to do with your credentials — upgrade first.
- **`sqlite3` CLI** for the mirror step (`brew install sqlite` / `apt-get install sqlite3`).
- **pnpm** (version pinned in `package.json`).

---

## 2. Provision

```
cd apps/cms
pnpm provision [--instance=<name>] [--domain=<host>] [--zone=<zone>] [--dry-run]
```

Defaults: `--instance=aiuis-cms`, `--domain=cms.aiu.is`, `--zone=aiu.is`.

Use `--dry-run` to preview every wrangler command and wrangler.jsonc diff without making remote changes.

The script runs 9 steps in order:

**Step 1 — D1.** Creates `<instance>-db`. If the database already exists, fetches its id via `wrangler d1 list --json` (idempotent). Patches `database_id` in `wrangler.jsonc` by targeted text replacement (only that line).

**Step 2 — R2.** Creates the `<instance>` bucket. Already-exists is silently accepted.

**Step 3 — KV.** Checks `wrangler kv namespace list` for a namespace named `<instance>` (note: this command has no `--json` flag — its plain output is already a JSON array). Creates it if absent. Patches `kv_namespaces[0].id` in `wrangler.jsonc` (only the section after `"kv_namespaces"` is searched, to avoid matching the D1 id).

**Step 4 — Queue.** Creates `<instance>-derive`. Queue name collisions are reported as "already taken" by the API (not "already exists") — both strings are matched.

**Step 5 — vars flip.** Mutates `wrangler.jsonc` (all changes are idempotent):
- Flips `ENVIRONMENT` to `"production"`.
- Removes `SESSION_SECRET` and `CMS_DEV_SECRET` from committed `vars` (they move to Secrets in step 6).
- Adds `"workers_dev": false`.
- Adds a `routes` block: `{ "pattern": "<domain>", "custom_domain": true }`.

Simultaneously ensures `.dev.vars` carries `ENVIRONMENT=dev` plus the pre-flip secret values (migrated from the committed vars before they are removed), so local dev continues to work unchanged — `.dev.vars` overrides `vars` under `wrangler dev`.

**Step 6 — Secrets.** Generates 32-byte hex values for `SESSION_SECRET` and `CMS_DEV_SECRET` via `crypto.randomBytes`, uploads each via `wrangler secret put` (stdin). These never touch disk.

**Step 7 — D1 migrations.** Runs `wrangler d1 migrations apply <instance>-db --remote`. All 5 migrations are applied; already-applied migrations are skipped.

**Step 8 — Deploy.** Runs `wrangler deploy`. Custom-domain registration succeeds when Cloudflare owns the zone and no orphaned DNS records exist. If the deploy returns HTTP 409, the script exits with instructions to switch to a zone-route fallback:

```jsonc
// In wrangler.jsonc, replace the routes entry with:
"routes": [{ "pattern": "cms.aiu.is/*", "zone_name": "aiu.is" }]
```

Then add a proxied CNAME in the Cloudflare DNS dashboard (`<domain>` → `<instance>.workers.dev`) and re-run provision.

**Step 9 — Epilogue.** Prints the post-provision runbook (bootstrap-admin, mirror, Access, MCP registration, verification curls).

---

## 3. Known plan/API constraints

All verified against the live deploy on 2026-08-02.

| Constraint | Detail |
|---|---|
| Workers Free + Durable Objects | All DO classes must use `new_sqlite_classes`. Error code 10097 if you use the old `new_classes` key. The storage API (`this.ctx.storage`) is identical either way. |
| Remote D1 rejects `BEGIN`/`COMMIT` | Explicit SQL transactions fail on remote D1. The mirror generates plain idempotent statements (`INSERT OR IGNORE`, `DELETE` + `INSERT`) with no transaction wrappers. |
| `wrangler kv namespace list` has no `--json` flag | Passing `--json` is an error. The plain output is already a JSON array — parse it directly. |
| Queue collision message | `wrangler queues create` reports "already taken" (not "already exists") for a name collision. Both strings are matched by the provision script. |

---

## 4. Local-dev gotcha after provisioning

**Miniflare keys the local D1 state file by `database_id`.** When provision fills the real id into `wrangler.jsonc`, the next `wrangler dev` creates a fresh empty local database under a new content-hash filename — your local content is not lost, it is sitting under the old hash.

Fix:

```bash
cd apps/cms/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/
# stop all dev servers first, then:
sqlite3 -readonly <old-hash>.sqlite ".backup '<new-hash>.sqlite'"
# move old files out of this directory
```

The mirror script (`pnpm mirror:remote`) requires exactly one `.sqlite` file in that directory (excluding `metadata.sqlite`); it will error if more than one is present.

Alternatively, a fresh checkout skips the problem entirely: run `pnpm migrate:local` and re-seed.

---

## 5. Bootstrap admin

```bash
cd apps/cms
pnpm bootstrap-admin --remote
```

This prints a `wrangler d1 execute --remote` command containing an `INSERT INTO tokens` statement, plus the raw 64-hex-char token. Copy and run the command, then copy the token — it is shown once and never stored. Default capabilities: `{ publish: true, collections: "*", namespaces: ["content", "schema", "skills"], admin: true }`.

Optional flags: `--principal <name>` (default `admin`), `--expires <ISO8601>`.

---

## 6. Mirror content

```bash
cd apps/cms
pnpm mirror:remote [--instance=<name>] [--dry-run]
```

Use `--dry-run` to print counts and SQL file paths without writing anything remote.

**What it copies:**

| Store | What |
|---|---|
| D1 | `documents`, `revisions`, `assets` rows — `INSERT OR IGNORE` (existing rows are not overwritten) |
| D1 FTS | `documents_fts` — full `DELETE` then `INSERT` (ensures search index matches documents) |
| R2 | All objects across all prefixes (`content/`, `schema/`, `skills/`, `revisions/`, `derived/`, `assets/`) — one `wrangler r2 object put --remote` per object |
| KV | `ptr:<collection>/<slug>` keys for all published documents (`derived` collection excluded) |

**What it deliberately excludes:** `tokens` (dev credentials must not reach prod), `op_log`, `d1_migrations`.

The script reads local state read-only (`sqlite3 -readonly`) and is safe to re-run. Re-running after local edits does not update existing D1 rows (`INSERT OR IGNORE`), but KV pointer updates and new R2 objects do propagate. To force a D1 row update, delete the remote row first.

The script requires exactly one `.sqlite` file in each of the D1 and R2 miniflare state directories. See §4 if provision changed the D1 hash.

---

## 7. Manual steps

These cannot be automated via wrangler (OAuth scope limitations):

**Cloudflare Access — review routes.** The `/review*` path must be protected by an Access application. The wrangler OAuth token has no Access scope, so this must be done in the dashboard:

> Cloudflare Dashboard → Zero Trust → Access → Applications → Add an application
> - URL: `https://<domain>/review*`
> - Policy: your email or org identity

**MCP registration.** Register the production endpoint in Claude:

```bash
claude mcp add --transport http cms-prod https://<domain>/mcp \
  --header "Authorization: Bearer <YOUR_ADMIN_TOKEN>" \
  --scope user
```

---

## 8. Verification checklist

```bash
# Public
curl -I https://cms.aiu.is/                    # 200
curl    https://cms.aiu.is/api/v1/pieces        # 200 JSON array

# Auth gates
curl -I https://cms.aiu.is/dev/export           # 401 (ENVIRONMENT=production blocks /dev/*)
curl -I https://cms.aiu.is/review               # 302 → Cloudflare Access login

# MCP
curl -X POST https://cms.aiu.is/mcp \
  -H "Content-Type: application/json" -d '{}'  # 401 (no token)
curl -X POST https://cms.aiu.is/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
  # 200 with server info
```

If a consuming site exists, verify it renders content via the `CMS` service binding (no cross-origin fetch needed).

---

## 9. Rollback

```bash
wrangler rollback --name <instance>
```

This rolls back the Worker code only. D1, R2, and KV data are unaffected. To restore a previous data state, re-run `pnpm mirror:remote` from a local checkout that holds the desired content.
