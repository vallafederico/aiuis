---
_kind: schema
collection: posts
body: markdown
fields:
  title: { type: string, required: true, max: 120 }
  slug: { type: slug, required: true, from: title }
  date: { type: datetime, required: true }
  tags: { type: tax, taxonomy: topics, max_items: 4 }
  cover: { type: asset, accept: ["image/*"] }
  related: { type: array, items: { type: ref, collection: posts } }
indexes: [date, tags]
---
# Writing guidelines for `posts`

Titles in sentence case. No title case, no trailing period.

Excerpt is the first paragraph — write it to stand alone. Readers on index pages see only the excerpt; make it earn a click or make it complete enough that no click is needed.

Date is the publish date. Do not set `date` to today if you are drafting something intended for next week — leave it unset and fill it on publish.

Tags come from the `topics` taxonomy. Maximum four. Prefer fewer: three well-chosen tags beat four padded ones. Unknown terms trigger a proposal to the review inbox — propose only if the gap is genuine.

Related posts resolve by `_id`, never by slug. Do not fabricate ids; use `query` to find real candidates.

Body is CommonMark + GFM. No raw HTML. Code blocks require a language tag.
