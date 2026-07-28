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
indexes: [section, order]
---

# Writing guidelines for `pieces`

Titles in sentence case. No title case, no trailing period.

Description is a single-sentence teaser for the piece listing — write it so a reader scanning the table of contents understands what the chapter is about without opening it.

Body is the full chapter text in CommonMark + GFM. No raw HTML. Code blocks require a language tag. Inline code, blockquotes, and tables are all fair game.

Order is an integer starting from 1 within each section. The first piece in a section is `order: 1`, the second is `order: 2`, and so on. Do not use decimals or gaps — if you insert a piece between two existing ones, renumber the others.

Section must match the nav section exactly: `preface`, `foundations`, or `uis`. A piece in the wrong section will appear under the wrong heading in the navigation.

Endnote material (affiliations, caveats, methodology asides) goes in a `:::notes` container directive at the end of the body — never a `## Notes` heading. The site renders it as a distinct, quieter block outside the table of contents:

```
:::notes
Affiliations are listed as they were at the time of the relevant contribution.
:::
```
