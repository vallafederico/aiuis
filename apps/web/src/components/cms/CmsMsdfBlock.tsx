import { createEffect, createMemo, createRoot, createSignal, For, onCleanup } from "solid-js";
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

// Module-level font metrics store — shared across all CmsMsdfBlock instances
// to avoid loading the same font N times and creating N reactive signal pairs.
type FontEntry = {
  metrics: () => BmFont | undefined;
  charset: () => Set<string> | undefined;
};
const fontMetricsStore = new Map<string, FontEntry>();

function ensureFontEntry(fontName: string): FontEntry {
  const existing = fontMetricsStore.get(fontName);
  if (existing) return existing;

  let entry!: FontEntry;
  createRoot(() => {
    const [metrics, setMetrics] = createSignal<BmFont | undefined>(undefined);
    const charset = createMemo(() => {
      const m = metrics();
      return m ? new Set(m.chars.map((c) => c.char)) : undefined;
    });
    entry = { metrics, charset };
    // loadMsdfFont is deduplicated by its own fontCache; guard against SSR
    if (!isServer) {
      loadMsdfFont(fontName).then(({ metrics: m }) => setMetrics(m));
    }
  });
  fontMetricsStore.set(fontName, entry);
  return entry;
}

export default function CmsMsdfBlock(props: CmsMsdfBlockProps) {
  let container!: HTMLSpanElement;
  const [width, setWidth] = createSignal<number>();

  const size = createElementSize(() => container);

  createEffect(() => {
    const w = size.width;
    if (!w) return;
    const timer = setTimeout(() => setWidth(w), RESIZE_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  const fontName = () => props.font ?? "AlteHaasGroteskBold";
  const fontEntry = () => ensureFontEntry(fontName());

  const wrapped = createMemo(() => {
    const normalized = normalizeMsdfText(props.text, fontEntry().charset());
    const m = fontEntry().metrics();
    const w = width();
    if (!m || !w) return normalized;
    const fontSizePx = parseFloat(getComputedStyle(container).fontSize) || m.info.size;
    return wrapMsdfText(m, normalized, w, fontSizePx, props.tracking);
  });

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
            <span class="block invisible">{" "}</span>
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
