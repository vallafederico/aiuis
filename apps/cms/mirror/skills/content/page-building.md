---
_kind: skill
name: page-building
audience: [content-agent]
attach: collection:pages
mode: always
description: "Full-agentic composition rules for the pages collection — slice ordering, adjacency, reuse patterns"
lint:
  banned_terms: ["click here", "learn more"]
---
# Page building — slice composition rules

## Before you start

Call `get_schema` to get the current slice whitelist, position rules, and per-slice field constraints. The schema is enforced at write time; do not guess what is allowed.

Call `query({ collection: "pages", status: "published" })` and read two or three existing pages before composing a new one. Reuse patterns that work; do not invent patterns that do not yet exist in the system.

## Composition taste

**Hero first, always** (unless the schema says this is a utility page). The hero earns the reader's attention before asking them to do anything.

**One prose slice per idea.** If a prose slice covers two topics, split it. The split makes each block independently editable and reveals whether the two ideas actually belong on the same page.

**CTA earns its position.** Place a CTA after prose that has built the case for it. A CTA before any supporting content asks the reader to act on faith.

**Do not fabricate adjacent pages.** If a CTA's `href` references another page, verify it exists via `query` before writing the ref. Broken references surface on publish validation, not on save.

## Adjacency rules (taste, not schema)

hero → prose: always valid.
prose → prose: valid; use when you have a clear topic break.
prose → cta: valid at the end; avoid mid-page unless the page is explicitly a landing page with a high-intent reader.
cta → prose: avoid — it implies the call to action failed and you are backpedaling.

## Never fabricate testimonial references or external claims

If a prose slice makes a factual claim that would require a citation, either include the source URL in the markdown or omit the claim. The review page exists to catch these before publish; do not rely on it as a safety net.
