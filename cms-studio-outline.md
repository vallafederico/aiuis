# CMS Studio — outline (post-adversarial-review)

_Companion to `agent-first-cms-spec.md` (authoritative spec) and `agent-first-cms-progress.md` (build state). Drafted 2026-07-29; same-day adversarial review (4 independent lenses: frontend-agnosticism, OSS/product viability, technical soundness, claim verification against code). This revision keeps only what survived. Status: §9 records the decisions locked 2026-07-31; earlier sections remain the option analysis that produced them._

## 0. What the review established (read this first)

1. **The missing layer is not UI — it is a public management surface.** Every management operation a studio needs is currently MCP-only or dev-secret-gated: publish/unpublish/archive/revert, history/diff, schema introspection, asset upload/list, token mint/revoke. `/review` itself violates the "public APIs only" rule — it authenticates with `CMS_DEV_SECRET` and calls lifecycle handlers in-process (`review/handler.ts`), and covers only publish+revert. No third-party frontend can manage this CMS today.
2. **No CORS exists anywhere** (`index.ts` has no CORS middleware, no OPTIONS handling). Until that changes, *no* browser frontend on another origin can consume even the read API. "Frontend agnostic" is currently aspirational, not structural.
3. **Token bootstrap hole**: nothing seeds or mints tokens in a deployed environment (`scripts/mint-token.ts` is a dev script that prints SQL; no migration inserts tokens; no mint endpoint; no admin capability exists in the capabilities schema). A fresh deploy has zero usable credentials.
4. **Visual editing is not "mostly built"** — annotations don't exist, `rehype-sanitize` strips both position data and any non-allowlisted `data-*` attribute (only `data-lqip` on `img` survives today), offset-based block identity is structurally unstable under the `str_replace` write path, always-on annotations would poison the immutable rev-addressed cache, and iframe draft auth has no workable mechanism yet (iframes can't set `Authorization` headers; the API has no cookie or preview-token path).
5. **Spec conflict**: spec **Appendix A explicitly retired the product framing** ("not a product — personal infra") after the July 2026 adversarial review, partly because Sanity shipped the studio+agent combination (Content OS: native MCP, Agent API, AI assistant, visual editing). This outline's "open source + product" premise reverses that. That reversal must be a conscious spec amendment with an answer to the original kill criterion — *what is differentiated now* — not an implicit drift.
6. **Cloudflare lock-in is load-bearing for the OSS claim.** D1/R2/KV/DO/Queues are typed directly into every handler; DOs have no self-hosted equivalent. Without a storage-adapter layer (big, invasive) the honest positioning is **"Cloudflare-native OSS"**, not "self-hostable." This choice also constrains the viable business split (§7).
7. **Scope trap**: "emulate Sanity Studio" is an unbounded race against an incumbent on their turf. The desk, media library, and history UIs are each weeks of frontend work ("UI only" in the old table hid 6–8 weeks). The differentiated surfaces are exactly two: the **chat-as-editor loop** and **annotation-based visual editing on a pipeline we own**.

## 1. Framing (revised)

Two artifacts, one boundary:

- **CMS core** (the worker): storage, revisions, derive, MCP write surface, HTTP read surface, tokens, op_log. Contract is **data**: sanitized HTML with stable class names + data attributes is the *primary* frontend-agnostic contract (consumable from any language); hast is a JS-ecosystem convenience format, not the portable contract. (Review finding: hast has no schema/standard and burdens non-JS consumers; the outline previously conflated the two.)
- **Studio**: a first-party frontend on public APIs. The rule "studio may only use public, documented APIs" is a **target**, not a current property — reaching it *is* the studio-enablement work (§3).

## 2. Capability map (corrected against code, 2026-07-29)

