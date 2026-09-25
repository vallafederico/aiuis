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

Status lives in `apps/web/src/lib/publish.ts`: published pieces are on the deployed site, drafts only in dev.

### Infinite Article — draft

At the end of a section, Choice: continue / deepen / aside / stop. Noul “are they still with this thread?” gates generation. LLM writes the next block. Split Choice → two ghost openings; generate the one they scroll into.

### Generative Moodboard — live

Now a chapter. The board is the prompt: two named axes, empty space as the generate verb. Full notes in the [Generative Moodboard](#generative-moodboard) section below.

### Sketch Generation — live

Draw on the pad. The site holds a closed set of prompts (short labels on screen; full text hidden until after generate). Empty pad stays quiet. Generate steers the render from sketch + chosen brief. Sketch stays beside the result; prompt shows as provenance after the fact.

**Visual center:** pad + result side by side. Marks are the ask. Wait chrome only on generate.

**Built:** one WebGL2 canvas spans the demo (`sketch-generation-gl.ts`); pad and result are two viewports. Strokes are instanced capsules stamped into an ink framebuffer, width from speed (or pen pressure). There is no generate button: a thin meter fills with ink, and once it is full (about 3 pad short sides of stroke, 2+ strokes) a 1.5s rest starts the render. Drawing again after a result needs less new ink; drawing during the wait drops the stale request. Chips pick the brief; switching a chip with a sketch on the pad renders again.

On generate the ink is snapshotted and blurred into proximity fields. Those fields paint a procedural underpainting per brief (masses, light, cast shadow, grain). The model gets the strokes as a plain line drawing, cropped to the drawing area, and edits from it with FLUX.2 [klein] 9B on Workers AI (reference image plus an instruction to keep the drawn composition; output at the drawing's aspect, 1024 px long side). Compared on the same sketch, klein 9B followed the composition best and answered in about 2–3 s; klein 4B took about 7–10 s and [dev] about 14 s with softer results, and feeding them the underpainting made them copy its embossed look. On error the server tries klein 4B, then `stable-diffusion-v1-5-inpainting` with the underpainting as init image (full mask, strength 0.75, so it acts as img2img). Without the binding, or if every model fails, the underpainting is the result, labelled "procedural". Wait: strokes bleed along a noise flow field under a scan band, while the pad strokes are re-read in drawn order. Arrival: the image develops outward from the ink, with a key-blue edge, then the overlaid strokes fade. Reduced motion is a crossfade. Hidden prompt pack and server call in `lib/sketch-generation.ts`.

### Filters — stub (Wave 4)

Hard tags cut exactly. Soft chips are typed Nouls; rows recede, then hide past a floor. Type a sentence to name a new chip when confidence is high; otherwise silence. Put-back for a bad chip. Floor is a mixing desk over stored scores (no extra call). Search ranks; filters cut. Same list.

**Visual center:** chip row + opacity choreography on the catalog. Not a results page.

**Reuse:** `catalog-search` / Images chip + floor patterns; seed catalog can be the Images tiles or the piece index.

**Build:** live MockFrame in `Filters.tsx` (stub layout already). Jev for soft chips + typed-chip naming. Literal hard tags without a key.

### Type an Analytic — generative dashboard (directed)

Type an analytic; a language model writes a dashboard for it and code fills it with the site's real numbers. Loose or random words get a generous reading, impossible asks get the nearest honest board plus a note. The model never supplies a number.

**Metrics:** ~22 in `lib/dashboard.ts` (series, breakdowns, scalars, one list) across Cloudflare traffic, AI Gateway + Workers AI usage, and the content catalog.

**Flow:** `POST /api/dashboard` streams SSE (`lib/dashboard-compose.ts`). 1) Gemini 2.5 Flash writes the board (`Output.object`): title, reading, range, 3–6 widgets of kind number / trend / ranking / ratio / list / note, sizes s / m / l, `compare`, ratio `scale` + `per`. Drafts stream so tiles form as it writes. With a current board, the need edits it. 2) Widgets resolve in parallel, each streamed as it lands. 3) A caption pass writes the headline + one line per widget from `digest()` only. At most two widgets may use a source that is not configured. Range toggles re-fetch + recaption without redesigning.

**Data:** `lib/dashboard-data.ts`, 5-minute per-isolate cache, previous-period windows for `compare`. Cloudflare GraphQL (`httpRequests1dGroups` / `1hGroups`, `httpRequestsAdaptiveGroups` for pages + devices, `aiInferenceAdaptiveGroups` for neurons) with `CF_ANALYTICS_TOKEN`; zone + account are looked up from the site host. AI Gateway `getSpendReport` + `getCredits` with `AI_GATEWAY_API_KEY`. Workers AI cost is neurons × list price, before the daily free 10k. A missing key or failed source reads as an `unavailable` panel.

**Chrome:** the thread of needs and the model's reading under the title; metrics, source and coverage gaps under each widget. Board persists in localStorage and re-fetches on load.

**Open:** the gateway key is team-wide, so spend includes other projects until the site's calls are tagged and the report filters by tag. Jev spend has no API yet.

---

## Parked — brainstorm only, not in the CMS

These were `/uis` chapters. They didn't hold up as components, so they live here to be worked through, not on the site. The prototypes are still in `apps/web/src/uis` (`Find.tsx`, `Navigation.tsx`, `Images.tsx`), unrouted since the pieces were archived.

### Find

Site-wide needle (⌘F). Query → spans light up by probability, anywhere on the site. Choice over paragraph IDs + Noul `exists`. Empty if `exists` is low: a miss is silence, not a bogus #1. Attribution is the highlight; there is no summary unless the reader asks, and then the LLM still cites the span Jev picked. Same closed-set rank primitive as catalog search. Vision later if the target is an image.

