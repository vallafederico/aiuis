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
import {
  buildSdfFragment,
  loadSdf,
  type ProgressiveBlur,
} from "./sdf-texture";
import { readCssColor } from "./css-color";

type SdfImageProps = JSX.HTMLAttributes<HTMLDivElement> & {
  /** sdf texture name in public/msdf (from svgs or pngs via `pnpm msdf`) */
  name: string;
  /** figma-style progressive blur ramp across the element */
  blur?: ProgressiveBlur;
};

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
  let resize: ResizeObserver | undefined;

  // The aa band is scaled by this width. Read 0 while hidden (solo mode,
  // mid-transition) it would stick at 1px and draw the mark soft, so it
  // follows the element's own size, not just window resizes.
  const syncWidth = () => {
    if (!el.clientWidth) return;
    item?.setUni({ value2: el.clientWidth * getCanvasDensity() });
  };

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
        const color = readCssColor("--color-key");
        const fragment = buildSdfFragment(meta, blur, color);
        item = createItem(el, {
          texture,
          textureFit: "stretch",
          shaders: { fragment, fragmentGlsl: fragment },
          uni: {
            value2: (el.clientWidth || 1) * getCanvasDensity(),
            value3: (blur?.radius ?? 0) * getCanvasDensity(),
          },
        });
        window.requestAnimationFrame(syncWidth);
        if (!resize) {
          resize = new ResizeObserver(syncWidth);
          resize.observe(el);
        }
        window.addEventListener("resize", syncWidth);
      })
      .catch((error) => console.error("[SdfImage]", name, error));
  });

  onCleanup(() => {
    disposed = true;
    if (isServer) return;
    window.removeEventListener("resize", syncWidth);
    resize?.disconnect();
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
