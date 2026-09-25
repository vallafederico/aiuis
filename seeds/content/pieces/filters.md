---
title: Filters
slug: filters
section: uis
order: 5
component: filters
tags:
  - jev
  - filter
  - score
---

:::foreword
Every chapter on this site is a ball on the table. Type a need, and the chapters it fits roll to the words.
:::

Filters makes every published chapter of this site a ball you can push, and turns a typed need into a pull that draws the chapters it fits to the search bar.

You might expect a filter to take away what fails. Most do: a checkbox removes rows, and a search swaps the index for a results page. Here nothing is removed. The list is closed, drawn from the chapters the CMS has published, and a search never adds a ball. It only moves the ones already there.

Typing asks Jev once the keys pause for 450 milliseconds. One call carries every chapter, and each gets a single yes-or-no question: does this piece satisfy the reader's rule? The judge sees the title, the summary, the tags, and a plain sentence saying what kind of piece it is. The answer is a probability per ball, and it sorts the table three ways.

A chapter at 0.5 or above passes. It springs to a seat of its own beside the bar, on whichever side it already was, and turns key blue. A chapter below 0.5 is left alone: it keeps whatever motion it had and stays wherever it ends up. When no chapter reaches 0.5, nothing moves at all, and the status line reads "Nothing here is" followed by what you typed.

That third case matters most. A weak best match is still a match, and pulling it in would state a confidence the score does not support. FAQs and Find keep the same rule. A miss is silence, not a confident wrong answer, and the table you were already looking at stays as it was.

The bar works like a magnet under a table of loose balls, and its strength on each ball is that ball's score. A chapter at 0.9 arrives fast and holds its seat firmly. One at 0.55 drifts in and gives way sooner when the pointer shoves it. An earlier draft put a relevance floor slider beside the list, and hard tags above it. The magnet made both redundant. The score is already on screen, as force.

Why balls, and why let the pointer shove them? Shneiderman (1983) argued for interfaces where the object of interest stays visible and actions on it are rapid, incremental and reversible. A results page fails the first test, because the index disappears behind the answer. Here the index is the answer. Every chapter stays on screen, any of them can be pushed, and Escape releases the lot.

The push has to behave like a push, or the manipulation is only decoration. Balls fly in, then run free: they roll with their motion, keep momentum under light drag, collide, and bounce off the walls. The bar is solid, so drawn balls gather in rows around the words and never cover them. The search text, caret and status are drawn on the same WebGL surface as the spheres.

The strongest objection is that motion is a slow way to report a result, and a list is faster to scan. For a long catalog that is right. This one is short and closed, and the question a reader brings is which of these, not what exists. The rows by the bar answer that at a glance.

What stays open is the crowded case: a need so broad that most of the table passes, and the magnet stops saying much. For now another need simply sorts the same balls again.

:::notes
Shneiderman, Ben. Direct Manipulation: A Step Beyond Programming Languages. IEEE Computer, 1983.
One call judges every chapter. A pass is 0.5 or above. When nothing passes, nothing moves.
:::
