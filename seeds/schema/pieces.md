---
_kind: schema
collection: pieces
body: markdown
fields:
  title: { type: string, required: true, max: 120 }
  slug: { type: slug, required: true, from: title }
  section: { type: enum, values: [preface, foundations, uis], required: true }
  order: { type: number, required: true }
  description: { type: text, max: 200 }
  component: { type: slug }
  tags: { type: tax, taxonomy: data, max_items: 4 }
indexes: [section, order, tags]
---

# Writing guidelines for `pieces`

Tone, punctuation, citations, and length follow the brand-voice skill. A chapter is one essay, 450 to 700 words. The first paragraph is the excerpt: one or two sentences that stand alone. On a piece with a `component`, that opening is one sentence.

Titles in sentence case. No title case, no trailing period.

Description is a single-sentence teaser for the piece listing. A reader scanning the table of contents should know what the chapter argues without opening it. Do **not** put DATA labels in description — those live in `tags`.

Body is the full chapter text in CommonMark + GFM. No raw HTML. Code blocks require a language tag. Inline code, blockquotes, and tables are all fair game.

Order is an integer starting from 1 within each section. The first piece in a section is `order: 1`, the second is `order: 2`, and so on. Do not use decimals or gaps. If you insert a piece between two existing ones, renumber the others.

Section must match the nav section exactly: `preface`, `foundations`, or `uis`. A piece in the wrong section will appear under the wrong heading in the navigation.

`component` is an optional slug naming a frontend UI in `apps/web/src/uis`. The CMS only stores the name; the site constructs the live component. Use it on `uis` pieces (usually the same as `slug`). Omit it on prose-only chapters. An unknown name is ignored. The chapter still renders.

`tags` is a taxonomy field bound to `data`. Pick from the existing terms in Studio (or propose a new one). Prefer one **model** tag (`jev`, `llama-3-2`, `image-model`, …) plus one or two **primitive** tags (`select`, `exists`, `needle`, `rank`, …). Maximum four. See `schema/taxonomies/data.md`.

Endnotes and the reference list go in a `:::notes` container directive at the end of the body. Do not use a `## Notes` or `## Sources` heading. The site renders the block as a quieter section outside the table of contents:

```
:::notes
Affiliations are listed as they were at the time of the relevant contribution.
:::
```

An optional short lead-in can go in a `:::foreword` container directive at the very start of the body. One or two sentences that orient the reader before the piece begins. It is a teaser, not a restatement of the opening paragraph, and there can be at most one per document:

```
:::foreword
A short note on what this chapter argues before it begins.
:::
```
