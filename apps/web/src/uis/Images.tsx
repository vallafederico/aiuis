import { MockFrame } from "./Mock";
import type { UiProps } from "./types";

export default function Images(_props: UiProps) {
  return (
    <MockFrame name="images" class="h-[58svh] w-grids-6">
      <div class="uis-mock-tiles">
        <div class="uis-mock-tile" />
        <div class="uis-mock-tile" />
        <div class="uis-mock-tile" />
        <div class="uis-mock-tile" />
      </div>
    </MockFrame>
  );
}
