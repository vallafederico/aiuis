/**
 * Schematic of Filters: how the component page (directed/Filters.tsx) turns
 * a typed need into balls drawn to the bar.
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
          title: "A closed list",
          detail: "The published chapters of this site, straight from the CMS, one ball each.",
          meta: "title · summary · tags",
          inside: ["The same list the sidebar reads.", "A search never adds a ball; it only moves them."],
          file: "lib/filters.ts",
        },
      ],
      out: "a ball per chapter, at rest on a ring",
    },
    {
      steps: [
        {
          role: "reader",
          title: "Types a need",
          detail: "The bar asks once the typing pauses. Escape lets every ball go.",
          meta: "after 450ms",
          file: "uis/directed/Filters.tsx",
        },
        {
          role: "jev",
          title: "Judges every row",
          detail: "One yes-or-no judgment per chapter, all in a single call.",
          meta: "jev · one noul per row",
          inside: [
            "The judge sees each row's title, summary, tags and kind.",
            "If no row passes at 0.5, nothing moves: a weak match is not a wrong filter.",
          ],
          file: "lib/catalog-search.ts",
        },
      ],
      out: "a score per ball",
    },
    {
      steps: [
        {
          role: "code",
          title: "Pulls and pushes",
          detail: "A passing ball springs to the bar, harder the higher it scores. The rest drift out.",
          meta: "springs · collisions · walls",
          inside: [
            "The bar is solid: balls gather around the words, never over them.",
            "Each ball rolls with its motion, then turns its title back to you at rest.",
          ],
          file: "uis/directed/Filters.tsx",
        },
        {
          role: "code",
          title: "Draws the spheres",
          detail: "Each ball is a WebGL quad on a DOM circle, shaded as a lit sphere with its title printed on.",
          file: "uis/directed/filter-ball-gl.ts",
        },
      ],
      out: "the answer, gathered at the bar",
    },
    {
      steps: [
        {
          role: "reader",
          title: "Pushes them around",
          detail: "The pointer shoves balls aside; they roll back to where the search wants them.",
          file: "uis/directed/Filters.tsx",
        },
      ],
    },
  ],
  loop: "another need re-sorts the same balls",
};

export default function Filters(_props: UiProps) {
  return (
    <MockFrame name="filters" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} />
    </MockFrame>
  );
}
