import { MockFrame } from "./Mock";
import type { UiProps } from "./types";

export default function InfiniteArticle(_props: UiProps) {
  return (
    <MockFrame name="infinite-article" class="h-[72svh] w-grids-6">
      <div class="uis-mock-lines">
        <div class="uis-mock-line" />
        <div class="uis-mock-line w-2/3" />
        <div class="uis-mock-line" />
        <div class="uis-mock-line w-1/2" />
        <div class="uis-mock-line" />
        <div class="uis-mock-line w-2/3" />
        <div class="uis-mock-line" />
        <div class="uis-mock-line w-1/2" />
        <div class="uis-mock-fill" />
      </div>
    </MockFrame>
  );
}
