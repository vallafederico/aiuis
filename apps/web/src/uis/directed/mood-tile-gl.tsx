import { createEffect, onCleanup } from "solid-js";
import { createItem, getDefaultEngine, loadTexture, type ItemController } from "shooosh";
import { webgl } from "~/lib/stores/webglStore";
import { readCssColor } from "~/components/webgl/css-color";
import { glslShaders } from "~/components/webgl/shaders";

type Texture = Awaited<ReturnType<typeof loadTexture>>;

/**
 * Board-wide paper target, written by the board each frame it moves. Each tile
 * springs toward it on its own (see TileSpring), so they settle out of step.
 */
export type Paper = {
  /** Bend in tile units (share of the tile's size), following pan velocity. */
  x: number;
  y: number;
  /** Bow from the zoom rate: > 0 toward the viewer (zooming out), < 0 away (zooming in). */
  cup: number;
};

/**
 * The quad extends this far past the tile on each side (share of the tile), so
 * bent edges have room. The engine culls a quad only once its whole box is off
 * screen, so as long as the bend stays inside this pad (capped in the shader)
 * nothing visible is ever cut off or culled early.
 */
const PAD = 0.3;
/**
 * How long a replaced quad keeps drawing alongside its successor. Short: it may
 * sit on a higher layer, so it is kept in sync but should not linger.
 */
const SWAP_OVERLAP_MS = 150;
/**
 * Control-point grid per side: the displacement is linear inside each cell.
 * Finer costs nothing per pixel (each lookup reads its cell's four corners).
 */
const SUBDIVISIONS = 8;

/**
 * Items are fixed 4-vertex quads, so the paper is deformed in the fragment
 * shader: displacement lives on a SUBDIVISIONS² grid of control points,
 * interpolated per cell (a mesh with that many subdivisions), inverted by
 * fixed-point iteration, and lit by the curve's slope.
 *
 * value1 zoom bow, value9 opacity, value10 wash, value11 has photo, value12 time,
 * value13–14 bend, value15 per-tile seed, value16 per-tile stiffness (0–1).
 */
