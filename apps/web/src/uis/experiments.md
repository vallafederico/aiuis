# UI experiments

Working notes for live `/uis` components. The chapters are mock frames until a prototype replaces them. The argument is not “add AI to the UI.” It is judgment at interaction timing, uncertainty as chrome, and select-don’t-generate unless generation is the point.

Buttons assumed a system that was fast, deterministic, and silent about uncertainty. Most LLM UIs invert all three. These experiments try to invert that again.

**Principles** (from the Foundations chapter): legibility, interruptibility, recoverability, attribution, calibration, restraint.

**Roles**

| Layer | Job |
| --- | --- |
| Code | Loop, AND/OR, order, whether anything disappears, URL |
| Jev (TypeSafe) | Rank, filter, route, find, confidence, “should chrome appear?” (~150ms) |
| LLM | FAQ answers, infinite-article prose, bot replies, prompt rewrite, captions |
| Vision / image | Look at pixels, generate/iterate an image, provenance gap vs the prompt |

Jev decides. An LLM writes. A vision/image model sees or draws. Typing indicators belong on the generate path, not on the judgment. If `exists` / confidence is low, stay quiet.

---

## Shared primitives

Build once, reuse.

- **Catalog search** — Choice over piece slugs + Noul `exists`. Reorders the existing index. Does not invent hits. A miss is silence, not a bogus #1.
- **Hard tag filter** — exact DATA labels in code. No model.
- **Soft rule chips** — typed Nouls (“about waiting”, “not a chatbot”). Rows recede or hide; put-back if wrong. LLM only to *name* a new chip from a sentence.
- **Relevance floor** — slider over stored scores; no extra call. The filter panel is a mixing desk.
- **Semantic find** — Choice over paragraph IDs + `exists`. Highlight the source. No generated answer.
- **Confidence chrome** — high / confirm / stay quiet. Opacity and whether a control exists.
- **Generate-when-needed** — Jev gate, then LLM or image. Wait UI only on that path.

Search ranks. Filters cut or recede. Same loop, two controls. At this catalog size (~13 pieces) skip BM25; send the whole list as state. URL holds the controls (`?q=` / `?tag=` / `?floor=`); the router already treats those as in-place updates.

Put search on the **nav**, not a `/search` route. The index *is* the result list.

---

## Existing `/uis` chapters

### FAQs — live

A short list. The last row is an Ask field. An answer becomes a new FAQ; the empty Ask row returns underneath. Rows expand/collapse with the `0fr` / `1fr` grid trick.

Jev (when wired): pick/open a matching row instead of generating. Rank remaining questions. Uncertain match stays closed. LLM only on a miss, and only if `exists` says the catalog can’t cover it. Remembered in this browser via localStorage.

### Look At

Needle on a chapter. Query or pointer → spans light up by probability. Empty if `exists` is low. Attribution is the highlight; there is no summary unless the reader asks, and then the LLM still cites the span Jev picked. Vision later if the target is an image.

This is the smallest honest prototype: one piece of text, one query, a focus field whose intensity is a number.

### Navigation

The live nav is already the experiment (“what is in play”). Search reorders pieces; chips cut scope; breadcrumb is context for both reader and model. Weak `exists` leaves order alone.

### Infinite Article

At the end of a section, Choice: continue / deepen / aside / stop. Noul “are they still with this thread?” gates generation. LLM writes the next block. Split Choice → two ghost openings; generate the one they scroll into.

### Bot

Jev routes first: answer from FAQ / go to a piece / ask a missing control / generate. LLM only on generate. Avatar and typing follow that path — the honest baseline the chapter already wants. Incomplete intent becomes a missing control, not a chat follow-up.

### Images

Filter/rank a grid by caption, prompt, and provenance tags. Soft chips: generated vs documented, prompt-gap, off-brief. Vision scores “does this image match the prompt?” Provenance stays visible; models only order and cut.

### Image Generation

Prompt-to-control, not prompt-to-pixels. Choice: iterate / vary / stop. Surface the next slider from the prompt (“more grain”, “less type”). Vision for the prompt–result gap after the image exists. Stopping is a first-class act.

The two-axis board is **not** this component. That is Generative Moodboard.

---

## Generative Moodboard

The board is the prompt, not a text field. Two named axes, four quadrants, images sit where they score. Click a gap → generate a mix of the two nearest, weighted by where you clicked.

