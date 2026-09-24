/**
 * WebGL2 renderer for Sketch Generation, in one of two modes:
 *
 * - Own canvas (the schematic): the pad and the result pane are two viewports
 *   of one context, so the result develops out of the strokes' own textures.
 * - Shared (the directed page): runs inside the site engine's context and
 *   composites ink, wait, reveal and the last image into one surface texture
 *   that a shooosh item draws, so the page's post effects apply. Every GL call
 *   made outside its own targets is bracketed by `guard`, which restores the
 *   engine's state.
 *
 * Ink lives in a framebuffer (R = coverage, G = stroke order), stamped with
 * instanced capsule segments under MAX blending. On generate the ink is
 * snapshotted into a slot with blurred proximity fields; those fields drive
 * the waiting bleed, the develop mask, and a procedural underpainting. The
 * model gets the strokes as a plain line drawing (FLUX.2 edits from it) and
 * the underpainting (SD 1.5's init image: a bare line drawing on white pulls
 * img2img toward white paper). The underpainting is also the result when no
 * model answers.
 */

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * What the image model gets, both framed to the drawing area and sized to
 * multiples of 64: the strokes as dark lines on white (PNG) and the
 * underpainting (JPEG).
 */
export type SketchExport = { lines: string; under: string; width: number; height: number };

type Target = {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
};

type Slot = {
  ink: Target;
  fieldS: Target;
  fieldB: Target;
  gainS: number;
  gainB: number;
  /** Aspect of the drawing rect. */
  aspect: number;
  /** The drawing rect inside the slot's ink and fields (uv offset, size); the margin is the rest. */
  rect: [number, number, number, number];
  /** Procedural reading of the strokes: the model's init image and the fallback result. */
  under: Target | null;
  /** Loaded model output; when null the slot shows `under`. */
  loaded: WebGLTexture | null;
  image: WebGLTexture | null;
};

type Program = {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
};

const BASE_WIDTH = 3.2;
const ORDER_SPAN = 8;
const SNAPSHOT_MAX = 1024;
const FIELD_MAX = 192;
const PROCEDURAL_MAX = 640;
const EXPORT_MAX = 512;
const REVEAL_S = 2.4;
const OVERLAY_END_S = 3.4;
const REDUCED_REVEAL_S = 0.7;
/** Shared mode: strokes left over a developed image stay at this strength. */
const FAINT_INK = 0.18;
const CLEAR_FADE_S = 0.45;
const MAX_SURFACE_PX = 4096;
/** Texture units the surface pass binds, and `guard` restores. */
const TEXTURE_UNITS = 6;

