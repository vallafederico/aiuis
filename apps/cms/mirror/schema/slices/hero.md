---
_kind: slice_schema
type: hero
intent: "Opening frame — establishes what the page is and why the reader is in the right place. Scanning, not reading."
fields:
  title: { type: string, required: true, max: 60 }
  subtitle: { type: text, max: 160 }
  cta:
    type: object
    fields:
      label: { type: string, max: 32, required: true }
      href: { type: string, required: true }
  variant: { type: enum, values: [centered, split], default: centered }
---
# Hero slice guidelines

Title is the value proposition, not the page name. "Build WebGL scenes at agent speed" beats "WebGL Editor". Max 60 characters — count them.

Subtitle expands the title by one sentence. It does not repeat the title in different words. If the title is self-sufficient, omit the subtitle.

CTA label: action verb + object. "Read the docs" not "Docs". "Start building" not "Get started".

Variant `split` is for pages with a visual artifact (screenshot, animation) worth showing above the fold. Default to `centered` when in doubt.
