import { MockFrame } from "./Mock";
import type { UiProps } from "./types";

export default function ImageGeneration(_props: UiProps) {
  return (
    <MockFrame name="image-generation" class="h-[60svh] w-grids-5">
      <div class="uis-mock-prompt" />
      <div class="uis-mock-result" />
    </MockFrame>
  );
}
