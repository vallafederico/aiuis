import { MockFrame } from "./Mock";
import type { UiProps } from "./types";

export default function LookAt(_props: UiProps) {
  return (
    <MockFrame name="look-at" class="h-[52svh] w-grids-6">
      <div class="uis-mock-stage">
        <div class="uis-mock-focus" />
      </div>
    </MockFrame>
  );
}
