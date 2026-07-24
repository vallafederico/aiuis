import {
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { isServer } from "solid-js/web";
import { createItem, type ItemController } from "@ssscript/webgl";
import { webgl } from "~/lib/stores/webglStore";
import { buildMsdfTextFragment, loadMsdfFont } from "./msdf-text";
import type { ProgressiveBlur } from "./sdf-texture";
import { readCssColor } from "./css-color";

type MsdfTextProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  text: string;
  font?: string;
  /** extra advance between glyphs, in em (default −0.06, figma −6%) */
  tracking?: number;
  /** line height as a multiplier of font size, figma-style (default 1) */
  lineHeight?: number;
  /**
   * Sets the em-context for the hidden layout text, px. Use when you want
   * the component to self-size from the MSDF metrics rather than inheriting
   * font-size from context. When omitted, the component inherits font-size
   * and the hidden real text drives the layout box.
   *
   * For width-only sizing (class="w-[70vw]"), omit fontSize and use fitWidth
   * — the outer span's aspect-ratio is set from the MSDF metrics so height
   * follows width.
   */
  fontSize?: number;
  /**
   * When true, the outer span has a forced width (e.g. class="w-[70vw]") and
   * aspect-ratio is applied so height follows width from MSDF metrics.
   * Do NOT put width classes directly on <MsdfText> without this flag — wrap
   * in a <p> or <span> instead.
   */
  fitWidth?: boolean;
  /** figma-style progressive blur ramp across the element */
  blur?: ProgressiveBlur;
  /** RGB color 0–1 range, defaults to CSS --color-key */
  color?: [number, number, number];
  /** opacity multiplier 0–1, defaults to 1 */
  alpha?: number;
};

/**
 * Inline-block WebGL MSDF text element. The hidden real text drives the
 * layout box so surrounding flow (flex rows, line-height, margins) is
 * preserved. The WebGL quad absolutely covers the same box.
 *
 * Size via context font-size (inherits naturally) or override with fontSize.
 * For width-only layout (e.g. class="w-[70vw]"), omit fontSize — the
 * component uses aspect-ratio so height follows width automatically.
 *
 *   <MsdfText text="aiuis" font="Garara" class="w-[70vw]" />
 *   <MsdfText text="002" font="Garara" fontSize={20} />
 *   <MsdfText text="Foreword" font="AlteHaasGroteskBold" class="text-sm" />
 */
export default function MsdfText(props: MsdfTextProps) {
  const [local, rest] = splitProps(props, [
    "text",
    "font",
    "tracking",
    "lineHeight",
    "fontSize",
    "fitWidth",
    "blur",
    "color",
    "alpha",
  ]);
  const [aspect, setAspect] = createSignal<number>();

  let el!: HTMLSpanElement;
  let item: ItemController | undefined;
  let disposed = false;
  let generation = 0;

  const syncWidth = () => item?.setUni({ value2: el.clientWidth || 1 });

  createEffect(() => {
    if (!webgl.loaded) return;
    const { text, font, tracking, lineHeight, fontSize, blur, color, alpha } = local;
    const current = ++generation;

    loadMsdfFont(font ?? "Garara")
      .then(({ metrics, texture }) => {
        if (disposed || current !== generation) return;
        const { fragment, aspect } = buildMsdfTextFragment(
          metrics,
          text,
          { tracking, lineHeight, blur, color: color ?? readCssColor("--color-key"), alpha },
        );
        setAspect(aspect);
        item?.destroy();
        item = createItem(el, {
          texture,
          shaders: { fragment },
          uni: { value2: el.clientWidth || 1, value3: blur?.radius ?? 0 },
        });
        window.requestAnimationFrame(syncWidth);
        window.addEventListener("resize", syncWidth);
      })
      .catch((error) => console.error("[MsdfText]", local.text, error));
  });

  onCleanup(() => {
    disposed = true;
    if (isServer) return;
    window.removeEventListener("resize", syncWidth);
    item?.destroy();
  });

  // Only apply aspect-ratio when fitWidth is explicitly set. In that mode the
  // outer span has a forced width (e.g. w-[70vw]) and aspect-ratio makes height
  // follow. In all other modes the hidden text's natural metrics drive the box.
  const useAspect = () => local.fitWidth && aspect() !== undefined;

  return (
    <span
      {...rest}
      style={{
        display: "inline-block",
        position: "relative",
        // aspect-ratio only for explicit fitWidth mode
        ...(useAspect() ? { "aspect-ratio": String(aspect()) } : {}),
        // fontSize overrides the em context for self-sizing mode
        ...(local.fontSize ? { "font-size": `${local.fontSize}px` } : {}),
        // spread caller styles last so they can override
        ...(typeof rest.style === "object" && rest.style !== null
          ? (rest.style as Record<string, string>)
          : {}),
      }}
    >
      {/* Hidden real text IS the sizing source — ref tracks it directly so the
          WebGL quad aligns to exactly the text's natural dimensions, not the
          full outer box. visibility:hidden keeps it in flow. */}
      <span
        ref={el}
        aria-hidden="true"
        style={{ visibility: "hidden", "white-space": "pre" }}
      >
        {local.text}
      </span>
      {/* Accessible selectable text, zero opacity so only WebGL is visible. */}
      <span
        data-selectable
        style={{ position: "absolute", inset: "0", opacity: "0" }}
      >
        {local.text}
      </span>
    </span>
  );
}
