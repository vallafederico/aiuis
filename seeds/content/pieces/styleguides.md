---
title: Styleguides
slug: styleguides
section: foundations
order: 2
---

:::foreword
A styleguide used to describe what the designers made. Here it also has to govern what the system writes, draws, and declines to say.
:::

A styleguide for a model-backed interface has to govern what nobody on the team authored: the sentence a model writes, the image it draws, the moment it says nothing. It works less like a pattern library than like the key on a map.

You might think tokens and components already cover this. They cover the frame. A component library fixes the button, the card and the type scale, then assumes the words inside will be written by someone who read the guide. A model has not read the guide, unless the guide reaches it as a constraint it cannot step outside.

Colour is the plainest case. The site runs on one key, #0000ff, and one paper, #E9E9EA, and every other value hangs off the key. When the Infinite Article asks an image model for a plate, the prompt names both values and asks for blue pencil on a flat ground. Pixels that come back in any other colour are snapped to paper. The palette is enforced after generation, not merely requested before it.

A map key lists the marks a reader will meet and says what each one means. A model-backed interface adds four marks the old guide never listed: judging, generating, unsure and silent. Each needs its own look, and the first two must never share one. A judgment gets no wait chrome: Filters scores every chapter in one call, and the balls simply move. Generation gets honest chrome instead: the bleed around the sketch pad while a render is drawn, a moodboard blend developing out of the key blue, an article section painting while it is still being written.

Unsure and silent are the marks most guides leave out. In Filters, unsure is drawn as weak force: a chapter at 0.55 drifts toward the bar and gives way when pushed. Silent is drawn as nothing. When no chapter reaches 0.5, no ball moves, and the status line reads "Nothing here is" followed by the need. The table stays as it was: a designed state, not a missing one.

The system's own sentences belong in the key as well, and they are short. A question that runs too long gets "Shorter, please" in reply. One off the subject gets "That's outside what this site is about." The rules the site is written by are the rules it hands its models: no em dash, no sentence over 40 words, no invented source or number. The article writer's prompt forbids dashes, and the analytic captioner may copy a number but never compute one. A voice rule a model can break is a suggestion. One the write path rejects is a style.

Type sits on the same surface as what it labels. The search text and caret in Filters are drawn in WebGL beside the balls, as multi-channel signed distance fields of Alte Haas Grotesk, so the words belong to the scene and bend under the same pointer lens. Models, thresholds and timings in the schematics are set in Chivo Mono. The split tells a reader which text the site wrote and which text reports on the machine.

Motion is the last entry in the key, and the easiest to misuse. Michotte (1946) showed that viewers read cause into timing alone: one square stops, the next starts, and people see a push. Heider and Simmel (1944) found that viewers told stories of intent about moving triangles. Motion will be read as meaning whether or not it carries any, so each motion here encodes a quantity. The spring that pulls a ball to the bar is its score. A chapter at 0.9 arrives fast and holds its seat.

The strongest objection is that a guide this strict makes generated output bland. Sometimes it does. So the key also says where it stops. Moodboard photographs keep almost all of their own colour, shifted a tenth of the way toward a key tint so they sit on the paper. Forced into two tones, a photograph would stop being evidence of what it shows.

What stays open is the model that speaks at length. A status line is easy to keep in key. A streamed section can pass every check for dashes and sentence length and still sound like nobody.

:::notes
Michotte, Albert. The Perception of Causality. Methuen, 1963. First published in French, 1946.
Heider, Fritz, and Marianne Simmel. An Experimental Study of Apparent Behavior. American Journal of Psychology, 1944.
Plates are drawn in #0000FF on #E9E9EA; any other pixel is snapped to paper.
:::