function tileShaders() {
  const [r, g, b] = readCssColor("--color-key");
  const inset = PAD / (1 + 2 * PAD);
  return glslShaders(`#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
uniform sampler2D uTexture;
out vec4 outColor;

const float INSET = ${inset.toFixed(6)};
// The bend never leaves the quad's pad (see PAD).
const float MAX_OFFSET = ${(PAD * 0.9).toFixed(4)};
const float N = ${SUBDIVISIONS.toFixed(1)};

vec3 controlPoint(vec2 grid) {
  // Each sheet is a little stiffer or looser than its neighbours.
  vec2 bend = uUni[3].xy * mix(0.75, 1.25, uUni[3].w);
  float amount = length(bend);
  // No ternary and no vector-with-scalar clamp: both break the WGSL conversion.
  vec2 dir = bend / max(amount, 0.0001);
  vec2 side = vec2(-dir.y, dir.x);
  vec2 c = grid - 0.5;
  float along = dot(c, dir);
  float across = dot(c, side);
  float wave = sin(uUni[2].w * 7.0 + uUni[3].z * 6.2831 + along * 7.0 + across * 3.0);
  // The paper is held at its centre: the far corners and the trailing edge lag most.
  float lag = dot(c, c) * 1.6 + max(-along, 0.0) * 0.7;
  vec2 offset = -bend * lag + side * wave * amount * 0.05;
  float lift = amount * (along * along * 3.0 + across * across * 1.2) + wave * amount * 0.25;
  // Zoom bows the sheet: edges toward the viewer read larger, away read smaller.
  float cup = uUni[0].x * mix(0.75, 1.25, uUni[3].w);
  offset += c * dot(c, c) * cup * 2.2;
  lift += dot(c, c) * cup * 4.0;
  offset = clamp(offset, vec2(-MAX_OFFSET), vec2(MAX_OFFSET));
  return vec3(offset, lift);
}

vec3 displacement(vec2 q) {
  vec2 cell = clamp(floor(q * N), vec2(0.0), vec2(N - 1.0));
  vec2 f = q * N - cell;
  float s = 1.0 / N;
  vec2 g0 = cell * s;
  vec3 a = controlPoint(g0);
  vec3 b = controlPoint(g0 + vec2(s, 0.0));
  vec3 c = controlPoint(g0 + vec2(0.0, s));
  vec3 d = controlPoint(g0 + vec2(s, s));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Smooth light across the curve: the lift is read continuously, not per cell,
// so cell borders never show as flat facets.
float shade(vec2 s) {
  float e = 0.02;
  float gx = (controlPoint(s + vec2(e, 0.0)).z - controlPoint(s - vec2(e, 0.0)).z) / (2.0 * e);
  float gy = (controlPoint(s + vec2(0.0, e)).z - controlPoint(s - vec2(0.0, e)).z) / (2.0 * e);
  // Light from the top left (uv y points down): a slope rising toward +x / +y
  // faces it and brightens. The sign matters; flipped, a dome reads as a bowl.
  return 1.0 + clamp(gx * 0.25 + gy * 0.35, -0.14, 0.08);
}

void main() {
  float opacity = uUni[2].x;
  float wash = uUni[2].y;
  float hasPhoto = uUni[2].z;
  vec3 key = vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)});

  // Where on the flat sheet this pixel lands once the sheet is bent.
  vec2 p = (vUv - INSET) / (1.0 - 2.0 * INSET);
  vec2 q = p;
  for (int i = 0; i < 4; i++) {
    q = p - displacement(clamp(q, vec2(0.0), vec2(1.0))).xy;
  }
  float edge = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
  float inside = clamp(edge / max(fwidth(edge), 0.0001) + 0.5, 0.0, 1.0);
  vec2 sheet = clamp(q, vec2(0.0), vec2(1.0));

  // Reveal: as the wash falls from 0.92 to 0 the photo spreads out of the blue
  // from the centre, along a ragged noise front with a light rim, and the
  // image just behind the front is still settling (warped).
  vec3 light = mix(vec3(1.0), key, 0.2);
  float reveal = clamp(1.0 - wash / 0.92, 0.0, 1.0);
  float grain = valueNoise(sheet * 5.0 + uUni[3].z * 17.0) * 0.6
    + valueNoise(sheet * 13.0 - uUni[3].z * 9.0) * 0.4;
  float field = length(sheet - 0.5) * 1.3 + (grain - 0.5) * 0.45;
  float front = reveal * 1.8 - 0.35;
  float shown = 1.0 - smoothstep(front - 0.07, front + 0.07, field);
  float toFront = (field - front) / 0.06;
  float rim = exp(-toFront * toFront) * (1.0 - reveal * reveal);
  vec2 settle = (vec2(valueNoise(sheet * 7.0 + 3.1), valueNoise(sheet * 7.0 - 5.7)) - 0.5)
    * 0.06 * (1.0 - shown * reveal);

  vec2 uv = (sheet + settle) * uUni[1].xy + uUni[1].zw;
  vec3 photo = texture(uTexture, uv).rgb;
  float luma = dot(photo, vec3(0.299, 0.587, 0.114));
  photo = mix(vec3(luma), photo, 0.9);
  photo = mix(photo, luma * key + (1.0 - key) * luma * 0.35, 0.1);
  vec3 emerging = mix(mix(key, photo, shown), light, rim * 0.85);

  // Placeholder: opaque, from a light blue to the key as the wash deepens
  // (a transparent key over the paper reads grey). CSS wash runs 0.13 to 0.92.
  float deepen = clamp((wash - 0.13) / 0.79, 0.0, 1.0);
  vec3 blank = mix(light, key, deepen);
  vec3 color = mix(blank, emerging, hasPhoto) * shade(sheet);
  float alpha = opacity * inside;
  outColor = vec4(color * alpha, alpha);
}`);
}

const textures = new Map<string, Promise<Texture>>();
/** Textures that have finished uploading, for a synchronous pick on re-layer. */
const loaded = new Map<string, Texture>();

/** Uploads a tile's texture ahead of time, so a reveal never waits on it. */
export function textureFor(src: string) {
  let cached = textures.get(src);
  if (!cached) {
    cached = loadTexture(src, { fit: "cover" });
    cached.then(
      (texture) => loaded.set(src, texture),
      () => textures.delete(src),
    );
    textures.set(src, cached);
  }
  return cached;
}

/**
 * Seed photos ship a 640px copy in /moodboard/sm/ (~0.5 MB for the set against
 * ~5 MB at full size). The board shows those first, then upgrades.
 */
