import {
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { isServer } from "solid-js/web";
import { createItem, type ItemController } from "shooosh";
import { getCanvasDensity, webgl } from "~/lib/stores/webglStore";
import { buildMsdfTextFragment, loadMsdfFont } from "./msdf-text";
import { buildWeirdFragment } from "./msdf-weird";
import type { ProgressiveBlur } from "./sdf-texture";
import { readCssColor } from "./css-color";

type MsdfTextProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  text: string;
  font?: string;
  tracking?: number;
  lineHeight?: number;
  fontSize?: number;
  fitWidth?: boolean;
  blur?: ProgressiveBlur;
  color?: [number, number, number];
  alpha?: number;
  weird?: boolean;
};

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
    "weird",
  ]);
  const [aspect, setAspect] = createSignal<number>();

  let el!: HTMLSpanElement;
  let item: ItemController | undefined;
  let disposed = false;
  let generation = 0;

  const syncSize = () => {
    const rect = el.getBoundingClientRect();
    const dpr = getCanvasDensity();
    item?.setUni({
      value2: (rect.width || 1) * dpr,
      value4: (rect.height || 1) * dpr,
    });
  };

  createEffect(() => {
    if (!webgl.loaded) return;
    const { text, font, tracking, lineHeight, weird, blur, color, alpha } = local;
    const current = ++generation;

    loadMsdfFont(font ?? "Garara")
      .then(({ metrics, texture }) => {
        if (disposed || current !== generation) return;

        const layoutColor = color ?? readCssColor("--color-key");
        const layoutAlpha = alpha ?? 1.0;
        const { fragment, aspect: asp } = weird
          ? buildWeirdFragment(metrics, text, { tracking, lineHeight, blur, color: layoutColor, alpha: layoutAlpha })
          : buildMsdfTextFragment(metrics, text, { tracking, lineHeight, blur, color: layoutColor, alpha: layoutAlpha });
        setAspect(asp);
        item?.destroy();
        const rect = el.getBoundingClientRect();
        const dpr = getCanvasDensity();
        item = createItem(el, {
          texture,
          shaders: { fragment, fragmentGlsl: fragment },
          uni: {
            value2: (rect.width || 1) * dpr,
            value3: (blur?.radius ?? 0) * dpr,
            value4: (rect.height || 1) * dpr,
          },
        });
        window.requestAnimationFrame(syncSize);
      })
      .catch((error) => console.error("[MsdfText]", local.text, error));
  });

  onCleanup(() => {
    disposed = true;
    if (isServer) return;
    item?.destroy();
  });

  const useAspect = () => local.fitWidth && aspect() !== undefined;

  return (
    <span
      {...rest}
      data-selectable
      style={{
        display: "inline-block",
        position: "relative",
        ...(useAspect() ? { "aspect-ratio": String(aspect()) } : {}),
        ...(local.fontSize ? { "font-size": `${local.fontSize}px` } : {}),
        ...(typeof rest.style === "object" && rest.style !== null
          ? (rest.style as Record<string, string>)
          : {}),
      }}
    >
      {/* Real HTML stays in the tree for layout, hit-testing, selection,
          screen readers, and crawlers. [data-msdf] fill is transparent while
          WebGL paints; selection is a super light blue. <noscript> in
          entry-server restores full key color without JS. */}
      <span
        ref={el}
        data-msdf
        data-selectable
        style={{ "white-space": "pre" }}
      >
        {local.text}
      </span>
    </span>
  );
}
