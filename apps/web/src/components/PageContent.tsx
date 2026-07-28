import type { JSX } from "solid-js";

export default function PageContent(props: {
  children: JSX.Element;
  spacing?: string;
  /* natural document flow for scrolling pages (articles);
     default is the viewport-locked splash layout */
  flow?: boolean;
}) {
  return (
    <div
      class={`flex py-20 justify-center ${
        props.flow ? "" : "h-svh items-center overflow-hidden"
      } ${props.spacing ?? ""}`}
    >
      <div class="w-grids-6">{props.children}</div>
    </div>
  );
}
