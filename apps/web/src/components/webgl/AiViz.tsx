import { onCleanup, onMount, type Accessor } from "solid-js";
import { createItem, type ItemController } from "@ssscript/webgl";
import type { AiVizParams } from "./ai-viz-params";

const PAPER = [1.0, 1.0, 1.0] as const;
const BLUR_BG = 36;
const BLUR_FG = 54;
/** blur ramp directions (deg) — soft edge points this way */
const BLUR_DIR_BG = 35;
const BLUR_DIR_MID = 200;
const BLUR_DIR_FG = 120;

/** Base blob radii (unchanged from the original design). */
const RADIUS_BG = 0.08;
const RADIUS_MID = 0.06;
const RADIUS_FG = 0.045;

const TAU = Math.PI * 2;

/** slight x/y speed offset so the deform warp doesn't look symmetric */
const DEFORM_DETUNE = 1.125;

/** Drift — slow wander of blob centers, expressed as fractions of the breath hz. */
const DRIFT_FREQ_X = 0.7;
const DRIFT_FREQ_Y = 0.55;
const DRIFT_AMOUNT_BG = 0.005;
const DRIFT_AMOUNT_MID = 0.004;
const DRIFT_AMOUNT_FG = 0.003;

/** Per-layer phase offsets (radians), evenly spread so bg/mid/fg breathe out of sync. */
const PHASE_BG = 0.0;
const PHASE_MID = (TAU * 1) / 3;
const PHASE_FG = (TAU * 2) / 3;

/** fbm seeds — keep the warp pattern visually distinct per layer (unrelated to timing). */
const SEED_BG = 0.0;
const SEED_MID = 2.5;
const SEED_FG = 5.0;

