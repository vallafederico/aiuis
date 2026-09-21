import type { JSX } from "solid-js";
import "./Mock.css";

export function MockFrame(props: {
  name: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div class={`uis-mock ${props.class ?? ""}`} data-ui={props.name}>
      <p class="uis-mock-kicker">{props.name.replaceAll("-", " ")}</p>
      {props.children}
    </div>
  );
}
