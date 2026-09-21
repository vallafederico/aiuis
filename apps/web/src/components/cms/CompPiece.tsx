import { For, Show, type JSX } from "solid-js";
import "./CompPiece.css";

export function CompPiece(props: {
  title: string;
  body: string;
  tags: string[];
  updated: string | null;
  children: JSX.Element;
}) {
  const blurb = () => {
    const body = props.body.trim();
    if (!body) return props.title;
    return `${props.title} — ${body}`;
  };

  return (
    <div class="uis-page">
      <h1 class="sr-only">{props.title}</h1>
      <div class="uis-feature">{props.children}</div>
      {/* Last two grid columns, gx gutter to the viewport. Copy wraps at 80%. */}
      <aside class="uis-meta pointer-events-none fixed top-0 right-0 z-5 flex h-lvh flex-col justify-center pr-gx py-[3svh]">
        <div class="uis-meta-col flex w-grids-2 flex-col gap-8">
          <p class="uis-meta-num" aria-hidden="true">
            <span class="font-[4]">0</span>
            <span class="font-[10]">0</span>
            <span class="font-[16]">2</span>
          </p>
          <p class="uis-meta-blurb max-w-[80%]">{blurb()}</p>
          <Show when={props.tags.length > 0}>
            <div class="flex flex-col gap-4">
              <p class="uis-meta-label">Data</p>
              <ul class="flex flex-col items-start gap-2">
                <For each={props.tags}>
                  {(tag) => (
                    <li class="uis-tag">{tag.replaceAll("_", "-").toUpperCase()}</li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
          <Show when={props.updated}>
            {(date) => (
              <div class="flex flex-col gap-4">
                <p class="uis-meta-label">Last updated</p>
                <p class="uis-meta-date">{date()}</p>
              </div>
            )}
          </Show>
        </div>
      </aside>
    </div>
  );
}
