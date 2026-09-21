import { MockFrame } from "./Mock";
import type { UiProps } from "./types";

export default function Faqs(_props: UiProps) {
  return (
    <MockFrame name="faqs" class="h-[56svh] w-grids-5">
      <ul class="uis-mock-list">
        <li class="uis-mock-row" />
        <li class="uis-mock-row is-open">
          <div class="uis-mock-lines">
            <div class="uis-mock-line" />
            <div class="uis-mock-line w-2/3" />
            <div class="uis-mock-line w-1/2" />
          </div>
        </li>
        <li class="uis-mock-row" />
        <li class="uis-mock-row" />
        <li class="uis-mock-row" />
      </ul>
    </MockFrame>
  );
}