/** Formats a JS number as a valid GLSL ES 3.00 float literal (which requires a decimal point). */
const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

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
  float seed,
  float phase,
  float breathHz,
  float rotateRadPerSec,
  float pulseAmount,
  float deformAmount,
  float deformHzX,
  float deformHzY
) {
  vec2 p = uv - center;

  // Aspect-correct first, so the shape lives in a uniform (circular) space
  // before rotation and radial deform are applied.
  float aspect = res.x / max(res.y, 1.0);
  p.x *= aspect;

  // Rotate: shared spin tempo (now in aspect-corrected space, so the blob
  // stays round while its internal pattern turns). Phase offset keeps layers
  // out of sync with each other.
  float angle = time * rotateRadPerSec + phase;
  float ca = cos(angle);
  float sa = sin(angle);
  p = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
  float rotatedBlurAngle = blurAngle + angle;

  float dist = length(p);

  // Deform: radial radius modulation from fbm scrolling at a rate tied to the
  // breath tempo. Sampled by angle (not by displacing p), so the outline
  // wobbles without ever stretching into an ellipse.
  float theta = atan(p.y, p.x);
  vec2 angleP = vec2(cos(theta), sin(theta));
  float warpA = fbm(angleP * 2.8 + vec2(time * deformHzX + seed, seed * 1.7));
  float warpB = fbm(angleP * 2.8 + vec2(seed * 2.3, time * deformHzY + seed));
  float deformTerm = ((warpA + warpB) * 0.5 - 0.5) * 2.0 * deformAmount;

  // Pulsate: radius breathes in/out once per breath cycle.
  float pulse = 1.0 + pulseAmount * sin(time * breathHz * ${f(TAU)} + phase);
  float pulsedRadius = radius * pulse * (1.0 + deformTerm);

  // progressive soft edge: sharp opposite blurAngle, soft along it
  vec2 blurDir = vec2(sin(rotatedBlurAngle), cos(rotatedBlurAngle));
  float t = clamp(dot(normalize(p + 1e-5), blurDir) * 0.5 + 0.5, 0.0, 1.0);
  float edgePx = mix(blurPx * 0.12, blurPx, t);
  float edge = edgePx / max(min(res.x, res.y), 1.0);
  return 1.0 - smoothstep(pulsedRadius - edge, pulsedRadius + edge, dist);
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
  float breathHz = uUni[0].w;
  float pulseAmount = uUni[1].x;
  float rotateRadPerSec = uUni[1].y;
  float deformAmount = uUni[1].z;
  float deformHzX = uUni[1].w;
  float deformHzY = deformHzX * ${f(DEFORM_DETUNE)};
  float layerOpacity = uUni[2].x;
  float driftAmount = uUni[2].y;
  vec3 fill = gradientFill(uv);

  // Z stack with a light vertical stagger so layers read apart; drift wanders on
  // breath harmonics so it stays "on tempo" instead of arbitrary speeds.
  vec2 origin = vec2(0.5, 0.5);
  float driftAngleX = time * breathHz * ${f(TAU)} * ${f(DRIFT_FREQ_X)};
  float driftAngleY = time * breathHz * ${f(TAU)} * ${f(DRIFT_FREQ_Y)};
  vec2 bgCenter = origin + vec2(0.0, 0.0225) + vec2(sin(driftAngleX + ${f(PHASE_BG)}), cos(driftAngleY + ${f(PHASE_BG)})) * ${f(DRIFT_AMOUNT_BG)} * driftAmount;
  vec2 midCenter = origin + vec2(cos(driftAngleX + ${f(PHASE_MID)}), sin(driftAngleY + ${f(PHASE_MID)})) * ${f(DRIFT_AMOUNT_MID)} * driftAmount;
  vec2 fgCenter = origin + vec2(0.0, -0.0225) + vec2(sin(driftAngleX + ${f(PHASE_FG)}), cos(driftAngleY + ${f(PHASE_FG)})) * ${f(DRIFT_AMOUNT_FG)} * driftAmount;

  float deg = 0.017453292519943295;
  float bgMask = blobMask(uv, bgCenter, ${f(RADIUS_BG)}, ${BLUR_BG}.0, ${BLUR_DIR_BG}.0 * deg, res, time, ${f(SEED_BG)}, ${f(PHASE_BG)}, breathHz, rotateRadPerSec, pulseAmount, deformAmount, deformHzX, deformHzY) * layerOpacity;
  float midMask = blobMask(uv, midCenter, ${f(RADIUS_MID)}, ${BLUR_BG}.0, ${BLUR_DIR_MID}.0 * deg, res, time, ${f(SEED_MID)}, ${f(PHASE_MID)}, breathHz, rotateRadPerSec, pulseAmount, deformAmount, deformHzX, deformHzY) * layerOpacity;
  float fgMask = blobMask(uv, fgCenter, ${f(RADIUS_FG)}, float(${BLUR_FG}), ${BLUR_DIR_FG}.0 * deg, res, time, ${f(SEED_FG)}, ${f(PHASE_FG)}, breathHz, rotateRadPerSec, pulseAmount, deformAmount, deformHzX, deformHzY) * layerOpacity;

  // Z stack on paper: each blend uses the already-composited layer below.
  vec3 paper = vec3(${PAPER[0]}, ${PAPER[1]}, ${PAPER[2]});
  vec3 color = paper;
  color = mix(color, fill, bgMask); // background — src-over
  color = mix(color, blendExclusion(color, fill), midMask); // middleground
  color = mix(color, blendDifference(color, fill), fgMask); // foreground

  outColor = vec4(color, 1.0);
}`;

export default function AiViz(props: { params: Accessor<AiVizParams> }) {
  let el!: HTMLDivElement;
  let item: ItemController | undefined;

  onMount(() => {
    const start = performance.now();
    const p0 = props.params();
    const breathHz0 = 1 / p0.breathPeriod;
    item = createItem(el, {
      shaders: { fragment },
      uni: {
        value1: 0,
        value2: 1,
        value3: 1,
        value4: breathHz0,
        value5: p0.pulseAmount,
        value6: p0.rotateSpeed * breathHz0 * TAU,
        value7: p0.deformAmount,
        value8: p0.deformSpeed * breathHz0,
        value9: p0.layerOpacity,
        value10: p0.driftAmount,
      },
      onFrame: (controller, frame) => {
        const t = (frame.now - start) * 0.001;
        const p = props.params();
        const breathHz = 1 / p.breathPeriod;
        controller.setUni({
          value1: t,
          value2: frame.canvas.clientWidth,
          value3: frame.canvas.clientHeight,
          value4: breathHz,
          value5: p.pulseAmount,
          value6: p.rotateSpeed * breathHz * TAU,
          value7: p.deformAmount,
          value8: p.deformSpeed * breathHz,
          value9: p.layerOpacity,
          value10: p.driftAmount,
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
