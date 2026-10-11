---
_kind: slice_schema
type: prose
intent: "Rich text body content — paragraphs, lists, code, headings. The workhorse slice."
when: "Body copy: one idea per slice, headings from h2."
when_not: "A call to action (use cta) or anything needing raw HTML (needs its own slice type)."
hints:
  - "Split a slice that covers two topics so each can be moved on its own."
fields: {}
body: markdown
---
# Prose slice guidelines

Body is full CommonMark + GFM. Headings start at h2 (the page h1 is the hero title). Code blocks must have a language tag.

One idea per prose slice. If you notice a slice covering two distinct topics, split it — the split makes both topics independently editable and reorderable.

No raw HTML. If you need a custom component (video embed, interactive widget), the right answer is a new slice type, not an HTML escape hatch.
