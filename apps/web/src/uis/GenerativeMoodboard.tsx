/**
 * Schematic of the Generative Moodboard as it runs: pre-scored photos laid out
 * on two named axes, a pair picked by the reader, and an image model that
 * blends them into a new tile at their midpoint.
 */
import { MockFrame } from "./Mock";
import { Pipeline, type PipelineSpec } from "./schematics/Pipeline";
import type { UiProps } from "./types";

const PIPELINE: PipelineSpec = {
  stages: [
    {
      steps: [
        {
          role: "source",
          title: "Scored photos",
          detail: "The board starts from photos already scored on ten dimensions.",
          meta: "scored offline with gemini 2.5 flash",
          inside: [
            "Scores are baked into moodboard-seeds.ts; nothing is judged at load.",
            "A Jev scorer (scoreTileAxes) exists but the board does not call it yet.",
            "Each photo's prompt is its caption.",
          ],
          file: "lib/moodboard-seeds.ts",
        },
      ],
      out: "tiles with scores",
    },
    {
      steps: [
        {
          role: "code",
          title: "Lays out",
          detail: "The chosen pair of axes places every tile where it scores.",
          meta: "views: subject, surface, light, framing, mood",
          inside: [
            "Switching view is a relayout, not a regeneration.",
            "Near ties are nudged apart (minimum distance 0.06).",
            "A blend sits at the midpoint of its sources.",
          ],
          file: "uis/directed/GenerativeMoodboard.tsx",
        },
        {
          role: "code",
          title: "Draws tiles",
          detail: "Each tile is a WebGL paper quad that tracks pan and zoom.",
          inside: ["Full-resolution images swap in past a zoom threshold."],
          file: "uis/directed/mood-tile-gl.tsx",
        },
      ],
      out: "the board, pannable and zoomable",
    },
    {
      steps: [
        {
          role: "reader",
          title: "Picks a pair",
          detail: "A click focuses the two nearest photos; a later click swaps the farther one.",
          inside: ["Dragging past a small slop pans instead and clears the pair."],
          file: "uis/directed/GenerativeMoodboard.tsx",
        },
      ],
      out: "two sources",
    },
    {
      steps: [
        {
          role: "code",
          title: "Places a blend",
          detail: "A pending tile appears at their midpoint, with their scores averaged.",
          inside: ["An equal mix: no distance weights yet.", "Only one uncommitted blend at a time."],
          file: "uis/directed/GenerativeMoodboard.tsx",
        },
      ],
      out: "a pending tile",
    },
    {
      steps: [
        {
          role: "code",
          title: "Prefetches",
          detail: "Hovering the pending tile shrinks both photos and starts the blend early.",
          meta: "after 120ms hover · 512px jpeg",
          inside: ["The result is cached by pair, so leaving and coming back is instant."],
          file: "uis/directed/GenerativeMoodboard.tsx",
        },
        {
          role: "reader",
          title: "Commits",
          detail: "Clicking the pending tile asks for the image.",
          inside: ["A failed blend removes the tile rather than leaving a broken one."],
          file: "uis/directed/GenerativeMoodboard.tsx",
        },
      ],
      out: "two photos, one blend request",
    },
    {
      steps: [
        {
          role: "image",
          title: "Blends",
          detail: "Both photos go to an image model with a fixed editorial prompt: an equal mix, one scene.",
          meta: "google/gemini-3.1-flash-image · ai gateway · 2 tries",
          inside: [
            "The prompt asks for adults, fully clothed, no weapons; without it the safety filter blocks about half the blends.",
            "The output is 512px, at the ratio closest to the pair's average.",
            "Paid from AI Gateway credit.",
          ],
          file: "lib/moodboard-mix.ts",
        },
      ],
      out: "the new image, developed onto the tile",
    },
  ],
  loop: "the blend stays on the board and can be mixed again",
};

export default function GenerativeMoodboard(_props: UiProps) {
  return (
    <MockFrame name="generative-moodboard" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} />
    </MockFrame>
  );
}
