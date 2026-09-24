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
Two named axes, images sitting where they score, and a click in empty space as the request for a new one.
:::

The Generative Moodboard makes the board the prompt: two named axes, images placed where they score, and empty space as the generate verb.

The pattern has ancestors: latent-space walks, interpolation sliders, scatterplot moodboards, "between A and B" controls. What is different here is that the axes are readable dimensions, not a latent blob. Shneiderman (1983) argued for interfaces where the object of interest stays visible and actions on it are incremental and reversible. A prompt box fails that test; a board where every image wears its coordinates meets it. Attribution is geometric. You can see why an image appeared where it did, because where it is says what it scored.

Clicking a gap asks for a mix of the two nearest images, weighted by where you clicked, and the rules are strict about what a click can mean. If the two nearest sit on different axes, the new image takes one coordinate from each: a quadrant fill. If they sit on the same axis at different values, the mix interpolates that axis and holds the other. If one image is much closer than any other, the click is a variation of that image toward the point, and the board says so rather than pretending it mixed two. And inside a dense cluster the click does nothing. The board is already speaking there, and restraint is part of the contract.

The roles split the way they do everywhere on this site. A judgment scores each image once on four or six dimensions, from prompt and caption, later from a vision pass on the pixels. The two axes on screen are just the pair you are looking at; swapping axes is a relayout, not a regeneration. On a click, the judgment returns the two nearest sources and a mix recipe: weights from distance, and whether this is an along-axis or a cross-axis blend. The image model draws from that recipe. A language model enters only if the recipe needs a written prompt, and often stitching the two source prompts in code is enough.

Generation is the point of this component, so the generate path gets honest chrome. While the image is drawn, the board shows the two sources and the mix weights, which is the wait state saying what is being made and from what. The judgments around it stay silent, as they should. A cold board starts three ways: generate the four corners from the axis extremes, drop in a few references and let the judgment place them, or name two axes and generate the corners from the names. After that, the board fills its gaps, and gap-filling is the actual interaction.

The axes that fit this site are its own tensions: prompt-faithful to surprising, sparse to dense, documentary to generated-looking. The reader can rename them. Two more verbs complete the loop: drag an image to disagree with its placement, which is correction, and double-click one to iterate it in place. When the board is dense enough, the empty space is gone, and so is the verb. Stopping is built into the surface.

:::notes
Shneiderman, Ben. Direct Manipulation: A Step Beyond Programming Languages. IEEE Computer, 1983.
Placement scores are computed once over four to six dimensions; the visible axes select which pair is on screen.
:::
