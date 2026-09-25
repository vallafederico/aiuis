---
title: Interactions
slug: interactions
section: foundations
order: 4
---

:::foreword
A model answers in seconds, not milliseconds, and not the same way twice. These are the gestures this site uses to spend that gap.
:::

Six interactions recur across the prototypes on this site: typing a need, pulling instead of listing, pausing, putting back, pressing and hovering, and scrolling to generate. Each exists because a model's answer is neither instant nor certain, and each trades something away to cope with that.

Nielsen (1993) set three limits for response time: 0.1 second to feel instant, 1 second to keep the flow of thought, 10 seconds to hold attention at all. A model call routinely lands between the second limit and the third. Every pattern below is a way of spending that gap.

**Typing a need.** The reader types what they want in their own words, not a query and not a prompt. Filters, FAQs and Type an Analytic all take a plain sentence, and the last two cap it at 240 characters. The trade is vocabulary. A need is loose, so the system must read it generously and then say how it read it. Type an Analytic writes one line under its title on how the last need was taken, and a need it cannot answer gets the nearest honest board with a sentence on what the site cannot see.

**Pulling instead of listing.** A result can arrive as a new list, or as movement among things already on screen. Filters does the second: passing chapters spring to the search bar and the rest stay where they are. Shneiderman (1983) wanted the object of interest to stay visible, and a results page hides the index behind the answer. The trade is scanning speed. For a long catalog a list is faster. For a short, closed set the pull answers "which of these" at a glance.

**Pausing.** On this site the trigger is usually a pause, not a button. Filters asks once the keys have been still for 450 milliseconds. Sketch Generation arms 1.5 seconds after the pen lifts, and only if the pad holds enough ink: 3.2 short-side lengths for a first image, 1.2 to revise. The trade is timing. Too short, and the system fires on half a thought and spends a call on it. Too long, and the page feels dead. The ink threshold matters as much as the delay, because a pause over nothing is not a request.

**Putting back.** Reversal here is mostly release and cancellation, not an undo stack. Escape lets every ball go. Drawing again cancels a render in flight. Moving on from a moodboard pair drops its uncommitted blend. The trade is cost. A generated result is paid for and will not come back the same, so a put-back must keep the old output, never regenerate it. Of the six, this pattern is the least finished.

**Pressing and hovering.** The pointer carries intent before it clicks. The site's lens grows with pointer speed, and grows again when a press is held for 280 milliseconds, so a plain click never enlarges it. On the sketch pad the lens switches off while the pen is down, so strokes land where they are drawn. Resting 120 milliseconds on a pending moodboard blend starts the request early. The trade is ambiguity. Hover may start cheap work, and only a click commits, because touch screens have no hover.

**Scrolling to generate.** In the Infinite Article, reaching the end writes the next section, steered by how the last one was read. Lingering 18 seconds or scrolling back asks for depth, an instance or an objection, and skimming in under 7 asks the essay to advance. The trade is deliberateness. Scrolling is the least intentional gesture on a page, so the article arms again only after the reader leaves the end and returns. It stops for good at 40 sections.

The strongest objection is that one chat box would serve every case. It would, at a price. Chat routes every intent through typing and waits for a whole turn. A pause, a push or a scroll can carry intent a sentence would take ten seconds to state.

The patterns share one open question. Most of them read intent from behaviour the reader did not mean as a request. Only Type an Analytic says, on screen, what it took the request to be.

:::notes
Nielsen, Jakob. Usability Engineering. Academic Press, 1993.
Shneiderman, Ben. Direct Manipulation: A Step Beyond Programming Languages. IEEE Computer, 1983.
:::
