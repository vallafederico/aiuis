---
title: Generative Moodboard
slug: generative-moodboard
section: uis
order: 3
component: generative-moodboard
tags:
  - image-model
  - axes
  - mix
---

:::foreword
Two named axes, photographs sitting where they score, and a pair you pick as the request for what lies between them.
:::

The Generative Moodboard makes the board the prompt: two named axes, photographs placed where they score, and a pair of them as the request for what lies between.

It is tempting to file this under latent-space walks with better styling. The pattern does have ancestors, those walks among them, along with interpolation sliders, scatterplot moodboards, and "between A and B" controls. The difference is that these axes are readable words, not a latent blob: still-life to portrait, quiet to glamorous, warm to cool, staged to candid. Read the board as a map. Shneiderman (1983) argued for interfaces where the object of interest stays visible and actions on it are incremental and reversible. A prompt box fails that test. A board where every image sits at its own coordinates meets it. Attribution is geometric: you can see why a photograph is where it is, because its place says what it scored.

The scores come first, and they come once. Every photograph is scored on ten dimensions before the board loads, and nothing is judged while you look. Five views choose which pair of dimensions is on screen: Subject, Surface, Light, Framing, Mood. Switching view is a relayout, not a regeneration. The map is redrawn, and the territory stays put.

The verb is a pair. Hold still over the board and the two nearest photographs come forward while the rest fade back. Drag instead, and the board simply pans. A second click swaps the farther of the two for the one under the cursor. Between them a placeholder appears at their midpoint, carrying the average of their scores. Nothing is generated yet. The request sits on the board, visible, until you click it.

Generation is the point of this component, so the generate path gets honest chrome. Clicking the placeholder sends both photographs to an image model with one fixed editorial brief: an equal mix, a single scene, not a collage. The board glides until the new tile sits at the centre, and while it is drawn that tile rides above every other. The blend then develops out of the key blue and stays, placed where its sources put it, ready to be mixed again.

The strongest objection is that an equal mix is a blunt instrument. It is, for now. The richer rules are designed but not yet on the board: a click in empty space that fills a quadrant, blends along one axis, varies a single close image, or does nothing inside a dense cluster. Weights from distance and a visible recipe belong with them. Until those land, the board keeps its promise the simple way. Every blend names its two sources by where it sits.

Two more verbs are planned: drag an image to disagree with its placement, and double-click one to iterate it in place. The pan already stops short of losing the photographs off screen, so the map never becomes empty ocean. What the board leaves open is the harder question: which pairs are worth asking for, and when the board is full.

:::notes
Shneiderman, Ben. Direct Manipulation: A Step Beyond Programming Languages. IEEE Computer, 1983.
Every photograph is scored once, on ten dimensions, before the board loads; the five views choose which pair is on screen.
:::
