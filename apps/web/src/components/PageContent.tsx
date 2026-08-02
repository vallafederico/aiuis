import type { JSX } from "solid-js";

export default function PageContent(props: {
  children: JSX.Element;
  spacing?: string;
  /* natural document flow for scrolling pages (articles);
     default is the viewport-locked splash layout */
  flow?: boolean;
  /* grid width of the content block; text reads best at the default */
  width?: string;
}) {
  return (
    <div
      class={`flex justify-center ${
        props.flow
          ? "pt-[40svh] pb-20"
          : "h-svh items-center overflow-hidden py-20"
      } ${props.spacing ?? ""}`}
    >
      <div class={props.width ?? "w-grids-6"}>{props.children}</div>
    </div>
  );
}
