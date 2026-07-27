import type { JSX } from "solid-js";

export default function PageContent(props: {
  children: JSX.Element;
  spacing?: string;
}) {
  return (
    <div
      class={`flex h-svh py-20 items-center justify-center
        overflow-hidden ${props.spacing ?? ""}`}
    >
      <div class="w-grids-8">{props.children}</div>
    </div>
  );
}
