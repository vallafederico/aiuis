# UI experiments

Working notes for live `/uis` components. The chapters are mock frames until a prototype replaces them. The argument is not “add AI to the UI.” It is judgment at interaction timing, uncertainty as chrome, and select-don’t-generate unless generation is the point.

Buttons assumed a system that was fast, deterministic, and silent about uncertainty. Most LLM UIs invert all three. These experiments try to invert that again.

**Principles** (from the Foundations chapter): legibility, interruptibility, recoverability, attribution, calibration, restraint.

**Roles**

| Layer | Job |
| --- | --- |
| Code | Loop, AND/OR, order, whether anything disappears, URL |
| Jev (TypeSafe) | Rank, filter, route, find, confidence, “should chrome appear?” (~150ms) |
| LLM | FAQ answers, infinite-article prose, prompt rewrite, captions |
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

### Find

Site-wide needle (⌘F). Query → spans light up by probability, anywhere on the site. Choice over paragraph IDs + Noul `exists`. Empty if `exists` is low: a miss is silence, not a bogus #1. Attribution is the highlight; there is no summary unless the reader asks, and then the LLM still cites the span Jev picked. Same closed-set rank primitive as catalog search. Vision later if the target is an image.

Absorbs the old Look At chapter (needle on a single chapter); site-wide is the same primitive over a larger set. Still the smallest honest prototype: text, a query, a focus field whose intensity is a number.

### Navigation

The live nav is already the experiment (“what is in play”). Search reorders pieces; chips cut scope; breadcrumb is context for both reader and model. Weak `exists` leaves order alone.

### Infinite Article

At the end of a section, Choice: continue / deepen / aside / stop. Noul “are they still with this thread?” gates generation. LLM writes the next block. Split Choice → two ghost openings; generate the one they scroll into.

### Images

Filter/rank a grid by caption, prompt, and provenance tags. Soft chips: generated vs documented, prompt-gap, off-brief. Vision scores “does this image match the prompt?” Provenance stays visible; models only order and cut.

### Generative Moodboard

Now a chapter. The board is the prompt: two named axes, empty space as the generate verb. Full notes in the [Generative Moodboard](#generative-moodboard) section below.

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

- **Filters** — mixing desk: hard tags + soft Nouls + floor. AnyFilter / Dev Ed pattern, from [Raksha’s roundup](https://x.com/rakshaa_t/status/2101950814545961082), on this catalog.
- **Inbox / rank** — same list, importance instead of nav order. Ranking as the default, not a search mode.
- **Command palette** — natural language → typed action (open piece, apply chip, find span) with confidence gates.
- **Smart drop** — drop a tag, quote, or image onto a piece; Jev picks the slot (related / evidence / discard).
- **Attention overlay** — Find without a query: pointer + viewport as state.
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
- Combinatorial pick from a known set ([Stefan, when a designer gets access to Jev](https://x.com/heystefan_/status/2101369117496521042): search over objects, design-system flags)
- Timeline / video find (transcripts, not frames)
- A picture that recomposes when the frame changes ([Runway Labs](https://x.com/runwayml_labs/status/2102035097436455021))

---

## What to steal (and what not to)

Keep the original post next to the idea.

- [Raksha T — Jev use cases saved from X](https://x.com/rakshaa_t/status/2101950814545961082)
- [Stefan — when a designer gets access to Jev](https://x.com/heystefan_/status/2101369117496521042), quoted at the top of that thread
- [Jonathan Moore — speaking a layout into place](https://x.com/Moore/status/2102078191758102998)
- [Peng Zheng — semantic autocomplete](https://x.com/pengzheng_/status/2102069593485238508)
- [Runway Labs — responsive generative video](https://x.com/runwayml_labs/status/2102035097436455021)
- TypeSafe cookbooks: [semantic find](https://docs.typesafe.ai/cookbooks/semantic_find.md), [rerank](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)

From [Raksha’s roundup](https://x.com/rakshaa_t/status/2101950814545961082) and those cookbooks:

- **Semantic find, not a results page.** Needle: find what you mean; highlight the source; do not generate an answer.
- **Live filter chips.** Rows drop out in real time; a wrong hide can be put back.
- **Rank instead of chronology.** The index stays the index; order is the result.
- **Search as picking from a known set.** Assemble, don’t invent.

Thread rule: no generated answer unless generation is the component.

From [Peng Zheng](https://x.com/pengzheng_/status/2102069593485238508), semantic autocomplete. Two clips, same loop: a loose phrase completes into something the system already knows, while you are still typing.

- “go to the cafe…” becomes “the cafe I went to last week with Alex Morgan,” with a small probability mark while it settles, then a concrete line (“Blue Bottle Coffee”) once you take it.
- “add … and my fi…” completes into a named file, with the source’s icon on the suggestion. The ghost text is a match, not a new sentence.

Steal the ghost completion and the probability on it. The closed set is this catalog: pieces, tags, spans. A weak match stays blank. Accepting writes the match into the query. It does not generate the weekend plan, or a new document.

From [Jonathan Moore](https://x.com/Moore/status/2102078191758102998), speaking a layout into place (Jev, shadcn, a local transcription model):

- **Point, then speak.** The pointer names the target. The sentence is the verb (“add an email input”, “make the button full”). The model does not have to guess which element.
- **One change.** The prompt says so, and the trace enforces it: hear the request, read the canvas, choose an action and a target, apply, stop.
- **The trace is the wait.** A side panel writes the steps as they happen — heard words, canvas context, “evaluating”, “awaiting the result”, then “Applied” with what changed. Judging and building are different lines. No spinner standing in for both.
- **Name the target on the thing.** While it decides, the chosen element wears its label (“Send button”). You can see what it thinks you meant before the edit lands.
- **Pause to apply.** Listening is a state you can stop. Apply is a separate act, so a bad hearing does not have to become a change.

Steal the loop, not the product. This site does not speak new components into a blank canvas. The useful part is a pointed target plus a verb, and a trace that keeps hearing, judging, and applying apart. Voice and typing are the same input.

From [Runway Labs](https://x.com/runwayml_labs/status/2102035097436455021), responsive generative video. The opening clip is a painted ski slope. Wide, it holds three numbered markers: the lift, the trees, the run. The frame is dragged tall, and the same slope restacks into a vertical picture: lift on one side, run down the middle, trees on the other. The picture answers the new frame.

Steal the constraint, not a generated operating system. On this site the grid already changes with the viewport. A generated image can do the same: the axes, the tags, and the sources stay put, and the picture recomposes for the frame it is in. That belongs with Images and the moodboard, after those exist. The thread goes on past this clip.

---

## Build order

1. FAQs (live) — Jev pick still to wire
2. Find (site-wide ⌘F needle)
3. Navigation search + chips
4. Infinite Article fork
5. Images as caption–prompt judges
6. **Generative Moodboard**
7. Image Generation controls around a single prompt/result, if still needed

1–3 are the same two primitives: rank a closed set, and don’t act when `exists` is low.
