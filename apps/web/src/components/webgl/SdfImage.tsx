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
import {
  buildSdfFragment,
  loadSdf,
  type ProgressiveBlur,
} from "./sdf-texture";

type SdfImageProps = JSX.HTMLAttributes<HTMLDivElement> & {
  /** sdf texture name in public/msdf (from svgs or pngs via `pnpm msdf`) */
  name: string;
  /** figma-style progressive blur ramp across the element */
  blur?: ProgressiveBlur;
};

function readCssColor(prop: string): [number, number, number] {
  if (typeof document === "undefined") return [0, 0, 1];
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(prop)
    .trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16) / 255;
    const g = parseInt(hex[1] + hex[1], 16) / 255;
    const b = parseInt(hex[2] + hex[2], 16) / 255;
    return [r, g, b];
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
  return [0, 0, 1];
}

/**
 * A DOM element rendered as a webgl sdf texture — the quad tracks the
 * element, the element gets the texture's aspect ratio.
 *
 *   <SdfImage name="logo" class="w-[20vw]" />
 */
export default function SdfImage(props: SdfImageProps) {
  const [local, rest] = splitProps(props, ["name", "blur"]);
  const [aspect, setAspect] = createSignal<number>();

  let el!: HTMLDivElement;
  let item: ItemController | undefined;
  let disposed = false;
  let generation = 0;

  const syncWidth = () => item?.setUni({ value2: el.clientWidth || 1 });

  createEffect(() => {
    if (!webgl.loaded) return;
    const name = local.name;
    const blur = local.blur;
    const current = ++generation;

    loadSdf(name)
      .then(({ meta, texture }) => {
        if (disposed || current !== generation) return;
        setAspect(meta.width / meta.height);
        item?.destroy();
        const [r, g, b] = readCssColor("--color-key");
        item = createItem(el, {
          texture,
          shaders: { fragment: buildSdfFragment(meta, blur) },
          uni: { value2: el.clientWidth || 1, value3: blur?.radius ?? 0, value4: r, value5: g, value6: b },
        });
        window.requestAnimationFrame(syncWidth);
        window.addEventListener("resize", syncWidth);
      })
      .catch((error) => console.error("[SdfImage]", name, error));
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
      style={{ "aspect-ratio": aspect() ? String(aspect()) : "1" }}
    />
  );
}
