import { For, Show, type JSX } from "solid-js";
import "./CompPiece.css";
import CmsMsdfBlock from "./CmsMsdfBlock";
import MsdfText from "~/components/webgl/MsdfText";
import GlRoundRect from "~/components/webgl/GlRoundRect";
import { tagPath } from "~/uis/meta";

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
            <MsdfText text="0" font="Garara-0" weird />
            <MsdfText text="0" font="Garara-10" weird />
            <MsdfText text="2" font="Garara-10" weird />
          </p>
          <p class="uis-meta-blurb max-w-[80%]">
            <CmsMsdfBlock text={blurb()} tracking={-0.053} />
          </p>
          <Show when={props.tags.length > 0}>
            <div class="flex flex-col gap-4">
              <p class="uis-meta-label">
                <MsdfText text="DATA" font="Garara-10" weird />
              </p>
              <ul class="flex flex-col items-start gap-2">
                <For each={props.tags}>
                  {(tag) => (
                    <li>
                      <a class="uis-tag pointer-events-auto" href={tagPath(tag)}>
                        <GlRoundRect class="uis-tag-fill" />
                        <MsdfText
                          text={tag.replaceAll("_", "-").toUpperCase()}
                          font="AlteHaasGroteskBold"
                          tracking={0.32}
                          weird
                        />
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
          <Show when={props.updated}>
            {(date) => (
              <div class="flex flex-col gap-4">
                <p class="uis-meta-label">
                  <MsdfText text="LAST UPDATED" font="Garara-10" weird />
                </p>
                <p class="uis-meta-date">
                  <MsdfText
                    text={date()}
                    font="AlteHaasGroteskBold"
                    tracking={0.32}
                    weird
                  />
                </p>
              </div>
            )}
          </Show>
        </div>
      </aside>
    </div>
  );
}
