# Personal Agent-First Markdown CMS — v0.1

My all-Cloudflare content infrastructure: markdown files as source of truth, an MCP server as the primary interface, agents as the default editors, me as the reviewer. Not a product — personal infra, a learning project across Workers/D1/R2/KV/DO, and a live test of one thesis: **markdown-native beats structured-JSON-native for agent editing reliability** (the opposite bet to EmDash's Portable Text).

A second track — giving clients friendly, non-repo editing access — is deliberately kept on the roadmap (§11), but nothing in v0.1 blocks on it.

## 1. Scope

**In**: content storage + revisions, schemas, slices, MCP tools, read API for my sites, a minimal review page, honest auth/audit.
**Out (for now)**: polished studio, multi-tenancy, pricing, teams, migration tooling, anything that exists to convince a buyer.
**Deferred, not deleted**: client access / non-repo editing (§11).

## 2. Architecture

One Worker, three surfaces, shared bindings:

- **`/mcp`** — MCP server (Streamable HTTP, Cloudflare Agents SDK / `McpAgent` on Durable Objects). The main interface.
- **`/api/v1`** — read-only JSON/HTML content API for my sites. Sites on Workers/Pages can also bind D1/R2 directly (zero-hop).
- **`/review`** — minimal human page: revision inbox, diffs, publish/revert. Behind Cloudflare Access.

| Binding | Role |
|---|---|
| R2 | Source of truth: markdown, assets, immutable revisions |
| D1 | Derived index (frontmatter fields, FTS5, revision log) — rebuildable from R2 |
| KV / Cache API | Rendered/query cache, purged by exact key on publish |
| Durable Objects | MCP sessions, per-doc write locks (TTL 60s) |
| Queues | Async on write: reindex, purge, optional git mirror |

### Write path

```
MCP mutating call
  → identity resolved from token (never from payload)
  → acquire per-doc DO lock
  → validate (schema, markdown lint, slice rules)
  → canonicalize formatting (server reformats; agents never round-trip their own whitespace)
  → write immutable revision to R2 + move HEAD
  → upsert D1 index + revision row (diff stat, note)
  → release lock → enqueue purge/mirror
```

Reads: queries/search from D1 only; bodies from R2 (KV-cached).

## 3. Storage layout (R2)

```
content/{collection}/{slug}.md              # HEAD
revisions/{collection}/{slug}/{rev-ulid}.md # immutable history
assets/{yyyy}/{mm}/{hash}-{filename}
schema/{collection}.md
schema/slices/{type}.md
schema/taxonomies/{name}.md                 # controlled vocabularies (§5)
skills/{area}/{name}.md                     # instruction layer (§8) — brand, content, dev
```

Rollback = copy old revision over HEAD through the normal write path.

## 4. Frontmatter

YAML frontmatter (strict-typed subset — ambiguous scalars rejected, no Norway problem) + markdown body.

```yaml
---
# system (server-managed; writes containing these are rejected)
_id: 01J8ZK7Q9G...            # ULID, immutable
_collection: posts
_status: draft                 # draft | published | archived
_created: 2026-07-23T09:14:00Z
_updated: 2026-07-23T11:02:00Z
_rev: 01J8ZR2M...
_author: { kind: agent, principal: marco, session: mcp-tok-8f3a }
#   ^ derived entirely from the authenticated token — never self-reported

# collection-defined (validated against schema/posts.md)
title: "Why agents prefer markdown"
slug: why-agents-prefer-markdown       # immutable after publish; rename op records redirect
tags: [ai, cms, markdown]
cover: asset:2026/07/a1b2c3-cover.png
related: [ref:posts/01J8ZJXQ...]       # refs by _id, resolved at render — renames never break links
---
Body. CommonMark + GFM. No raw HTML unless the schema allows it.
```

## 5. Schemas & slices

### Schemas as markdown

`schema/{collection}.md`: frontmatter declares fields, body is prose guidelines **served to agents via `get_schema`** — the CMS is self-prompting.

```yaml
---
_kind: schema
collection: posts
body: markdown                 # markdown | none
fields:
  title:   { type: string, required: true, max: 120 }
  slug:    { type: slug, required: true, from: title }
  tags:    { type: array, items: string, max_items: 8 }
  cover:   { type: asset, accept: [image/*] }
  related: { type: array, items: { type: ref, collection: posts } }
indexes: [tags]
---
# Writing guidelines for `posts`
Titles in sentence case. Excerpts are full sentences...
```

Types: `string, text, number, boolean, datetime, slug, array, enum, ref, asset, object, tax`. Validation errors are structured and specific (`fields.title: exceeds max 120 (got 143)`).

### Taxonomies

Declared vocabularies with per-taxonomy policies — not free tagging (agents sprawl: `ai`/`AI`/`a.i.` within a week) and not hard enums (friction for genuinely new topics). `schema/taxonomies/{name}.md`:

```yaml
---
_kind: taxonomy
name: topics
policy: propose          # closed → reject unknown | propose → accept + file for review | open → auto-register
normalize: { case: lower, slugify: true, singularize: true }
aliases: { ml: machine-learning, llms: ai }
hierarchy: false
terms:
  - { slug: ai, title: AI, description: "Models, agents, LLM tooling" }
  - { slug: tutorials, description: "Step-by-step guides only — not opinion pieces" }
---
Prose guidance served via get_context: how many topics per post, pairing rules...
```

- Fields bind by type: `tags: { type: tax, taxonomy: topics, max_items: 4 }`.
- Write path: normalize → alias-resolve → policy check. Unknown terms under `propose` **succeed** and file the new term as a proposed edit to the taxonomy file itself — vocabulary evolution flows through the review inbox, diffable and reversible like any revision. Rejection triggers a sweep re-tagging affected docs.
- Agent-optimized errors include nearest existing terms (edit distance now, Vectorize later) so agents self-correct in one round trip, or resubmit with `propose_terms: true` to stand by the proposal.
- Term `description`s are agent guidance (right term, not just valid term) — same trick as slice `intent`.
- **Harvest sweep** (the "auto-generate" mode, tamed): scheduled or one-off job clusters values in use for a field, normalizes, and emits *one proposed taxonomy revision* ("37 distinct values → 12 canonical terms + alias map") for inbox approval. Auto-generation as a draft, never as a fact.
- Read side: D1 `terms` + `doc_terms` join with denormalized counts — tag pages are index-only; `query` filters via the existing grammar (`filter: { tags: { op: "in", value: [...] } }`); `/api/v1/taxonomy/{name}` lists terms + counts.

### Content directives — components without code

In-body components use the CommonMark generic-directive syntax (`remark-directive`) — a de-facto convention (Docusaurus, VitePress), not spec-standard, chosen because it keeps documents **data, not code**: plain text that round-trips canonicalization, degrades gracefully in any markdown viewer, and gives agents nothing executable to inject. MDX stays rejected for the same three reasons it always was (unvalidatable, unsanitizable, doesn't round-trip).

Three forms, by colon count; **attributes are the props channel, the body/label is the content channel**:

```markdown
A sentence with :term[latent space]{def="the model's internal representation"} inline.

::video{src="assets/demos/look-at.mp4" poster="assets/demos/look-at.jpg" muted ratio="16/9"}

:::notes
Endnote material — body is real markdown.
:::
```

- `:name[label]{attrs}` inline · `::name{attrs}` leaf (no body — embeds) · `:::name{attrs}` container (markdown body). Containers nest by fence depth: outer fences use more colons — which is why slices (below) use four.
- **Attributes are flat strings.** That's the honest limit and the boundary rule: simple props → directive; structured/typed/repeatable data → slice. Don't encode JSON into attributes.
- **Registry, not convention**: every directive is declared by a schema doc `schema/directives/{name}.md` (allowed attributes, required ones, allowed contexts), same field system and prose-`intent` trick as slices. The write path validates against the registry — an **unknown directive or bad attribute is a structured error** (with the known-directive list, so agents self-correct), never silently dropped content. The sanitizer allowlists only what registered directives emit.
- Derivation maps each directive to a stable element (`aside.cms-notes`, …); the site maps those to components (CSS now, hast→Solid renderer later). First shipped directive: `:::notes`.

### Slices — composable page blocks

Schema-declared whitelist of markdown container directives (the four-colon form of the syntax above) — not MDX (unvalidatable, arbitrary code), not JSON arrays (loses the markdown edit model). **v0.1 hard limits: flat only — no nesting, no shared/global slices, no presets, no variants.** The treadmill stays off.

```markdown
::::slice{type=hero id=s_9K2M variant=split}
title: Ship content at agent speed
cta: { label: "Start", href: "ref:pages/01J9..." }
::::

::::slice{type=prose id=s_7BB4}
Regular **markdown** — this slice's body is rich text.
::::
```

- Slice types are schemas (`schema/slices/{type}.md`), same field system, same prose-guidelines trick.
- Stable server-assigned instance `id` — edits, reorders, and diffs address slices by id.
- Page collection schema constrains composition: `slices: { allowed: [...], max: 20, rules: { hero: { max: 1, position: first } } }`.
- Content docs stay pure markdown; slices are opt-in per collection.

Rendering: `format=json` → `{ slices: [{ type, id, props, body_html }] }`, my site maps type → Solid component. `format=md` → raw file.

## 6. MCP tools

Principles: str_replace-native editing; mutating calls return resulting state (no follow-up read); structured errors; destructive ops are two-step; `base_rev` optimistic concurrency (stale rev → conflict response includes current diff so the agent rebases itself).

```jsonc
// discovery
get_schema        { collection? }          // incl. prose guidelines + slice schemas
list_collections  {}
get_context       { task, collection? }    // assembled briefing: schemas + slices + always-skills
                                           // (audience/scope-filtered by token) + on-demand skill index
list_skills       { audience?, attach? }   // name + description index (progressive disclosure)

// read
query    { collection, filter?, status?, sort?, limit?, cursor?, fields? }  // D1 only, bodies excluded
read_doc { id, rev? }                       // "_id" or "{collection}/{slug}"
search   { q, collection?, limit? }         // FTS5 now; Vectorize semantic search is the planned upgrade

// write
create_doc { collection, frontmatter, body }
edit_doc {
  id, base_rev, note?,
  edits: [                                   // atomic: all or none
    { op: "str_replace", old, new }          // must match exactly once
    | { op: "append", text }
    | { op: "set_field", field, value }
    | { op: "delete_field", field }
    | { op: "insert_slice", type, fields, body?, position }
    | { op: "set_slice_field", slice, field, value }
    | { op: "replace_slice_body", slice, body }
    | { op: "move_slice", slice, position }
    | { op: "remove_slice", slice }
  ]
}
rename_doc { id, new_slug }                  // records redirect
delete_doc { id, confirm: "_id" }            // archives; R2 history never destroyed

// lifecycle & history
publish  { id, base_rev }                    // full validation incl. required-at-publish
unpublish { id }
history  { id, limit? }                      // [{ rev, at, author, note, diff_stat }]
diff     { id, from_rev, to_rev? }           // unified diff — agent-readable
revert   { id, to_rev, note? }

// assets
upload_asset { filename, content_base64 | url, alt? }
list_assets  { q?, cursor? }
```

## 7. Derived content & the read pipeline

**Transform at write time, never at read time.** Writes are rare, reads are hot: the Queue consumer derives all render artifacts on publish, and SSR reads become pure lookups. Raw markdown is for agents; SSR frameworks never parse markdown.

### Derivation (on accepted publish)

Stored as `derived/{collection}/{slug}/{rev}.json` in R2, mirrored to KV for hot docs:

- `body_html` — sanitized, syntax-highlighted, ready for `innerHTML`
- `body_hast` — HTML AST as JSON, for component mapping in the frontend (own `<Link>`, `<Image>` w/ LQIP, custom code blocks) — MDX-like flexibility, zero runtime parsing
- `slices: [{ type, id, props, body_html, body_hast }]` — resolved and validated
- `toc` (headings + anchor ids), `excerpt`, `reading_time`
- image metadata: dimensions, LQIP/blurhash, srcset via `/cdn-cgi/image`
- side outputs: sitemap fragment, RSS item, Vectorize embedding

### The pointer trick

Derived artifacts are rev-addressed ⇒ **immutable** ⇒ `Cache-Control: immutable`, cached forever, no purge logic. The only mutable read in the system is the HEAD pointer (`slug → rev`): one tiny D1/KV row. SSR render = pointer lookup (~1ms) + immutable KV/R2 fetch (~ms). Publish = pointer flip. Rollback = pointer flip. No cache races, ever.

### Lists

D1 index rows carry denormalized card fields (title, excerpt, cover ref + inline LQIP): index pages are one D1 query returning render-ready rows, zero body fetches.

### Reference invalidation graph

Refs snapshot the target's slug/title at derive time. D1 stores outbound-ref edges; when a target's slug/title changes, the queue re-derives referencing docs (bounded, async). Readers just see new rev keys.

### Consumption tiers (fastest first)

1. **Same-platform (my sites)**: Worker binds KV/D1 directly — zero-hop; this is the all-Cloudflare payoff.
2. **HTTP** `GET /api/v1/{collection}/{slug}?format=html|hast|json|md`: rev-keyed, edge-cached (Cache API), `stale-while-revalidate` for off-platform consumers.
3. Drafts via short-lived preview token (derivation runs on draft saves too, flagged non-cacheable).

## 8. Skills & rules — the instruction layer

Generalizes the §5 trick (markdown files whose prose is served to agents) into the full instruction system. **Skills are content**: stored in R2 (`skills/`), indexed in D1, revisioned, human-gated through the same review inbox, edited via the same write path. The brand voice doc has version history like a post; a client (future track) edits tone-of-voice through a form.

### Skill files

```yaml
---
_kind: skill
name: brand-voice
audience: [content-agent, human]   # content-agent | dev-agent | human | any
attach: global                      # global | collection:X | slice:Y
mode: always                        # always → auto-injected | on-demand → indexed, fetched by need
description: "Tone of voice and terminology for all written content"
lint:                               # machine-checkable → enforced in the write path
  banned_terms: ["synergy", "cutting-edge"]
  max_sentence_words: 28
---
Prose guidelines: judgment calls, taste, examples...
```

**Rules that validate vs rules that prompt**: anything mechanically checkable (banned terms, sentence length, required alt text) lives in `lint` frontmatter and runs as a write-path step returning structured errors; prose carries what can't be enforced. Devs push rules downward into enforcement whenever possible.

### Standard skill set

```
skills/brand/voice.md            # tone, terminology, style (user/client-maintained)
skills/content/writing-posts.md  # attach: collection:posts
skills/content/page-building.md  # attach: collection:pages — full-agentic composition rules:
                                 #   slice ordering taste, adjacency rules, "reuse patterns from
                                 #   existing pages via query", "never fabricate testimonial refs"
skills/dev/extending.md          # add collections/slices/derivation steps; the two-worlds handshake
skills/dev/frontend-contract.md  # derived hast/slices JSON contract, type → component mapping
```

Slice schemas gain an `intent` line in their guidelines ("feature-grid: scanning, not reading — max 8 words per item") so agents pick the right block, not merely a valid one. Hard composition limits stay in schema `slices.rules` (enforced); skills carry taste.

### `get_context` — one call, complete briefing

`get_context { task, collection? }` assembles: relevant schema(s) + allowed slice schemas/guidelines + all `mode: always` skills matching the caller's audience and scope + a name/description **index** of `on-demand` skills (progressive disclosure — fetch via `read_doc` only if relevant). Capability-scoped tokens select both what an agent may *do* and what it is *told*: client content tokens never see dev skills.

### Two worlds

Content agents live entirely CMS-side (MCP, no repo). Dev agents touch the repo *and* the CMS's schema/skill files. Adding a slice type is the one cross-world operation (schema file + frontend component + type→component registration) — `dev/extending.md` documents the handshake.

### Interop export

`GET /api/v1/skills/export` bundles skills as standard SKILL.md files so Claude Code and other harnesses consume the CMS's conventions natively. The CMS is the source of truth for its own operating manual.

## 9. Review page

One page, not a studio: inbox of recent revisions (author, principal, note, per-slice/markdown diff) with approve-publish, revert, comment-to-file. Cloudflare Access in front. This is where I catch what agents did before the world sees it.

## 10. Hardening I keep even solo

- **T1 — identity from token, always.** Tokens minted per agent/session, bound to a principal; payload-supplied `_author` rejected. "Which session changed this" stays answerable.
- **T2 — human-gated publish by default.** Agents draft; `publish` requires a publish-capable token (mine, via the review page). Prompt injection doesn't care that I'm the only customer — my agents still read the open web.
- **T2b — `skills/` and `schema/` are never auto-publishable. Non-negotiable, forever.** A poisoned skill or schema poisons every future agent (privilege escalation via instruction layer). Even if regular content later gets auto-publish tokens, these namespaces always require human review.
- **T3 — reconciliation sweep.** Scheduled job compares R2 HEAD revs to D1 rows, repairs drift, reports. The index must never lie quietly.
- **T6 — canonicalizing formatter.** Server reformats every accepted write; different models' whitespace/quoting habits never accrete into the files.
- **Thesis instrumentation.** Every mutating call logs outcome + error class (str_replace miss, validation fail, YAML malformation, slice error) with session/model to `op_log`. Months of real use = the markdown-vs-structured agent-reliability data, collected for free.

Deferred hardening: rate breakers, capability tiers beyond draft/publish, slice migration tooling — added when they annoy me personally.

## 11. Future track — client & non-repo access

The path from personal infra to "clients can edit their site without touching files, repos, or YAML." Kept warm, built only when a real client needs it:

1. **Capability-scoped tokens** (the same mechanism as agent scoping — one system, two audiences): a client token limited to specific collections/docs, draft-only or publish-capable per arrangement.
2. **Schema-driven forms**: frontmatter rendered as a form from `get_schema` — the machinery already exists; this is a UI layer, not new architecture.
3. **Markdown-invisible body editing**: WYSIWYG (Tiptap/Milkdown) serializing to markdown, saves submitted as `edit_doc` diffs with `base_rev` reconciliation. The client never knows it's markdown.
4. **Slice cards**: form + mini editor per slice, add-slice palette filtered by the page schema, drag-to-reorder. This is the big UI lift — last for a reason.
5. **Per-site preview links** off the draft endpoint.
6. **Brand & voice self-service**: clients maintain their own `skills/brand/voice.md` through the same schema-driven forms — the tone-of-voice doc is content, so edits flow through review like everything else, and every future agent write instantly inherits the updated voice.

Design guarantee that makes this track safe to defer: clients would be *just another authenticated principal on the same write path* — same locks, same revisions, same review trail as agents. Nothing in v0.1 needs rework to add them. Decision checkpoint when the track activates: build this UI, or bridge to something existing (incl. re-evaluating EmDash) — whichever is less work *at that point*.

## 12. Build order (weekend-sized)

1. R2 layout + D1 schema + write path as plain functions; indexer rebuildable from bucket scan.
2. MCP server: `get_schema, query, read_doc, create_doc, edit_doc` (+ token identity). **Usable from here.**
3. `base_rev` conflicts, locks, `history/diff/revert`; canonicalizing formatter.
4. Derivation pipeline (html + hast + pointer scheme) + zero-hop reads + HTTP API; point first site at it.
5. Review page.
6. Slices (parser, validation, slice ops); first composed page.
7. Skills layer: skill files + lint step + `get_context`/`list_skills`; write brand-voice and page-building skills; SKILL.md export.
8. Reconciliation sweep, git mirror via Queues, Vectorize search — as the mood strikes.

## 13. Implementation kit

### Decision log (what we decided and why — the whole conversation, one table)

| Decision | Choice | Why |
|---|---|---|
| Source of truth | Markdown files in R2 | Cheapest/most reliable LLM edit surface; the core thesis |
| Structured metadata | YAML frontmatter, strict-typed subset | Agent-writable; strictness kills coercion footguns |
| Index | D1, fully derived/rebuildable | Files stay truth; queries stay fast; drift is repairable |
| Primary interface | MCP server (Agents SDK, DO-backed) | Agents are the default editors |
| Edit model | `str_replace` + slice ops, atomic batches, `base_rev` optimistic concurrency | Matches how LLMs edit; conflicts return diffs so agents self-rebase |
| In-body components | Generic directives (`:` / `::` / `:::`), registry-validated; attrs = props, body = content; slices for structured data | Document-not-code holds; unknown directives error instead of vanishing; MDX stays out |
| Concurrency | Per-doc DO locks (TTL 60s) + `base_rev` | Locks for the write moment; base_rev for semantic races |
| Identity | Derived from token, never payload | Audit trail that can't be spoofed (red team T1) |
| Publish | Human-gated by default; `skills/`+`schema/` gated forever | Injection defense (T2/T2b) |
| Revisions | Immutable, ULID-keyed, R2; rollback = pointer flip | History free; diffs agent-readable |
| Page composition | Slices as whitelisted markdown directives, flat-only v0.1, stable ids | Sanity-style composition without MDX's arbitrary code or JSON's edit model |
| Instruction layer | Skills as content (audience/attach/mode + `lint`), same write path | One mechanism for brand voice, content rules, dev docs; reviewed like content |
| Enforcement split | Schema/lint validates; prose prompts | Push rules into machine checks whenever possible |
| Agent briefing | `get_context` assembles per-token bundle + on-demand index | One call to operate correctly; progressive disclosure |
| Taxonomies | Declared vocabularies, per-taxonomy policy (`propose` default), aliases+normalize | Agents sprawl free tags; closed enums add friction; propose = growth via review |
| Read pipeline | Transform at write time; serve `body_html` + `body_hast` | Reads outnumber writes; never parse markdown per-request |
| Caching | Rev-addressed immutable artifacts + tiny mutable HEAD pointer | `immutable` caching, no purge logic, instant publish/rollback |
| Lists | Denormalized card fields in D1 rows | Index pages = one query, zero body fetches |
| Refs | By `_id`, snapshot at derive, D1 edge graph re-derives on change | Renames never break links |
| Formatting | Server canonicalizes every write | Model whitespace habits never accrete (T6) |
| Scope | Personal infra + client track deferred | Product framing killed by adversarial review (Appendix A) |

### D1 schema (tables for migration 0001)

```sql
documents  (id TEXT PK, collection, slug, status, head_rev, title, card JSON,
            created, updated, UNIQUE(collection, slug))         -- + per-schema indexed cols
documents_fts (FTS5: title, body_text)
revisions  (rev TEXT PK, doc_id, at, author_kind, principal, session, note, diff_stat)
ref_edges  (from_doc, to_doc, field)                            -- invalidation graph
slice_index(doc_id, slice_id, type, position)                   -- query pages by slice type
terms      (taxonomy, slug, title, description, status, count, PK(taxonomy, slug))
doc_terms  (doc_id, taxonomy, term_slug)
tokens     (token_hash PK, principal, kind, audience, capabilities JSON, created, expires)
op_log     (at, session, tool, doc_id, outcome, error_class)    -- thesis instrumentation
```

Pointers = `documents.head_rev`, mirrored to KV (`ptr:{collection}/{slug}`) for hot reads. Schemas/skills/taxonomies parsed from R2, cached in KV keyed by their own rev.

### Repo structure

```
cms/
  wrangler.jsonc            # bindings: D1, R2, KV, DO (McpAgent, LockRoom), Queues
  migrations/
  seeds/                    # initial schema/, skills/, taxonomies/ files
  src/
    index.ts                # Hono router → /mcp /api/v1 /review
    mcp/                    # McpAgent, tool defs, get_context assembly
    core/                   # write path: auth, lock, validate, canonicalize, revision, index
    parse/                  # strict YAML, frontmatter, slice directives, markdown pipeline
    derive/                 # queue consumer: html/hast/toc/images/embeddings, pointer flip
    db/                     # D1 queries
    review/                 # inbox UI (server-rendered, tiny)
```

### Stack picks

TypeScript; **Hono** (routing); **Cloudflare Agents SDK** (`McpAgent`); **unified**: remark-parse + remark-gfm + **remark-directive** (slices) → rehype + **rehype-sanitize**; syntax highlighting at derive time (Shiki fine-grained bundle — it runs in the queue consumer, not the hot path); **yaml** with a strict custom schema; **ulid**; unified-format diffs via **diff**.

### Milestone 1 — definition of done

From Claude (chat or Claude Code) connected to `/mcp` with a minted token:
1. `get_context(task: "write", collection: "posts")` returns schema + guidelines + brand-voice skill.
2. `create_doc` a post → appears in `query`; frontmatter validated; `_author` from token.
3. `edit_doc` with one `str_replace` + one `set_field` and correct `base_rev` → new revision; stale `base_rev` → conflict + current diff.
4. `history` shows both revisions with author/session; `op_log` recorded every call.
5. D1 wipe + reindex-from-R2 rebuilds identical state (proves "the index is derived").

Everything after stacks on this skeleton per §12.

### Seed content for day one

`schema/posts.md`, `schema/pages.md` (+ slice schemas: hero, prose, cta), `schema/taxonomies/topics.md` (policy: propose, ~8 terms), `skills/brand/voice.md`, `skills/content/page-building.md` — real files in `seeds/`, uploaded by a setup script. Writing these first pressure-tests every format before any code exists.

---

## Appendix A — Product-scale record (kept for reference)

Retired after adversarial review (July 2026). Summary of why the *product* framing died: Cloudflare shipped EmDash (Apr 2026) — free, MIT, MCP-native, agent-first, distributed via the Cloudflare dashboard, on Astro (which Cloudflare acquired); Sanity rebranded as a Content OS with native MCP, Agent API, per-actor revisions and scoped agent access (our "governed agent authorship" pitch, shipped); MCP support is table stakes across Sanity/Contentful/Storyblok/Strapi/Payload/Directus/Hygraph/Kontent.ai; and the low end increasingly concludes markdown+git+coding-agent needs no CMS at all. Squeezed from four sides, with the studio as the biggest and least differentiated build surface.

What survived: the markdown-vs-Portable-Text thesis (unclaimed by any major player) — now tested here at zero stakes. If it ever proves out dramatically on my own content, the revival paths were, cheapest first: EmDash plugins (markdown storage adapter / review queue / slice authoring), open-sourcing the core, or the standalone build — gated by the original kill criteria: EmDash-first trial on a real project; core in ≤3 weeks; ≥40% content-ops improvement vs git+agent control on 3 sites over 6 weeks; external adoption within 3 months of any public release; and the thesis itself falsified if Portable-Text-native editing matches markdown on agent edit failure rates.

Product-scale threats parked with it: multi-tenant D1 limits (10GB SQLite, DB-per-tenant provisioning), pricing when users are agents, enterprise vendor-lock objections, slice migration tooling at fleet scale, rate/anomaly breakers, CRDT co-editing.
