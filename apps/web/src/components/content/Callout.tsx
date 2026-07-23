import type { JSX } from "solid-js";
import cx from "classix";

export default function Callout(props: {
  kind?: "info" | "warn";
  children?: JSX.Element;
}) {
  return (
    <aside
      class={cx(
        "my-6 border-l-2 py-2 pl-4",
        props.kind === "warn" ? "border-red-500" : "border-key",
      )}
    >
      {props.children}
    </aside>
  );
}
