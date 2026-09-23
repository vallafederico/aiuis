import { createEffect, onCleanup, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { createItem, type ItemController } from "shooosh";
import { getCanvasDensity, webgl } from "~/lib/stores/webglStore";
import { glslShaders } from "./shaders";

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
out vec4 outColor;

void main() {
  vec2 res = vec2(max(uUni[0].y, 1.0), max(uUni[0].w, 1.0));
  float cap = min(res.y, res.x) * 0.5;
  float r = uUni[1].w < 0.0 ? cap : min(uUni[1].w, cap);
  vec2 p = vUv * res;
  vec2 halfSize = res * 0.5;
  vec2 q = abs(p - halfSize) - (halfSize - vec2(r));
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float a = 1.0 - smoothstep(-0.75, 0.75, d);
  // value1 > 1 draws the whole shape (current-page strike, pills).
  // 0–1 wipes that shape from the left (hover).
  float wipe = uUni[0].x;
  float full = step(1.5, wipe);
  a *= mix(step(vUv.x, clamp(wipe, 0.0, 1.0)), 1.0, full);
  vec3 fill = vec3(uUni[1].x, uUni[1].y, uUni[1].z);
  outColor = vec4(fill * a, a);
}
`;

const shaders = glslShaders(FRAGMENT);

/** DOM box mirrored as a WebGL stadium so mosaic can pick it up. */
export default function GlRoundRect(props: {
  class?: string;
  fill?: [number, number, number];
  /** Corner radius in CSS pixels. Omit for a pill. `0` is a sharp rectangle. */
  radius?: number;
  /** Draw order. Text sits at 10; pass a higher layer to paint over glyphs. */
  layer?: number;
  /** 0–1 left-to-right fill. Omit for a full rect. */
  wipe?: number;
  children?: JSX.Element;
}) {
  let el!: HTMLDivElement;
  let item: ItemController | undefined;
  let wipeRef = props.wipe == null ? 2 : props.wipe;
  let fillRef: [number, number, number] = [0.8745, 0.8745, 0.8745];

  const syncSize = () => {
    const rect = el.getBoundingClientRect();
    const dpr = getCanvasDensity();
    item?.setUni({
      value2: (rect.width || 1) * dpr,
      value4: (rect.height || 1) * dpr,
    });
  };

  createEffect(() => {
    if (isServer || !webgl.loaded) return;
    const radius = props.radius;
    const rect = el.getBoundingClientRect();
    const dpr = getCanvasDensity();
    item?.destroy();
    item = createItem(el, {
      layer: props.layer ?? 9,
      shaders,
      uni: {
        value2: (rect.width || 1) * dpr,
        value4: (rect.height || 1) * dpr,
        value5: fillRef[0],
        value6: fillRef[1],
        value7: fillRef[2],
        value8: radius == null ? -1 : radius * dpr,
        value1: wipeRef,
      },
    });
    window.requestAnimationFrame(syncSize);
    window.addEventListener("resize", syncSize);
    onCleanup(() => {
      window.removeEventListener("resize", syncSize);
      item?.destroy();
      item = undefined;
    });
  });

  createEffect(() => {
    wipeRef = props.wipe == null ? 2 : props.wipe;
    item?.setUni({ value1: wipeRef });
  });

  createEffect(() => {
    const fill = props.fill ?? ([0.8745, 0.8745, 0.8745] as [number, number, number]);
    fillRef = fill;
    item?.setUni({ value5: fill[0], value6: fill[1], value7: fill[2] });
  });

  return (
    <span ref={el} class={props.class}>
      {props.children}
    </span>
  );
}
