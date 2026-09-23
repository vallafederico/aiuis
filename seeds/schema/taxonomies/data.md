---
_kind: taxonomy
name: data
policy: propose
normalize: { case: lower, slugify: true }
aliases:
  chatgpt: language-model
  chat-gpt: language-model
  gpt: language-model
  llm: language-model
  llama: llama-3-2
  llama3: llama-3-2
  "llama-3.2": llama-3-2
  typesafe: jev
  system-one: jev
  model: image-model
hierarchy: false
terms:
  # Models - who judges or generates
  - { slug: jev, title: JEV, description: "TypeSafe System One (Choice, Noul, Score). Fast typed judgments, not prose." }
  - { slug: llama-3-2, title: LLAMA-3.2, description: "Cloudflare Workers AI @cf/meta/llama-3.2-3b-instruct: short generative answers." }
  - { slug: language-model, title: LANGUAGE-MODEL, description: "A general LLM generate path when the specific model is not fixed yet." }
  - { slug: image-model, title: IMAGE-MODEL, description: "An image generate or vision model (draw, caption, or score pixels)." }
  - { slug: workers-ai, title: WORKERS-AI, description: "Cloudflare Workers AI binding in general: prefer a specific model tag when known." }
  # Primitives - what the interface does
  - { slug: select, title: SELECT, description: "Select-don't-generate: pick from a closed set instead of inventing an answer." }
  - { slug: exists, title: EXISTS, description: "A Noul (or equivalent) gate: silence when nothing fits, not a bogus first hit." }
  - { slug: rank, title: RANK, description: "Order a closed set by relevance (Choice probabilities over known options)." }
  - { slug: needle, title: NEEDLE, description: "Find-in-place: the answer is a location in existing text, not a new paragraph." }
  - { slug: highlight, title: HIGHLIGHT, description: "Attribution by lighting up the source span or region." }
  - { slug: generation, title: GENERATION, description: "A generate path is in play (prose or image) with honest wait chrome." }
  - { slug: prompt, title: PROMPT, description: "The prompt (or mix recipe) is a first-class interface object." }
  - { slug: provenance, title: PROVENANCE, description: "Where an artifact came from vs what it claims to show." }
  - { slug: score, title: SCORE, description: "Graded judgment along a dimension (TypeSafe Score or similar)." }
  - { slug: axes, title: AXES, description: "Readable named dimensions that place items in a space." }
  - { slug: mix, title: MIX, description: "Blend or interpolate from neighbors (gap-click, between A and B)." }
  - { slug: iteration, title: ITERATION, description: "Regenerate or refine in place from a single result." }
  - { slug: scroll, title: SCROLL, description: "Continuous scroll as the surface the model writes into." }
---

DATA labels for `/uis` chapters. Shown under Data on component pages and as `/data/:tag` indexes.

Prefer **one model tag** (who judges or generates) plus **one or two primitive tags** (what the interface does). Three is usually enough; four is the hard max on the pieces field.

Propose a new term only when none of the existing ones fit and more than one chapter would use it. Prefer extending an alias to an existing slug over inventing a near-duplicate.
