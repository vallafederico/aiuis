import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { isServer } from "solid-js/web";
import { createElementSize } from "@solid-primitives/resize-observer";
import MsdfText from "~/components/webgl/MsdfText";
import { loadMsdfFont, type BmFont } from "~/components/webgl/msdf-text";
import { normalizeMsdfText } from "./normalizeMsdfText";
import { wrapMsdfText } from "./wrapMsdfText";

export type CmsMsdfBlockProps = {
  text: string;
  font?: string;
  class?: string;
  lineHeight?: number;
  tracking?: number;
  alpha?: number;
};

const RESIZE_DEBOUNCE_MS = 100;

/**
 * Width-aware MSDF text block — measures its own box, wraps the text to fit
 * (bmfont metrics, no browser reflow needed) and hands the result to
 * <MsdfText>. Used by CmsBody for every plain-text run in a piece body.
 */
export default function CmsMsdfBlock(props: CmsMsdfBlockProps) {
  let container!: HTMLSpanElement;
  const [metrics, setMetrics] = createSignal<BmFont>();
  const [width, setWidth] = createSignal<number>();

  const size = createElementSize(() => container);

  createEffect(() => {
    const w = size.width;
    if (!w) return;
    const timer = setTimeout(() => setWidth(w), RESIZE_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  onMount(() => {
    if (isServer) return;
    loadMsdfFont(props.font ?? "AlteHaasGroteskBold").then(({ metrics }) => setMetrics(metrics));
  });

  const charset = createMemo(() => {
    const m = metrics();
    return m ? new Set(m.chars.map((c) => c.char)) : undefined;
  });

  const wrapped = createMemo(() => {
    const normalized = normalizeMsdfText(props.text, charset());
    const m = metrics();
    const w = width();
    if (!m || !w) return normalized; // pre-measure fallback — single unwrapped run
    const fontSizePx = parseFloat(getComputedStyle(container).fontSize) || m.info.size;
    return wrapMsdfText(m, normalized, w, fontSizePx, props.tracking);
  });

  // One MsdfText per wrapped line — each fragment shader only loops over its
  // own line's glyphs instead of the whole paragraph. Vertical rhythm moves
  // from the shader's lineHeight to plain CSS line-height on the container.
  const lines = createMemo(() => wrapped().split("\n"));

  return (
    <span
      ref={container}
      class={`block w-full ${props.class ?? ""}`}
      style={
        props.lineHeight !== undefined
          ? { "line-height": String(props.lineHeight) }
          : undefined
      }
    >
      <For each={lines()}>
        {(line) =>
          line === "" ? (
            <span class="block invisible">{"\u00A0"}</span>
          ) : (
            <span class="block">
              <MsdfText
                text={line}
                font={props.font ?? "AlteHaasGroteskBold"}
                tracking={props.tracking}
                alpha={props.alpha}
              />
            </span>
          )
        }
      </For>
    </span>
  );
}
