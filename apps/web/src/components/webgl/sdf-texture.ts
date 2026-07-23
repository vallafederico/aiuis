import { loadTexture, type TextureLoaderResult } from "@ssscript/webgl";

export type SdfMeta = {
  type: string;
  width: number;
  height: number;
  spread: number;
};

export type SdfAssets = {
  meta: SdfMeta;
  texture: TextureLoaderResult;
};

const sdfCache = new Map<string, Promise<SdfAssets>>();

/** sdf texture + sidecar from `pnpm msdf` (public/msdf). Engine must be ready. */
export function loadSdf(name: string): Promise<SdfAssets> {
  let cached = sdfCache.get(name);
  if (!cached) {
    cached = Promise.all([
      fetch(`/msdf/${name}.json`).then((r) => r.json() as Promise<SdfMeta>),
      loadTexture(`/msdf/${name}.png`, { fit: "stretch" }),
    ]).then(([meta, texture]) => ({ meta, texture }));
    sdfCache.set(name, cached);
  }
  return cached;
}

export type ProgressiveBlur = {
  /** max blur radius on screen, px (animatable later via uni value3) */
  radius: number;
  /** ramp direction in deg — 0 blurs toward the bottom, 90 toward the right.
   * omit angle/from/to entirely for a uniform edge blur all around */
  angle?: number;
  /** where the ramp starts/ends along the direction, 0–1 over the element */
  from?: number;
  to?: number;
};

const fmt = (n: number) => n.toFixed(6);

/**
 * Shared decode: sdf → alpha with analytic aa, plus a figma-style
 * progressive blur — the alpha transition band widens along a ramp
 * (blurring an sdf ≈ softening its edge; thin features fade out like a
 * real blur). Max radius is capped by the baked spread of the field.
 * Expects `screenSd` (signed distance in screen px) in scope.
 */
export function sdfBlurGlsl(blur?: ProgressiveBlur) {
  const angle = ((blur?.angle ?? 0) * Math.PI) / 180;
  const dir = [Math.sin(angle), Math.cos(angle)];
  // radius alone = uniform edge blur; any ramp field makes it progressive
  const ramped =
    blur &&
    (blur.angle !== undefined ||
      blur.from !== undefined ||
      blur.to !== undefined);
  const t = ramped
    ? "clamp((p - BLUR_FROM) / max(BLUR_TO - BLUR_FROM, 0.0001), 0.0, 1.0)"
    : "1.0";
  return `
const vec2 BLUR_DIR = vec2(${fmt(dir[0])}, ${fmt(dir[1])});
const float BLUR_FROM = ${fmt(blur?.from ?? 0)};
const float BLUR_TO = ${fmt(blur?.to ?? 1)};

float blurAlpha(float screenSd, float maxSd, vec2 uv) {
  float blurPx = uUni[0].z; // value3: max blur radius, px
  float p = dot(uv - 0.5, BLUR_DIR) + 0.5;
  float t = ${t};
  // cap at the field's encoded range — past it the sdf saturates and the
  // whole quad would pick up a floor of alpha (boxy haze)
  float r = clamp(blurPx * t, 0.5, maxSd * 0.95);
  return smoothstep(-r, r, screenSd);
}`;
}

/**
 * Fragment for a DOM-tracked item drawing a whole sdf texture — same decode
 * and analytic aa as the text shader, misses transparent (premultiplied).
 * uni.value2 must carry the element width in px, value3 the blur radius.
 */
export function buildSdfFragment(meta: SdfMeta, blur?: ProgressiveBlur) {
  return `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
uniform sampler2D uTexture;
out vec4 outColor;

const float TEX_W = ${fmt(meta.width)};
const float SPREAD = ${fmt(meta.spread)};
${sdfBlurGlsl(blur)}

void main() {
  float widthPx = max(uUni[0].y, 1.0); // value2: element width in px
  float sd = texture(uTexture, vUv).r - 0.5;
  // analytic aa: sdf px scaled by texture→screen magnification
  float mag = widthPx / TEX_W;
  float screenSd = sd * 2.0 * SPREAD * mag;
  float alpha = blurAlpha(screenSd, SPREAD * mag, vUv);

  vec3 key = vec3(0.0, 0.0, 1.0); // --color-key
  outColor = vec4(key * alpha, alpha);
}`;
}
