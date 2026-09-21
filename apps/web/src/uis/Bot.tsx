import { MockFrame } from "./Mock";
import type { UiProps } from "./types";

export default function Bot(_props: UiProps) {
  return (
    <MockFrame name="bot" class="h-[64svh] w-grids-4">
      <div class="uis-mock-chat">
        <div class="uis-mock-bubble" />
        <div class="uis-mock-bubble uis-mock-bubble-self" />
        <div class="uis-mock-bubble" />
        <div class="uis-mock-bubble uis-mock-bubble-self" />
        <div class="uis-mock-input" />
      </div>
    </MockFrame>
  );
}
