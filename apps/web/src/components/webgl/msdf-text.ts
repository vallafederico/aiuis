import { loadTexture, type TextureLoaderResult } from "@ssscript/webgl";
import { sdfBlurGlsl, type ProgressiveBlur } from "./sdf-texture";

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

/** Atlas + metrics from `pnpm msdf` (public/msdf). Engine must be ready. */
export function loadMsdfFont(font: string): Promise<MsdfFontAssets> {
  let cached = fontCache.get(font);
  if (!cached) {
    cached = Promise.all([
      fetch(`/msdf/${font}.json`).then((r) => r.json() as Promise<BmFont>),
      loadTexture(`/msdf/${font}.png`, { fit: "stretch" }),
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
  /** figma-style progressive blur ramp — radius soft-caps at the font's
   * distanceRange × magnification, keep it subtle on text */
  blur?: ProgressiveBlur;
};

/**
 * Fragment for a DOM-tracked item whose quad IS the text box — glyph rects
 * baked in, misses transparent (premultiplied). Multi-line via `\n`.
 * Returns the box's width/height ratio so the element can be sized with
 * `aspect-ratio`, plus the box size in font px (for font-size sizing).
 * uni.value2 must carry the element width in px (for analytic aa).
 */
export function buildMsdfTextFragment(
  font: BmFont,
  text: string,
  layout: MsdfTextLayout = {},
) {
  const { scaleW, scaleH } = font.common;
  const distanceRange = font.distanceField?.distanceRange ?? 4;
  const chars = new Map(font.chars.map((c) => [c.char, c]));
  // figma-style defaults: tracking −6%, line height 100% of the font size
  const trackingPx = (layout.tracking ?? -0.06) * font.info.size;
  const lineSpacing = (layout.lineHeight ?? 1) * font.info.size;

  // pen advance in font px, top-down y like bmfont
  const glyphs: { src: number[]; dst: number[] }[] = [];
  let w = 0;
  text.split("\n").forEach((line, lineIndex) => {
    let pen = 0;
    let last = 0;
    const lineY = lineIndex * lineSpacing;
    for (const ch of line) {
      const g = chars.get(ch);
      if (!g) {
        pen += font.info.size * 0.33 + trackingPx; // unknown char → gap
        continue;
      }
      if (g.width > 0 && g.height > 0) {
        glyphs.push({
          // atlas rect, v top-down like the png (this load path uploads unflipped)
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
      last = pen - trackingPx; // width without the trailing tracking
    }
    w = Math.max(w, last);
  });

  const ys = glyphs.flatMap((g) => [g.dst[1], g.dst[3]]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const h = y1 - y0;

  const fmt = (n: number) => n.toFixed(6);
  const src = glyphs
    .map((g) => `vec4(${g.src.map(fmt).join(", ")})`)
    .join(",\n\t");
  const dst = glyphs
    .map((g) =>
      `vec4(${[g.dst[0] / w, (g.dst[1] - y0) / h, g.dst[2] / w, (g.dst[3] - y0) / h].map(fmt).join(", ")})`,
    )
    .join(",\n\t");

  const fragment = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
uniform sampler2D uTexture;
out vec4 outColor;

#define GLYPHS ${glyphs.length}
const vec4 SRC[GLYPHS] = vec4[](
	${src}
);
const vec4 DST[GLYPHS] = vec4[](
	${dst}
);
const float ATLAS_W = ${fmt(scaleW)};
const float PX_RANGE = ${fmt(distanceRange)};
${sdfBlurGlsl(layout.blur)}

float median3(vec3 c) { return max(min(c.r, c.g), min(c.b, c.r)); }

void main() {
  float widthPx = max(uUni[0].y, 1.0); // value2: element width in px
  vec2 local = vUv; // quad space, y down (matches bmfont cells)

  float alpha = 0.0;
  for (int i = 0; i < GLYPHS; i++) {
    vec4 d = DST[i];
    float inside = step(d.x, local.x) * step(local.x, d.z)
                 * step(d.y, local.y) * step(local.y, d.w);
    vec2 g = clamp((local - d.xy) / (d.zw - d.xy), 0.0, 1.0);
    vec3 s = texture(uTexture, mix(SRC[i].xy, SRC[i].zw, g)).rgb;
    float sd = median3(s) - 0.5;
    // analytic aa: sdf px scaled by atlas→screen magnification (no derivatives)
    float glyphScreenPx = (d.z - d.x) * widthPx;
    float glyphAtlasPx = abs(SRC[i].z - SRC[i].x) * ATLAS_W;
    float glyphMag = glyphScreenPx / max(glyphAtlasPx, 0.0001);
    float screenSd = sd * PX_RANGE * glyphMag;
    alpha = max(alpha, inside * blurAlpha(screenSd, PX_RANGE * glyphMag * 0.5, vUv));
  }

  // premultiplied alpha — misses stay transparent
  vec3 key = vec3(0.0, 0.0, 1.0); // --color-key
  outColor = vec4(key * alpha, alpha);
}`;

  return { fragment, aspect: w / h, width: w, height: h };
}
