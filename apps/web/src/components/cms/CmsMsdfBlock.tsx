import { createEffect, createMemo, createRoot, createSignal, For, onCleanup, onMount, Show, useContext } from "solid-js";
import { isServer } from "solid-js/web";
import { createElementSize } from "@solid-primitives/resize-observer";
import MsdfText from "~/components/webgl/MsdfText";
import { loadMsdfMetrics, getMsdfFontMetricsSync, type BmFont } from "~/components/webgl/msdf-text";
import { PieceReadContext } from "~/components/ArticleFocus";
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
    // Wrapping needs metrics only; MsdfText loads the atlas once the scene is up.
    else if (!isServer) {
      loadMsdfMetrics(fontName).then(setMetrics);
    }
  });
  fontMetricsStore.set(fontName, entry);
  return entry;
}

export default function CmsMsdfBlock(props: CmsMsdfBlockProps) {
  const articleLine = useContext(PieceReadContext);
  let container!: HTMLSpanElement;
  const [width, setWidth] = createSignal<number>();

  const size = createElementSize(() => container);

  const fontName = () => props.font ?? "AlteHaasGroteskBold";
  const fontEntry = () => ensureFontEntry(fontName());

  createEffect(() => {
    const w = size.width;
    if (!w) return;
    const timer = setTimeout(() => setWidth(w), RESIZE_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  onMount(() => {
    const w = container.getBoundingClientRect().width;
    if (w) setWidth(w);
  });

  const normalized = createMemo(() => normalizeMsdfText(props.text, fontEntry().charset()));
  const measured = () => !!fontEntry().metrics() && !!width();

  const wrapped = createMemo(() => {
    const m = fontEntry().metrics();
    const w = width();
    if (!m || !w) return normalized();
    const fontSizePx = parseFloat(getComputedStyle(container).fontSize) || m.info.size;
    return wrapMsdfText(m, normalized(), w, fontSizePx, props.tracking);
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
      {/* Until the box is measured (SSR, first client frame) the HTML copy wraps
          natively, so the block is already its wrapped height: no layout shift
          when the MSDF lines replace it. */}
      <Show
        when={measured()}
        fallback={
          <span
            class="block"
            data-msdf
            style={{
              "white-space": "pre-wrap",
              "letter-spacing": `${props.tracking ?? -0.06}em`,
            }}
          >
            {normalized()}
          </span>
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
                  articleLine={articleLine}
                />
              </span>
            )
          }
        </For>
      </Show>
    </span>
  );
}
