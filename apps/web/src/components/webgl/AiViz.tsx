import { onCleanup, onMount } from "solid-js";
import { createItem, type ItemController } from "@ssscript/webgl";

const PAPER = [1.0, 1.0, 1.0] as const;
const LAYER_OPACITY = 0.8;
const BLUR_BG = 36;
const BLUR_FG = 54;
/** blur ramp directions (deg) — soft edge points this way */
const BLUR_DIR_BG = 35;
const BLUR_DIR_MID = 200;
const BLUR_DIR_FG = 120;

const fragment = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 pos = p;
  v += a * noise(pos);
  pos = pos * 2.02 + vec2(1.7, 9.2);
  a *= 0.5;
  v += a * noise(pos);
  pos = pos * 2.02 + vec2(1.7, 9.2);
  a *= 0.5;
  v += a * noise(pos);
  pos = pos * 2.02 + vec2(1.7, 9.2);
  a *= 0.5;
  v += a * noise(pos);
  return v;
}

vec3 gradientFill(vec2 uv) {
  vec3 blue = vec3(0.0, 0.050980392156862744, 1.0);
  vec3 white = vec3(1.0);
  return mix(blue, white, uv.y);
}

float blobMask(
  vec2 uv,
  vec2 center,
  float radius,
  float blurPx,
  float blurAngle,
  vec2 res,
  float time,
  float seed
) {
  vec2 p = uv - center;
  float aspect = res.x / max(res.y, 1.0);
  p.x *= aspect;
  vec2 warp = vec2(
    fbm(p * 2.8 + vec2(time * 0.08 + seed, seed * 1.7)) - 0.5,
    fbm(p * 2.8 + vec2(seed * 2.3, time * 0.09 + seed)) - 0.5
  ) * 0.12;
  p += warp;
  float dist = length(p);

  // progressive soft edge: sharp opposite blurAngle, soft along it
  vec2 blurDir = vec2(sin(blurAngle), cos(blurAngle));
  float t = clamp(dot(normalize(p + 1e-5), blurDir) * 0.5 + 0.5, 0.0, 1.0);
  float edgePx = mix(blurPx * 0.12, blurPx, t);
  float edge = edgePx / max(min(res.x, res.y), 1.0);
  return 1.0 - smoothstep(radius - edge, radius + edge, dist);
}

vec3 blendExclusion(vec3 base, vec3 blend) {
  return base + blend - 2.0 * base * blend;
}

vec3 blendDifference(vec3 base, vec3 blend) {
  return abs(base - blend);
}

void main() {
  vec2 uv = vUv;
  float time = uUni[0].x;
  vec2 res = vec2(max(uUni[0].y, 1.0), max(uUni[0].z, 1.0));
  vec3 fill = gradientFill(uv);

  // Z stack with a light vertical stagger so layers read apart; tiny parallax.
  vec2 origin = vec2(0.5, 0.5);
  vec2 bgCenter = origin + vec2(0.0, 0.045) + vec2(sin(time * 0.17), cos(time * 0.13)) * 0.01;
  vec2 midCenter = origin + vec2(cos(time * 0.11), sin(time * 0.15)) * 0.008;
  vec2 fgCenter = origin + vec2(0.0, -0.045) + vec2(sin(time * 0.19 + 1.2), cos(time * 0.16 + 0.8)) * 0.006;

  float deg = 0.017453292519943295;
  float bgMask = blobMask(uv, bgCenter, 0.16, ${BLUR_BG}.0, ${BLUR_DIR_BG}.0 * deg, res, time, 0.0) * ${LAYER_OPACITY};
  float midMask = blobMask(uv, midCenter, 0.12, ${BLUR_BG}.0, ${BLUR_DIR_MID}.0 * deg, res, time, 2.5) * ${LAYER_OPACITY};
  float fgMask = blobMask(uv, fgCenter, 0.09, float(${BLUR_FG}), ${BLUR_DIR_FG}.0 * deg, res, time, 5.0) * ${LAYER_OPACITY};

  // Z stack on paper: each blend uses the already-composited layer below.
  vec3 paper = vec3(${PAPER[0]}, ${PAPER[1]}, ${PAPER[2]});
  vec3 color = paper;
  color = mix(color, fill, bgMask); // background — src-over
  color = mix(color, blendExclusion(color, fill), midMask); // middleground
  color = mix(color, blendDifference(color, fill), fgMask); // foreground

  outColor = vec4(color, 1.0);
}`;

export default function AiViz() {
  let el!: HTMLDivElement;
  let item: ItemController | undefined;

  onMount(() => {
    const start = performance.now();
    item = createItem(el, {
      shaders: { fragment },
      uni: { value1: 0, value2: 1, value3: 1 },
      onFrame: (controller, frame) => {
        const t = (frame.now - start) * 0.001;
        controller.setUni({
          value1: t,
          value2: frame.canvas.clientWidth,
          value3: frame.canvas.clientHeight,
        });
      },
    });
  });

  onCleanup(() => {
    item?.destroy();
    item = undefined;
  });

  return (
    <div
      ref={el}
      class="pointer-events-none fixed inset-0 h-svh w-screen"
      aria-hidden="true"
    />
  );
}
