import { onCleanup, onMount, splitProps, type JSX } from "solid-js";
import {
  createItem,
  type CreateItemOptions,
  type ItemController,
} from "@ssscript/webgl";

type GlItemProps = JSX.HTMLAttributes<HTMLDivElement> & {
  options?: CreateItemOptions;
  onItem?: (item: ItemController) => void;
};

/**
 * DOM element mirrored as a webgl quad. Items queue until the engine from
 * <Canvas /> is ready, so mount order doesn't matter.
 */
export default function GlItem(props: GlItemProps) {
  const [local, rest] = splitProps(props, ["options", "onItem"]);
  let el!: HTMLDivElement;
  let item: ItemController | undefined;

  onMount(() => {
    item = createItem(el, local.options);
    local.onItem?.(item);
  });

  onCleanup(() => item?.destroy());

  return <div ref={el} {...rest} />;
}
