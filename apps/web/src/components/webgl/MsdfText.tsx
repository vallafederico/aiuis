import {
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { isServer } from "solid-js/web";
import { createItem, createMsdfGlyphs, type ItemController, type MsdfGlyphsHandle } from "@ssscript/webgl";
import { webgl } from "~/lib/stores/webglStore";
import { buildMsdfGlyphData, buildMsdfTextFragment, loadMsdfFont } from "./msdf-text";
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
  let glyphs: MsdfGlyphsHandle | undefined;
  let disposed = false;
  let generation = 0;

  const syncSize = () => {
    const rect = el.getBoundingClientRect();
    item?.setUni({ value2: rect.width || 1, value4: rect.height || 1 });
  };

  createEffect(() => {
    if (!webgl.loaded) return;
    const { text, font, tracking, lineHeight, weird, blur, color, alpha } = local;
    const useOldPath = !!(weird || blur);
    const current = ++generation;

    loadMsdfFont(font ?? "Garara")
      .then(({ metrics, texture }) => {
        if (disposed || current !== generation) return;

        const layoutColor = color ?? readCssColor("--color-key");
        const layoutAlpha = alpha ?? 1.0;

        if (useOldPath) {
          // Weird or blur path: baked-constants loop shader
          const { fragment, aspect: asp } = weird
            ? buildWeirdFragment(metrics, text, { tracking, lineHeight, blur, color: layoutColor, alpha: layoutAlpha })
            : buildMsdfTextFragment(metrics, text, { tracking, lineHeight, blur, color: layoutColor, alpha: layoutAlpha });
          setAspect(asp);
          item?.destroy();
          glyphs?.destroy();
          glyphs = undefined;
          const rect = el.getBoundingClientRect();
          item = createItem(el, {
            texture,
            shaders: { fragment },
            uni: { value2: rect.width || 1, value3: blur?.radius ?? 0, value4: rect.height || 1 },
          });
          window.requestAnimationFrame(syncSize);
        } else {
          // Instanced path: GPU-instanced quad per glyph
          const { glyphData, glyphCount, aspect: asp } = buildMsdfGlyphData(metrics, text, {
            tracking,
            lineHeight,
          });
          setAspect(asp);
          item?.destroy();
          item = undefined;
          glyphs?.destroy();
          const rect = el.getBoundingClientRect();
          glyphs = createMsdfGlyphs(el, {
            texture,
            glyphData,
            glyphCount,
            distanceRange: metrics.distanceField?.distanceRange ?? 4,
            atlasWidth: metrics.common.scaleW,
            color: layoutColor,
            alpha: layoutAlpha,
            boxAspect: asp,
            uni: { value2: rect.width || 1, value4: rect.height || 1 },
          });
        }
      })
      .catch((error) => console.error("[MsdfText]", local.text, error));
  });

  onCleanup(() => {
    disposed = true;
    if (isServer) return;
    item?.destroy();
    glyphs?.destroy();
  });

  const useAspect = () => local.fitWidth && aspect() !== undefined;

  return (
    <span
      {...rest}
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
      <span
        ref={el}
        aria-hidden="true"
        style={{ visibility: "hidden", "white-space": "pre" }}
      >
        {local.text}
      </span>
      <span
        data-selectable
        style={{ position: "absolute", inset: "0", opacity: "0" }}
      >
        {local.text}
      </span>
    </span>
  );
}