Old pattern: StyleGAN walks, Midjourney interpolate, scatterplot moodboards, “between A and B” sliders. What’s better here: the axes are **readable dimensions**, not a latent blob, and **empty space is the generate verb**. Attribution is geometric — you can see why that image appeared.

**Roles**

- **Jev** places and mixes. Score each image on the two axes (from prompt, caption, later a vision pass on the pixels). On click, return the two nearest and a mix recipe: weights from distance, plus whether this is an along-axis blend or a cross-axis blend.
- **Image model** draws from that recipe (prompts + refs + target position).
- **LLM** only if the recipe needs a written prompt. Often code can stitch the two prompts and the target scores without one.

Score four or six dimensions once. The two axes on screen are just which pair you are looking at. Swap axes → relayout, no new images.

**Click rules**

- Two nearest on **different axes** → take X from one, Y from the other. Quadrant fill.
- Two nearest on the **same axis**, different values → interpolate that axis, hold the other.
- **One much closer** → vary that image toward the click. Don’t pretend it’s a mix.
- **Dense cluster** → do nothing. Restraint: the board is already speaking there.

Show the two sources and the mix weights before or as it generates.

**Cold start**

1. Four corner generations from the axis extremes, or
2. Drop in a few references and let Jev place them, or
3. Type two axis names and generate the corners.

Then the rest of the board is gap-filling, which is the actual interaction.

**Axes that fit this site** (or let the reader name them)

- prompt-faithful ↔ surprising
- sparse ↔ dense
- documentary ↔ generated-looking
- still ↔ iterative (how far from the last prompt)

**Other verbs:** drag an image to disagree with Jev’s placement (correction). Double-click an existing one to iterate in place. Stop when the board is dense enough.

Fits the Image Generation chapter’s loop (iterate, know when to stop) as its own `/uis` piece, not as a prompt box plus a result.

---

## New components worth a chapter

- **Find (⌘F)** — site-wide Needle. Same primitive as Look At, as its own verb. LLM only if they want a sentence *about* the hit.
- **Filters** — mixing desk: hard tags + soft Nouls + floor. AnyFilter / Dev Ed pattern, on this catalog.
- **Inbox / rank** — same list, importance instead of nav order. Ranking as the default, not a search mode.
- **Command palette** — natural language → typed action (open piece, apply chip, find span) with confidence gates.
- **Smart drop** — drop a tag, quote, or image onto a piece; Jev picks the slot (related / evidence / discard).
- **Attention overlay** — Look At without a query: pointer + viewport as state.
- **Restraint meter** — “would chrome appear?” as you type. For Representing Thinking / Interactions.
- **Distribution view** — full Choice probabilities as overlapping ghosts, not a winner. Calibration.
- **Correction** — select a bad highlight/rank/hide and tell Jev what it should have been. Recoverability as UI.
- **Styleguide check** — Nouls on a generated block vs voice rules. Pass / flag / don’t show. LLM may propose a rewrite; Jev accepts it.
- **Representing Thinking** — different wait UI for judging vs generating. Stream only when generating.
- **Interactions** — the decision tree as a live toy: submit → Jev → act / confirm / generate / stay quiet.

---

## Later spectacle

Real, but not this site’s argument. Do not start here.

- Mood-as-you-type (scores drive a visual, like the flower)
- Combinatorial pick from a known set (Stefan’s search-over-objects, design-system flags)
- Timeline / video find (transcripts, not frames)
- Live stream filter (chat/comments) if Bot grows a feed

---

## What to steal (and what not to)

From Raksha T’s Jev roundup and TypeSafe cookbooks:

- **Semantic find, not a results page.** Needle: find what you mean; highlight the source; do not generate an answer.
- **Live filter chips.** Rows drop out in real time; a wrong hide can be put back.
- **Rank instead of chronology.** The index stays the index; order is the result.
- **Search as picking from a known set.** Assemble, don’t invent.

Thread rule: no generated answer unless generation is the component.

---

## Build order

1. FAQs (live) — Jev pick still to wire
2. Look At (in-chapter find)
3. Navigation search + chips
4. Bot routing
5. Infinite Article fork
6. Images as caption–prompt judges
7. **Generative Moodboard**
8. Image Generation controls around a single prompt/result, if still needed

1–3 are the same two primitives: rank a closed set, and don’t act when `exists` is low.
