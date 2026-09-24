---
title: Type an Analytic
slug: type-an-analytic
section: uis
order: 6
component: type-an-analytic
tags:
  - language-model
  - generation
  - prompt
---

:::foreword
Type what you want to know about this site. A dashboard is written for it, and filled with the site's real numbers.
:::

A dashboard is usually a decision somebody made months ago about what you would want to know. Type an analytic turns that around. The board starts empty, and a sentence brings one into existence: a title in your terms, a lead figure, a trend, a ranking, a ratio nobody thought to chart. "What does a reader cost us in AI" becomes AI spend divided by visitors, per thousand, beside the models that spent it.

The generation is in the arrangement, never in the numbers. A language model reads the need and writes the board: which metrics, which kinds of widget, how large, whether to compare with the period before, which two numbers to divide. It writes that plan before any number exists. Code then fetches every figure from its source: Cloudflare's analytics for the zone, the AI Gateway's spend report, Workers AI's neuron counts, the site's own catalog. Only then does the model caption the board, from a digest of what came back. It may copy a number; it may not compute one.

Loose words are read generously. "Is anyone out there" is visitors and countries. "Are we broke" is spend against the credit left. "Vibes" gets a varied board and a note saying how it was read. A need the site cannot answer, the weather in Milan, gets the nearest honest board and a sentence saying what the site cannot see. Nothing is refused, and nothing is invented. When a source is missing, its widget says what it needs instead of drawing an empty chart as if it were data.

Every board shows its working. Under the title sits the thread of needs that shaped it and one line on how the last was read. Under each widget sit the metrics, the source, and any gap in what the source could cover. The next sentence edits the board rather than replacing it: "monthly", "drop the chapters", "and per call". The range stays a direct control, and changing it re-fetches the numbers and rewrites the captions without redesigning the board. Shneiderman (1983) wanted the object visible and the action incremental and reversible. The board is the object; each sentence is one increment.

The site shows its own numbers in public, including what its AI costs to run. That is the argument of the project in one component: an interface that writes itself should still be willing to show where every figure came from.

:::notes
Shneiderman, Ben. Direct Manipulation: A Step Beyond Programming Languages. IEEE Computer, 1983.
The model plans the board and captions it. Every number is fetched by code; captions may only repeat figures from the fetched digest.
:::
