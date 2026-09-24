---
title: Sketch Generation
slug: sketch-generation
section: uis
order: 4
component: sketch-generation
tags:
  - image-model
  - prompt
  - sketch
---

:::foreword
You draw. The site holds the prompt. The image is a reading of the sketch under that hidden brief.
:::

Most image UIs put the prompt in the foreground and treat drawing as an advanced mode. Sketch generation reverses that. The reader’s mark is the input you see. The prompt is chosen by the site and kept back until after the image exists, so the sketch carries the intent and the brief only steers the render.

The contract is select-then-generate, not chat. A small closed set of prompts sits behind the pad: still life under soft light, portrait against a plain field, interior with a single window. The interface picks one (or the reader picks from short labels that do not reveal the full text). Generation runs only when there is a mark on the pad. An empty pad stays quiet. Wait chrome belongs on the generate path alone.

Attribution stays visible when the image lands. The sketch remains beside the result. The prompt is shown as provenance after the fact, the way a caption names the model. That order matters. If the full prompt were editable up front, the sketch would become decoration. Here the sketch is the ask, and the hidden brief is a constraint the site applies, not a second conversation.

The pattern fails when the brief invents detail the sketch never offered, or when the pad is only a stamp over a text prompt. Restraint means the render should follow the marks that are there. Iteration can clear the pad, keep the same brief, or swap the brief without rewriting a paragraph. Stopping is leaving the last pair of sketch and image on screen.

:::notes
The prompt set is closed and site-authored. Generation waits for a mark. Empty pad is silence.
:::
