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

/**
 * Fragment for a DOM-tracked item drawing a whole sdf texture — same decode
 * and analytic aa as the text shader, misses transparent (premultiplied).
 * uni.value2 must carry the element width in px.
 */
export function buildSdfFragment(meta: SdfMeta) {
  const fmt = (n: number) => n.toFixed(6);
  return `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
uniform sampler2D uTexture;
out vec4 outColor;

const float TEX_W = ${fmt(meta.width)};
const float SPREAD = ${fmt(meta.spread)};

void main() {
  float widthPx = max(uUni[0].y, 1.0); // value2: element width in px
  float sd = texture(uTexture, vUv).r - 0.5;
  // analytic aa: sdf px scaled by texture→screen magnification
  float screenSd = sd * 2.0 * SPREAD * (widthPx / TEX_W);
  float alpha = clamp(screenSd + 0.5, 0.0, 1.0);

  vec3 key = vec3(0.0, 0.0, 1.0); // --color-key
  outColor = vec4(key * alpha, alpha);
}`;
}
