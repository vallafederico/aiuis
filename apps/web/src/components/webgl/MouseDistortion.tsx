import { createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { createPostProcessor, getDefaultEngine } from "shooosh";
import { createLensTrail, type LensTrail } from "./mouse-trail-field";
import { onEnter, onLeave } from "@acme/router";
import { componentView } from "~/lib/component-view";
import { webgl } from "~/lib/stores/webglStore";
import {
  crumbProgress,
  mosaicProgress,
  mosaicFullFrame,
  setMosaicSnapshotRequester,
  beginPageEntry,
  beginPageLeave,
  playMosaic,
  setMosaicSink,
  setMosaicSnapshotMode,
  tickMosaic,
} from "./mosaic-clock";

type MouseDistortionProps = {
  /** Circle radius in pixels (default 48). */
  radius?: number;
  /** Magnification magnitude, 0-1 (default 0.3). */
  strength?: number;
  /** Pixel offset [x, y] applied to the lerped position (default [0, 0]). */
  offset?: [number, number];
};

/** CSS top-origin Y → post `uv`. WebGL2's single-pass chain is bottom-origin. */
function postPointerY(cssY: number, backend: string) {
  return backend === "webgl2" ? 1 - cssY : cssY;
}

const EMPTY_BOX = { minX: 1, minY: 1, maxX: 0, maxY: 0 };

/** Lens radius grows with pointer speed (px/ms): boost per unit and its cap. */
const RADIUS_SPEED_GAIN = 0.5;
const RADIUS_MAX_BOOST = 1.5;
/** Held radius is the fastest-move size, times this. */
const HOLD_SCALE = 1.6;
/** Wait before a press counts as a hold, so a click never grows the lens. */
const HOLD_ARM_MS = 280;
/** Pointer speed decay rate (1/s) once movement stops. */
const SPEED_DECAY = 4;
/** Damping rate (1/s) for the rendered radius, so it never jumps. */
const RADIUS_K = 6;

function uvBox(
  el: HTMLElement | null,
  backend: string,
  W: number,
  H: number,
  padX: number,
  padY: number,
) {
  if (!el) return EMPTY_BOX;
  const box = el.getBoundingClientRect();
  const top = box.top / H;
  const bottom = box.bottom / H;
  const minY = backend === "webgl2" ? 1 - bottom : top;
  const maxY = backend === "webgl2" ? 1 - top : bottom;
  return {
    minX: box.left / W - padX,
    maxX: box.right / W + padX,
    minY: Math.min(minY, maxY) - padY,
    maxY: Math.max(minY, maxY) + padY,
  };
}

/** Persistent chrome (left nav, top-right logo) in post UV. Refresh on resize. */
function readChromeUv(backend: string) {
  const W = Math.max(window.innerWidth, 1);
  const H = Math.max(window.innerHeight, 1);
  const padX = 8 / W;
  const padY = 8 / H;
  const nav = document.querySelector<HTMLElement>("[data-mosaic-chrome=nav]");
  const logo = document.querySelector<HTMLElement>("[data-mosaic-chrome=logo]");
  const meta = document.querySelector<HTMLElement>("[data-mosaic-chrome=meta]");
  const crumbs = document.querySelector<HTMLElement>("[data-mosaic-page=crumbs]");
  const navBox = nav?.getBoundingClientRect();
  const metaBox = meta?.getBoundingClientRect();
  const navRight = navBox ? navBox.right / W + padX : 0;
  // Solo hides meta / logo / crumbs (display: none, zero rects). Keep their
  // last shown boxes so the mosaic still covers where they were.
  if (!meta) lastChrome.metaLeft = 1;
  else if (metaBox && metaBox.width > 0) lastChrome.metaLeft = metaBox.left / W - padX;
  const logoBox = uvBox(logo, backend, W, H, padX, padY);
  const crumbsBox = uvBox(crumbs, backend, W, H, padX, padY);
  if (shown(logoBox, padX)) lastChrome.logo = logoBox;
  if (shown(crumbsBox, padX)) lastChrome.crumbs = crumbsBox;
  return {
    navRight,
    metaLeft: lastChrome.metaLeft,
    logo: lastChrome.logo,
    crumbs: lastChrome.crumbs,
  };
}

const lastChrome = { metaLeft: 1, logo: EMPTY_BOX, crumbs: EMPTY_BOX };

/** A display:none element measures as a zero rect, i.e. only the padding. */
function shown(box: typeof EMPTY_BOX, padX: number) {
  return box.maxX - box.minX > padX * 2 + 1e-6;
}

/**
 * One fullscreen pass: mosaic page transition then the cursor magnifier.
 * Clock is uni[1].x: 1 settled, 0 gone. Leave plays 1→0, enter plays 0→1.
 * uni[1].y = left-nav UV cutoff. uni[1].z = crumb mosaic clock.
 * uni[1].w = 1 for the opening reveal, which mosaics the whole frame.
 * uni[2] = logo box. uni[3] = crumb box (mosaics after the page settles).
 */
const FRAGMENT_SHADER = `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

bool inBox(vec2 u, vec4 b) {
  return u.x >= b.x && u.x <= b.z && u.y >= b.y && u.y <= b.w;
}

bool inNavChrome(vec2 u, float navRight, vec4 logo) {
  return u.x < navRight || inBox(u, logo);
}

bool inSoloChrome(vec2 u, float navRight, vec4 logo, vec4 crumbs, float metaLeft) {
  return inBox(u, crumbs) || inNavChrome(u, navRight, logo) || u.x > metaLeft;
}

// Staggered hop: each cell starts on another grid square and settles home.
vec2 gridHop(vec2 uv, vec2 resolution, float p) {
  vec2 grid = max(floor(resolution / 32.0), vec2(4.0));
  vec2 cell = floor(uv * grid);
  vec2 cellUv = fract(uv * grid);
  float rnd = hash21(cell);
  float raw = clamp((p - rnd * 0.58) / 0.42, 0.0, 1.0);
  float inv = 1.0 - raw;
  float t = 1.0 - inv * inv * inv;
  vec2 swap = vec2(
    floor(hash21(cell + 1.7) * 13.0) - 6.0,
    floor(hash21(cell + 8.3) * 9.0) - 4.0
  );
  vec2 srcCell = mix(cell + swap, cell, t);
  float hop = 1.0 - smoothstep(0.55, 1.0, t);
  srcCell = mix(srcCell, floor(srcCell + 0.5), hop);
  return (srcCell + cellUv) / grid;
}

// Effects compose: the mosaic samples through the magnifier's zoomed uv, so
// the lens keeps working over the scrambled frame during transitions.
// Chrome persists across pages, so it does not dissolve: only a sparse set of
// cells hops out and settles back while everything else stays put.
vec4 chromeTwitch(vec2 uv, vec2 zoomed, vec2 resolution, float p, float navRight, vec4 logo, vec4 crumbs) {
  if (p >= 0.999 || p <= 0.001) {
    return texture(uTexture, zoomed);
  }
  vec2 grid = max(floor(resolution / 32.0), vec2(4.0));
  vec2 cell = floor(zoomed * grid);
  if (hash21(cell + vec2(4.2)) > 0.15) {
    return texture(uTexture, zoomed);
  }
  vec2 srcUv = gridHop(zoomed, resolution, p);
  if (!inNavChrome(srcUv, navRight, logo) || inBox(srcUv, crumbs)) srcUv = zoomed;
  return texture(uTexture, clamp(srcUv, 0.0, 1.0));
}

// With a snapshot of the outgoing page (uSnap), parked cells — those that
// have not started hopping home (p below their gridHop threshold) — keep
// showing old-page tiles, and each cell flips to the live frame the moment
// it starts moving. Old and new mix per tile across the whole play; there is
// no single frame where the page switches.
vec4 mosaic(vec2 uv, vec2 zoomed, vec2 resolution, float p, vec4 hops, bool mixOld) {
  if (p >= 0.999) {
    return texture(uTexture, zoomed);
  }
  vec2 srcUv = gridHop(zoomed, resolution, p);
  if (!inBox(srcUv, hops)) srcUv = zoomed;
  if (mixOld) {
    vec2 grid = max(floor(resolution / 32.0), vec2(4.0));
    if (p < hash21(floor(zoomed * grid)) * 0.58) {
      return texture(uSnap, clamp(srcUv, 0.0, 1.0));
    }
  }
  return texture(uTexture, clamp(srcUv, 0.0, 1.0));
}

// The trail is a soft mask. Every texel in a stamp shares one focal point,
// and the sample scales toward it, so the path enlarges as a round lens.
vec2 lensUv(vec2 uv, vec2 resolution, float radiusUv, float strength) {
  if (strength < 0.001) return uv;
  vec3 trail = texture(uTrail, clamp(uv, 0.0, 1.0)).rgb;
  if (trail.r < 0.02) return uv;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 delta = (trail.gb - 0.5) * 0.5;
  float cap = max(radiusUv, 0.0) * 1.25;
  vec2 scaled = delta * aspect;
  float reach = length(scaled);
  if (reach > cap) scaled *= cap / max(reach, 1e-4);
  vec2 center = uv + scaled / aspect;
  return mix(uv, center, trail.r * strength);
}

vec4 applyEffect(vec4 color, vec2 uv, vec2 resolution, vec4 uni[4]) {
  float radiusUv = uni[0].z;
  float strength = uni[0].w;
  float p = clamp(uni[1].x, 0.0, 1.0);
  float navRight = uni[1].y;
  float crumbP = clamp(uni[1].z, 0.0, 1.0);
  vec4 logo = uni[2];
  vec4 crumbs = uni[3];

  vec2 zoomed = lensUv(uv, resolution, radiusUv, strength);

  // uni[1].w: 1 = whole frame, 2 = snapshot mix, 3 = chrome only,
  // 4 = chrome only with snapshot mix.
  float w = uni[1].w;
  if (w > 2.5) {
    // crumbP is packed as the meta column's left edge in this mode.
    float metaLeft = crumbP;
    if (!inSoloChrome(uv, navRight, logo, crumbs, metaLeft) || p >= 0.999) {
      return texture(uTexture, zoomed);
    }
    vec2 srcUv = gridHop(zoomed, resolution, p);
    if (!inSoloChrome(srcUv, navRight, logo, crumbs, metaLeft)) srcUv = zoomed;
    // Parked cells keep the frame from before the swap; each flips to
    // the live frame once it starts moving, so the swap mixes per tile.
    if (w > 3.5) {
      vec2 grid = max(floor(resolution / 32.0), vec2(4.0));
      if (p < hash21(floor(zoomed * grid)) * 0.58) {
        return texture(uSnap, clamp(srcUv, 0.0, 1.0));
      }
    }
    return texture(uTexture, clamp(srcUv, 0.0, 1.0));
  }
  bool mixOld = w > 1.5;
  if (w > 0.5 && !mixOld) {
    return mosaic(uv, zoomed, resolution, p, vec4(0.0, 0.0, 1.0, 1.0), false);
  }
  if (inBox(uv, crumbs)) {
    return mosaic(uv, zoomed, resolution, crumbP, crumbs, false);
  }
  if (inNavChrome(uv, navRight, logo)) {
    return chromeTwitch(uv, zoomed, resolution, p, navRight, logo, crumbs);
  }
  return mosaic(uv, zoomed, resolution, p, vec4(navRight, 0.0, 1.0, 1.0), mixOld);
}
`;

const FRAGMENT_SHADER_WGSL = `
fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn inBox(u: vec2f, b: vec4f) -> bool {
  return u.x >= b.x && u.x <= b.z && u.y >= b.y && u.y <= b.w;
}

fn inNavChrome(u: vec2f, navRight: f32, logo: vec4f) -> bool {
  return u.x < navRight || inBox(u, logo);
}

fn gridHop(uv: vec2f, resolution: vec2f, p: f32) -> vec2f {
  let grid = max(floor(resolution / 32.0), vec2f(4.0));
  let cell = floor(uv * grid);
  let cellUv = fract(uv * grid);
  let rnd = hash21(cell);
  let raw = clamp((p - rnd * 0.58) / 0.42, 0.0, 1.0);
  let inv = 1.0 - raw;
  let t = 1.0 - inv * inv * inv;
  let swap = vec2f(
    floor(hash21(cell + vec2f(1.7)) * 13.0) - 6.0,
    floor(hash21(cell + vec2f(8.3)) * 9.0) - 4.0
  );
  var srcCell = mix(cell + swap, cell, t);
  let hop = 1.0 - smoothstep(0.55, 1.0, t);
  srcCell = mix(srcCell, floor(srcCell + vec2f(0.5)), hop);
  return (srcCell + cellUv) / grid;
}

// Effects compose: the mosaic samples through the magnifier's zoomed uv, so
// the lens keeps working over the scrambled frame during transitions.
// Chrome persists across pages, so it does not dissolve: only a sparse set of
// cells hops out and settles back while everything else stays put.
fn chromeTwitch(uv: vec2f, zoomed: vec2f, resolution: vec2f, p: f32, navRight: f32, logo: vec4f, crumbs: vec4f) -> vec4f {
  if (p >= 0.999 || p <= 0.001) {
    return textureSample(uTexture, uSampler, zoomed);
  }
  let grid = max(floor(resolution / 32.0), vec2f(4.0));
  let cell = floor(zoomed * grid);
  if (hash21(cell + vec2f(4.2)) > 0.15) {
    return textureSample(uTexture, uSampler, zoomed);
  }
  var srcUv = gridHop(zoomed, resolution, p);
  if (!inNavChrome(srcUv, navRight, logo) || inBox(srcUv, crumbs)) {
    srcUv = zoomed;
  }
  return textureSample(uTexture, uSampler, clamp(srcUv, vec2f(0.0), vec2f(1.0)));
}

fn mosaic(uv: vec2f, zoomed: vec2f, resolution: vec2f, p: f32, hops: vec4f) -> vec4f {
  if (p >= 0.999) {
    return textureSample(uTexture, uSampler, zoomed);
  }
  var srcUv = gridHop(zoomed, resolution, p);
  if (!inBox(srcUv, hops)) {
    srcUv = zoomed;
  }
  return textureSample(uTexture, uSampler, clamp(srcUv, vec2f(0.0), vec2f(1.0)));
}

fn lensUv(uv: vec2f, resolution: vec2f, radiusUv: f32, strength: f32) -> vec2f {
  if (strength < 0.001) {
    return uv;
  }
  let trail = textureSample(uTrail, uSampler, clamp(uv, vec2f(0.0), vec2f(1.0))).rgb;
  if (trail.r < 0.02) {
    return uv;
  }
  let aspect = vec2f(resolution.x / max(resolution.y, 1.0), 1.0);
  let delta = (trail.gb - 0.5) * 0.5;
  let cap = max(radiusUv, 0.0) * 1.25;
  var scaled = delta * aspect;
  let reach = length(scaled);
  if (reach > cap) {
    scaled = scaled * (cap / max(reach, 1e-4));
  }
  let center = uv + scaled / aspect;
  return mix(uv, center, trail.r * strength);
}

fn applyEffect(color: vec4f, uv: vec2f, resolution: vec2f, uni: Uni) -> vec4f {
  let radiusUv = uni.values0.z;
  let strength = uni.values0.w;
  let p = clamp(uni.values1.x, 0.0, 1.0);
  let navRight = uni.values1.y;
  let crumbP = clamp(uni.values1.z, 0.0, 1.0);
  let logo = uni.values2;
  let crumbs = uni.values3;
  let zoomed = lensUv(uv, resolution, radiusUv, strength);
  let w = uni.values1.w;
  if (w > 2.5) {
    if (inBox(uv, crumbs) || inNavChrome(uv, navRight, logo) || uv.x > crumbP) {
      return mosaic(uv, zoomed, resolution, p, vec4f(0.0, 0.0, 1.0, 1.0));
    }
    return textureSample(uTexture, uSampler, clamp(zoomed, vec2f(0.0), vec2f(1.0)));
  }
  if (w > 0.5 && w < 1.5) {
    return mosaic(uv, zoomed, resolution, p, vec4f(0.0, 0.0, 1.0, 1.0));
  }
  if (inBox(uv, crumbs)) {
    return mosaic(uv, zoomed, resolution, crumbP, crumbs);
  }
  if (inNavChrome(uv, navRight, logo)) {
    return chromeTwitch(uv, zoomed, resolution, p, navRight, logo, crumbs);
  }
  return mosaic(uv, zoomed, resolution, p, vec4f(navRight, 0.0, 1.0, 1.0));
}
`;

/**
 * Second pass: the origin and landing nav items — the ones trading the
 * current-page strike — actually change during a navigation, so they get the
 * full mosaic. Cells may hop into the other item's box, handing the strike
 * over through the scramble.
 * uni[0].x = page clock. uni[0].y = full-frame flag (pass 1 owns that case).
 * uni[1] = origin item box, uni[2] = landing item box.
 */
const STRIKE_FRAGMENT_SHADER = `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

bool inBox(vec2 u, vec4 b) {
  return u.x >= b.x && u.x <= b.z && u.y >= b.y && u.y <= b.w;
}

vec2 gridHop(vec2 uv, vec2 resolution, float p) {
  vec2 grid = max(floor(resolution / 32.0), vec2(4.0));
  vec2 cell = floor(uv * grid);
  vec2 cellUv = fract(uv * grid);
  float rnd = hash21(cell);
  float raw = clamp((p - rnd * 0.58) / 0.42, 0.0, 1.0);
  float inv = 1.0 - raw;
  float t = 1.0 - inv * inv * inv;
  vec2 swap = vec2(
    floor(hash21(cell + 1.7) * 13.0) - 6.0,
    floor(hash21(cell + 8.3) * 9.0) - 4.0
  );
  vec2 srcCell = mix(cell + swap, cell, t);
  float hop = 1.0 - smoothstep(0.55, 1.0, t);
  srcCell = mix(srcCell, floor(srcCell + 0.5), hop);
  return (srcCell + cellUv) / grid;
}

vec4 applyEffect(vec4 color, vec2 uv, vec2 resolution, vec4 uni[4]) {
  float p = clamp(uni[0].x, 0.0, 1.0);
  if (p >= 0.999 || uni[0].y > 0.5) return color;
  if (!inBox(uv, uni[1]) && !inBox(uv, uni[2])) return color;
  vec2 srcUv = gridHop(uv, resolution, p);
  if (!inBox(srcUv, uni[1]) && !inBox(srcUv, uni[2])) return color;
  // uni[0].z: snapshot available — parked cells keep the old strike tiles.
  if (uni[0].z > 0.5) {
    vec2 grid = max(floor(resolution / 32.0), vec2(4.0));
    if (p < hash21(floor(uv * grid)) * 0.58) {
      return texture(uSnap, clamp(srcUv, 0.0, 1.0));
    }
  }
  return texture(uTexture, clamp(srcUv, 0.0, 1.0));
}
`;

const STRIKE_FRAGMENT_SHADER_WGSL = `
fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn inBox(u: vec2f, b: vec4f) -> bool {
  return u.x >= b.x && u.x <= b.z && u.y >= b.y && u.y <= b.w;
}

fn gridHop(uv: vec2f, resolution: vec2f, p: f32) -> vec2f {
  let grid = max(floor(resolution / 32.0), vec2f(4.0));
  let cell = floor(uv * grid);
  let cellUv = fract(uv * grid);
  let rnd = hash21(cell);
  let raw = clamp((p - rnd * 0.58) / 0.42, 0.0, 1.0);
  let inv = 1.0 - raw;
  let t = 1.0 - inv * inv * inv;
  let swap = vec2f(
    floor(hash21(cell + vec2f(1.7)) * 13.0) - 6.0,
    floor(hash21(cell + vec2f(8.3)) * 9.0) - 4.0
  );
  var srcCell = mix(cell + swap, cell, t);
  let hop = 1.0 - smoothstep(0.55, 1.0, t);
  srcCell = mix(srcCell, floor(srcCell + vec2f(0.5)), hop);
  return (srcCell + cellUv) / grid;
}

fn applyEffect(color: vec4f, uv: vec2f, resolution: vec2f, uni: Uni) -> vec4f {
  let p = clamp(uni.values0.x, 0.0, 1.0);
  if (p >= 0.999 || uni.values0.y > 0.5) {
    return color;
  }
  if (!inBox(uv, uni.values1) && !inBox(uv, uni.values2)) {
    return color;
  }
  let srcUv = gridHop(uv, resolution, p);
  if (!inBox(srcUv, uni.values1) && !inBox(srcUv, uni.values2)) {
    return color;
  }
  return textureSample(uTexture, uSampler, clamp(srcUv, vec2f(0.0), vec2f(1.0)));
}
`;

export default function MouseDistortion(props: MouseDistortionProps) {
  if (isServer) return null;

  let captureStrike: ((phase: "from" | "to") => void) | null = null;

  onLeave(() => {
    captureStrike?.("from");
    return beginPageLeave();
  });
  onEnter(() => {
    captureStrike?.("to");
    return beginPageEntry();
  });

  createEffect(() => {
    if (!webgl.loaded) return;

    const radiusPx = props.radius ?? 48;
    const strengthMax = props.strength ?? 0.3;
    const magnify = () => (componentView() ? 0 : strengthMax);
    const offset = props.offset ?? [0, 0];

    let targetX = 0.5;
    let targetY = 0.5;
    let targetStrength = 0;

    let currentX = 0.5;
    let currentY = 0.5;
    let currentStrength = 0;

    // Pointer speed (px/ms) feeds the lens radius; the rendered radius is
    // damped toward its target so it swells and relaxes without jumps.
    let pointerSpeed = 0;
    let holding = false;
    let holdTimer = 0;
    let currentRadiusPx = radiusPx;
    let lastMoveX = 0;
    let lastMoveY = 0;
    let lastMoveT = 0;
    let hasLastMove = false;
    const radiusUvNow = () =>
      currentRadiusPx / Math.max(window.innerHeight, 1);

    let backend = "webgl2";
    let chrome = readChromeUv(backend);
    let intro = true;
    let alive = true;
    let pumping = false;
    const trail: LensTrail = createLensTrail();

    // Snapshot of the outgoing page (WebGL2 only). Captured on the first
    // frame of a leave, before any scramble or fade touches the scene, and
    // sampled by the shaders for cells that have not flipped to the new page.
    let wantSnapshot = false;
    let snapReady = false;
    let snapTex: WebGLTexture | null = null;
    let snapGl: WebGL2RenderingContext | null = null;
    let snapWaiters: Array<(ok: boolean) => void> = [];
    const snapHandle = () =>
      snapTex && snapGl ? { texture: snapTex, gl: snapGl } : null;

    const root = document.documentElement;
    root.classList.add("is-intro");
    root.style.setProperty("--intro", "0");

    const endIntro = () => {
      if (!intro) return;
      intro = false;
      root.classList.remove("is-intro");
      root.style.removeProperty("--intro");
      pp.setEffectUni(effectId, { value8: 0 });
    };

    const paintIntro = (page: number) => {
      if (!intro) return;
      const shown = Math.max(0, (page - 0.15) / 0.85);
      root.style.setProperty("--intro", shown.toFixed(3));
      if (page >= 0.999) endIntro();
    };

    const chromeUni = () => ({
      value6: chrome.navRight,
      value7: crumbProgress(),
      // 1 = whole frame, 2 = snapshot mix.
      value8: intro || mosaicFullFrame() ? 1 : snapReady ? 2 : 0,
      value9: chrome.logo.minX,
      value10: chrome.logo.minY,
      value11: chrome.logo.maxX,
      value12: chrome.logo.maxY,
      value13: chrome.crumbs.minX,
      value14: chrome.crumbs.minY,
      value15: chrome.crumbs.maxX,
      value16: chrome.crumbs.maxY,
    });

    const snapChrome = (nextBackend: string) => {
      backend = nextBackend;
      chrome = readChromeUv(backend);
    };

    const pp = createPostProcessor({
      onFrame(_post, frame) {
        if (
          wantSnapshot &&
          frame.gl &&
          frame.inputTexture.backend === "webgl2"
        ) {
          const gl = frame.gl;
          const src = frame.inputTexture;
          if (snapTex && snapGl !== gl) snapTex = null;
          if (!snapTex) {
            snapTex = gl.createTexture();
            snapGl = gl;
          }
          const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.framebuffer);
          gl.bindTexture(gl.TEXTURE_2D, snapTex);
          gl.copyTexImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA16F,
            0,
            0,
            src.width,
            src.height,
            0,
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
          wantSnapshot = false;
          if (!snapReady) {
            snapReady = true;
            setMosaicSnapshotMode(true);
          }
          const waiters = snapWaiters;
          snapWaiters = [];
          for (const resolve of waiters) resolve(true);
        } else if (snapWaiters.length && frame.inputTexture.backend !== "webgl2") {
          const waiters = snapWaiters;
          snapWaiters = [];
          for (const resolve of waiters) resolve(false);
        }

        const dt = Math.min(frame.delta * 0.001, 0.1);
        const k = 9;
        const lerpT = 1 - Math.exp(-k * dt);

        const mouseSettled =
          currentX === targetX &&
          currentY === targetY &&
          currentStrength === targetStrength;

        if (!mouseSettled) {
          currentX += (targetX - currentX) * lerpT;
          currentY += (targetY - currentY) * lerpT;
          currentStrength += (targetStrength - currentStrength) * lerpT;
          if (Math.abs(targetX - currentX) < 0.0005) currentX = targetX;
          if (Math.abs(targetY - currentY) < 0.0005) currentY = targetY;
          if (Math.abs(targetStrength - currentStrength) < 0.0005) {
            currentStrength = targetStrength;
          }
        }

        pointerSpeed *= Math.exp(-SPEED_DECAY * dt);
        if (pointerSpeed < 0.001) pointerSpeed = 0;
        const speedBoost = Math.min(
          pointerSpeed * RADIUS_SPEED_GAIN,
          RADIUS_MAX_BOOST,
        );
        const speedRadiusPx = radiusPx * (1 + speedBoost);
        const heldRadiusPx = radiusPx * (1 + RADIUS_MAX_BOOST) * HOLD_SCALE;
        const targetRadiusPx = holding ? heldRadiusPx : speedRadiusPx;
        currentRadiusPx +=
          (targetRadiusPx - currentRadiusPx) * (1 - Math.exp(-RADIUS_K * dt));
        if (Math.abs(targetRadiusPx - currentRadiusPx) < 0.1) {
          currentRadiusPx = targetRadiusPx;
        }
        const radiusSettled =
          pointerSpeed === 0 && currentRadiusPx === targetRadiusPx;

        trail.step({
          x: currentX,
          y: postPointerY(currentY, frame.backend),
          radius: radiusUvNow(),
          stamp: strengthMax > 0 ? currentStrength / strengthMax : 0,
          dt,
          canvasWidth: frame.canvas.width,
          canvasHeight: frame.canvas.height,
          gl: frame.gl ?? null,
        });
        const trailHot = trail.hot();

        if (!mouseSettled || !radiusSettled || trailHot) {
          getDefaultEngine()?.requestFrame();
        }

        if (mouseSettled && radiusSettled && !trailHot && !intro && !mosaicFullFrame()) {
          return;
        }

        snapChrome(frame.backend);
        pp.setEffectUni(effectId, {
          value1: currentX,
          value2: postPointerY(currentY, frame.backend),
          value3: radiusUvNow(),
          value4: currentStrength,
          value5: mosaicProgress(),
          ...chromeUni(),
        });
      },
    });

    const effectId = pp.addFragmentEffect({
      fragmentShader: FRAGMENT_SHADER,
      fragmentShaderWgsl: FRAGMENT_SHADER_WGSL,
      textureUniforms: { uSnap: snapHandle, uTrail: () => trail.handle() },
      uni: {
        value1: currentX,
        value2: currentY,
        value3: radiusUvNow(),
        value4: currentStrength,
        value5: mosaicProgress(),
        ...chromeUni(),
      },
    });

    // Second pass: full scramble on the nav items whose current-page strike
    // changes during this navigation (origin captured at leave, landing at
    // enter). Runs after the main pass so it composes over lens + twitch.
    const strikeBox = { from: EMPTY_BOX, to: EMPTY_BOX };

    const readStrikeUv = () => {
      const W = Math.max(window.innerWidth, 1);
      const H = Math.max(window.innerHeight, 1);
      const links = document.querySelectorAll<HTMLElement>(
        '[data-mosaic-chrome=nav] a[aria-current="page"]',
      );
      for (const el of links) {
        if (el.closest("[data-mosaic-page=crumbs]")) continue;
        return uvBox(el, backend, W, H, 8 / W, 8 / H);
      }
      return EMPTY_BOX;
    };

    const strikeUni = () => ({
      value1: mosaicProgress(),
      value2: intro || mosaicFullFrame() ? 1 : 0,
      value3: snapReady ? 1 : 0,
      value5: strikeBox.from.minX,
      value6: strikeBox.from.minY,
      value7: strikeBox.from.maxX,
      value8: strikeBox.from.maxY,
      value9: strikeBox.to.minX,
      value10: strikeBox.to.minY,
      value11: strikeBox.to.maxX,
      value12: strikeBox.to.maxY,
    });

    const strikeId = pp.addFragmentEffect({
      fragmentShader: STRIKE_FRAGMENT_SHADER,
      fragmentShaderWgsl: STRIKE_FRAGMENT_SHADER_WGSL,
      textureUniforms: { uSnap: snapHandle },
      uni: strikeUni(),
    });

    const pushStrikeUni = () => pp.setEffectUni(strikeId, strikeUni());

    captureStrike = (phase) => {
      if (phase === "from") {
        wantSnapshot = true;
        strikeBox.from = readStrikeUv();
        strikeBox.to = EMPTY_BOX;
      } else {
        strikeBox.to = readStrikeUv();
        // The landing nav may still be settling layout; re-read next frame.
        requestAnimationFrame(() => {
          if (!alive) return;
          strikeBox.to = readStrikeUv();
          pushStrikeUni();
        });
      }
      pushStrikeUni();
    };

    let kick = () => {};
    const pump = () => {
      pumping = false;
      if (!alive) return;
      const running = tickMosaic(performance.now());
      paintIntro(mosaicProgress());
      if (!intro && !running) return;
      getDefaultEngine()?.requestFrame();
      kick();
    };
    kick = () => {
      if (!alive || pumping) return;
      pumping = true;
      setTimeout(pump, 16);
    };

    setMosaicSink((_page, crumbs) => {
      paintIntro(mosaicProgress());
      snapChrome(backend);
      pp.setEffectUni(effectId, {
        value5: mosaicProgress(),
        ...chromeUni(),
        value7: crumbs,
      });
      pushStrikeUni();
      kick();
    });
    void playMosaic(1);
    kick();

    createEffect(() => {
      if (!componentView()) return;
      targetStrength = 0;
      getDefaultEngine()?.requestFrame();
    });

    setMosaicSnapshotRequester(
      () =>
        new Promise<boolean>((resolve) => {
          if (!alive) return resolve(false);
          snapWaiters.push(resolve);
          wantSnapshot = true;
          getDefaultEngine()?.requestFrame();
          // Never hold mosaic snapshot waiters hostage to a frame that does not come.
          setTimeout(() => {
            const i = snapWaiters.indexOf(resolve);
            if (i < 0) return;
            snapWaiters.splice(i, 1);
            resolve(false);
          }, 120);
        }),
    );

    const onPointerMove = (e: PointerEvent) => {
      const ox = offset[0] / window.innerWidth;
      const oy = offset[1] / window.innerHeight;
      targetX = e.clientX / window.innerWidth + ox;
      targetY = e.clientY / window.innerHeight + oy;
      targetStrength = magnify();
      if (hasLastMove) {
        const dtMs = Math.max(e.timeStamp - lastMoveT, 1);
        const dist = Math.hypot(e.clientX - lastMoveX, e.clientY - lastMoveY);
        // Target rises instantly; the rendered radius is damped in onFrame.
        pointerSpeed = Math.max(pointerSpeed, Math.min(dist / dtMs, 3));
      }
      hasLastMove = true;
      lastMoveX = e.clientX;
      lastMoveY = e.clientY;
      lastMoveT = e.timeStamp;
    };

    const onPointerLeave = () => {
      targetStrength = 0;
    };

    const clearHoldTimer = () => {
      if (!holdTimer) return;
      clearTimeout(holdTimer);
      holdTimer = 0;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      clearHoldTimer();
      holdTimer = window.setTimeout(() => {
        holdTimer = 0;
        if (!alive) return;
        holding = true;
        getDefaultEngine()?.requestFrame();
      }, HOLD_ARM_MS);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.type !== "pointercancel" && e.button !== 0) return;
      clearHoldTimer();
      if (!holding) return;
      holding = false;
      getDefaultEngine()?.requestFrame();
    };

    const onResize = () => {
      snapChrome(backend);
      pp.setEffectUni(effectId, { value3: radiusUvNow(), ...chromeUni() });
      getDefaultEngine()?.requestFrame();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("resize", onResize);

    onCleanup(() => {
      alive = false;
      clearHoldTimer();
      captureStrike = null;
      setMosaicSnapshotRequester(undefined);
      for (const resolve of snapWaiters) resolve(false);
      snapWaiters = [];
      setMosaicSnapshotMode(false);
      if (snapTex && snapGl) snapGl.deleteTexture(snapTex);
      snapTex = null;
      setMosaicSink(undefined);
      root.classList.remove("is-intro");
      root.style.removeProperty("--intro");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      pp.removeEffect(strikeId);
      pp.removeEffect(effectId);
      pp.destroy();
      trail.destroy();
    });
  });

  return null;
}
