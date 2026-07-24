---
_kind: schema
collection: pages
body: markdown
slices:
  allowed: [hero, prose, cta]
  max: 20
  rules:
    hero: { max: 1, position: first }
fields:
  title: { type: string, required: true, max: 80 }
  slug: { type: slug, required: true, from: title }
  description: { type: text, max: 200 }
indexes: []
---
# Writing guidelines for `pages`

Pages are composed from slices. Always begin with `get_schema` before authoring — slice types, allowed combinations, and position rules are enforced by the write path and will reject invalid compositions.

Start with a hero slice unless the page is a bare utility page (legal, 404). The hero sets the frame; everything after must justify its existence relative to the hero's promise.

Use `prose` slices for body copy. Keep prose slices short — one idea per slice. This makes reordering and editing surgical rather than surgical-on-a-blob.

Use `cta` for calls to action. One per page is usually enough. If you need two, put the second one at the end.

Never fabricate references (`ref:pages/...`). Query for real document ids and use those.
