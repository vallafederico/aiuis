import { MockFrame } from "./Mock";
import type { UiProps } from "./types";

export default function Navigation(_props: UiProps) {
  return (
    <MockFrame name="navigation" class="h-[44svh] w-grids-6">
      <div class="uis-mock-nav">
        <div class="uis-mock-nav-col">
          <div class="uis-mock-line" />
          <div class="uis-mock-line w-2/3" />
          <div class="uis-mock-line w-1/2" />
        </div>
        <div class="uis-mock-nav-col">
          <div class="uis-mock-line" />
          <div class="uis-mock-line w-1/2" />
          <div class="uis-mock-line w-2/3" />
        </div>
        <div class="uis-mock-nav-col">
          <div class="uis-mock-line" />
          <div class="uis-mock-line w-2/3" />
        </div>
      </div>
    </MockFrame>
  );
}
