/**
 * Schematic of Sketch Generation: marks on the pad, a hidden brief, and an
 * image model that reads the sketch under it, with an honest procedural
 * fallback when the model is unavailable or out of quota.
 */
import { MockFrame } from "./Mock";
import { Pipeline, type PipelineSpec } from "./schematics/Pipeline";
import type { UiProps } from "./types";

const PIPELINE: PipelineSpec = {
  stages: [
    {
      steps: [
        {
          role: "reader",
          title: "Draws",
          detail: "Draws on the pad and may pick a brief: still life, portrait or interior.",
          meta: "at least 2 strokes · enough ink",
          inside: [
            "Ink is measured in pad short-side lengths: 3.2 for a first image (FIRST_INK), 1.2 to revise (REVISE_INK).",
            "Only the brief's short label is on screen; its full prompt stays hidden.",
            "A brief is picked at random on load.",
          ],
          file: "uis/sketch-session.ts",
        },
      ],
      out: "enough marks to read",
    },
    {
      steps: [
        {
          role: "code",
          title: "Waits for a pause",
          detail: "Once the pen lifts and the pad has enough, it arms and generates after a short idle.",
          meta: "idle 1.5s",
          inside: [
            "Phases: empty, sketching, armed, generating, developing.",
            "Drawing again cancels a generation in flight.",
            "Changing the brief while armed generates again.",
          ],
          file: "uis/sketch-session.ts",
        },
      ],
      out: "a snapshot of the pad",
    },
    {
      steps: [
        {
          role: "code",
          title: "Exports two images",
          detail: "The GL pad exports the line drawing and a procedural underpainting from the same strokes.",
          meta: "up to 640px",
          inside: [
            "Lines: dark strokes on white, the reference for FLUX.",
            "Underpainting: the init image for Stable Diffusion, and the fallback.",
            "The waiting bleed starts here.",
          ],
          file: "uis/sketch-generation-gl.ts",
        },
      ],
      out: "sketch + underpainting + brief",
    },
    {
      steps: [
        {
          role: "image",
          title: "Renders",
          detail: "Tries FLUX klein 9B, then 4B, then Stable Diffusion 1.5 inpainting, each on Workers AI.",
          meta: "@cf/black-forest-labs/flux-2-klein-9b · 4b · sd 1.5 · workers ai",
          inside: [
            "Error 4006 means the daily Workers AI allowance is spent; it stops trying models.",
            "Outputs under 4096 bytes are treated as blank or blocked.",
            "Stable Diffusion runs at strength 0.75, 20 steps, guidance 7.5.",
          ],
          file: "lib/sketch-generation.ts",
        },
      ],
      out: "an image, or a reason it could not",
    },
    {
      branch: true,
      steps: [
        {
          role: "code",
          title: "Develops",
          detail: "After at least 1.2s, the render develops in over the sketch.",
          inside: ["The prompt appears only after the image exists, as provenance."],
          file: "uis/sketch-session.ts",
        },
        {
          role: "code",
          title: "Falls back",
          detail: "No model or no quota: the procedural underpainting develops instead, and says why.",
          inside: ["“Workers AI daily quota spent”, “Workers AI unavailable”, or “image did not decode”."],
          file: "uis/sketch-session.ts",
        },
      ],
    },
  ],
  loop: "drawing more after it develops revises the image",
};

export default function SketchGeneration(_props: UiProps) {
  return (
    <MockFrame name="sketch-generation" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} />
    </MockFrame>
  );
}
