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

type MsdfTextProps = JSX.HTMLAttributes<HTMLDivElement> & {
  text: string;
  font?: string;
  /** extra advance between glyphs, in em */
  tracking?: number;
  /** line spacing multiplier over the font's own line height */
  lineHeight?: number;
  /** sizes the element from the text metrics instead of a width class, px */
  fontSize?: number;
};

/**
 * A DOM element rendered as webgl msdf text — the quad tracks the element,
 * the element gets the text box's aspect ratio. Size it with a width class,
 * or pass fontSize to derive the element size from the type. `\n` wraps.
 *
 *   <MsdfText text="aiuis" font="Garara" class="w-[70vw]" />
 *   <MsdfText text={"one\ntwo"} font="Garara" fontSize={120} tracking={0.05} />
 */
export default function MsdfText(props: MsdfTextProps) {
  const [local, rest] = splitProps(props, [
    "text",
    "font",
    "tracking",
    "lineHeight",
    "fontSize",
  ]);
  const [aspect, setAspect] = createSignal<number>();
  const [pxWidth, setPxWidth] = createSignal<number>();

  let el!: HTMLDivElement;
  let item: ItemController | undefined;
  let disposed = false;
  let generation = 0;

  const syncWidth = () => item?.setUni({ value2: el.clientWidth || 1 });

  createEffect(() => {
    if (!webgl.loaded) return;
    // tracked — the item rebuilds when any of these change
    const { text, font, tracking, lineHeight, fontSize } = local;
    const current = ++generation;

    loadMsdfFont(font ?? "Garara")
      .then(({ metrics, texture }) => {
        if (disposed || current !== generation) return;
        const { fragment, aspect, width } = buildMsdfTextFragment(
          metrics,
          text,
          { tracking, lineHeight },
        );
        setAspect(aspect);
        setPxWidth(
          fontSize ? (width / metrics.info.size) * fontSize : undefined,
        );
        item?.destroy();
        item = createItem(el, {
          texture,
          shaders: { fragment },
          uni: { value2: el.clientWidth || 1 },
        });
        // element size settles after the style update — sync next frame
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

  return (
    <div
      ref={el}
      {...rest}
      style={{
        "aspect-ratio": aspect() ? String(aspect()) : "4 / 1",
        ...(pxWidth() ? { width: `${pxWidth()}px` } : {}),
      }}
    >
      {/* real text, hidden via opacity — selectable, indexable, read by
          screen readers; the webgl quad draws the visible version */}
      <span class="whitespace-pre-line opacity-0">{local.text}</span>
    </div>
  );
}
