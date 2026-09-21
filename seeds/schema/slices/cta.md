---
_kind: slice_schema
type: cta
intent: "Call to action — one clear next step. Use once per page, at the end or at a natural decision point."
fields:
  heading: { type: string, max: 60 }
  body: { type: text, max: 200 }
  primary:
    type: object
    required: true
    fields:
      label: { type: string, max: 32, required: true }
      href: { type: string, required: true }
  secondary:
    type: object
    fields:
      label: { type: string, max: 32 }
      href: { type: string }
---
# CTA slice guidelines

Heading is optional but useful when the CTA is not immediately following the content that motivates it. If placed at the end of a short page, skip the heading.

Body is one sentence of reinforcement — not a repeat of the page's case, but a nudge ("No setup required." / "Free for personal projects."). Omit if the primary CTA label is self-sufficient.

Secondary CTA is for a genuinely different path (e.g., "Start building" + "Read the docs"). Do not use it for decoration.
