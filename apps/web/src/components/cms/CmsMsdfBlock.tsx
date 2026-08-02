import { createEffect, createMemo, createRoot, createSignal, For, onCleanup, onMount } from "solid-js";
import { isServer } from "solid-js/web";
import { createElementSize } from "@solid-primitives/resize-observer";
import MsdfText from "~/components/webgl/MsdfText";
import { loadMsdfFont, getMsdfFontMetricsSync, type BmFont } from "~/components/webgl/msdf-text";
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
    // Seed synchronously if metrics were statically imported — no async tick needed.
    const syncM = getMsdfFontMetricsSync(fontName);
    if (syncM) setMetrics(syncM);
    // Always kick off the full load (needed for texture); metrics signal stays stable.
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
  // Hidden until wrap is computed — prevents the wide-text flash on first paint.
  // SSR must also ship hidden: the server can't know container width, so its
  // fallback is the unwrapped single line — exactly the flash. No-JS readers
  // get the noscript span instead.
  const [visible, setVisible] = createSignal(false);

  const size = createElementSize(() => container);

  const fontName = () => props.font ?? "AlteHaasGroteskBold";
  const fontEntry = () => ensureFontEntry(fontName());

  createEffect(() => {
    const w = size.width;
    if (!w) return;
    const timer = setTimeout(() => setWidth(w), RESIZE_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  // Reveal the block once wrap is ready (metrics sync + width measured).
  createEffect(() => {
    if (fontEntry().metrics() && width()) setVisible(true);
  });

  onMount(() => {
    const w = container.getBoundingClientRect().width;
    if (w) setWidth(w);
  });

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
      style={{
        ...(props.lineHeight !== undefined ? { "line-height": String(props.lineHeight) } : {}),
        visibility: visible() ? "visible" : "hidden",
      }}
    >
      {/* No-JS fallback: visibility:visible on the inner span explicitly overrides the
          parent's visibility:hidden (visibility is inherited but child can override). */}
      <noscript><span style="visibility:visible">{props.text}</span></noscript>
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
