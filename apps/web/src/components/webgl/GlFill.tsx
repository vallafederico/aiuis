import { createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { createItem, type ItemController } from "shooosh";
import { webgl } from "~/lib/stores/webglStore";
import { readCssColor } from "./css-color";
import { glslShaders } from "./shaders";

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
out vec4 outColor;

void main() {
  vec3 fill = uUni[1].xyz;
  float a = uUni[1].w;
  outColor = vec4(fill * a, a);
}
`;

const shaders = glslShaders(FRAGMENT);

/**
 * A DOM box drawn as a flat WebGL quad in the key colour, so it lives in the
 * scene (lens, mosaic) like the rest. Hairlines stay solid: no edge falloff.
 * The element keeps its CSS paint until the quad is up (`data-gl`), then the
 * stylesheet can hide it.
 */
export default function GlFill(props: { class?: string; layer?: number; alpha?: number }) {
  let el!: HTMLElement;
  let item: ItemController | undefined;

  createEffect(() => {
    if (isServer || !webgl.loaded) return;
    const [r, g, b] = readCssColor("--color-key");
    item = createItem(el, {
      layer: props.layer ?? 6,
      shaders,
      uni: { value5: r, value6: g, value7: b, value8: props.alpha ?? 1 },
    });
    el.dataset.gl = "";
    onCleanup(() => {
      item?.destroy();
      item = undefined;
      delete el.dataset.gl;
    });
  });

  return <i ref={el} class={props.class} />;
}
