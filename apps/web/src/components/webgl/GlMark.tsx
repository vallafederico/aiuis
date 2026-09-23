import { createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { createItem, type ItemController } from "shooosh";
import { getCanvasDensity, webgl } from "~/lib/stores/webglStore";
import { readCssColor } from "./css-color";
import { glslShaders } from "./shaders";

/**
 * Stroke marks drawn into the WebGL scene so the mosaic post can hop them.
 * kind 0/1 are chevrons. kind 2 lerps the corner brackets with `morph`.
 */
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
out vec4 outColor;

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float corner(vec2 q, vec2 a0, vec2 b0, vec2 c0, vec2 a1, vec2 b1, vec2 c1, float t) {
  vec2 a = mix(a0, a1, t);
  vec2 b = mix(b0, b1, t);
  vec2 c = mix(c0, c1, t);
  return min(sdSeg(q, a, b), sdSeg(q, b, c));
}

float arrow(vec2 q, float right) {
  float tipX = mix(5.0, 11.0, right);
  float tailX = mix(11.0, 5.0, right);
  vec2 tip = vec2(tipX, 8.0);
  return min(sdSeg(q, vec2(tailX, 3.2), tip), sdSeg(q, tip, vec2(tailX, 12.8)));
}

float corners(vec2 q, float t) {
  float d = corner(q, vec2(2.0, 6.0), vec2(2.0, 2.0), vec2(6.0, 2.0), vec2(6.0, 2.0), vec2(6.0, 6.0), vec2(2.0, 6.0), t);
  d = min(d, corner(q, vec2(10.0, 2.0), vec2(14.0, 2.0), vec2(14.0, 6.0), vec2(10.0, 2.0), vec2(10.0, 6.0), vec2(14.0, 6.0), t));
  d = min(d, corner(q, vec2(14.0, 10.0), vec2(14.0, 14.0), vec2(10.0, 14.0), vec2(10.0, 14.0), vec2(10.0, 10.0), vec2(14.0, 10.0), t));
  d = min(d, corner(q, vec2(6.0, 14.0), vec2(2.0, 14.0), vec2(2.0, 10.0), vec2(6.0, 14.0), vec2(6.0, 10.0), vec2(2.0, 10.0), t));
  return d;
}

void main() {
  vec2 res = vec2(max(uUni[0].y, 1.0), max(uUni[0].w, 1.0));
  float s = min(res.x, res.y);
  vec2 q = ((vUv * res - res * 0.5) / s) * 16.0 + 8.0;
  float kind = uUni[0].x;
  float d = kind < 1.5 ? arrow(q, step(0.5, kind)) : corners(q, clamp(uUni[0].z, 0.0, 1.0));
  float px = 16.0 / s;
  float a = 1.0 - smoothstep(0.7 - px, 0.7 + px, d);
  vec3 fill = vec3(uUni[1].x, uUni[1].y, uUni[1].z);
  outColor = vec4(fill * a, a);
}
`;

const shaders = glslShaders(FRAGMENT);

export default function GlMark(props: {
  kind: "prev" | "next" | "corners";
  /** 0 expand, 1 compress. Only read for corners. */
  morph?: number;
  /** Stroke color. Defaults to the key blue. */
  color?: [number, number, number];
  class?: string;
}) {
  let el!: HTMLSpanElement;
  let item: ItemController | undefined;
  let colorRef: [number, number, number] = props.color ?? [0, 0, 1];

  const kindValue = () => (props.kind === "prev" ? 0 : props.kind === "next" ? 1 : 2);

  const sync = () => {
    if (!item) return;
    const rect = el.getBoundingClientRect();
    const dpr = getCanvasDensity();
    item.setUni({
      value1: kindValue(),
      value2: (rect.width || 1) * dpr,
      value3: props.morph ?? 0,
      value4: (rect.height || 1) * dpr,
      value5: colorRef[0],
      value6: colorRef[1],
      value7: colorRef[2],
    });
  };

  createEffect(() => {
    colorRef = props.color ?? readCssColor("--color-key");
    item?.setUni({ value5: colorRef[0], value6: colorRef[1], value7: colorRef[2] });
  });

  createEffect(() => {
    if (isServer || !webgl.loaded) return;
    const kind = kindValue();
    const rect = el.getBoundingClientRect();
    const dpr = getCanvasDensity();
    item?.destroy();
    item = createItem(el, {
      layer: 30,
      shaders,
      uni: {
        value1: kind,
        value2: (rect.width || 1) * dpr,
        value3: 0,
        value4: (rect.height || 1) * dpr,
        value5: colorRef[0],
        value6: colorRef[1],
        value7: colorRef[2],
      },
    });
    window.addEventListener("resize", sync);
    onCleanup(() => {
      window.removeEventListener("resize", sync);
      item?.destroy();
      item = undefined;
    });
  });

  createEffect(() => {
    if (isServer || !webgl.loaded) return;
    sync();
  });

  return <span ref={el} aria-hidden="true" class={`pointer-events-none block w-4 h-4 ${props.class ?? ""}`} />;
}
