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
import { buildSdfFragment, loadSdf } from "./sdf-texture";

type SdfImageProps = JSX.HTMLAttributes<HTMLDivElement> & {
  /** sdf texture name in public/msdf (from svgs or pngs via `pnpm msdf`) */
  name: string;
};

/**
 * A DOM element rendered as a webgl sdf texture — the quad tracks the
 * element, the element gets the texture's aspect ratio.
 *
 *   <SdfImage name="logo" class="w-[20vw]" />
 */
export default function SdfImage(props: SdfImageProps) {
  const [local, rest] = splitProps(props, ["name"]);
  const [aspect, setAspect] = createSignal<number>();

  let el!: HTMLDivElement;
  let item: ItemController | undefined;
  let disposed = false;
  let generation = 0;

  const syncWidth = () => item?.setUni({ value2: el.clientWidth || 1 });

  createEffect(() => {
    if (!webgl.loaded) return;
    const name = local.name;
    const current = ++generation;

    loadSdf(name)
      .then(({ meta, texture }) => {
        if (disposed || current !== generation) return;
        setAspect(meta.width / meta.height);
        item?.destroy();
        item = createItem(el, {
          texture,
          shaders: { fragment: buildSdfFragment(meta) },
          uni: { value2: el.clientWidth || 1 },
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
