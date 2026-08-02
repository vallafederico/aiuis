# Agent-first CMS — progress & plan

_Last updated: 2026-07-28 (end of session). Companion to `agent-first-cms-spec.md` (authoritative spec, incl. the new §5 directives section) and the phase plan. Status verified against the code, not just session logs._

## Where it stands

The full local loop works end to end: an agent connects over MCP, creates/edits documents with conflict detection and history; a human reviews and publishes at `/review`; publish derives sanitized HTML and flips an immutable pointer; the site renders the content at real routes. The 13 nav items (Preface / Foundations / UIs) are live CMS pieces at `/{section}/{slug}`. Rich content has begun: the `:::notes` directive and full image support (upload → validate → derive → render) are live, both registry/schema-governed. Every integrity gap found by the code audit (below) has been fixed the same day. **177 tests green (35 node + 142 workers pool), typecheck clean.**

Dev ergonomics: `pnpm dev` runs web + cms; only ONE cms instance may run at a time (second workerd on the same `.wrangler/state` dies with SQLITE_BUSY). After changing the derive pipeline, run `POST /dev/rederive` (dev secret) or stale artifacts break piece pages. `pnpm --filter cms run mirror[:watch]` reflects live content into `apps/cms/mirror/` (gitignored) for browsing.

## Built and verified

| Area | State |
|---|---|
| Storage (P1) | Markdown in R2 (revisions immutable + HEAD), D1 index, crash-safe write order, `reindexFromR2` rebuild proven by test (D1 wipe → identical state) |
| Canonicalization | Strict YAML 1.2 frontmatter, idempotent canonicalize (test invariant) |
| MCP server (P2) | `CmsMcpAgent` DO via agents SDK, identity via `ctx.props` + `serve()`; 15 tools registered |
| Conflicts/locks (P3) | `LockRoom` DO (TTL 60s), required `base_rev`, stale edit → structured CONFLICT + unified diff; verified live |
| History/lifecycle (P3) | history, diff, revert (through write path), rename, two-step archive delete, publish/unpublish with validation; T2b namespace capability enforcement in code |
| Derivation (P4) | Sanitized HTML (remark→rehype-sanitize), hast, toc, excerpt, reading time; Shiki via dynamic import; artifacts in R2 + KV mirror |
| Publish semantics (P4) | `published_rev` (D1, source of truth) + KV `ptr:` mirror; synchronous derive on publish; on-demand derive fallback on read for missing artifacts (drafts) |
| Read API (P4) | Cards list (published only), doc by slug (`html\|hast\|json\|md`), rev-addressed = immutable cache, pointer = SWR; drafts gated by bearer auth |
| Review (P6) | Server-rendered inbox / diff / publish–revert actions reusing lifecycle handlers, human `reviewer` principal in op_log; dev-secret auth |
| Web (P5, redefined) | `pieces` collection (section + order), 13 nav items seeded published through the real write path; `PieceView` → `PageContent` (`w-grids-6`, `width`/`flow` props); graceful 503/404 |
| Ops instrumentation | op_log rows for every tool (reads included) + API routes + review actions |
| Directives (§5 spec) | `:::notes` live; registry = `schema/directives/*` docs; unknown directive/attr = structured error; discoverable via get_schema/get_context |
| Images | upload_asset/list_assets (capability-gated), assets table + R2, in-worker dimension parsing, /api/v1/assets (immutable cache) + site proxy route, body-ref validation, `figure.cms-figure` derivation |
| Integrity (audit fixes) | Full field validation, taxonomy upkeep (published-only counts), refs + ref_edges, redirects on read (308/follow/compaction), cards carry indexes fields, queue producer live |
| Content mirror | `/dev/export` + mirror script (one-shot / watch), local-only by choice |

## Honest gaps (verified in code)

> **Update 2026-07-28 (later):** everything in this section except the "Not started" phases was **fixed and committed** in the integrity sprint (`9cf470b`) and the directive-registry pass (`7da4623`): full field validation, taxonomy upkeep (published-only counts), ref checks + ref_edges, redirects on read (API 308 / MCP follow / chain compaction), op_log on reads, cards carry indexes fields as objects, queue producer wired, MCP search status param, directive registry with structured unknown-directive errors, PieceView single-fetch, real HTTP 404s. The list below is kept for the record.

