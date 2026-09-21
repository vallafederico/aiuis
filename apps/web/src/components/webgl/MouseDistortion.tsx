import { createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { createPostProcessor, getDefaultEngine } from "shooosh";
import { onEnter, onLeave } from "@acme/router";
import { webgl } from "~/lib/stores/webglStore";
import {
  crumbProgress,
  mosaicProgress,
  beginPageEntry,
  beginPageLeave,
  playMosaic,
  setMosaicSink,
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
  const crumbs = document.querySelector<HTMLElement>("[data-mosaic-page=crumbs]");
  const navBox = nav?.getBoundingClientRect();
  const navRight = navBox ? navBox.right / W + padX : 0;
  return {
    navRight,
    logo: uvBox(logo, backend, W, H, padX, padY),
    crumbs: uvBox(crumbs, backend, W, H, padX, padY),
  };
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

vec4 chromeTwitch(vec2 uv, vec2 zoomed, vec2 resolution, float p, float navRight, vec4 logo, vec4 crumbs) {
  if (p >= 0.999 || p <= 0.001) {
    return texture(uTexture, zoomed);
  }
  vec2 srcUv = gridHop(uv, resolution, p);
  if (!inNavChrome(srcUv, navRight, logo) || inBox(srcUv, crumbs)) srcUv = uv;
  return texture(uTexture, clamp(srcUv, 0.0, 1.0));
}

vec4 mosaic(vec2 uv, vec2 zoomed, vec2 resolution, float p, vec4 hops) {
  if (p >= 0.999) {
    return texture(uTexture, zoomed);
  }
  vec2 srcUv = gridHop(uv, resolution, p);
  if (!inBox(srcUv, hops)) srcUv = uv;
  return texture(uTexture, clamp(srcUv, 0.0, 1.0));
}

vec4 applyEffect(vec4 color, vec2 uv, vec2 resolution, vec4 uni[4]) {
  vec2 mouse = vec2(uni[0].x, uni[0].y);
  float radiusUv = uni[0].z;
  float strength = uni[0].w;
  float p = clamp(uni[1].x, 0.0, 1.0);
  float navRight = uni[1].y;
  float crumbP = clamp(uni[1].z, 0.0, 1.0);
  vec4 logo = uni[2];
  vec4 crumbs = uni[3];

  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 delta = (uv - mouse) * aspect;
  float dist = length(delta);
  float mask = smoothstep(radiusUv, radiusUv * 0.55, dist);
  float zoom = 1.0 - mask * strength;
  vec2 zoomed = mouse + (uv - mouse) * zoom;

  if (uni[1].w > 0.5) {
    return mosaic(uv, zoomed, resolution, p, vec4(0.0, 0.0, 1.0, 1.0));
  }
  if (inBox(uv, crumbs)) {
    return mosaic(uv, zoomed, resolution, crumbP, crumbs);
  }
  if (inNavChrome(uv, navRight, logo)) {
    return chromeTwitch(uv, zoomed, resolution, p, navRight, logo, crumbs);
  }
  return mosaic(uv, zoomed, resolution, p, vec4(navRight, 0.0, 1.0, 1.0));
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

fn chromeTwitch(uv: vec2f, zoomed: vec2f, resolution: vec2f, p: f32, navRight: f32, logo: vec4f, crumbs: vec4f) -> vec4f {
  if (p >= 0.999 || p <= 0.001) {
    return textureSample(uTexture, uSampler, zoomed);
  }
  var srcUv = gridHop(uv, resolution, p);
  if (!inNavChrome(srcUv, navRight, logo) || inBox(srcUv, crumbs)) {
    srcUv = uv;
  }
  return textureSample(uTexture, uSampler, clamp(srcUv, vec2f(0.0), vec2f(1.0)));
}

fn mosaic(uv: vec2f, zoomed: vec2f, resolution: vec2f, p: f32, hops: vec4f) -> vec4f {
  if (p >= 0.999) {
    return textureSample(uTexture, uSampler, zoomed);
  }
  var srcUv = gridHop(uv, resolution, p);
  if (!inBox(srcUv, hops)) {
    srcUv = uv;
  }
  return textureSample(uTexture, uSampler, clamp(srcUv, vec2f(0.0), vec2f(1.0)));
}

fn applyEffect(color: vec4f, uv: vec2f, resolution: vec2f, uni: Uni) -> vec4f {
  let mouse = vec2f(uni.values0.x, uni.values0.y);
  let radiusUv = uni.values0.z;
  let strength = uni.values0.w;
  let p = clamp(uni.values1.x, 0.0, 1.0);
  let navRight = uni.values1.y;
  let crumbP = clamp(uni.values1.z, 0.0, 1.0);
  let logo = uni.values2;
  let crumbs = uni.values3;
  let aspect = vec2f(resolution.x / resolution.y, 1.0);
  let delta = (uv - mouse) * aspect;
  let dist = length(delta);
  let mask = smoothstep(radiusUv, radiusUv * 0.55, dist);
  let zoom = 1.0 - mask * strength;
  let zoomed = mouse + (uv - mouse) * zoom;
  if (uni.values1.w > 0.5) {
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

export default function MouseDistortion(props: MouseDistortionProps) {
  if (isServer) return null;

  onLeave(() => beginPageLeave());
  onEnter(() => beginPageEntry());

  createEffect(() => {
    if (!webgl.loaded) return;

    const radiusPx = props.radius ?? 48;
    const strengthMax = props.strength ?? 0.3;
    const offset = props.offset ?? [0, 0];

    let targetX = 0.5;
    let targetY = 0.5;
    let targetStrength = 0;

    let currentX = 0.5;
    let currentY = 0.5;
    let currentStrength = 0;

    let radiusUv = radiusPx / window.innerHeight;
    let backend = "webgl2";
    let chrome = readChromeUv(backend);
    let intro = true;
    let alive = true;
    let pumping = false;

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
      value8: intro ? 1 : 0,
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

        if (mouseSettled && !intro) return;

        snapChrome(frame.backend);
        pp.setEffectUni(effectId, {
          value1: currentX,
          value2: postPointerY(currentY, frame.backend),
          value3: radiusUv,
          value4: currentStrength,
          value5: mosaicProgress(),
          ...chromeUni(),
        });
      },
    });

    const effectId = pp.addFragmentEffect({
      fragmentShader: FRAGMENT_SHADER,
      fragmentShaderWgsl: FRAGMENT_SHADER_WGSL,
      uni: {
        value1: currentX,
        value2: currentY,
        value3: radiusUv,
        value4: currentStrength,
        value5: mosaicProgress(),
        ...chromeUni(),
      },
    });

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
        value7: crumbs,
        ...chromeUni(),
      });
      kick();
    });
    void playMosaic(1);
    kick();

    const onPointerMove = (e: PointerEvent) => {
      const ox = offset[0] / window.innerWidth;
      const oy = offset[1] / window.innerHeight;
      targetX = e.clientX / window.innerWidth + ox;
      targetY = e.clientY / window.innerHeight + oy;
      targetStrength = strengthMax;
    };

    const onPointerLeave = () => {
      targetStrength = 0;
    };

    const onResize = () => {
      radiusUv = radiusPx / window.innerHeight;
      snapChrome(backend);
      pp.setEffectUni(effectId, { value3: radiusUv, ...chromeUni() });
      getDefaultEngine()?.requestFrame();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("resize", onResize);

    onCleanup(() => {
      alive = false;
      setMosaicSink(undefined);
      root.classList.remove("is-intro");
      root.style.removeProperty("--intro");
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      pp.removeEffect(effectId);
      pp.destroy();
    });
  });

  return null;
}
