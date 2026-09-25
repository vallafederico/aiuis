/**
 * Schematic of Filters: how the component page (directed/Filters.tsx) cuts
 * the site's own chapter list.
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
          detail: "The published chapters of this site, straight from the CMS. There is no results page.",
          meta: "title · summary · tags",
          inside: ["The same list the sidebar reads.", "Filters only cut and recede rows that already exist."],
          file: "lib/filters.ts",
        },
      ],
      out: "the rows, in place",
    },
    {
      steps: [
        {
          role: "code",
          title: "Hard tags",
          detail: "Exact CMS tags cut rows. A row carries every picked tag or it folds away. No model.",
          inside: ["Several tags narrow together.", "Unpicking one puts its rows back."],
          file: "uis/directed/Filters.tsx",
        },
        {
          role: "jev",
          title: "Type a chip",
          detail: "A typed rule becomes one yes-or-no judgment per row, all in a single call.",
          meta: "jev · one noul per row",
          inside: [
            "The judge sees each row's title, summary, tags and kind.",
            "Only a rule some row passes at 0.5 becomes a chip.",
            "Otherwise the field stays quiet: a weak match is not a wrong filter.",
          ],
          file: "lib/catalog-search.ts",
        },
      ],
      out: "a score per row per chip, stored",
    },
    {
      steps: [
        {
          role: "code",
          title: "The floor",
          detail: "A row scores as its weakest chip. Under 0.5 it recedes; under the floor it hides.",
          meta: "floor 0 to 0.5",
          inside: ["Moving the floor re-mixes stored scores. It calls no model."],
          file: "uis/directed/Filters.tsx",
        },
      ],
      out: "keep, recede or hide, per row",
    },
    {
      steps: [
        {
          role: "reader",
          title: "Sees the list move",
          detail: "The list stays the list. Removing a chip puts every row it hid back.",
          file: "uis/directed/Filters.tsx",
        },
      ],
    },
  ],
  loop: "another chip, a tag or a moved floor reshapes the same list",
};

export default function Filters(_props: UiProps) {
  return (
    <MockFrame name="filters" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} />
    </MockFrame>
  );
}