**Dead or missing subsystems**
- **Taxonomy upkeep is missing entirely.** Nothing writes `terms` / `doc_terms`; `GET /api/v1/taxonomy/:name` reads real tables that are never populated. Post tags validate against nothing and count nothing.
- **`ref_edges` is never written.** Schema-only. No backlink/reference graph exists.
- **`redirects` is write-only.** `rename_doc` records redirects, but no read path consults them — renamed docs 404 on their old slug.
- **Queue producer is dead code.** Consumer is wired; nothing ever calls `DERIVE_QUEUE.send()`. All derivation is synchronous (publish) or on-demand (read fallback). Fine at this scale, but it's an illusion of async infrastructure.

**Validation holes** (`core/validate.ts`)
- `number`, `ref`, `asset`, `tax` field types: **no validation at all** (the `pieces.order` field is unchecked; refs aren't verified to exist).
- `max` enforced only for string/text; `string` itself isn't type-guarded (non-string silently skips checks).

**Governance / instrumentation**
- `get_context` returns all `mode: always` skills to **any** authenticated caller — no audience/scope filtering (Phase 8 work, but worth stating: token audience is currently decorative for skills).
- Read tools (`query`, `read_doc`, `search`, `list_collections`, `get_schema`) and all HTTP read routes write **no op_log rows** — the "every call visible" thesis instrumentation currently covers mutations only.
- MCP `search` searches drafts + archived too (API search is published-only). Possibly right for agents; currently undocumented rather than decided.

**Derivation stubs**: LQIP, srcset, embeddings return `null` (relevant now that images/video are wanted — see next steps).

**Web integration debts**
- Cards don't carry schema `indexes` fields (`section`, `order`, tags) — `PieceView` does a second `?format=md` fetch and regex-parses frontmatter for section/title. Should come from card / derived JSON.
- Missing piece slugs render "Not found." with HTTP 200 (streaming SSR commits status before data resolves).
- Nav lists are hardcoded (hrefs point at CMS routes; the list itself isn't CMS-driven yet — needs section/order in cards first).

**Not started**: Phase 7 (slices), Phase 8 (skills/lint enforcement, audience filtering, `list_skills`, skills export), Phase 9 (reconciliation sweep, drift repair), Phase 10 (deploy: `wrangler.jsonc` still has `REPLACE_AFTER_PROVISION` for D1/KV ids; no Cloudflare Access; no service binding in apps/web).

## Next steps (proposed order)

### 1. Rich article content — images, video, Notes _(new, top priority)_
Goal: authors (and agents) embed images, video, and custom components like **Notes** inside articles, with custom styling per component.

Approach — **directives + hast→Solid mapping**, not raw MDX. The CMS is markdown-native by design (spec §13): R2 markdown must stay portable, agent-editable, and derivable to sanitized output. Arbitrary MDX (imports/JSX) would break sanitization, canonicalization, and agent editing. The equivalent capability, kept markdown-native:
- **Authoring syntax**: remark-directive — `![alt](asset)` stays standard; `::video{src="…" poster="…"}`, `:::notes … :::` for custom blocks. Directives are already in the parse dependency set and are the same mechanism slices (Phase 7) need — this fast-tracks part of Phase 7.
- ✅ **Images shipped (2026-07-28, `6be3e3a`)** — upload_asset/list_assets tools, assets table + R2, in-worker dimension parsing (png/jpeg/webp), /api/v1/assets serving (immutable cache) + site-side proxy route so origin-relative srcs resolve, body image-ref validation, figure.cms-figure derivation with width/height + lazy loading. Demo live in uis/images. Deferred to deploy-phase Cloudflare Images: LQIP generation, srcset variants.
- ✅ **`:::notes` shipped (2026-07-28)** — first directive end-to-end: round-trips canonicalization, derives to sanitized `aside.cms-notes`, excluded from toc; all 13 pieces migrated through real edit→publish revisions; styled as a quiet endnote block (`PieceView.css`); authoring guidelines updated. Remaining in this workstream: images (LQIP/srcset), `::video`, asset upload pipeline, hast→Solid renderer (Notes is CSS-styled for now; becomes a Solid component when the renderer lands), a proper directive registry (unknown directives currently drop silently).
- **Derive side**: map directives to stable custom hast nodes (e.g. `<cms-video>`, `<cms-notes>`) allowlisted through sanitization; fill the LQIP/srcset stubs for images.
- **Assets pipeline**: `upload_asset` MCP tool + R2 `assets/` + `/api/v1/assets/…` serving (planned `mcp/tools/assets.ts`, never built).
- **Web side**: switch `PieceView` from `innerHTML` to **hast→Solid renderer** (the plan's intended upgrade) with a component map: `img` → figure w/ LQIP, `cms-video` → video player, `cms-notes` → new `Notes` component (doesn't exist yet — to design; wanted first on Credits). Unmapped nodes render as plain HTML.

### 2. Integrity sprint (close the verified gaps)
Taxonomy upkeep in the write path + reindex; validation for number/ref/asset/tax + max everywhere; redirects consulted on read (API + MCP); ref_edges maintained; op_log for read tools; card denormalization of `indexes` fields (kills the PieceView double-fetch, enables CMS-driven Nav); route-level 404 status. Decide: MCP draft search (keep, but document + capability-gate?), queue (wire producer for re-derives, or delete consumer).

### 3. Phase 7 — slices
Composed pages (`::::slice` containers, slice ops, per-slice derivation). UIs pieces then declare layout/width per piece from schema data (`PieceView` already threads `width`).

### 4. Phase 8 — skills layer
Lint enforcement in the write path (banned terms, sentence length → structured errors), full `get_context` assembly with audience filtering, `list_skills`, skills export.

### 5. Phase 9 — hardening
Hourly reconciliation (R2↔D1 drift report + repair), decide queue fate here at the latest.

### 6. Phase 10 — deploy
Provision D1/KV/R2/queue, fill ids, remote migrations, seed, Cloudflare Access on `/review*`, `CMS` service binding in apps/web, prod MCP endpoint. Local-first decision stands — deploy when the site's ready to point at it.

## Phase 10 — EXECUTED (2026-08-02)

CMS live at `cms.aiu.is`. Runbook: `apps/cms/DEPLOY.md`.

**Provisioned resources:**

| Resource | Id / name |
|---|---|
| Worker | `aiuis-cms` |
| D1 | `aiuis-cms-db` — `f8882adb-7cc5-4cdf-87cd-114a154baee9` |
| KV | `658027e659b046e68ae70cb464e10cd0` |
| R2 | `aiuis-cms` |
| Queue | `aiuis-cms-derive` |
| Durable Objects | `CmsMcpAgent`, `LockRoom` — both SQLite-backed (`new_sqlite_classes`) |

All 5 migrations applied remotely (0001–0005). `wrangler.jsonc` vars flipped: `ENVIRONMENT=production`, secrets (`SESSION_SECRET`, `CMS_DEV_SECRET`) uploaded via stdin, `workers_dev: false`, custom domain route `cms.aiu.is`.

**Content mirrored** (`pnpm mirror:remote`): 16 docs / 68 revisions / 1 asset / 16 FTS rows / 135 R2 objects / 14 KV `ptr:` keys — zero failures.

**Admin token** minted via `pnpm bootstrap-admin --remote` (held by Federico, not stored anywhere in the repo).

**Site (`aiu.is`)** deployed with `CMS` service binding + prerender exclusions. 13/13 routes browser-verified.

**Remaining manual step:** Cloudflare Access app for `cms.aiu.is/review*` (dashboard only — wrangler OAuth has no Access scope). See runbook §7.

---

## Decisions needed from Federico
1. **Rich content**: confirm directives-over-MDX (recommendation above). If you truly want `.mdx` files with imports as the source format, that's an architecture change to the spec worth a dedicated discussion.
2. ~~**Notes**~~ — resolved: the trailing notes section of an article (Credits was the example). Shipped as the `:::notes` directive; visual refinement open as design evolves.
3. ~~**MCP search over drafts**~~ — resolved: kept, made explicit via a documented `status` param (default `all`), logged. API search stays published-only.
4. ~~**Queue**~~ — resolved: producer wired (draft saves pre-warm derivation); publish stays synchronous.

## Picking up next (in rough order)
1. **hast→Solid renderer** — Federico has started exploring (`apps/web/src/components/cms/hast.ts`, uncommitted); build on that. Unlocks: Notes as a real Solid component, LQIP blur-up figures, component-mapped everything.
2. **`::video` directive** — same registry pattern as notes + the asset pipeline already handles the files.
3. **Phase 7 slices** (composed pages; per-piece width/layout from schema data — PieceView already threads `width`).
4. **Phase 8 skills layer** (lint enforcement, get_context audience filtering — the one audit gap deliberately left for this phase, list_skills, export).
5. **Phase 9 hardening** (reconciliation sweep; git-mirror of content if wanted — the local mirror is the manual precursor).
6. **Phase 10 deploy** (provision, fill REPLACE_AFTER_PROVISION ids, Cloudflare Access on /review, CMS service binding in apps/web — the asset proxy route body becomes the binding call, Cloudflare Images for LQIP/srcset).