function smallSrcFor(src: string) {
  const match = src.match(/^\/moodboard\/([^/]+\.webp)$/);
  return match ? `/moodboard/sm/${match[1]}` : null;
}

/** Full-size textures load a few at a time, behind the small ones. */
const FULL_CONCURRENCY = 3;
const fullQueue: Array<() => void> = [];
let fullActive = 0;
function queueFull(src: string) {
  if (textures.has(src)) return textureFor(src);
  return new Promise<Texture>((resolve, reject) => {
    const run = () => {
      fullActive++;
      textureFor(src)
        .then(resolve, reject)
        .finally(() => {
          fullActive--;
          fullQueue.shift()?.();
        });
    };
    if (fullActive < FULL_CONCURRENCY) run();
    else fullQueue.push(run);
  });
}

/** Bend spring: under-damped, so a sheet flops back a little when the board stops. */
const BEND_K = 140;
const BEND_DAMP = 14;
/** Zoom bow spring: over-damped (ratio ≈ 1.1), so a sheet eases back flat and never bounces past it. */
const CUP_K = 60;
const CUP_DAMP = 17;
/** Each tile's springs run between these multiples of the base stiffness; wider staggers the settle. */
const SPRING_SPREAD: [number, number] = [0.35, 1.75];

/** One tile's own bend and bow, chasing the shared target at its own pace. */
function createTileSpring(stiffness: number) {
  const k = SPRING_SPREAD[0] + (SPRING_SPREAD[1] - SPRING_SPREAD[0]) * stiffness;
  // Damping scales with √k so every tile keeps the same feel, just faster or slower.
  const d = Math.sqrt(k);
  const s = { x: 0, y: 0, cup: 0, vx: 0, vy: 0, vc: 0, last: 0 };
  return {
    state: s,
    step(paper: Paper, now: number) {
      const dt = s.last ? Math.min((now - s.last) / 1000, 0.05) : 1 / 60;
      s.last = now;
      s.vx += ((paper.x - s.x) * BEND_K * k - s.vx * BEND_DAMP * d) * dt;
      s.vy += ((paper.y - s.y) * BEND_K * k - s.vy * BEND_DAMP * d) * dt;
      s.vc += ((paper.cup - s.cup) * CUP_K * k - s.vc * CUP_DAMP * d) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.cup += s.vc * dt;
      const moving =
        Math.abs(paper.x - s.x) + Math.abs(paper.y - s.y) + Math.abs(paper.cup - s.cup) > 0.0003 ||
        Math.abs(s.vx) + Math.abs(s.vy) + Math.abs(s.vc) > 0.003;
      if (!moving) {
        s.x = paper.x;
        s.y = paper.y;
        s.cup = paper.cup;
        s.vx = s.vy = s.vc = 0;
      }
      return moving;
    },
  };
}

function seedOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Draws a moodboard tile in WebGL. The figure stays in the DOM as an invisible
 * proxy; this renders a padded box inside it that the quad tracks, and reads
 * the figure's (CSS-animated) opacity and the wash layer's every frame, so
 * fades keep living in the stylesheet.
 */