| Capability | What exists | Surface today | Real gap for a studio |
|---|---|---|---|
| Cards list | `GET /api/v1/:collection` returns id/collection/slug/title/**card JSON**/created/updated; section/order live inside the card blob (schema `indexes`); `status` not returned | HTTP (public) | Status field; documented card shape |
| Search | FTS5; `status` param on the **MCP** `search` tool only; HTTP `/api/v1/search` is hardcoded published-only | HTTP (published-only) + MCP | Status-aware HTTP search (authed) |
| Doc by slug | `html\|hast\|json\|md` all real; toc/excerpt/reading-time derived | HTTP (public; drafts bearer-gated) | — |
| Schema / collections | `get_schema`, `list_collections` | **MCP only** | HTTP introspection endpoints |
| History / diff / revert | Immutable R2 revisions, unified diffs, revert through write path — tested | **MCP only** | HTTP endpoints (or studio speaks MCP) |
| Lifecycle | publish/unpublish/archive/delete handlers, tested | **MCP only**; `/review` form POST (dev secret) covers publish+revert only | Bearer-authed HTTP lifecycle API — **the** studio blocker |
| Assets | `assets` table + R2, dimension parsing, immutable serving | Serve: HTTP public. Upload: MCP tool or dev-secret route. List: MCP only | Bearer-authed upload/list over HTTP |
| Locks / presence | `LockRoom` DO, `base_rev`, structured CONFLICT | Internal only — **no read surface for lock state at all** | New endpoint before any presence UI |
| Tokens | D1 `tokens` table (hash, principal, kind, audience, capabilities, created, expires); enforcement live | Manual SQL via dev script | Mint/revoke/list endpoints; **admin capability concept; seed/bootstrap path; `last_used` needs a migration (column doesn't exist)** |
| Draft reads | Bearer-gated, on-demand derive — confirmed in code | HTTP | Preview auth usable from a browser/iframe (§4) |
| op_log | Every tool + route + review action, principal via session | Internal | Query endpoint for per-principal views |

Bottom line: the read side is genuinely public; the **entire management side needs an API layer** (or a decision that the studio is an MCP client — see §3).

## 3. Studio enablement — the actual prerequisite work

Before any studio UI, one of two paths (or a hybrid):

**A. REST-ify management.** Add bearer-authed `/api/v1` endpoints: lifecycle (publish/unpublish/revert/archive), history/diff, schema, assets upload/list, tokens (mint/revoke/list, gated on a new `admin` capability), lock-state read, op_log query. Plus CORS middleware with configurable origins, and OPTIONS handling. Retire the dev-secret path for production (`/review` moves onto the same API with real tokens; current cookie+form approach also has CSRF exposure — Bearer JSON endpoints are CSRF-immune).

**B. Studio as MCP client.** The management API *is* MCP — the studio speaks Streamable HTTP MCP with a bearer token, exactly like external agents (maximal dogfooding; nearly every needed tool already exists). Requires: CORS on `/mcp`, a browser MCP client, and accepting MCP's session model in a SPA. Read-side stays REST.

Either way, three items are unconditional: **CORS**, **admin capability + token bootstrap** (seed one admin token via migration/setup step), and **retiring `CMS_DEV_SECRET` as a production credential**. Note the spec (§9) requires Cloudflare Access in front of `/review` — currently unimplemented (Phase 10).

**Framework** (unchanged conclusions, demoted importance): app-shaped studio → Vite SPA fits; Astro fits only the server-rendered-pages shape that `/review` already is. Framework choice stops mattering for rendering fidelity if previews use the real-site iframe. The site's own `CmsBody` is coupled to its WebGL/MSDF aesthetic and is **not** a reusable preview renderer — a neutral hast/HTML preview renderer would be a separate small artifact if in-studio preview is wanted.

**Deployment**: static SPA from cms worker assets under `/studio` (one origin, one Access policy, no CORS for itself) vs own deploy (independent cadence; CORS needed — which §3 requires anyway for third parties).

**Scope guard** (from review): studio v1 = document view + lifecycle actions + the two differentiated surfaces. Desk niceties, media-library polish, presence UI — explicitly deferred. Don't race Sanity on desk UX.

## 4. Visual editing (rewritten honestly — nothing here exists yet)

The pipeline ownership advantage is real, but every layer needs building:

1. **Stable block identity** — the hard problem. Source offsets shift on every `str_replace` edit; offset-anchored overlays go stale immediately. Options: structural identity (block index + type + content hash — cheap, breaks on reorder), or stable block IDs embedded in markdown (e.g. HTML comments — durable, but pollutes the canonical source and must round-trip canonicalization). This decision gates everything else.
2. **Annotation pass in derive** — stamp block-level nodes with `data-cms-block`; extend the sanitize schema to allowlist it (today it would be stripped; only `data-lqip` on `img` survives).
3. **Cache separation** — annotated artifacts must live under a separate derived key (e.g. `derived-preview/…`), never served through the `Cache-Control: immutable` public routes. Preview derivation gets its own lifecycle.
4. **Preview auth** — iframes can't send `Authorization` headers; the API has no cookie path. Needs a designed mechanism: short-lived signed preview tokens as query params on draft routes, or a preview-session cookie scoped to the preview origin. Undesigned today.
5. **Overlay protocol** — postMessage with strict `event.origin` allowlisting (an `allowed_origins` config item that currently has no home in the data model). Browser-only by nature; native consumers are out of scope for overlay editing.
6. **Consumer burden honesty**: iframe-of-real-site is agnostic *for rendering*, but each consuming site must implement draft mode + the overlay handshake. That's real per-consumer integration work, to be specified as a small contract + reference implementation (this site).

Block-level edits themselves ride the existing write path (locks, `base_rev`, conflicts) — that part is genuinely done.

## 5. Chatbot mode (constraints added)

- **Not before Phase 8**: `get_context` currently returns all `mode: always` skills to any authed caller; an LLM holding write tools while reading unfiltered CMS content is a prompt-injection surface. Audience filtering precedes chat. Treat CMS content as untrusted data in the session design regardless.
- **Open-proxy risk**: any valid CMS token reaching a chat endpoint spends the operator's LLM budget. Chat needs its own capability flag (e.g. `capabilities.chat`), per-principal rate/spend caps, and op_log-visible usage. Key management: operator's key in Worker Secrets; self-hosters bring their own — a settings surface, not an afterthought.
- **Wiring**: in-process tool calls avoid the self-HTTP auth coupling (a chat DO calling `/mcp` would need to hold a forwarded bearer token) and subrequest limits. Dogfood the public MCP surface in tests/CI instead of in the runtime hot path. (Revised from "leaning dogfood.")
- The block→chat→edit→preview loop remains the thesis demo and the studio's actual reason to exist.

## 6. Open-source / product fork (no longer parked — it gates the studio)

The review broke "defer this": the business split determines whether the studio is worth building and what the core must become.

- **(a) Cloudflare-native OSS, personal-infra-first** (closest to spec Appendix A): no self-hosting claim beyond "bring your own Cloudflare account," studio is first-party tooling, no paid tier. Cheapest, honest, keeps thesis focus. The "product" is the pattern + the open code.
- **(b) Hosted product, core OSS**: requires multi-tenancy design (D1 limits are a known parked threat in Appendix A) and eventually storage abstraction if "self-hostable" is claimed. Studio becomes a real product surface. Big commitment; restarts the product framing the spec retired — needs the differentiation answer vs Sanity's shipped Content OS.
- **(c) Storage-adapter refactor for true self-hosting**: invasive (every handler touches D1/R2/KV/DO directly); only worth it if (b) demands it.

Decision needed before studio implementation (not before deploy).

## 7. Sequencing (corrected)

The old "§8: deploy is independent" was half true. Corrected dependencies:

1. **Deploy track first** (provision → remote migrations → worker deploy → seed → service binding): unblocks everything, required by any studio option (the `/studio`-from-worker-assets option literally is the worker).
2. **Studio-enablement layer** (§3: CORS, admin capability + token bootstrap, management surface A or B, Access on `/review`): the studio cannot publish a single document until this exists.
3. **Adoption gate** (from review, worth adopting): before major studio build-out, ship MCP endpoint docs + a "connect your agent in 5 minutes" guide and get one external user. The differentiated core is the MCP surface; validate it before racing on UI.
4. **Studio v1** (scoped per §3 guard) → then visual editing (§4, after the block-identity decision) → chat (§5, after Phase 8).

## 8. Open questions (updated)

1. Management surface: REST-ify (A) vs studio-as-MCP-client (B) vs hybrid (read REST + manage MCP).
2. OSS/product fork §6 (a)/(b)/(c) — and the spec amendment acknowledging Appendix A if product framing returns.
3. Block identity: structural vs embedded IDs (gates visual editing).
4. Preview auth mechanism: signed preview tokens vs preview-session cookies.
5. Annotations: separate preview derivation namespace (review says always-on poisons immutable caches — effectively decided unless contested).
6. Studio framework + serving location (demoted: decide after §3 layer exists).
7. Whole-doc human editing: spec §11 already contemplates WYSIWYG-to-markdown as future-track; block-level comes first via visual editing.

## 9. Decisions — 2026-07-31

Locked in session (Federico + review); these supersede the corresponding items in §8.

1. **Management surface (§8.1): MCP core, studio-as-MCP-client.** "Manual management for users" means a studio UI, not a second API. The studio speaks Streamable HTTP MCP with a bearer token, exactly like external agents — every studio bug is an MCP-surface bug, which is the point. REST wrappers get added only on demonstrated integration need, reusing the same handlers. The read side stays REST.
2. **Fork (§8.2): (b) — OSS self-deploy plus operator-managed instances.** A conscious reversal of Appendix A's retirement; amendment recorded in the spec. Managed instances use **per-tenant provisioning** (own worker + D1 + R2 + KV per customer, Workers-for-Platforms shape), which sidesteps the parked multi-tenant D1 threat entirely — and makes the Phase 10 deploy automation, the OSS install script, and the managed-instance factory the *same artifact*.
3. **Block identity (§8.3): structural, per-rev — cross-rev stability is a non-goal.** `data-cms-block` = block index + type + content hash, stamped during derive; valid only for its rev. The overlay holds `(rev, block-id)`; edits gate on `base_rev` and stale overlays get the same structured CONFLICT agents get (existing, tested machinery). After a successful write the preview re-derives and IDs refresh. No IDs embedded in markdown source — the canonical document stays for the reader, never the machinery (red line). Granularity check (Federico): outside long articles, content is already directive-block-shaped — `:::type` components with plain markdown between — so whole-block editing matches the natural authoring unit rather than fighting it.
4. **Preview auth (§8.4): two scopes, no third-party cookies.** The staging origin (`staging.[site]` — the same site app deployed draft-enabled, reading `derived-preview/…` only) authenticates *people* via login session. Studio iframe previews use **short-lived signed `(doc, rev)` tokens in query params** — mintable over the management surface, op_logged, bounded by short TTL + narrow scope + `Referrer-Policy` on preview routes. §8.5 is confirmed as decided: annotated artifacts never touch the immutable public cache.
5. **Embedded agent:** chatbot mode ships *inside the studio view* next to the preview (the block→chat→edit→preview loop is the product's reason to exist), hard-gated per §5: not before Phase 8 audience filtering, `chat` capability, per-principal spend caps.
6. **Sequencing:** §7 stands, with the deploy track further promoted — provisioning automation is now product code, not just ops.

Remaining open from §8: framework/serving location for the studio (§8.6, still deferred until the enablement layer exists) and whole-doc WYSIWYG (§8.7, future-track).
