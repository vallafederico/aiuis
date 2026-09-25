---
title: Principles
slug: principles
section: foundations
order: 3
---

:::foreword
Six tests a screen can fail, each learned from a prototype on this site that failed it first.
:::

Six principles hold across the prototypes on this site: legibility, interruptibility, recoverability, attribution, calibration, and restraint. Each is written as a test a screen can fail, because a principle nothing can fail is a mood.

You might expect the principles to come first and the prototypes to follow. The order ran the other way. Each principle below is what was left standing after a prototype broke, stated as a test and paired with the component that taught it. They run in the order a reader meets them, from first contact to long use.

**Legibility.** From the screen alone, a reader can tell which kind of work is happening: judging, generating, or none. Norman (1988) called the distance between what a system did and what a person can perceive of it the gulf of evaluation. One spinner over every kind of work widens it. Filters shows a judgment as movement, with no wait chrome at all, while Sketch Generation gives its render a visible bleed and a developing image. The test fails when both paths look the same.

**Interruptibility.** The reader can stop work in flight with a gesture they were already making, at no cost. Drawing again on the sketch pad cancels the render under way. Selecting new text in the Infinite Article cancels the margin note being written. Escape releases every ball in Filters. Horvitz (1999) listed efficient invocation and termination among the principles of mixed-initiative interfaces. The test fails when a modal "generating" state locks the canvas.

**Recoverability.** Any state the system produces can be left, and the state before it is still within reach. Switching views on the Generative Moodboard is a relayout, not a regeneration, so the photographs return to where they were. A follow-up in Type an Analytic edits the board instead of replacing it: "drop the chapters" removes one widget and keeps the rest. The test fails when leaving a result means asking the model to make it again.

**Attribution.** Every selected or generated thing names its source, in a place the reader already looks. A FAQ answer ends "From" and its chapter. Each analytic widget lists its metrics, its source and any gap in what that source covers. A moodboard blend sits at the midpoint of its two photographs, so its place is its citation. The test fails when a source is available but kept behind a click.

**Calibration.** The strength of the display matches the strength of the evidence. Lee and See (2004) argue that trust in automation is appropriate when it tracks actual reliability, and that overtrust and distrust both cost. In Filters the pull on each ball is its score, so a chapter at 0.9 arrives fast and one at 0.55 drifts. FAQs opens an existing row only when the duplicate judgment clears 0.7 and the pick's confidence clears 0.5. The test fails when fluent prose rests on weak retrieval.

**Restraint.** When the honest output is nothing, the screen shows nothing new. A FAQ question the index does not cover adds no row. A need that no chapter meets moves no ball. An empty sketch pad makes no request, and the Infinite Article stops after three failed streams. Horvitz (1999) also asks a system to weigh the cost of a poor guess against doing nothing. The test fails when a weak best match is shown as an answer.

The strongest objection is that calibration and restraint are one principle. They answer different questions. Calibration decides how strongly to show something, and restraint decides whether to show it at all. A chapter at 0.55 drifting toward the bar is calibration. No ball moving, because nothing reached 0.5, is restraint. A design can pass one and fail the other, which is the reason to keep them apart.

The last phase is the least tested. FAQs remembers up to 32 answers in a single browser, and none of these principles yet says what that memory owes the reader over months. Long use is where the next principle will come from, if it comes from anywhere.

:::notes
Norman, Donald A. The Psychology of Everyday Things. Basic Books, 1988. Later published as The Design of Everyday Things.
Horvitz, Eric. Principles of Mixed-Initiative User Interfaces. Proceedings of CHI, 1999.
Lee, John D., and Katrina A. See. Trust in Automation: Designing for Appropriate Reliance. Human Factors, 2004.
:::