export function MoodTileGl(props: {
  id: string;
  src: string;
  layer: number;
  paper: Paper;
  /** Load the full-size texture (zoomed in, or this tile hovered / focused). */
  full: boolean;
  /** Ms from mount until the tile's CSS entrance has landed; it keeps writing until then. */
  enterMs?: number;
}) {
  const enterUntil = performance.now() + (props.enterMs ?? 0);
  let el!: HTMLSpanElement;
  let item: ItemController | undefined;
  let shaders: ReturnType<typeof tileShaders> | undefined;
  let last = { opacity: -1, wash: -1, x: 0, y: 0, cup: 0 };
  let disposed = false;
  let generation = 0;
  /** Replaced quads still drawing until their successor is surely up. */
  const retiring = new Set<ItemController>();
  const seed = seedOf(props.id);
  const stiffness = seedOf(`${props.id}:stiffness`);

  const spring = createTileSpring(stiffness);

  const sample = () => {
    const figure = el.parentElement!;
    const washEl = figure.querySelector<HTMLElement>(".mood-block-wash");
    return {
      opacity: Number(getComputedStyle(figure).opacity),
      wash: washEl ? Number(getComputedStyle(washEl).opacity) : 0,
      x: spring.state.x,
      y: spring.state.y,
      cup: spring.state.cup,
    };
  };

  let lastFrame: number | null = null;

  const read = () => {
    // Every live quad of this tile (current + retiring) calls this each frame;
    // do the work once and write to all of them.
    const frame = document.timeline.currentTime as number | null;
    if (frame !== null && frame === lastFrame) return;
    lastFrame = frame;
    const now = performance.now();
    // Still springing: keep writing, which keeps the engine drawing until this
    // tile has settled, even after the board itself has stopped.
    const moving = spring.step(props.paper, now);
    const next = sample();
    const bent = Math.abs(next.x) + Math.abs(next.y) + Math.abs(next.cup) > 0.0005;
    // setUni marks the engine dirty; only write on change so the page can idle.
    // While it flies in, write every frame: it starts culled off screen, and the
    // engine must keep drawing until it lands.
    const entering = now < enterUntil;
    if (
      !entering &&
      !moving &&
      !bent &&
      Math.abs(next.opacity - last.opacity) < 0.002 &&
      Math.abs(next.wash - last.wash) < 0.002 &&
      next.x === last.x &&
      next.y === last.y &&
      next.cup === last.cup
    ) {
      return;
    }
    last = next;
    const uni = {
      value1: next.cup,
      value9: next.opacity,
      value10: next.wash,
      value12: now / 1000,
      value13: next.x,
      value14: next.y,
    };
    item?.setUni(uni);
    // A retiring quad must look identical while it overlaps its successor.
    for (const old of retiring) old.setUni(uni);
  };

  createEffect(() => {
    if (!webgl.loaded) return;
    const src = props.src;
    const layer = props.layer;
    const current = ++generation;
    shaders ??= tileShaders();

    const mount = (texture: Texture | null) => {
      if (disposed || current !== generation) return;
      const previous = item;
      // Start from the proxy's current state, or a re-layered quad blinks at 0.
      last = sample();
      item = createItem(el, {
        layer,
        shaders,
        texture,
        textureFit: "cover",
        uni: {
          value1: last.cup,
          value9: last.opacity,
          value10: last.wash,
          value11: texture ? 1 : 0,
          value12: performance.now() / 1000,
          value13: last.x,
          value14: last.y,
          value15: seed,
          value16: stiffness,
        },
        onFrame: read,
      });
      // A new item builds its renderer on its first frame, and on WebGPU the
      // pipeline can take a few more. Keep the old quad drawing through that
      // gap, or the tile blinks out on every re-layer (hover, focus, reveal).
      if (previous) {
        retiring.add(previous);
        window.setTimeout(() => {
          retiring.delete(previous);
          previous.destroy();
        }, SWAP_OVERLAP_MS);
      }
      getDefaultEngine()?.requestFrame();
    };

    if (!src) {
      mount(null);
      return;
    }
    const fail = (error: unknown) => console.error("[moodboard tile]", error);
    const small = smallSrcFor(src);
    // Best texture already uploaded: swap synchronously (re-layer on hover, focus).
    const ready = loaded.get(src) ?? (small ? loaded.get(small) : undefined);
    if (ready) mount(ready);
    else textureFor(small ?? src).then(mount, fail);
    // Upgrade to full size only when it shows: zoomed in, or this tile hovered /
    // focused. At rest the 640px copy is sharp enough.
    if (small && props.full && !loaded.has(src)) queueFull(src).then(mount, fail);
  });

  onCleanup(() => {
    disposed = true;
    item?.destroy();
    for (const old of retiring) old.destroy();
    retiring.clear();
  });

  return (
    <span
      ref={el}
      class="mood-block-gl"
      style={{ inset: `${-PAD * 100}%` }}
      aria-hidden="true"
    />
  );
}

/** Keeps the settle-loop engine rendering while CSS fades or the board glide run. */
export function createEngineHeat() {
  let hotUntil = 0;
  let raf = 0;
  const loop = () => {
    getDefaultEngine()?.requestFrame();
    raf = performance.now() < hotUntil ? requestAnimationFrame(loop) : 0;
  };
  const heat = (ms: number) => {
    hotUntil = Math.max(hotUntil, performance.now() + ms);
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const dispose = () => cancelAnimationFrame(raf);
  return { heat, dispose };
}