Absorbs the old Look At chapter (needle on a single chapter); site-wide is the same primitive over a larger set. Still the smallest honest prototype: text, a query, a focus field whose intensity is a number.

The archived chapter text, kept for reference:

> ⌘F on this site matches meaning, and it answers by lighting up what was already written, or by staying dark.
>
> Find is the site-wide needle: ask for a passage in your own words, and the paragraphs that carry it light up, or nothing does.
>
> The browser's find-in-page is one of the last honest search interfaces. It matches the exact string, shows every hit in place, and reports zero when there is none. Its one failure is literalness: change a word and the passage you remember stops existing. Find keeps that contract and loosens only the matching. The query is read for meaning, the answer is still a location in the text, and a miss is still a miss.
>
> The mechanics are a closed set and two judgments. Every published paragraph has an ID. A Choice ranks those IDs against the query, and a Noul answers whether a covering passage exists at all. When it does, the source paragraph is highlighted, and the intensity of the highlight is the probability the judgment assigned. Nothing is written. The result is a place on the site, and the attribution is the highlight itself.
>
> The exists gate is what makes silence possible. A ranking over a closed set always returns an order, so left alone it will always nominate a first hit, however poor. That is the failure mode of most semantic search: a confident answer where the honest answer is no. Here a weak `exists` keeps the page dark. A miss is silence, not a bogus first result.
>
> This is the same primitive as the catalog search on the navigation: rank a closed set, and do not act when the judgment is weak. The two are one mechanism with two grains. The nav asks which piece; Find asks which passage. Neither invents a hit, and neither needs a results page, because the index and the article are already on screen. The order, or the highlight, is the result.
>
> An earlier chapter, Look At, ran this needle inside a single chapter: one piece of text, one query, a focus field whose intensity is a number. Find absorbs it. Site-wide is the same primitive over a larger set, and the smaller version had no argument the larger one lacks. The one deferred part survives the merge: when the target is an image rather than a paragraph, a vision pass will score regions the way the Choice scores text. Generation stays out of the loop. If the reader asks for a sentence about a hit, a language model may write one, and it still cites the span the judgment picked. The needle finds; it does not speak first.

Tags were `jev`, `needle`, `exists`.

### Navigation

The live nav is already the experiment (“what is in play”). Search reorders pieces; chips cut scope; breadcrumb is context for both reader and model. Weak `exists` leaves order alone.

Archived chapter text:

> Navigation in an AI-assisted interface is partly about wayfinding and partly about scope management: telling the system what is in play and what is not. This chapter examines how persistent navigation structures, breadcrumbs, and context panels do double duty as both user controls and model context.
>
> The navigation on this site is an instance of the patterns described here; you are looking at the experiment.

Tags were `jev`, `rank`, `exists`.

### Images

Filter/rank a grid by caption, prompt, and provenance tags. Soft chips: generated vs documented, prompt-gap, off-brief. Vision scores “does this image match the prompt?” Provenance stays visible; models only order and cut.

Archived chapter text:

> Generated images raise questions that stock photography did not: provenance, consistency across a session, and the gap between what was asked and what was produced. This chapter proposes an image component that makes that gap legible rather than hiding it behind a polished result.
>
> All images in this thesis were generated; captions carry the prompt and model identifier.

Tags were `provenance`, `prompt`, `score`.

### Image Generation

Prompt-to-control, not prompt-to-pixels. Choice: iterate / vary / stop. Surface the next slider from the prompt. Prototype remains in `ImageGeneration.tsx`; parked in favor of Sketch Generation for the next build.

Archived chapter text:

> Designing the interface for image generation is a different problem from designing the image generator. This chapter focuses on the prompt-to-image loop: how to write prompts, how to read results, how to iterate, and how to know when to stop, plus what the UI can do to support each step.

Tags were `image-model`, `prompt`, `iteration`.

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

- still-life ↔ portrait (human presence)
- quiet ↔ glamorous (editorial styling)
- sparse ↔ dense
- organic ↔ technical (materials/props)

**Other verbs:** drag an image to disagree with Jev’s placement (correction). Double-click an existing one to iterate in place. Stop when the board is dense enough.

Fits the Image Generation chapter’s loop (iterate, know when to stop) as its own `/uis` piece, not as a prompt box plus a result.

---

## New components worth a chapter

- **Filters** + **Type an Analytic** — next build (Wave 4). See stubs above.
- **Inbox / rank** — same list, importance instead of nav order. Ranking as the default, not a search mode.
- **Command palette** — natural language → typed action (open piece, apply chip, find span). Overlaps Type an Analytic; prefer Type an Analytic when the answer is a control, palette when the answer is navigation.
- **Smart drop** — drop a tag, quote, or image onto a piece; Jev picks the slot (related / evidence / discard).
- **Attention overlay** — Find without a query: pointer + viewport as state. Visual (light field).
- **Feed stamp** — confidence stamp on each row as you scroll (shipwithjev Feed Lens / slop filter).
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

1. FAQs (live)
2. Find / Navigation / Images / Image Generation — parked (prototypes remain)
3. Infinite Article (draft)
4. Generative Moodboard (live)
5. **Sketch Generation** (live)
6. **Filters** (stub → Wave 4)
7. **Type an Analytic** (stub → Wave 4; control set shared with Filters)

Wave 4 reuses: rank a closed set, soft Nouls, exists gate, opacity as first response. Sketch Generation is generate-when-needed with the sketch as the visible ask.
