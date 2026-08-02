import { loadTexture, type TextureLoaderResult } from "@ssscript/webgl";
import { sdfBlurGlsl, type ProgressiveBlur } from "./sdf-texture";
import AlteHaasGroteskBoldJson from "../../../public/msdf/AlteHaasGroteskBold.json";

type BmChar = {
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
};

export type BmFont = {
  chars: BmChar[];
  common: { lineHeight: number; base: number; scaleW: number; scaleH: number };
  info: { size: number };
  distanceField?: { distanceRange?: number };
};

export type MsdfFontAssets = {
  metrics: BmFont;
  texture: TextureLoaderResult;
};

const fontCache = new Map<string, Promise<MsdfFontAssets>>();

/** Metrics available synchronously (statically imported at module load). */
const syncMetricsCache = new Map<string, BmFont>();
syncMetricsCache.set("AlteHaasGroteskBold", AlteHaasGroteskBoldJson as unknown as BmFont);

/** Returns font metrics synchronously if they were statically imported; undefined otherwise. */
export function getMsdfFontMetricsSync(font: string): BmFont | undefined {
  return syncMetricsCache.get(font);
}

// Module-level charMap cache — avoids re-building Map<char,BmChar> on every call.
const charMapCache = new WeakMap<BmFont, Map<string, BmChar>>();

/** Returns (and caches) a char→BmChar lookup map for the given BmFont. */
export function getCharMap(font: BmFont): Map<string, BmChar> {
  let m = charMapCache.get(font);
  if (!m) {
    m = new Map(font.chars.map((c) => [c.char, c]));
    charMapCache.set(font, m);
  }
  return m;
}

/** Atlas + metrics from `pnpm msdf` (public/msdf). Engine must be ready. */
export function loadMsdfFont(font: string): Promise<MsdfFontAssets> {
  let cached = fontCache.get(font);
  if (!cached) {
    cached = Promise.all([
      fetch(`/msdf/${font}.json`).then((r) => r.json() as Promise<BmFont>),
      loadTexture(`/msdf/${font}.png`, { fit: "stretch", format: "rgb" }),
    ]).then(([metrics, texture]) => ({ metrics, texture }));
    fontCache.set(font, cached);
  }
  return cached;
}

export type MsdfTextLayout = {
  /** extra advance between glyphs, in em (1 = one font size) */
  tracking?: number;
  /** line spacing multiplier over the font's own line height */
  lineHeight?: number;
  /** figma-style progressive blur ramp */
  blur?: ProgressiveBlur;
  /** RGB color (0–1 range), defaults to blue [0, 0, 1] */
  color?: [number, number, number];
  /** opacity multiplier (0–1), defaults to 1 */
  alpha?: number;
  /** stretch the msdf layout to fill the DOM box — distorts glyphs; the beloved accident */
  weird?: boolean;
};

/** Computes glyph layout and returns Float32Array for the instanced renderer. */
export function buildMsdfGlyphData(
  font: BmFont,
  text: string,
  layout: MsdfTextLayout = {},
): { glyphData: Float32Array; glyphCount: number; aspect: number; width: number; height: number } {
  const { scaleW, scaleH } = font.common;
  const chars = getCharMap(font);
  const trackingPx = (layout.tracking ?? -0.06) * font.info.size;
  const lineSpacing = (layout.lineHeight ?? 1) * font.info.size;

  const rawGlyphs: { src: [number, number, number, number]; dst: [number, number, number, number] }[] = [];
  let w = 0;

  text.split("\n").forEach((line, lineIndex) => {
    let pen = 0;
    let last = 0;
    const lineY = lineIndex * lineSpacing;
    for (const ch of line) {
      const g = chars.get(ch);
      if (!g) {
        pen += font.info.size * 0.33 + trackingPx;
        continue;
      }
      if (g.width > 0 && g.height > 0) {
        rawGlyphs.push({
          src: [
            g.x / scaleW,
            g.y / scaleH,
            (g.x + g.width) / scaleW,
            (g.y + g.height) / scaleH,
          ],
          dst: [
            pen + g.xoffset,
            lineY + g.yoffset,
            pen + g.xoffset + g.width,
            lineY + g.yoffset + g.height,
          ],
        });
      }
      pen += g.xadvance + trackingPx;
      last = pen - trackingPx;
    }
    w = Math.max(w, last);
  });

  // Compute bounding box with tracking loop (avoids spread arg-limit risk)
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const g of rawGlyphs) {
    if (g.dst[1] < y0) y0 = g.dst[1];
    if (g.dst[3] > y1) y1 = g.dst[3];
  }
  if (!isFinite(y0)) y0 = 0;
  if (!isFinite(y1)) y1 = 0;
  const h = y1 - y0 || 1;

  // Normalize DST to 0..1 element space (same as buildMsdfTextFragment)
  const glyphCount = rawGlyphs.length;
  const glyphData = new Float32Array(glyphCount * 8);
  for (let i = 0; i < glyphCount; i++) {
    const { src, dst } = rawGlyphs[i]!;
    const base = i * 8;
    // dst in normalized element space
    glyphData[base + 0] = dst[0] / w;
    glyphData[base + 1] = (dst[1] - y0) / h;
    glyphData[base + 2] = dst[2] / w;
    glyphData[base + 3] = (dst[3] - y0) / h;
    // src in atlas UV space
    glyphData[base + 4] = src[0];
    glyphData[base + 5] = src[1];
    glyphData[base + 6] = src[2];
    glyphData[base + 7] = src[3];
  }

  return { glyphData, glyphCount, aspect: w / (h || 1), width: w, height: h };
}