const FULLSCREEN_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const STROKE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;
layout(location = 2) in vec4 aMeta;
uniform vec2 uRes;
out vec2 vP;
flat out vec4 vSeg;
flat out vec3 vMeta;
void main() {
  vec2 a = aSeg.xy;
  vec2 b = aSeg.zw;
  vec2 d = b - a;
  float len = length(d);
  vec2 t = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float r = max(aMeta.x, aMeta.y) * 0.5 + 1.5;
  float along = aCorner.x < 0.0 ? -r : len + r;
  vec2 p = a + t * along + n * aCorner.y * r;
  vP = p;
  vSeg = aSeg;
  vMeta = aMeta.xyz;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const STROKE_FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vSeg;
flat in vec3 vMeta;
out vec4 o;
void main() {
  vec2 pa = vP - vSeg.xy;
  vec2 ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  float r = mix(vMeta.x, vMeta.y, h) * 0.5;
  float c = 1.0 - smoothstep(r - 0.7, r + 0.7, d);
  if (c <= 0.004) discard;
  o = vec4(c, vMeta.z, 0.0, c);
}`;

const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}`;

const PAD_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInk;
uniform vec3 uKey;
uniform float uScan;
uniform float uScanMax;
out vec4 o;
void main() {
  vec4 s = texture(uInk, vUv);
  float a = s.r;
  vec3 col = uKey;
  if (uScan >= 0.0) {
    float d = s.g - uScan * uScanMax;
    float hl = exp(-d * d * 900.0);
    col = mix(uKey, vec3(0.5, 0.58, 1.0), hl * 0.85);
    a *= mix(0.5, 1.0, hl);
  }
  o = vec4(col * a, a);
}`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uFoot;
out vec4 o;
void main() {
  float m = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 off = (vec2(float(i), float(j)) - 1.5) / 4.0 * uFoot;
      m = max(m, texture(uSrc, vUv + off).r);
    }
  }
  o = vec4(m, 0.0, 0.0, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 o;
void main() {
  float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  float v = texture(uSrc, vUv).r * w[0];
  for (int i = 1; i < 5; i++) {
    v += texture(uSrc, vUv + uDir * float(i)).r * w[i];
    v += texture(uSrc, vUv - uDir * float(i)).r * w[i];
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

const PROCEDURAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInk;
uniform sampler2D uFieldS;
uniform sampler2D uFieldB;
uniform float uGainS;
uniform float uGainB;
uniform vec2 uTexel;
uniform int uLook;
uniform float uSeed;
/** The drawing rect inside the ink textures: offset, size. */
uniform vec4 uCrop;
out vec4 o;
${NOISE}
vec2 C(vec2 uv) { return uCrop.xy + uv * uCrop.zw; }
float S(vec2 uv) { return clamp(texture(uFieldS, C(uv)).r * uGainS, 0.0, 1.0); }
float B(vec2 uv) { return clamp(texture(uFieldB, C(uv)).r * uGainB, 0.0, 1.0); }
float H(vec2 uv) { return S(uv) * 0.55 + B(uv) * 0.45; }
void main() {
  vec2 uv = vUv;
  float s = S(uv);
  float b = B(uv);
  float h = s * 0.55 + b * 0.45;
  vec2 e = uTexel * 1.5 / uCrop.zw;
  float dx = H(uv + vec2(e.x, 0.0)) - H(uv - vec2(e.x, 0.0));
  float dy = H(uv + vec2(0.0, e.y)) - H(uv - vec2(0.0, e.y));
  vec3 N = normalize(vec3(-dx * 7.0, -dy * 7.0, 1.0));
  float grainLow = fbm(uv * 7.0 + uSeed);
  float form = smoothstep(0.16, 0.5, s * 0.45 + b * 0.7 + (grainLow - 0.5) * 0.12);

  vec3 bg;
  vec3 obj;
  vec3 L;
  float shade = 0.0;
  if (uLook == 0) {
    L = normalize(vec3(-0.6, 0.55, 0.6));
    float horizon = 0.36 + (fbm(vec2(uv.x * 2.0, uSeed)) - 0.5) * 0.03;
    vec3 wall = mix(vec3(0.55, 0.5, 0.44), vec3(0.88, 0.84, 0.76), 1.0 - smoothstep(0.0, 1.2, length(uv - vec2(0.05, 0.95))));
    vec3 table = mix(vec3(0.42, 0.33, 0.26), vec3(0.66, 0.55, 0.44), uv.y / horizon);
    table *= 0.94 + 0.06 * vnoise(vec2(uv.x * 3.0, uv.y * 60.0));
    bg = uv.y < horizon ? table : wall;
    obj = mix(vec3(0.74, 0.47, 0.3), vec3(0.83, 0.78, 0.66), smoothstep(0.35, 0.7, fbm(uv * 3.0 + uSeed)));
    shade = smoothstep(0.2, 0.55, H(uv - L.xy * 0.07));
  } else if (uLook == 1) {
    L = normalize(vec3(-0.5, 0.35, 0.8));
    float v = length((uv - vec2(0.5, 0.55)) * vec2(1.0, 1.2));
    bg = mix(vec3(0.63, 0.67, 0.61), vec3(0.4, 0.44, 0.41), smoothstep(0.2, 0.9, v));
    vec3 skin = vec3(0.86, 0.67, 0.55);
    vec3 cloth = vec3(0.2, 0.19, 0.23);
    obj = mix(cloth, skin, smoothstep(0.3, 0.5, uv.y + (fbm(uv * 4.0 + uSeed) - 0.5) * 0.15));
    shade = smoothstep(0.25, 0.6, H(uv - L.xy * 0.05)) * 0.6;
  } else {
    L = normalize(vec3(0.65, 0.35, 0.6));
    float floorY = 0.3;
    vec3 wall = mix(vec3(0.68, 0.66, 0.6), vec3(0.8, 0.78, 0.72), uv.y);
    vec3 flr = mix(vec3(0.36, 0.3, 0.25), vec3(0.52, 0.44, 0.36), uv.y / floorY);
    bg = uv.y < floorY ? flr : wall;
    vec2 wq = (uv - vec2(0.73, 0.66)) / vec2(0.11, 0.17);
    float win = 1.0 - smoothstep(0.85, 1.05, max(abs(wq.x), abs(wq.y)));
    bg = mix(bg, vec3(1.0, 0.97, 0.88), win);
    vec2 sq = vec2(uv.x + (floorY - uv.y) * 0.9, uv.y);
    float shaft = (1.0 - smoothstep(0.1, 0.16, abs(sq.x - 0.62))) * step(uv.y, floorY) * smoothstep(0.0, floorY, uv.y);
    bg = mix(bg, vec3(0.95, 0.88, 0.74), shaft * 0.7);
    obj = mix(vec3(0.3, 0.24, 0.2), vec3(0.55, 0.45, 0.36), fbm(uv * 3.0 + uSeed));
    shade = smoothstep(0.2, 0.55, H(uv - L.xy * 0.06));
  }

  float diffuse = max(dot(N, L), 0.0);
  vec3 shaded = obj * (0.38 + 0.8 * diffuse) + vec3(0.06) * pow(diffuse, 12.0);
  bg *= 1.0 - 0.32 * shade * (1.0 - form);
  vec3 col = mix(bg, shaded, form);
  col *= 1.0 - 0.18 * b * (1.0 - form);
  float line = texture(uInk, C(uv)).r;
  col = mix(col, col * 0.5, line * 0.3);
  col *= 0.95 + 0.1 * fbm(uv * vec2(90.0, 30.0) + uSeed);
  col += (hash(uv * 1024.0 + uSeed) - 0.5) * 0.045;
  col *= 1.0 - 0.28 * pow(length(uv - 0.5) * 1.25, 2.4);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** The strokes as dark lines on white, cropped to the drawing rect. */
const LINES_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInk;
uniform vec4 uCrop;
out vec4 o;
void main() {
  float ink = texture(uInk, uCrop.xy + vUv * uCrop.zw).r;
  o = vec4(vec3(mix(1.0, 0.08, ink)), 1.0);
}`;

const RESULT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPrevImg;
uniform float uHasPrev;
uniform float uPrevAspect;
uniform sampler2D uNewImg;
uniform sampler2D uNewInk;
uniform sampler2D uNewField;
uniform float uNewAspect;
uniform float uNewGain;
uniform float uWait;
uniform float uWaitT;
uniform float uReveal;
uniform float uOverlay;
uniform float uPaneAspect;
uniform float uTime;
uniform float uMotion;
uniform vec3 uKey;
out vec4 o;
${NOISE}
vec2 fitUv(vec2 uv, float aspect, out float inside) {
  vec2 s = uPaneAspect > aspect ? vec2(uPaneAspect / aspect, 1.0) : vec2(1.0, aspect / uPaneAspect);
  vec2 q = (uv - 0.5) * s + 0.5;
  inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  return q;
}
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
void main() {
  vec4 col = vec4(0.0);
  float inP;
  vec2 pu = fitUv(vUv, uPrevAspect, inP);
  if (uHasPrev > 0.0) {
    col = vec4(texture(uPrevImg, pu).rgb, 1.0) * inP * (1.0 - 0.72 * uWait) * uHasPrev;
  }
  float inN;
  vec2 nu = fitUv(vUv, uNewAspect, inN);

  if (uWait > 0.001) {
    float bleed = uMotion * (1.0 - exp(-uWaitT * 0.55));
    vec2 flow = (vec2(fbm(nu * 3.0 + vec2(0.0, uTime * 0.12)), fbm(nu * 3.0 + vec2(5.2, -uTime * 0.1))) - 0.5) * 2.0;
    float ink = 0.0;
    for (int i = 0; i < 8; i++) {
      float f = float(i) / 7.0;
      ink = max(ink, texture(uNewInk, nu - flow * bleed * 0.05 * f).r * (1.0 - 0.75 * f));
    }
    float field = clamp(texture(uNewField, nu + flow * bleed * 0.02).r * uNewGain, 0.0, 1.0);
    float scan = fract(uWaitT * 0.3);
    float band = exp(-pow(((1.0 - nu.y) - scan) * 12.0, 2.0)) * uMotion;
    float breathe = 1.0 + 0.12 * sin(uTime * 2.1) * uMotion;
    float a = ink * 0.92 + field * (0.1 + 0.25 * bleed + 0.55 * band);
    a = clamp(a * breathe, 0.0, 1.0) * uWait * inN;
    vec3 c = mix(uKey, vec3(0.5, 0.58, 1.0), clamp(band * field * 1.5, 0.0, 1.0));
    col = over(vec4(c * a, a), col);
  }

  if (uReveal > 0.0) {
    vec3 img = texture(uNewImg, nu).rgb;
    float prox = clamp(texture(uNewField, nu).r * uNewGain, 0.0, 1.0);
    float n = fbm(nu * 5.0 + 1.7);
    float e = mix(n, prox, 0.62);
    float m;
    float edge;
    if (uMotion > 0.5) {
      float th = 1.0 - uReveal * 1.3;
      m = smoothstep(th, th + 0.05, e);
      edge = exp(-pow((e - th - 0.015) / 0.022, 2.0)) * (1.0 - smoothstep(0.8, 1.0, uReveal));
    } else {
      m = uReveal;
      edge = 0.0;
    }
    m *= inN;
    col = over(vec4(img, 1.0) * m, col);
    float ga = edge * 0.9 * inN;
    col = over(vec4(mix(uKey, vec3(0.62, 0.7, 1.0), 0.35) * ga, ga), col);
  }

  if (uOverlay > 0.0) {
    float ink = texture(uNewInk, nu).r * uOverlay * inN;
    col = over(vec4(uKey * ink, ink), col);
  }
  o = col;
}`;

/**
 * Shared mode: one surface, bottom to top — the last image (dimmed as new ink
 * arrives), the waiting bleed read in stroke order, the new image developing
 * out of the ink, the settling ink overlay, and the live ink. Output is
 * premultiplied; the page shows through where nothing is drawn.
 *
 * The surface is the drawing rect plus a bleed margin. Images sit exactly in
 * the drawing rect; ink, fields and glow run on into the margin and fall off
 * to nothing before its outer edge. `d` is drawing-local (0–1 on the drawing
 * rect, beyond it in the margin); each slot maps it into its own textures.
 */
const SURFACE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInk;
uniform vec4 uRect;
uniform vec2 uSize;
uniform float uBleed;
uniform sampler2D uPrevImg;
uniform sampler2D uPrevInk;
uniform float uPrevAlpha;
uniform float uPrevInkMask;
uniform float uPrevAspect;
uniform vec4 uPrevRect;
uniform sampler2D uNewImg;
uniform sampler2D uNewInk;
uniform sampler2D uNewField;
uniform float uNewAspect;
uniform vec4 uNewRect;
uniform float uNewGain;
uniform float uWait;
uniform float uWaitT;
uniform float uScanOrder;
uniform float uReveal;
uniform float uOverlay;
uniform float uLive;
uniform float uFaint;
uniform float uPaneAspect;
uniform float uTime;
uniform float uMotion;
uniform vec3 uKey;
out vec4 o;
${NOISE}
// Contain-fit a slot drawn at another aspect into the current drawing rect.
vec2 fitUv(vec2 d, float aspect) {
  vec2 s = uPaneAspect > aspect ? vec2(uPaneAspect / aspect, 1.0) : vec2(1.0, aspect / uPaneAspect);
  return (d - 0.5) * s + 0.5;
}
// 1 inside the unit square, antialiased over px.
float inside(vec2 q, vec2 px) {
  vec2 a = smoothstep(vec2(0.0), px, q) * smoothstep(vec2(0.0), px, 1.0 - q);
  return a.x * a.y;
}
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
// Develop order: noise pulled toward the strokes, read in the new slot's drawing-local coords.
float developE(vec2 q) {
  float prox = clamp(texture(uNewField, uNewRect.xy + q * uNewRect.zw).r * uNewGain, 0.0, 1.0);
  return mix(fbm(q * 5.0 + 1.7), prox, 0.62);
}
void main() {
  vec4 col = vec4(0.0);
  vec2 d = (vUv - uRect.xy) / uRect.zw;
  vec2 drawPx = uRect.zw * uSize;
  vec2 onePx = 1.0 / drawPx;
  // Distance past the drawing rect in CSS px; effects are gone by the outer edge.
  float outside = length(max(abs((d - 0.5) * drawPx) - drawPx * 0.5, 0.0));
  float fall = 1.0 - smoothstep(0.0, max(uBleed, 1.0), outside);

  vec2 pd = fitUv(d, uPrevAspect);
  float inP = inside(pd, onePx);
  vec2 pu = uPrevRect.xy + pd * uPrevRect.zw;
  if (uPrevAlpha > 0.001) {
    col = vec4(texture(uPrevImg, pd).rgb, 1.0) * inP * uPrevAlpha;
  }
  vec2 nd = fitUv(d, uNewAspect);
  float inN = inside(nd, onePx);
  vec2 nu = uNewRect.xy + nd * uNewRect.zw;

  if (uWait > 0.001) {
    float bleed = uMotion * (1.0 - exp(-uWaitT * 0.55));
    vec2 flow = (vec2(fbm(nd * 3.0 + vec2(0.0, uTime * 0.12)), fbm(nd * 3.0 + vec2(5.2, -uTime * 0.1))) - 0.5) * 2.0;
    vec2 drift = flow * bleed * uNewRect.zw;
    float ink = 0.0;
    for (int i = 0; i < 8; i++) {
      float f = float(i) / 7.0;
      ink = max(ink, texture(uNewInk, nu - drift * 0.03 * f).r * (1.0 - 0.75 * f));
    }
    float field = clamp(texture(uNewField, nu + drift * 0.015).r * uNewGain, 0.0, 1.0);
    // The scan band enters and leaves through the margin, not at the drawing's edge.
    float reach = uRect.y / uRect.w;
    float scan = mix(-reach, 1.0 + reach, fract(uWaitT * 0.3));
    float band = exp(-pow(((1.0 - nd.y) - scan) * 10.0, 2.0)) * uMotion;
    float breathe = 1.0 + 0.12 * sin(uTime * 2.1) * uMotion;
    // The strokes are read back in the order they were drawn.
    float ord = texture(uNewInk, nu).g - uScanOrder;
    float hl = uScanOrder >= 0.0 ? exp(-ord * ord * 900.0) : 0.0;
    float a = ink * mix(0.8, 1.0, hl) + field * (0.08 + 0.2 * bleed + 0.45 * band);
    a = clamp(a * breathe, 0.0, 1.0) * uWait * fall;
    vec3 c = mix(uKey, vec3(0.5, 0.58, 1.0), clamp(band * field * 1.5 + hl * 0.8, 0.0, 1.0));
    col = over(vec4(c * a, a), col);
  }

  if (uReveal > 0.0) {
    vec3 img = texture(uNewImg, nd).rgb;
    float e = developE(nd);
    float m;
    float edge;
    if (uMotion > 0.5) {
      float th = 1.0 - uReveal * 1.3;
      m = smoothstep(th, th + 0.05, e);
      if (outside < 0.5) {
        edge = exp(-pow((e - th - 0.015) / 0.022, 2.0));
      } else {
        // Past the image the edge is read along the nearby border and spreads
        // out from it as a widening, fading halo.
        float spread = 1.0 + outside / 10.0;
        vec2 r = onePx * outside * 0.8;
        edge = 0.0;
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            float eb = developE(clamp(nd + r * vec2(float(i), float(j)), 0.0, 1.0));
            edge += exp(-pow((eb - th - 0.015) / (0.022 * spread), 2.0));
          }
        }
        edge *= exp(-outside / max(uBleed * 0.3, 1.0)) / (9.0 * sqrt(spread));
      }
      edge *= 1.0 - smoothstep(0.8, 1.0, uReveal);
    } else {
      m = uReveal;
      edge = 0.0;
    }
    m *= inN;
    col = over(vec4(img, 1.0) * m, col);
    float ga = edge * 0.9 * fall;
    col = over(vec4(mix(uKey, vec3(0.62, 0.7, 1.0), 0.35) * ga, ga), col);
  }

  if (uOverlay > 0.0) {
    float ink = texture(uNewInk, nu).r * uOverlay * fall;
    col = over(vec4(uKey * ink, ink), col);
  }

  if (uLive > 0.0) {
    // Strokes already read into the image stay faint; new ones are full ink.
    float old = smoothstep(0.02, 0.25, texture(uPrevInk, pu).r) * inP * uPrevInkMask;
    float a = texture(uInk, vUv).r * uLive * mix(1.0, uFaint, old);
    col = over(vec4(uKey * a, a), col);
  }
  o = col;
}`;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function easeInOut(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function fitWithin(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Shape `createItem({ texture })` binds as `uTexture` on the WebGL2 path. */
export type SurfaceTexture = {
  view: { texture: WebGLTexture };
  width: number;
  height: number;
  aspect: number;
};

export type SharedOptions = {
  /** Ask the host engine for a frame; `renderShared` runs inside it. */
  requestFrame: () => void;
  /** Long side of the image sent to the model. */
  exportMax?: number;
  /** Nominal stroke width in CSS px (speed and pressure vary it). */
  strokeWidth?: number;
};

export class SketchGl {
  private gl: WebGL2RenderingContext;
  /** Own-canvas mode only; null when drawing into the host engine's context. */
  private canvas: HTMLCanvasElement | null;
  private shared: SharedOptions | null;
  private vao!: WebGLVertexArrayObject;
  private strokeVao!: WebGLVertexArrayObject;
  private instanceBuffer!: WebGLBuffer;
  private cornerBuffer!: WebGLBuffer;
  private blank!: WebGLTexture;
  private programs: Program[] = [];
  private strokeProg!: Program;
  private padProg!: Program;
  private downProg!: Program;
  private blurProg!: Program;
  private proceduralProg!: Program;
  private linesProg!: Program;
  private resultProg!: Program;
  private surfaceProg: Program | null = null;

  private ink: Target | null = null;
  /** Shared mode: the composited surface the host item samples. */
  private out: Target | null = null;
  private dim = 0;
  private dimTarget = 0;
  private lastStep = 0;
  private prevFadeStart: number | null = null;
  private segments: number[] = [];
  private instanceCapacity = 0;

  private dpr = 1;
  private baseWidth = BASE_WIDTH;
  private pad: Rect = { x: 0, y: 0, w: 1, h: 1 };
  /** Shared mode: CSS px of bleed around the pad that ink targets and the surface also cover. */
  private bleed = 0;
  private result: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private key: [number, number, number];
  private motion = true;

  private stroke: {
    lastX: number;
    lastY: number;
    lastW: number;
    lastT: number;
    points: Array<{ x: number; y: number; w: number }>;
    speed: number;
    width: number;
  } | null = null;
  private cumulative = 0;

  private prevSlot: Slot | null = null;
  private newSlot: Slot | null = null;
  private waitStart: number | null = null;
  private scanMax = 0;
  private revealStart: number | null = null;
  private onRevealDone: (() => void) | null = null;

  private raf = 0;
  private dirty = true;
  private disposed = false;

  static create(canvas: HTMLCanvasElement, key: [number, number, number]) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    try {
      return new SketchGl(canvas, null, gl, key);
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  /** Draw inside a host context (the site engine). Call `renderShared` from its frame. */
  static shared(
    gl: WebGL2RenderingContext,
    key: [number, number, number],
    options: SharedOptions,
  ) {
    try {
      return new SketchGl(null, options, gl, key);
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  private constructor(
    canvas: HTMLCanvasElement | null,
    shared: SharedOptions | null,
    gl: WebGL2RenderingContext,
    key: [number, number, number],
  ) {
    this.canvas = canvas;
    this.shared = shared;
    this.gl = gl;
    this.key = key;
    this.baseWidth = shared?.strokeWidth ?? BASE_WIDTH;
    this.guard(() => this.init());
  }

  private init() {
    const gl = this.gl;
    this.strokeProg = this.program(STROKE_VS, STROKE_FS);
    this.padProg = this.program(FULLSCREEN_VS, PAD_FS);
    this.downProg = this.program(FULLSCREEN_VS, DOWN_FS);
    this.blurProg = this.program(FULLSCREEN_VS, BLUR_FS);
    this.proceduralProg = this.program(FULLSCREEN_VS, PROCEDURAL_FS);
    this.linesProg = this.program(FULLSCREEN_VS, LINES_FS);
    this.resultProg = this.program(FULLSCREEN_VS, RESULT_FS);
    if (this.shared) this.surfaceProg = this.program(FULLSCREEN_VS, SURFACE_FS);

    this.vao = gl.createVertexArray()!;

    this.strokeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.strokeVao);
    this.cornerBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
  }

  // ---------------------------------------------------------------- setup

  private program(vs: string, fs: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`sketch shader: ${log}`);
      }
      return shader;
    };
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    const program = gl.createProgram()!;
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`sketch program: ${gl.getProgramInfoLog(program)}`);
    }
    const entry = { program, uniforms: new Map() };
    this.programs.push(entry);
    return entry;
  }

  private use(p: Program) {
    this.gl.useProgram(p.program);
    return (name: string) => {
      if (!p.uniforms.has(name)) {
        p.uniforms.set(name, this.gl.getUniformLocation(p.program, name));
      }
      return p.uniforms.get(name) ?? null;
    };
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  private dropTarget(t: Target | null) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  /** Reallocate in place so a host item holding `t.tex` keeps sampling it. */
  private resizeTarget(t: Target, w: number, h: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    t.w = w;
    t.h = h;
  }

  /**
   * Shared mode: run GL work and put back the host state it touches (targets,
   * viewport, program, VAO, buffers, texture units, caps, clear colour,
   * unpack flags). Own-canvas mode runs `fn` directly.
   */
  private guard<T>(fn: () => T): T {
    if (!this.shared) return fn();
    const gl = this.gl;
    const drawFbo = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const readFbo = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const textures: Array<WebGLTexture | null> = [];
    for (let i = 0; i < TEXTURE_UNITS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      textures.push(gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null);
    }
    const blend = gl.isEnabled(gl.BLEND);
    const depth = gl.isEnabled(gl.DEPTH_TEST);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    const scissorBox = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;
    const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    try {
      return fn();
    } finally {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFbo);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
      gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, arrayBuffer);
      for (let i = 0; i < TEXTURE_UNITS; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, textures[i]);
      }
      gl.activeTexture(activeTexture);
      gl.blendEquation(gl.FUNC_ADD);
      if (blend) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      if (depth) gl.enable(gl.DEPTH_TEST);
      gl.scissor(scissorBox[0], scissorBox[1], scissorBox[2], scissorBox[3]);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    }
  }

  private dropSlot(slot: Slot | null) {
    if (!slot) return;
    this.dropTarget(slot.ink);
    this.dropTarget(slot.fieldS);
    this.dropTarget(slot.fieldB);
    this.dropTarget(slot.under);
    if (slot.loaded) this.gl.deleteTexture(slot.loaded);
  }

  private blit(src: Target, dst: Target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, dst.w, dst.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  private pass(t: Target, p: Program, bind: (u: (n: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.disable(gl.BLEND);
    const u = this.use(p);
    bind(u);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private bindTex(unit: number, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  // --------------------------------------------------------------- layout

  setMotion(motion: boolean) {
    this.motion = motion;
    this.kick();
  }

  layout(cssW: number, cssH: number, dpr: number, pad: Rect, result: Rect) {
    const canvas = this.canvas;
    if (!canvas) return;
    this.dpr = Math.min(2, Math.max(1, dpr));
    this.pad = pad;
    this.result = result;
    const cw = Math.max(1, Math.round(cssW * this.dpr));
    const ch = Math.max(1, Math.round(cssH * this.dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    this.sizeInk();
  }

  /**
   * Shared mode: the drawing area in CSS px, and the bleed margin around it
   * that the surface also covers so glow can spill past the drawing edge.
   * Strokes stay in drawing-area coordinates.
   */
  layoutSurface(cssW: number, cssH: number, dpr: number, bleed = 0) {
    const w = Math.max(1, cssW);
    const h = Math.max(1, cssH);
    this.bleed = Math.max(0, bleed);
    const outer = Math.max(w, h) + this.bleed * 2;
    this.dpr = Math.min(2, Math.max(1, dpr), MAX_SURFACE_PX / outer);
    this.pad = { x: 0, y: 0, w, h };
    this.result = this.pad;
    this.guard(() => {
      this.sizeInk();
      const ink = this.ink!;
      if (!this.out) this.out = this.target(ink.w, ink.h);
      else if (this.out.w !== ink.w || this.out.h !== ink.h) this.resizeTarget(this.out, ink.w, ink.h);
    });
  }

  /** Shared mode: the composited surface, for `createItem({ texture })`. */
  surfaceTexture(): SurfaceTexture | null {
    const out = this.out;
    if (!out) return null;
    return { view: { texture: out.tex }, width: out.w, height: out.h, aspect: out.w / out.h };
  }

  private sizeInk() {
    const iw = Math.max(1, Math.round((this.pad.w + this.bleed * 2) * this.dpr));
    const ih = Math.max(1, Math.round((this.pad.h + this.bleed * 2) * this.dpr));
    if (!this.ink || this.ink.w !== iw || this.ink.h !== ih) {
      const next = this.target(iw, ih);
      if (this.ink) {
        this.flush();
        this.blit(this.ink, next);
        this.dropTarget(this.ink);
      }
      this.ink = next;
    }
    this.dirty = true;
    this.kick();
  }

  /**
   * Shared mode: how far the last image falls back toward the paper (0–1).
   * Eased, so drawing over an image or starting a render fades it smoothly.
   */
  setDim(target: number) {
    const next = Math.min(1, Math.max(0, target));
    if (next === this.dimTarget) return;
    this.dimTarget = next;
    this.kick();
  }

  // --------------------------------------------------------------- strokes

  /** Pointer position in CSS px relative to the pad. Returns ink length added (CSS px). */
  beginStroke(x: number, y: number, time: number, pressure: number | null) {
    const width = this.widthFor(0, pressure);
    this.stroke = {
      lastX: x,
      lastY: y,
      lastW: width,
      lastT: time,
      points: [{ x, y, w: width }],
      speed: 0,
      width,
    };
  }

  extendStroke(x: number, y: number, time: number, pressure: number | null): number {
    const s = this.stroke;
    if (!s) return 0;
    const dx = x - s.lastX;
    const dy = y - s.lastY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.75) return 0;
    const dt = Math.max(1, time - s.lastT);
    s.speed = s.speed * 0.7 + (dist / dt) * 0.3;
    s.width = s.width * 0.6 + this.widthFor(s.speed, pressure) * 0.4;
    s.lastT = time;
    s.lastX = x;
    s.lastY = y;
    const pts = s.points;
    pts.push({ x, y, w: s.width });

    if (pts.length === 2) {
      const a = pts[0];
      const b = pts[1];
      this.emitLine(a.x, a.y, a.w, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.w + b.w) / 2, dist / 2);
    } else {
      const a = pts[pts.length - 3];
      const b = pts[pts.length - 2];
      const c = pts[pts.length - 1];
      this.emitCurve(a, b, c);
      if (pts.length > 4) pts.shift();
    }
    return dist;
  }

  endStroke(): void {
    const s = this.stroke;
    if (!s) return;
    const pts = s.points;
    if (pts.length === 1) {
      const p = pts[0];
      this.pushSegment(p.x, p.y, p.x, p.y, p.w * 1.2, p.w * 1.2);
    } else {
      const b = pts[pts.length - 2];
      const c = pts[pts.length - 1];
      this.emitLine(
        (b.x + c.x) / 2,
        (b.y + c.y) / 2,
        (b.w + c.w) / 2,
        c.x,
        c.y,
        c.w * 0.7,
        Math.hypot(c.x - b.x, c.y - b.y) / 2,
      );
    }
    this.stroke = null;
  }

  clearInk() {
    const gl = this.gl;
    this.segments.length = 0;
    this.stroke = null;
    this.cumulative = 0;
    const ink = this.ink;
    if (ink) {
      this.guard(() => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, ink.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      });
    }
    this.dirty = true;
    this.kick();
  }

  /** Blank slate. Ink goes at once; the last image fades back to paper. */
  clearAll() {
    if (this.revealStart !== null) this.completeReveal();
    this.cancelGeneration();
    this.clearInk();
    this.dimTarget = 0;
    if (!this.prevSlot) return;
    if (this.motion) {
      this.prevFadeStart = performance.now();
    } else {
      this.dropSlot(this.prevSlot);
      this.prevSlot = null;
    }
    this.kick();
  }

  private widthFor(speed: number, pressure: number | null) {
    if (pressure !== null && pressure > 0 && pressure !== 0.5) {
      return this.baseWidth * (0.35 + pressure * 1.3);
    }
    return this.baseWidth * (1.35 - 0.85 * smoothstep(0.05, 2.4, speed));
  }

  private emitLine(x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, len: number) {
    const steps = Math.max(1, Math.ceil(len / 2));
    let px = x0;
    let py = y0;
    let pw = w0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const w = w0 + (w1 - w0) * t;
      this.pushSegment(px, py, x, y, pw, w);
      px = x;
      py = y;
      pw = w;
    }
  }

  private emitCurve(
    a: { x: number; y: number; w: number },
    b: { x: number; y: number; w: number },
    c: { x: number; y: number; w: number },
  ) {
    const sx = (a.x + b.x) / 2;
    const sy = (a.y + b.y) / 2;
    const sw = (a.w + b.w) / 2;
    const ex = (b.x + c.x) / 2;
    const ey = (b.y + c.y) / 2;
    const ew = (b.w + c.w) / 2;
    const len = Math.hypot(b.x - sx, b.y - sy) + Math.hypot(ex - b.x, ey - b.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    let px = sx;
    let py = sy;
    let pw = sw;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * sx + 2 * mt * t * b.x + t * t * ex;
      const y = mt * mt * sy + 2 * mt * t * b.y + t * t * ey;
      const w = sw + (ew - sw) * t;
      this.pushSegment(px, py, x, y, pw, w);
      px = x;
      py = y;
      pw = w;
    }
  }

  private pushSegment(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number) {
    const unit = Math.max(1, Math.min(this.pad.w, this.pad.h));
    this.cumulative += Math.hypot(x1 - x0, y1 - y0) / unit;
    const order = Math.min(1, this.cumulative / ORDER_SPAN);
    const k = this.dpr;
    const o = this.bleed;
    this.segments.push((x0 + o) * k, (y0 + o) * k, (x1 + o) * k, (y1 + o) * k, w0 * k, w1 * k, order, 0);
    this.dirty = true;
    this.kick();
  }

  private flush() {
    const gl = this.gl;
    const ink = this.ink;
    const count = this.segments.length / 8;
    if (!ink || count === 0) return;
    const data = new Float32Array(this.segments);
    this.segments.length = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    if (count > this.instanceCapacity) {
      this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, 256);
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacity * 32, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ink.fbo);
    gl.viewport(0, 0, ink.w, ink.h);
    // Ink stays on the drawing area; only the effects spill into the bleed.
    const clip = this.bleed > 0;
    if (clip) {
      const [x, y, w, h] = this.inkRectPx(ink);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, y, w, h);
    }
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    const u = this.use(this.strokeProg);
    gl.uniform2f(u("uRes"), ink.w, ink.h);
    gl.bindVertexArray(this.strokeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    if (clip) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The drawing rect inside an ink-sized target, in its pixels. */
  private inkRectPx(t: { w: number; h: number }): [number, number, number, number] {
    const [ox, oy, sx, sy] = this.inkRect();
    const x = Math.round(ox * t.w);
    const y = Math.round(oy * t.h);
    return [x, y, Math.max(1, Math.round((ox + sx) * t.w) - x), Math.max(1, Math.round((oy + sy) * t.h) - y)];
  }

  /** The drawing rect inside the ink target, in uv (offset, size). The margin is symmetric. */
  private inkRect(): [number, number, number, number] {
    const w = this.pad.w + this.bleed * 2;
    const h = this.pad.h + this.bleed * 2;
    return [this.bleed / w, this.bleed / h, this.pad.w / w, this.pad.h / h];
  }

  // ------------------------------------------------------------ generation

  /**
   * Snapshot the pad, paint the procedural underpainting for `look`, start
   * the waiting bleed, and return the line drawing and underpainting for the model.
   */
  beginGeneration(look: number): SketchExport | null {
    const ink = this.ink;
    if (!ink) return null;
    if (this.revealStart !== null) this.completeReveal();
    this.dropSlot(this.newSlot);
    this.newSlot = null;

    return this.guard(() => {
      this.flush();
      // Scale the caps with the margin so the drawing keeps the same resolution.
      const rect = this.inkRect();
      const spread = 1 / Math.max(rect[2], rect[3]);
      const size = fitWithin(ink.w, ink.h, Math.round(SNAPSHOT_MAX * spread));
      const snap = this.target(size.w, size.h);
      this.blit(ink, snap);
      const slot = this.buildFields(snap, rect, Math.round(FIELD_MAX * spread));
      const under = this.paintProcedural(slot, look);
      slot.under = under;
      this.newSlot = slot;
      this.scanMax = Math.min(1, this.cumulative / ORDER_SPAN);
      this.waitStart = performance.now();
      this.kick();
      const max = this.shared?.exportMax ?? EXPORT_MAX;
      const lines = this.paintLines(slot, under.w, under.h);
      const out = {
        lines: this.exportImage(lines, max, "image/png"),
        ...this.exportImage(under, max, "image/jpeg"),
      };
      this.dropTarget(lines);
      return { lines: out.lines.image, under: out.image, width: out.width, height: out.height };
    });
  }

  cancelGeneration() {
    if (this.waitStart === null) return;
    this.waitStart = null;
    this.dropSlot(this.newSlot);
    this.newSlot = null;
    this.dirty = true;
    this.kick();
  }

  async revealImage(url: string, onDone: () => void): Promise<boolean> {
    const slot = this.newSlot;
    if (!slot) return false;
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return false;
    }
    if (this.disposed || this.newSlot !== slot) return false;
    const gl = this.gl;
    const tex = this.guard(() => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    });
    slot.loaded = tex;
    slot.image = tex;
    this.startReveal(onDone);
    return true;
  }

  /** Show the underpainting itself when no image model answered. */
  revealProcedural(onDone: () => void) {
    const slot = this.newSlot;
    if (!slot?.under) return;
    slot.image = slot.under.tex;
    this.startReveal(onDone);
  }

  /** Paint the drawing rect only: this is what the model sees and where images land. */
  private paintProcedural(slot: Slot, look: number): Target {
    const [ox, oy, sx, sy] = slot.rect;
    const size = fitWithin(slot.ink.w * sx, slot.ink.h * sy, PROCEDURAL_MAX);
    const t = this.target(size.w, size.h);
    const gl = this.gl;
    this.pass(t, this.proceduralProg, (u) => {
      this.bindTex(0, slot.ink.tex);
      this.bindTex(1, slot.fieldS.tex);
      this.bindTex(2, slot.fieldB.tex);
      gl.uniform1i(u("uInk"), 0);
      gl.uniform1i(u("uFieldS"), 1);
      gl.uniform1i(u("uFieldB"), 2);
      gl.uniform1f(u("uGainS"), slot.gainS);
      gl.uniform1f(u("uGainB"), slot.gainB);
      gl.uniform2f(u("uTexel"), 1 / slot.fieldB.w, 1 / slot.fieldB.h);
      gl.uniform1i(u("uLook"), look);
      gl.uniform1f(u("uSeed"), Math.random() * 100);
      gl.uniform4f(u("uCrop"), ox, oy, sx, sy);
    });
    return t;
  }

  private paintLines(slot: Slot, w: number, h: number): Target {
    const t = this.target(w, h);
    const gl = this.gl;
    this.pass(t, this.linesProg, (u) => {
      this.bindTex(0, slot.ink.tex);
      gl.uniform1i(u("uInk"), 0);
      gl.uniform4f(u("uCrop"), ...slot.rect);
    });
    return t;
  }

  private startReveal(onDone: () => void) {
    this.waitStart = this.waitStart ?? performance.now();
    this.revealStart = performance.now();
    this.onRevealDone = onDone;
    this.kick();
  }

  private completeReveal() {
    this.dropSlot(this.prevSlot);
    this.prevSlot = this.newSlot;
    this.newSlot = null;
    this.revealStart = null;
    this.waitStart = null;
    this.prevFadeStart = null;
    // The new image is the last image now, at full strength.
    this.dim = 0;
    this.dimTarget = 0;
    const done = this.onRevealDone;
    this.onRevealDone = null;
    this.dirty = true;
    done?.();
  }

  private buildFields(snap: Target, rect: Slot["rect"], fieldMax: number): Slot {
    const gl = this.gl;
    const low = fitWithin(snap.w, snap.h, fieldMax);
    const a = this.target(low.w, low.h);
    const b = this.target(low.w, low.h);
    const fieldS = this.target(low.w, low.h);
    const fieldB = this.target(low.w, low.h);

    this.pass(a, this.downProg, (u) => {
      this.bindTex(0, snap.tex);
      gl.uniform1i(u("uSrc"), 0);
      gl.uniform2f(u("uFoot"), 1 / low.w, 1 / low.h);
    });
    const blur = (src: Target, dst: Target, dx: number, dy: number) =>
      this.pass(dst, this.blurProg, (u) => {
        this.bindTex(0, src.tex);
        gl.uniform1i(u("uSrc"), 0);
        gl.uniform2f(u("uDir"), dx / low.w, dy / low.h);
      });
    blur(a, b, 1, 0);
    blur(b, fieldS, 0, 1);
    blur(fieldS, b, 2.5, 0);
    blur(b, a, 0, 2.5);
    blur(a, b, 5, 0);
    blur(b, fieldB, 0, 5);
    this.dropTarget(a);
    this.dropTarget(b);

    return {
      ink: snap,
      fieldS,
      fieldB,
      gainS: this.gainOf(fieldS),
      gainB: this.gainOf(fieldB),
      aspect: (snap.w * rect[2]) / (snap.h * rect[3]),
      rect,
      under: null,
      loaded: null,
      image: null,
    };
  }

  private gainOf(t: Target) {
    const gl = this.gl;
    const px = new Uint8Array(t.w * t.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let max = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > max) max = px[i];
    return 1 / Math.max(0.06, max / 255);
  }

  private exportImage(source: Target, max: number, type: "image/png" | "image/jpeg") {
    const gl = this.gl;
    const { w, h } = source;
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, source.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const full = document.createElement("canvas");
    full.width = w;
    full.height = h;
    const fctx = full.getContext("2d")!;
    const data = fctx.createImageData(w, h);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * rowBytes;
      data.data.set(px.subarray(src, src + rowBytes), y * rowBytes);
    }
    fctx.putImageData(data, 0, 0);

    const aspect = w / h;
    const snap64 = (v: number) => Math.max(256, Math.round(v / 64) * 64);
    const width = aspect >= 1 ? max : snap64(max * aspect);
    const height = aspect >= 1 ? snap64(max / aspect) : max;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const octx = out.getContext("2d")!;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(full, 0, 0, width, height);
    return { image: out.toDataURL(type, 0.9), width, height };
  }

  // ---------------------------------------------------------------- frame

  kick() {
    if (this.disposed) return;
    if (this.shared) {
      this.shared.requestFrame();
      if (!this.raf) this.raf = requestAnimationFrame(this.heat);
      return;
    }
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * Shared mode: re-arm the host every animation frame while anything moves.
   * The engine's settle loop drops out if one of its frames lands more than
   * its settle window after the last request (a long task, a decode), so a
   * request made from inside the previous frame is not enough.
   */
  private heat = () => {
    this.raf = 0;
    if (this.disposed || !this.shared) return;
    if (!this.animating() && !this.dirty) return;
    this.shared.requestFrame();
    this.raf = requestAnimationFrame(this.heat);
  };

  private animating() {
    return (
      this.waitStart !== null ||
      this.revealStart !== null ||
      this.prevFadeStart !== null ||
      Math.abs(this.dim - this.dimTarget) > 0.002
    );
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const animating = this.animating();
    if (!this.dirty && !animating) return;
    this.dirty = false;
    this.flush();
    this.draw(now);
    this.advance(now);
    if (animating || this.dirty) this.kick();
  };

  /**
   * Shared mode: call from the host item's frame hook, before it draws. Brings
   * the surface texture up to date and keeps the host rendering while animating.
   */
  renderShared() {
    if (this.disposed || !this.out) return;
    const now = performance.now();
    const animating = this.animating();
    if (!this.dirty && !animating) return;
    this.dirty = false;
    this.guard(() => {
      this.flush();
      this.drawSurface(now);
    });
    this.advance(now);
    if (this.animating() || this.dirty) this.kick();
  }

  /** Time-driven state: dim easing, the clear fade, the end of a reveal. */
  private advance(now: number) {
    const dt = this.lastStep ? Math.min(0.1, (now - this.lastStep) / 1000) : 0;
    this.lastStep = now;
    if (this.motion) this.dim += (this.dimTarget - this.dim) * (1 - Math.exp(-dt * 5));
    else this.dim = this.dimTarget;
    if (Math.abs(this.dim - this.dimTarget) <= 0.002) this.dim = this.dimTarget;
    if (this.prevFadeStart !== null && (now - this.prevFadeStart) / 1000 >= CLEAR_FADE_S) {
      this.prevFadeStart = null;
      this.dropSlot(this.prevSlot);
      this.prevSlot = null;
      this.dirty = true;
    }
    if (this.revealStart !== null) {
      const t = (now - this.revealStart) / 1000;
      const end = this.motion ? OVERLAY_END_S : REDUCED_REVEAL_S;
      if (t >= end) this.completeReveal();
    }
  }

  /** Wait, reveal and overlay strengths shared by both modes. */
  private phaseMix(now: number) {
    const waitT = this.waitStart !== null ? (now - this.waitStart) / 1000 : 0;
    const revealT = this.revealStart !== null ? (now - this.revealStart) / 1000 : -1;
    let wait = 0;
    let reveal = 0;
    let overlay = 0;
    if (this.waitStart !== null) {
      wait = this.motion ? Math.min(1, waitT / 0.45) : 1;
    }
    if (revealT >= 0) {
      if (this.motion) {
        reveal = easeInOut(revealT / REVEAL_S);
        wait *= 1 - Math.min(1, revealT / 0.9);
        overlay = 0.75 * (1 - smoothstep(1.4, OVERLAY_END_S, revealT));
      } else {
        reveal = Math.min(1, revealT / REDUCED_REVEAL_S);
        wait *= 1 - reveal;
      }
    }
    return { waitT, revealT, wait, reveal, overlay };
  }

  private drawSurface(now: number) {
    const gl = this.gl;
    const out = this.out;
    const ink = this.ink;
    const prog = this.surfaceProg;
    if (!out || !ink || !prog) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prev = this.prevSlot;
    const next = this.newSlot;
    const { waitT, revealT, wait, reveal, overlay: settle } = this.phaseMix(now);
    const revealing = revealT >= 0 && !!next?.image;

    // Live ink hands over to the bleed while waiting and to the overlay while
    // developing; the overlay settles at the faint strength the live ink resumes at.
    let live = 1;
    let overlay = 0;
    if (this.waitStart !== null && !revealing) live = 1 - wait;
    if (revealing) {
      live = 0;
      overlay = this.motion
        ? FAINT_INK + (settle / 0.75) * (0.75 - FAINT_INK)
        : FAINT_INK * reveal;
    }
    const fade = this.prevFadeStart !== null
      ? 1 - smoothstep(0, CLEAR_FADE_S, (now - this.prevFadeStart) / 1000)
      : 1;
    const prevAlpha = prev?.image ? fade * (1 - this.dim) : 0;
    const scanning = this.motion && this.waitStart !== null && !revealing;

    const u = this.use(prog);
    this.bindTex(0, ink.tex);
    this.bindTex(1, prev?.image ?? this.blank);
    this.bindTex(2, prev?.ink.tex ?? this.blank);
    this.bindTex(3, next?.image ?? this.blank);
    this.bindTex(4, next?.ink.tex ?? this.blank);
    this.bindTex(5, next?.fieldB.tex ?? this.blank);
    gl.uniform1i(u("uInk"), 0);
    gl.uniform1i(u("uPrevImg"), 1);
    gl.uniform1i(u("uPrevInk"), 2);
    gl.uniform1i(u("uNewImg"), 3);
    gl.uniform1i(u("uNewInk"), 4);
    gl.uniform1i(u("uNewField"), 5);
    gl.uniform1f(u("uPrevAlpha"), prevAlpha);
    gl.uniform1f(u("uPrevInkMask"), prev && this.prevFadeStart === null ? 1 : 0);
    const rect = this.inkRect();
    const pane = this.pad.w / this.pad.h;
    gl.uniform4f(u("uRect"), ...rect);
    gl.uniform2f(u("uSize"), this.pad.w + this.bleed * 2, this.pad.h + this.bleed * 2);
    gl.uniform1f(u("uBleed"), this.bleed);
    gl.uniform1f(u("uPrevAspect"), prev?.aspect ?? pane);
    gl.uniform4f(u("uPrevRect"), ...(prev?.rect ?? rect));
    gl.uniform1f(u("uNewAspect"), next?.aspect ?? pane);
    gl.uniform4f(u("uNewRect"), ...(next?.rect ?? rect));
    gl.uniform1f(u("uNewGain"), next?.gainB ?? 1);
    gl.uniform1f(u("uWait"), next ? wait : 0);
    gl.uniform1f(u("uWaitT"), waitT);
    gl.uniform1f(u("uScanOrder"), scanning ? ((waitT * 0.45) % 1.15) * this.scanMax : -1);
    gl.uniform1f(u("uReveal"), revealing ? reveal : 0);
    gl.uniform1f(u("uOverlay"), revealing ? overlay : 0);
    gl.uniform1f(u("uLive"), live);
    gl.uniform1f(u("uFaint"), FAINT_INK);
    gl.uniform1f(u("uPaneAspect"), pane);
    gl.uniform1f(u("uTime"), (now / 1000) % 1000);
    gl.uniform1f(u("uMotion"), this.motion ? 1 : 0);
    gl.uniform3f(u("uKey"), ...this.key);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private viewportFor(r: Rect) {
    const k = this.dpr;
    const x = Math.round(r.x * k);
    const w = Math.round(r.w * k);
    const h = Math.round(r.h * k);
    const y = (this.canvas?.height ?? 0) - Math.round(r.y * k) - h;
    this.gl.viewport(x, y, w, h);
  }

  private draw(now: number) {
    const gl = this.gl;
    const ink = this.ink;
    const canvas = this.canvas;
    if (!canvas) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.vao);

    const time = (now / 1000) % 1000;
    const { waitT, wait, reveal, overlay } = this.phaseMix(now);

    if (ink) {
      this.viewportFor(this.pad);
      const u = this.use(this.padProg);
      this.bindTex(0, ink.tex);
      gl.uniform1i(u("uInk"), 0);
      gl.uniform3f(u("uKey"), ...this.key);
      const scanning = this.motion && this.waitStart !== null && this.revealStart === null;
      gl.uniform1f(u("uScan"), scanning ? (waitT * 0.45) % 1.15 : -1);
      gl.uniform1f(u("uScanMax"), this.scanMax);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const prev = this.prevSlot;
    const next = this.newSlot;
    if (prev || next) {
      this.viewportFor(this.result);
      const u = this.use(this.resultProg);
      this.bindTex(0, prev?.image ?? this.blank);
      this.bindTex(1, next?.image ?? this.blank);
      this.bindTex(2, next?.ink.tex ?? this.blank);
      this.bindTex(3, next?.fieldB.tex ?? this.blank);
      gl.uniform1i(u("uPrevImg"), 0);
      gl.uniform1i(u("uNewImg"), 1);
      gl.uniform1i(u("uNewInk"), 2);
      gl.uniform1i(u("uNewField"), 3);
      const fade = this.prevFadeStart !== null
        ? 1 - smoothstep(0, CLEAR_FADE_S, (now - this.prevFadeStart) / 1000)
        : 1;
      gl.uniform1f(u("uHasPrev"), prev?.image ? fade : 0);
      gl.uniform1f(u("uPrevAspect"), prev?.aspect ?? 1);
      gl.uniform1f(u("uNewAspect"), next?.aspect ?? 1);
      gl.uniform1f(u("uNewGain"), next?.gainB ?? 1);
      gl.uniform1f(u("uWait"), next ? wait : 0);
      gl.uniform1f(u("uWaitT"), waitT);
      gl.uniform1f(u("uReveal"), next?.image ? reveal : 0);
      gl.uniform1f(u("uOverlay"), next?.image ? overlay : 0);
      gl.uniform1f(u("uPaneAspect"), this.result.w / Math.max(1, this.result.h));
      gl.uniform1f(u("uTime"), time);
      gl.uniform1f(u("uMotion"), this.motion ? 1 : 0);
      gl.uniform3f(u("uKey"), ...this.key);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const gl = this.gl;
    // A lost context has already freed everything; deleting is a no-op then.
    this.guard(() => {
      this.dropTarget(this.ink);
      this.dropTarget(this.out);
      this.dropSlot(this.prevSlot);
      this.dropSlot(this.newSlot);
      for (const p of this.programs) gl.deleteProgram(p.program);
      gl.deleteBuffer(this.instanceBuffer);
      gl.deleteBuffer(this.cornerBuffer);
      gl.deleteVertexArray(this.vao);
      gl.deleteVertexArray(this.strokeVao);
      gl.deleteTexture(this.blank);
    });
    this.ink = null;
    this.out = null;
    this.prevSlot = null;
    this.newSlot = null;
    // The host engine owns a shared context.
    if (!this.shared) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
