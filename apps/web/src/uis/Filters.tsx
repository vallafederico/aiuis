/**
 * Schematic of Filters as designed. The component is not built yet; every
 * step says so, and names the live helper it would reuse.
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
          detail: "Filters only cut and recede rows that already exist. There is no results page.",
          inside: ["Not built yet.", "Would reuse the image catalog or the chapter index."],
          file: "uis/Filters.tsx",
        },
      ],
      out: "the rows, in place",
    },
    {
      steps: [
        {
          role: "code",
          title: "Hard tags",
          detail: "Exact data labels cut rows. No model.",
          inside: ["Not built yet.", "filterByProvenance in lib/images.ts already does this for images."],
          file: "lib/images.ts",
        },
        {
          role: "jev",
          title: "Soft chips",
          detail: "A chip is one judgment per row. Rows that fail recede, then hide past the floor.",
          meta: "jev · one noul per row",
          inside: [
            "Not built yet.",
            "judgeImageChip and judgeChip already score rows this way elsewhere.",
            "Elsewhere: hidden below 0.5, receding from 0.3.",
          ],
          file: "lib/catalog-search.ts",
        },
        {
          role: "jev",
          title: "Type a chip",
          detail: "A sentence becomes a new chip only when the judgment is confident; otherwise nothing.",
          inside: ["Not built yet.", "A weak match must not invent a chip."],
          file: "uis/Filters.tsx",
        },
      ],
      out: "a score per row per chip, stored",
    },
    {
      steps: [
        {
          role: "code",
          title: "The floor",
          detail: "A relevance floor mixes over the stored scores. Moving it calls no model.",
          inside: ["Not built yet.", "Live in the image and navigation prototypes as a 0 to 0.5 range."],
          file: "uis/Images.tsx",
        },
      ],
      out: "keep, recede or hide, per row",
    },
    {
      steps: [
        {
          role: "reader",
          title: "Sees the list move",
          detail: "The list stays the list. A wrong chip can be put back.",
          inside: ["Not built yet."],
          file: "uis/Filters.tsx",
        },
      ],
    },
  ],
  loop: "another chip or a moved floor reshapes the same list",
};

export default function Filters(_props: UiProps) {
  return (
    <MockFrame name="filters" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} />
    </MockFrame>
  );
}