/**
 * Fragment for a DOM-tracked item whose quad IS the text box — glyph rects
 * baked in, misses transparent (premultiplied). Multi-line via `\n`.
 * Used by the weird path and any path that needs blur.
 */
export function buildMsdfTextFragment(
  font: BmFont,
  text: string,
  layout: MsdfTextLayout = {},
) {
  const { scaleW, scaleH } = font.common;
  const distanceRange = font.distanceField?.distanceRange ?? 4;
  const chars = getCharMap(font);
  const trackingPx = (layout.tracking ?? -0.06) * font.info.size;
  const lineSpacing = (layout.lineHeight ?? 1) * font.info.size;

  const glyphs: { src: number[]; dst: number[] }[] = [];
  let w = 0;
  text.split("\n").forEach((line, lineIndex) => {
    let pen = 0;
    let last = 0;
    const lineY = lineIndex * lineSpacing;
    for (const ch of line) {
      const g = chars.get(ch);
      if (!g) {
        pen += font.info.size * 0.33 + trackingPx;
        continue;
      }
      if (g.width > 0 && g.height > 0) {
        glyphs.push({
          src: [
            g.x / scaleW,
            g.y / scaleH,
            (g.x + g.width) / scaleW,
            (g.y + g.height) / scaleH,
          ],
          dst: [
            pen + g.xoffset,
            lineY + g.yoffset,
            pen + g.xoffset + g.width,
            lineY + g.yoffset + g.height,
          ],
        });
      }
      pen += g.xadvance + trackingPx;
      last = pen - trackingPx;
    }
    w = Math.max(w, last);
  });

  // Bounding box — tracking loop (avoids spread arg-limit on large glyph arrays)
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const g of glyphs) {
    if (g.dst[1] < y0) y0 = g.dst[1];
    if (g.dst[3] > y1) y1 = g.dst[3];
  }
  if (!isFinite(y0)) y0 = 0;
  if (!isFinite(y1)) y1 = 0;
  const h = y1 - y0 || 1;

  const fmt = (n: number) => n.toFixed(6);
  const [r, g, b] = layout.color ?? [0, 0, 1];
  const a = layout.alpha ?? 1.0;
  const src = glyphs
    .map((g) => `vec4(${g.src.map(fmt).join(", ")})`)
    .join(",\n\t");
  const dst = glyphs
    .map((g) =>
      `vec4(${[g.dst[0] / w, (g.dst[1] - y0) / h, g.dst[2] / w, (g.dst[3] - y0) / h].map(fmt).join(", ")})`,
    )
    .join(",\n\t");

  const weirdMode = layout.weird ?? false;
  const mainPrologue = weirdMode
    ? `void main() {
  float widthPx = max(uUni[0].y, 1.0); // value2: element width in px
  vec2 local = vUv; // quad space, y down (matches bmfont cells)`
    : `const float BOX_ASPECT = ${fmt(w / h)};

void main() {
  float widthPx = max(uUni[0].y, 1.0); // value2: element width in px
  float heightPx = max(uUni[0].w, 1.0); // value4: element height in px
  // uniform scale: msdf box fits the element width; center the ink vertically
  float fy = max(widthPx / (BOX_ASPECT * heightPx), 0.0001);
  vec2 local = vec2(vUv.x, (vUv.y - 0.5 * (1.0 - fy)) / fy);`;

  const fragment = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
uniform sampler2D uTexture;
out vec4 outColor;

#define GLYPHS ${glyphs.length}
const vec4 SRC[GLYPHS] = vec4[](
\t${src}
);
const vec4 DST[GLYPHS] = vec4[](
\t${dst}
);
const float ATLAS_W = ${fmt(scaleW)};
const float PX_RANGE = ${fmt(distanceRange)};
${sdfBlurGlsl(layout.blur)}

float median3(vec3 c) { return max(min(c.r, c.g), min(c.b, c.r)); }

${mainPrologue}

  float alpha = 0.0;
  for (int i = 0; i < GLYPHS; i++) {
    vec4 d = DST[i];
    if (local.x < d.x || local.x > d.z || local.y < d.y || local.y > d.w) continue;
    vec2 g = clamp((local - d.xy) / (d.zw - d.xy), 0.0, 1.0);
    vec3 s = texture(uTexture, mix(SRC[i].xy, SRC[i].zw, g)).rgb;
    float sd = median3(s) - 0.5;
    float glyphScreenPx = (d.z - d.x) * widthPx;
    float glyphAtlasPx = abs(SRC[i].z - SRC[i].x) * ATLAS_W;
    float glyphMag = glyphScreenPx / max(glyphAtlasPx, 0.0001);
    float screenSd = sd * PX_RANGE * glyphMag;
    alpha = max(alpha, blurAlpha(screenSd, PX_RANGE * glyphMag * 0.5, vUv));
  }

  vec3 key = vec3(${fmt(r)}, ${fmt(g)}, ${fmt(b)});
  float opacity = ${fmt(a)};
  outColor = vec4(key * alpha * opacity, alpha * opacity);
}`;

  return { fragment, aspect: w / h, width: w, height: h };
}
