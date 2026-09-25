import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { UiProps } from "../types";
import {
  AXIS_LABELS,
  AXIS_VIEWS,
  MOOD_DIMENSIONS,
  type AxisPair,
  type MoodScores,
  type MoodTile,
} from "~/lib/moodboard";
import { MOODBOARD_SEED_TILES } from "~/lib/moodboard-seeds";
import { mixMoodboardPair } from "~/lib/moodboard-mix";
import GlFill from "~/components/webgl/GlFill";
import MsdfText from "~/components/webgl/MsdfText";
import { NavHitButton, NavHitText } from "~/components/NavHit";
import { MoodTileGl, createEngineHeat, textureFor, type Paper } from "./mood-tile-gl";
import "./GenerativeMoodboard.css";

/** Draw order of the tile quads; the logo sits at 10, above all of them. */
const TILE_LAYER = 2;
const TILE_LAYER_BLEND = 3;
const TILE_LAYER_NEAR = 4;
/** A blend being drawn sits above every other tile. */
const TILE_LAYER_GENERATING = 5;
/**
 * The engine draws equal layers in creation order, and a tile re-creates its
 * quad on every re-layer (focus, blend, generate). A fixed per-tile offset
 * keeps the resting stack order.
 */
const TILE_ORDER_STEP = 0.001;

type Block = {
  id: string;
  src: string;
  alt: string;
  /** Every dimension, 0–1; the active view picks two of them as x / y. */
  scores: MoodScores;
  /** Width as a share of the plane width at zoom 1. */
  w: number;
  aspect: number;
  /** Midpoint placeholder for the focused pair. */
  pending?: boolean;
  /** Focus pair key the placeholder belongs to. */
  pair?: string;
  /** Source tile ids for the blend. */
  sources?: [string, string];
  /** Parallax depth; blends take their sources' average so they stay between them. */
  depth?: number;
};

/** How much tiles resist the zoom: 0 = scale with the board, 1 = constant screen size. */
const TILE_COUNTER_ZOOM = 0.4;
/** Zoom past which tiles swap their 640px textures for full size. */
const FULL_RES_ZOOM = 1.3;
/** Wheel / pinch zoom limits: out far enough to see the whole set, in to about one photo. */
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 3;
/** Wheel pixels per e-fold of zoom. */
const WHEEL_ZOOM = 0.0016;
/** Follow rate (1/s) of the rendered view toward the target. */
const VIEW_K = 18;
/** Follow rate while dragging: a slight lag behind the pointer. */
const DRAG_K = 14;
/** Follow rate for the glide that centres a new generation: slow and deliberate. */
const CENTER_K = 3.2;
/** Glide decay after release (1/s); higher stops sooner. */
const FLING_FRICTION = 4.5;
/** Below this (px/s) the glide stops. */
const FLING_MIN = 8;
const FLING_MAX = 4000;
/** Held still this long (ms) before release: no throw. */
const FLING_STALE_MS = 90;
/** Pointer movement before pan replaces press-to-focus (px). */
const DRAG_SLOP = 7;
/** A press waits this long before focusing, so the start of a drag does not flash the fade. */
const FOCUS_DELAY_MS = 180;
/** Parallax: each tile moves this much more or less than the pan (±, share of it). */
const PARALLAX = 0.09;

/** Seed photos fly in one by one over this long (s), in a stable shuffled order. */
const ENTER_SPREAD_S = 2.4;
/** Matches mood-block-fly in GenerativeMoodboard.css: 0.5s wait, 1.4s flight. */
const ENTER_MS = (0.5 + ENTER_SPREAD_S + 1.4) * 1000;
/** How far out a seed photo starts its flight (vmax), past the screen edge. */
const ENTER_DISTANCE = 85;

function hash01(id: string, salt: number) {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

function enterDelayOf(id: string) {
  return hash01(id, 7) * ENTER_SPREAD_S;
}

/**
 * Where a seed photo flies in from: outward from the board's centre through
 * its own spot, so the board assembles from all around. Tiles near the
 * centre take a stable random angle instead.
 */
function enterFrom(id: string, p: Point) {
  let dx = p.x - 0.5;
  let dy = 0.5 - p.y;
  let len = Math.hypot(dx, dy);
  if (len < 0.08) {
    const a = hash01(id, 13) * Math.PI * 2;
    dx = Math.cos(a);
    dy = Math.sin(a);
    len = 1;
  }
  return { x: (dx / len) * ENTER_DISTANCE, y: (dy / len) * ENTER_DISTANCE };
}

/** Stable per-tile depth in [-PARALLAX, PARALLAX], from the id. */
function depthOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 131 + id.charCodeAt(i)) | 0;
  return ((((h >>> 0) % 1000) / 1000) * 2 - 1) * PARALLAX;
}

/** Paper bend per px/s of pan, and its cap (share of a tile's size). */
const BEND_PER_SPEED = 0.00006;
const BEND_MAX = 0.18;
/** How long tiles take to glide to a new view; matches the CSS transition. */
const VIEW_SWITCH_MS = 1100;
/** Minimap margin around the tiles, as a share of their extent. */
const MAP_MARGIN = 0.12;
/** Pan limit: the tiles always reach at least this share into the view from each edge. */
const PAN_KEEP = 0.3;
/** Minimap quads sit above the board's tiles and axes (up to 6), below the logo (10). */
const MAP_LAYER = 7;
/** The view marker's corners: a horizontal and a vertical bar at each. */
const MAP_CORNERS = ["tl-h", "tl-v", "tr-h", "tr-v", "bl-h", "bl-v", "br-h", "br-v"].map(
  (c) => `mood-map-corner is-${c}`,
);
/** Zoom bow per e-fold/s of zoom, and its cap. */
const CUP_PER_RATE = 0.05;
const CUP_MAX = 0.14;
/** Low-pass (1/s) on the shared bend / bow target; the springs live per tile. */
const TARGET_SMOOTH = 24;
/** Tiles vary from their base size up to this factor (stable per tile). */
const SIZE_VARIATION = 1.4;

function sizeFactor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 17 + id.charCodeAt(i)) | 0;
  return 1 + (((h >>> 0) % 1000) / 1000) * (SIZE_VARIATION - 1);
}

/** Scored photo tiles; positions come from the active view (see layoutFor). */
function seedBlocks(tiles: MoodTile[]): Block[] {
  return tiles.map((tile) => ({
    id: tile.id,
    src: tile.src ?? "",
    alt: tile.caption,
    scores: tile.scores,
    w: (0.062 + tile.scores.sparseDense * 0.026) * sizeFactor(tile.id),
    aspect: tile.aspect ?? 3 / 4,
  }));
}

type Point = { id: string; x: number; y: number };

/** Stretched axes keep this margin at each end of the board. */
const STRETCH_MARGIN = 0.06;

/**
 * Maps a dimension onto the board: min to max of this set becomes the full
 * width, order kept. Some dimensions barely vary here (the set is almost all
 * staged, so candor spans 0 to 0.4) and would otherwise pile on one side.
 */
function stretch(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range < 1e-6) return () => 0.5;
  return (v: number) => STRETCH_MARGIN + ((v - min) / range) * (1 - 2 * STRETCH_MARGIN);
}

/** Where each tile sits on a view: its two scores, stretched, with ties nudged apart. */
function layoutFor(blocks: Block[], pair: AxisPair): Map<string, Point> {
  const sx = stretch(blocks.map((b) => b.scores[pair.x]));
  const sy = stretch(blocks.map((b) => b.scores[pair.y]));
  const points = separateBlocks(
    blocks.map((b) => ({ id: b.id, x: sx(b.scores[pair.x]), y: sy(b.scores[pair.y]) })),
  );
  return new Map(points.map((p) => [p.id, p]));
}

/**
 * A portrait tile on a landscape board spans about twice as much of the board's
 * height as of its width, so vertical gaps are measured in that squashed unit.
 */
const SEPARATE_Y_SCALE = 2;

/** Light nudge for true overlaps/ties in score-space (relative scores spread naturally). */
function separateBlocks(blocks: Point[], minDist = 0.13): Point[] {
  const out = blocks.map((b) => ({ ...b }));
  const pad = 0.04;
  const clamp01 = (v: number) => Math.min(1 - pad, Math.max(pad, v));

  for (let iter = 0; iter < 96; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j].x - out[i].x;
        let dy = (out[j].y - out[i].y) / SEPARATE_Y_SCALE;
        let d = Math.hypot(dx, dy);
        if (d < 1e-5) {
          // Identical scores: fan out on a stable angle from the id.
          let h = 0;
          for (let k = 0; k < out[i].id.length; k++) h = (h * 31 + out[i].id.charCodeAt(k)) | 0;
          const a = ((h >>> 0) % 360) * (Math.PI / 180);
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1e-5;
        }
        if (d >= minDist) continue;
        const push = ((minDist - d) / 2) * (iter < 24 ? 0.55 : 0.9);
        const ux = dx / d;
        const uy = dy / d;
        out[i].x = clamp01(out[i].x - ux * push);
        out[i].y = clamp01(out[i].y - uy * push * SEPARATE_Y_SCALE);
        out[j].x = clamp01(out[j].x + ux * push);
        out[j].y = clamp01(out[j].y + uy * push * SEPARATE_Y_SCALE);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

/** Gap between a label and its axis line, and between labels. */
const LABEL_GAP = 12;
/** Axis lines stop this far inside the board's box; labels line up with their ends. */
const LABEL_EDGE = 24;

type LabelKey = "xLow" | "xHigh" | "yHigh" | "yLow";
const LABEL_KEYS: LabelKey[] = ["xLow", "xHigh", "yHigh", "yLow"];
type Size = { w: number; h: number };
type Rect = Size & { x: number; y: number };

function overlaps(a: Rect, b: Rect) {
  const pad = LABEL_GAP / 2;
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

/** WebGL text like the rest of the board; the hidden HTML copy keeps the box the script measures. */
function AxisLabel(props: { text: string; ref: (el: HTMLSpanElement) => void }) {
  return (
    <span ref={props.ref} class="mood-axis-label">
      <MsdfText text={props.text} font="AlteHaasGroteskBold" />
    </span>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Art-directed Generative Moodboard. The axes are fixed on the screen centre;
 * the images behind them pan by drag and zoom by wheel / trackpad scroll.
 */
export default function GenerativeMoodboardDirected(_props: UiProps) {
  const [viewId, setViewId] = createSignal(AXIS_VIEWS[0]!.id);
  const pair = () => (AXIS_VIEWS.find((v) => v.id === viewId()) ?? AXIS_VIEWS[0]!).pair;
  const x = () => AXIS_LABELS[pair().x];
  const y = () => AXIS_LABELS[pair().y];
  const [worldAspect, setWorldAspect] = createSignal(16 / 10);
  let mapView: HTMLSpanElement | undefined;
  const [blocks, setBlocks] = createSignal<Block[]>(seedBlocks(MOODBOARD_SEED_TILES));
  const layout = createMemo(() => layoutFor(blocks(), pair()));
  const byId = createMemo(() => new Map(blocks().map((b) => [b.id, b])));
  /**
   * Where a tile sits on the current view. A blend sits at the midpoint of its
   * two sources' actual places (after tie-nudging), not at its own averaged
   * scores, so it stays exactly between them on every view.
   */
  const posOf = (b: Block): Point => {
    if (b.sources) {
      const a = byId().get(b.sources[0]);
      const c = byId().get(b.sources[1]);
      if (a && c) {
        const pa = posOf(a);
        const pc = posOf(c);
        return { id: b.id, x: (pa.x + pc.x) / 2, y: (pa.y + pc.y) / 2 };
      }
    }
    return layout().get(b.id) ?? { id: b.id, x: b.scores[pair().x], y: b.scores[pair().y] };
  };
  /** Parallax depth; a blend's is its sources' average (see Block.depth). */
  const depthFor = (b: Block) => b.depth ?? depthOf(b.id);
  let disposed = false;
  const { heat, dispose: disposeHeat } = createEngineHeat();

  let plane!: HTMLDivElement;
  let world!: HTMLDivElement;
  let axisX!: HTMLSpanElement;
  let axisY!: HTMLSpanElement;
  const labels = {} as Record<LabelKey, HTMLSpanElement>;
  const sizes = {} as Record<LabelKey, Size>;

  // Pan is in px from the plane centre, where the board's midpoint sits at rest.
  const target = { x: 0, y: 0, z: 1 };
  const view = { x: 0, y: 0, z: 1 };
  /** Past this zoom, tiles upgrade to full-size textures. */
  const [zoomedIn, setZoomedIn] = createSignal(false);
  /** Shared by every tile quad; see mood-tile-gl.tsx. */
  const paper: Paper = { x: 0, y: 0, cup: 0 };
  let raf = 0;
  let last = 0;
  let drag: {
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    t: number;
    dragging: boolean;
    /** True when pointer-down happened while a focus pair was already active. */
    swapping: boolean;
  } | null = null;

  /**
   * Focused pair as [closer, farther] from the initial pick.
   * Later clicks replace the farther slot; the closer stays until a drag clears focus.
   */
  const [focusedIds, setFocusedIds] = createSignal<string[] | null>(null);

  const focusPairKey = (ids: string[]) => `${ids[0] ?? ""}|${ids[1] ?? ""}`;

  /**
   * A finished blend keeps its placeholder block (same element) and gets its
   * image here, so the blue wash can fade off it instead of the tile remounting.
   */
  const [revealed, setRevealed] = createSignal<Record<string, string>>({});
  /** Clicked blends: they stay on the board and keep generating whatever happens next. */
  const [generating, setGenerating] = createSignal<Record<string, true>>({});
  const srcOf = (b: Block) => b.src || revealed()[b.id] || "";
  /** A blend still without its image, clicked or not. */
  const isBlend = (b: Block) => !!b.pending && !revealed()[b.id];
  const isGenerating = (b: Block) => !!generating()[b.id];
  /** The one uncommitted placeholder; moving on replaces or drops it. */
  const isPlaceholder = (b: Block) => isBlend(b) && !isGenerating(b);

  /** A tile's box in world units (0–1 across the world box, y down). */
  const worldBox = (b: Block) => {
    const h = (b.w * worldAspect()) / b.aspect;
    const p = posOf(b);
    const cx = p.x;
    const cy = 1 - p.y;
    return { left: cx - b.w / 2, right: cx + b.w / 2, top: cy - h / 2, bottom: cy + h / 2 };
  };

  /** Where the tiles are, in world units, without margin. */
  const tileExtent = createMemo(() => {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const b of blocks()) {
      const r = worldBox(b);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    return Number.isFinite(left) ? { left, right, top, bottom } : { left: 0, right: 1, top: 0, bottom: 1 };
  });

  /** What the minimap covers: every tile and the resting view, with a margin. */
  const mapExtent = createMemo(() => {
    let left = 0;
    let right = 1;
    let top = 0;
    let bottom = 1;
    for (const b of blocks()) {
      const r = worldBox(b);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    const mx = (right - left) * MAP_MARGIN;
    const my = (bottom - top) * MAP_MARGIN;
    return { left: left - mx, right: right + mx, top: top - my, bottom: bottom + my };
  });

  const mapRect = (b: Block) => {
    const ext = mapExtent();
    const r = worldBox(b);
    const ew = ext.right - ext.left;
    const eh = ext.bottom - ext.top;
    return {
      left: `${((r.left - ext.left) / ew) * 100}%`,
      top: `${((r.top - ext.top) / eh) * 100}%`,
      width: `${((r.right - r.left) / ew) * 100}%`,
      height: `${((r.bottom - r.top) / eh) * 100}%`,
    };
  };

  const mapAspect = () => {
    const ext = mapExtent();
    return ((ext.right - ext.left) / (ext.bottom - ext.top)) * worldAspect();
  };

  // A new blend can widen the map; keep the view marker in step.
  createEffect(() => {
    mapExtent();
    paintMinimap();
  });
  const setGeneratingFlag = (id: string, on: boolean) =>
    setGenerating((prev) => {
      const next = { ...prev };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });

  /** Show the midpoint placeholder for the focused pair; generation waits for a click on it. */
  const placePlaceholder = (ids: string[]) => {
    if (ids.length !== 2) return;
    const key = focusPairKey(ids);
    const existing = blocks().find(isPlaceholder);
    if (existing?.pair === key) return;

    const tiles = blocks().filter((b) => !isBlend(b) && srcOf(b));
    const a = tiles.find((b) => b.id === ids[0]);
    const b = tiles.find((b) => b.id === ids[1]);
    if (!a || !b) return;

    const pending: Block = {
      id: `mix-${ids[0]}-${ids[1]}-${Date.now()}`,
      src: "",
      alt: `Mix of ${a.alt} and ${b.alt}`,
      // Halfway on every dimension, so the blend sits between them on any view.
      scores: Object.fromEntries(
        MOOD_DIMENSIONS.map((dim) => [dim, (a.scores[dim] + b.scores[dim]) / 2]),
      ) as MoodScores,
      w: (a.w + b.w) / 2 || 0.12,
      aspect: (a.aspect + b.aspect) / 2 || 0.75,
      pending: true,
      pair: key,
      sources: [a.id, b.id],
      depth: (depthFor(a) + depthFor(b)) / 2,
    };

    setBlocks((prev) => [...prev.filter((block) => !isPlaceholder(block)), pending]);
  };

  const dropPlaceholder = () => {
    setBlocks((prev) => prev.filter((block) => !isPlaceholder(block)));
  };

  /** Swap the axis pair: same tiles and scores, new places (they glide there in CSS). */
  const switchView = (id: string) => {
    if (id === viewId()) return;
    endHover();
    clearFocus();
    dropPlaceholder();
    setViewId(id);
    heat(VIEW_SWITCH_MS + 200);
  };

  /** True when the click landed on the visible placeholder. */
  const hitsPlaceholder = (clientX: number, clientY: number) => {
    const el = world.querySelector<HTMLElement>(".mood-block.is-pending:not(.is-generating)");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const p = plane.getBoundingClientRect();
    const visible = r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom;
    return (
      visible &&
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    );
  };

  /**
   * Blends per focus pair. Hover starts one early; leaving without a click
   * just leaves it unrevealed, so a later hover or click on the pair is instant.
   */
  const mixCache = new Map<string, ReturnType<typeof mixMoodboardPair>>();

  /** Refs go up as ~512px JPEG data URLs: smaller upload, no server refetch. */
  const REF_MAX = 512;
  const downscale = (src: string): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const s = Math.min(1, REF_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * s);
        canvas.height = Math.round(img.naturalHeight * s);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });

  const prefetchMix = () => {
    const pending = blocks().find(isPlaceholder);
    if (!pending?.pair || !pending.sources) return null;
    const cached = mixCache.get(pending.pair);
    if (cached) return cached;
    const tiles = blocks();
    const a = tiles.find((b) => b.id === pending.sources![0]);
    const b = tiles.find((b) => b.id === pending.sources![1]);
    if (!a || !b) return null;
    const request = Promise.all([downscale(srcOf(a)), downscale(srcOf(b))]).then(([srcA, srcB]) =>
      mixMoodboardPair({ srcA, srcB, aspect: (a.aspect + b.aspect) / 2 }),
    );
    mixCache.set(pending.pair, request);
    return request;
  };

  /** Hover must rest this long on the placeholder before a blend starts. */
  const HOVER_PREFETCH_MS = 120;
  let hoverTimer = 0;
  let focusTimer = 0;
  let hovering = false;

  /** The tile under the cursor; it loads full size while nothing is focused. */
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);

  const tileUnder = (clientX: number, clientY: number) => {
    const contains = (el: Element) => {
      const r = el.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    };
    // Keep the current one while the cursor is still on it: overlaps don't flicker.
    const current = hoveredId();
    const currentEl = current ? world.querySelector(`[data-tile="${CSS.escape(current)}"]`) : null;
    if (currentEl && contains(currentEl)) return current;
    let best: string | null = null;
    let bestD = Infinity;
    for (const el of world.querySelectorAll<HTMLElement>("[data-tile]")) {
      if (!contains(el)) continue;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = el.dataset.tile ?? null;
      }
    }
    return best;
  };

  const onHover = (event: PointerEvent) => {
    setHoveredId(tileUnder(event.clientX, event.clientY));
    const over = hitsPlaceholder(event.clientX, event.clientY);
    if (over === hovering) return;
    hovering = over;
    clearTimeout(hoverTimer);
    if (over) hoverTimer = window.setTimeout(() => void prefetchMix(), HOVER_PREFETCH_MS);
  };

  const endHover = () => {
    hovering = false;
    clearTimeout(hoverTimer);
    setHoveredId(null);
  };

  const startMix = () => {
    const pending = blocks().find(isPlaceholder);
    if (!pending?.pair) return;
    const key = pending.pair;
    const pendingId = pending.id;
    const request = prefetchMix();
    if (!request) return;

    setGeneratingFlag(pendingId, true);
    centerOn(pending);

    const fail = (error: unknown) => {
      if (disposed) return;
      console.error("[moodboard mix]", error);
      mixCache.delete(key);
      setGeneratingFlag(pendingId, false);
      setBlocks((prev) => prev.filter((block) => block.id !== pendingId));
    };

    void request.then(async (result) => {
      if (disposed) return;
      if (!result.ok) return fail(result.error);

      // Upload first so the image is ready under the wash before it fades.
      await textureFor(result.dataUrl).catch(() => {});
      if (disposed) return;

      setRevealed((prev) => ({ ...prev, [pendingId]: result.dataUrl }));
      setGeneratingFlag(pendingId, false);
      mixCache.delete(key);
      // Still looking at this pair: the board goes back to normal. Otherwise
      // leave whatever the user moved on to alone.
      const focused = focusedIds();
      if (focused && focusPairKey(focused) === key) {
        endHover();
        clearFocus();
      }
    }, fail);
  };

  const tileDistances = (clientX: number, clientY: number) => {
    const wr = world.getBoundingClientRect();
    return blocks()
      .filter((b) => !isBlend(b) && srcOf(b))
      .map((b) => ({
        id: b.id,
        d: Math.hypot(
          clientX - (wr.left + posOf(b).x * wr.width + view.x * depthFor(b)),
          clientY - (wr.top + (1 - posOf(b).y) * wr.height + view.y * depthFor(b)),
        ),
      }))
      .sort((a, b) => a.d - b.d);
  };

  const nearestTwo = (clientX: number, clientY: number): string[] =>
    tileDistances(clientX, clientY)
      .slice(0, 2)
      .map((r) => r.id);

  const nearestOne = (clientX: number, clientY: number): string | null =>
    tileDistances(clientX, clientY)[0]?.id ?? null;

  const pickFocus = (clientX: number, clientY: number) => {
    setFocusedIds(nearestTwo(clientX, clientY));
  };

  /** Keep the closer of the current pair; swap in the clicked tile for the farther. */
  const swapFarther = (clientX: number, clientY: number) => {
    const pair = focusedIds();
    if (!pair || pair.length < 2) {
      pickFocus(clientX, clientY);
      return;
    }
    const clicked = nearestOne(clientX, clientY);
    if (!clicked || pair.includes(clicked)) return;
    setFocusedIds([pair[0]!, clicked]);
  };

  const clearFocus = () => {
    setFocusedIds(null);
  };

  /** Plane size and the board's box inside it at zoom 1. Re-read on resize. */
  const box = { w: 0, h: 0, insetY: 0, worldW: 1, worldH: 1 };
  const measure = () => {
    box.w = plane.clientWidth;
    box.h = plane.clientHeight;
    box.insetY = world.offsetTop;
    box.worldW = world.offsetWidth || 1;
    box.worldH = world.offsetHeight || 1;
    setWorldAspect(box.worldW / box.worldH);
    for (const key of LABEL_KEYS) {
      sizes[key] = { w: labels[key].offsetWidth, h: labels[key].offsetHeight };
    }
  };

  const place = (el: HTMLElement, x: number, y: number) => {
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  /**
   * The cross follows the board, so blocks keep their quadrant under any pan
   * or zoom. Labels sit at the box edges on their own side and slide along
   * their line, held inside the box so they are always on screen.
   */
  const paintAxes = () => {
    const { w, h, insetY } = box;
    // The cross is the board's midpoint; the lines are directions, so they
    // always span the whole box whatever the zoom.
    const cx = w / 2 + view.x;
    const cy = h / 2 + view.y;
    const top = insetY;
    const bottom = h - insetY;

    const e = LABEL_EDGE;
    axisX.style.transform = `translate3d(${e}px, ${cy}px, 0) scaleX(${w - 2 * e})`;
    axisY.style.transform = `translate3d(${cx}px, ${top + e}px, 0) scaleY(${bottom - top - 2 * e})`;

    const g = LABEL_GAP;
    const inX = (s: Size, x: number) => clamp(x, e, w - s.w - e);
    const inY = (s: Size, y: number) => clamp(y, top + e, bottom - s.h - e);
    // Page controls over the board (back arrow, UIs link) count as already
    // placed, so labels step around them.
    const origin = plane.getBoundingClientRect();
    const placed: Rect[] = [...document.querySelectorAll<HTMLElement>("[data-board-exclude]")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }));

    // Each label tries its spots in order and takes the first that is clear
    // of the ones already placed; if none is, it steps past whatever is in
    // the way along its own axis.
    const settle = (
      key: LabelKey,
      spots: Array<{ x: number; y: number }>,
      stepPast: (hit: Rect, s: Size) => { x: number; y: number },
    ) => {
      const s = sizes[key];
      const rects = spots.map((p) => ({ x: inX(s, p.x), y: inY(s, p.y), ...s }));
      let rect = rects.find((r) => !placed.some((o) => overlaps(r, o)));
      if (!rect) {
        const hit = placed.find((o) => overlaps(rects[0]!, o))!;
        const p = stepPast(hit, s);
        rect = { x: inX(s, p.x), y: inY(s, p.y), ...s };
      }
      placed.push(rect);
      place(labels[key], rect.x, rect.y);
    };

    const above = (s: Size) => cy - s.h - g;
    const below = cy + g;
    const right = cx + g;
    const left = (s: Size) => cx - g - s.w;

    // Edge-pinned spots start at 0 / the far edge; inX / inY add the inset.
    settle("xLow", [{ x: 0, y: above(sizes.xLow) }, { x: 0, y: below }], (hit, s) => ({
      x: hit.x + hit.w + g,
      y: above(s),
    }));
    settle(
      "xHigh",
      [
        { x: w, y: above(sizes.xHigh) },
        { x: w, y: below },
      ],
      (hit, s) => ({ x: hit.x - s.w - g, y: above(s) }),
    );
    settle("yHigh", [{ x: right, y: top }, { x: left(sizes.yHigh), y: top }], (hit) => ({
      x: right,
      y: hit.y + hit.h + g,
    }));
    settle(
      "yLow",
      [
        { x: right, y: bottom },
        { x: left(sizes.yLow), y: bottom },
      ],
      (hit, s) => ({ x: right, y: hit.y - s.h - g }),
    );
  };

  /** The visible part of the board, in world units (0–1 across the world box). */
  const visibleWorld = () => {
    const { w, h, worldW, worldH } = box;
    return {
      left: 0.5 + (-w / 2 - view.x) / (view.z * worldW),
      right: 0.5 + (w / 2 - view.x) / (view.z * worldW),
      top: 0.5 + (-h / 2 - view.y) / (view.z * worldH),
      bottom: 0.5 + (h / 2 - view.y) / (view.z * worldH),
    };
  };

  const paintMinimap = () => {
    if (!mapView) return;
    const ext = mapExtent();
    const v = visibleWorld();
    const toX = (n: number) => clamp((n - ext.left) / (ext.right - ext.left), 0, 1) * 100;
    const toY = (n: number) => clamp((n - ext.top) / (ext.bottom - ext.top), 0, 1) * 100;
    const left = toX(v.left);
    const top = toY(v.top);
    mapView.style.left = `${left}%`;
    mapView.style.top = `${top}%`;
    mapView.style.width = `${toX(v.right) - left}%`;
    mapView.style.height = `${toY(v.bottom) - top}%`;
  };

  const recenter = () => {
    fling.x = fling.y = 0;
    target.x = 0;
    target.y = 0;
    target.z = 1;
    kick();
  };

  const paint = () => {
    world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.z})`;
    paintMinimap();
    // Parallax: each tile adds pan × its depth. In world units, so it stays
    // a screen-space shift whatever the zoom.
    world.style.setProperty("--pan-x", `${view.x / view.z}px`);
    world.style.setProperty("--pan-y", `${view.y / view.z}px`);
    // Tiles counter-scale against the zoom: positions spread at the full zoom
    // while each tile grows by only zoom^(1 − TILE_COUNTER_ZOOM), so zooming
    // into a stack pulls it apart.
    world.style.setProperty("--tile-scale", String(Math.pow(view.z, -TILE_COUNTER_ZOOM)));
    paintAxes();
  };

  /** Release velocity in px/s; the board glides on it after a drag. */
  const fling = { x: 0, y: 0 };
  /** The slow centring glide is running; any drag or wheel takes over at the normal rate. */
  let centering = false;

  /**
   * Glide so this tile sits in the middle of the screen, at the current zoom.
   * On screen a tile is at pan + (u − ½)·size·zoom + pan·depth (parallax), so
   * the pan that centres it is −(u − ½)·size·zoom / (1 + depth), per axis.
   */
  const centerOn = (b: Block) => {
    const r = worldBox(b);
    const depth = depthFor(b);
    const z = target.z;
    fling.x = fling.y = 0;
    target.x = (-((r.left + r.right) / 2 - 0.5) * box.worldW * z) / (1 + depth);
    target.y = (-((r.top + r.bottom) / 2 - 0.5) * box.worldH * z) / (1 + depth);
    centering = true;
    kick();
  };

  /**
   * Keep the tiles on screen: the world is centred in the plane and scales
   * about its centre, so a world point u sits at centre + pan + (u − ½)·size·zoom.
   * A glide into the limit stops on that axis.
   */
  const clampPan = () => {
    const ext = tileExtent();
    const z = target.z;
    const axis = (pan: number, lo: number, hi: number, size: number, span: number) => {
      const keep = span * PAN_KEEP;
      const min = keep - span / 2 - (hi - 0.5) * size * z;
      const max = span / 2 - keep - (lo - 0.5) * size * z;
      // Zoomed far out the tiles fit either way: hold them centred.
      if (min > max) return (min + max) / 2;
      return Math.min(max, Math.max(min, pan));
    };
    const x = axis(target.x, ext.left, ext.right, box.worldW, box.w);
    const y = axis(target.y, ext.top, ext.bottom, box.worldH, box.h);
    if (x !== target.x) fling.x = 0;
    if (y !== target.y) fling.y = 0;
    target.x = x;
    target.y = y;
  };

  const tick = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
    last = now;
    if (!drag) {
      target.x += fling.x * dt;
      target.y += fling.y * dt;
      const decay = Math.exp(-FLING_FRICTION * dt);
      fling.x *= decay;
      fling.y *= decay;
      if (Math.hypot(fling.x, fling.y) < FLING_MIN) fling.x = fling.y = 0;
    }
    if (box.w > 0) clampPan();
    if (drag) centering = false;
    if (centering && Math.hypot(target.x - view.x, target.y - view.y) < 0.5) centering = false;
    const pan = 1 - Math.exp(-(drag ? DRAG_K : centering ? CENTER_K : VIEW_K) * dt);
    const zoom = 1 - Math.exp(-VIEW_K * dt);
    const before = { x: view.x, y: view.y, z: view.z };
    view.x += (target.x - view.x) * pan;
    view.y += (target.y - view.y) * pan;
    view.z += (target.z - view.z) * zoom;
    if (view.z > FULL_RES_ZOOM !== zoomedIn()) setZoomedIn(view.z > FULL_RES_ZOOM);

    // The sheets bend against the pan like paper dragged through air. Zoom
    // also shifts the view (it anchors on the cursor); that should not bend.
    const zooming = Math.abs(view.z - before.z) > 0.0001;
    let bx = zooming ? 0 : ((view.x - before.x) / Math.max(dt, 0.001)) * BEND_PER_SPEED;
    let by = zooming ? 0 : ((view.y - before.y) / Math.max(dt, 0.001)) * BEND_PER_SPEED;
    const bendLength = Math.hypot(bx, by);
    if (bendLength > BEND_MAX) {
      bx *= BEND_MAX / bendLength;
      by *= BEND_MAX / bendLength;
    }
    // Zooming in bows the sheets away (edges trail back as you push in),
    // zooming out toward the viewer. The
    // rate is relative (e-folds / s), so it feels the same at any zoom level.
    const zoomRate = Math.log(view.z / before.z) / Math.max(dt, 0.001);
    const cupTarget = Math.max(-CUP_MAX, Math.min(CUP_MAX, -zoomRate * CUP_PER_RATE));

    // Only the target is shared (lightly smoothed: per-frame velocity is noisy).
    // Each tile springs toward it with its own stiffness (mood-tile-gl.tsx), so
    // they settle one after another rather than all on the same frame.
    const smooth = 1 - Math.exp(-TARGET_SMOOTH * dt);
    paper.x += (bx - paper.x) * smooth;
    paper.y += (by - paper.y) * smooth;
    paper.cup += (cupTarget - paper.cup) * smooth;
    const flat = Math.hypot(paper.x, paper.y) < 0.0004 && Math.abs(paper.cup) < 0.0004;

    const settled =
      !drag &&
      flat &&
      fling.x === 0 &&
      fling.y === 0 &&
      Math.abs(target.x - view.x) < 0.1 &&
      Math.abs(target.y - view.y) < 0.1 &&
      Math.abs(target.z - view.z) < 0.0005;
    if (settled) {
      Object.assign(view, target);
      paper.x = paper.y = paper.cup = 0;
    }
    paint();
    // Tiles are WebGL quads tracking the board: keep the engine drawing while it moves.
    heat(300);
    raf = settled ? 0 : requestAnimationFrame(tick);
  };

  const kick = () => {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  };

  /** Pointer position relative to the axes origin. */
  const fromCentre = (clientX: number, clientY: number) => {
    const rect = plane.getBoundingClientRect();
    return {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    centering = false;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plane.clientHeight : 1;
    // Pinch arrives as ctrl+wheel with small deltas; give it more reach.
    const gain = event.ctrlKey ? WHEEL_ZOOM * 6 : WHEEL_ZOOM;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target.z * Math.exp(-event.deltaY * unit * gain)));
    // Keep the world point under the cursor fixed while zooming.
    const c = fromCentre(event.clientX, event.clientY);
    const ratio = next / target.z;
    target.x = c.x - (c.x - target.x) * ratio;
    target.y = c.y - (c.y - target.y) * ratio;
    target.z = next;
    kick();
  };

  /** Touches on the board, for two-finger pinch zoom. */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; z: number; mx: number; my: number } | null = null;

  const pinchSpan = () => {
    const [a, b] = [...touches.values()];
    return {
      dist: Math.max(1, Math.hypot(b!.x - a!.x, b!.y - a!.y)),
      mx: (a!.x + b!.x) / 2,
      my: (a!.y + b!.y) / 2,
    };
  };

  const startPinch = () => {
    // A second finger turns whatever the first was doing into a pinch.
    clearTimeout(focusTimer);
    focusTimer = 0;
    if (drag?.dragging) plane.classList.remove("is-dragging");
    drag = null;
    clearFocus();
    fling.x = fling.y = 0;
    centering = false;
    const span = pinchSpan();
    pinch = { dist: span.dist, z: target.z, mx: span.mx, my: span.my };
  };

  const movePinch = () => {
    if (!pinch) return;
    const span = pinchSpan();
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.z * (span.dist / pinch.dist)));
    // Like the wheel: the world point under the fingers stays put, and the
    // midpoint moving pans the board.
    const c = fromCentre(span.mx, span.my);
    const ratio = next / target.z;
    target.x = c.x - (c.x - target.x) * ratio + (span.mx - pinch.mx);
    target.y = c.y - (c.y - target.y) * ratio + (span.my - pinch.my);
    target.z = next;
    pinch.mx = span.mx;
    pinch.my = span.my;
    kick();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        try {
          plane.setPointerCapture(event.pointerId);
        } catch {
          // Pointer already gone; the pinch still ends on pointerup / cancel.
        }
        startPinch();
        return;
      }
      if (touches.size > 2) return;
    }
    if (event.button !== 0) return;
    // Grabbing the board stops any glide where it is.
    fling.x = fling.y = 0;
    target.x = view.x;
    target.y = view.y;
    const swapping = focusedIds() !== null;
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      t: event.timeStamp,
      dragging: false,
      swapping,
    };
    // Fresh focus: pick the two nearest, once the press has held still a
    // moment. Already focused: wait for click (pointerup without drag) to swap
    // the farther for the clicked tile.
    clearTimeout(focusTimer);
    focusTimer = 0;
    if (!swapping) {
      focusTimer = window.setTimeout(() => {
        focusTimer = 0;
        if (drag && !drag.dragging) pickFocus(drag.x, drag.y);
      }, FOCUS_DELAY_MS);
    }
    try {
      plane.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone; the drag still ends on pointerup / cancel.
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch) {
        movePinch();
        return;
      }
    }
    if (!drag) {
      onHover(event);
      return;
    }
    if (event.pointerId !== drag.id) return;

    if (!drag.dragging) {
      const slop = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (slop < DRAG_SLOP) {
        drag.x = event.clientX;
        drag.y = event.clientY;
        // Only chase the cursor while establishing the initial pair, once it shows.
        if (!drag.swapping && !focusTimer) pickFocus(event.clientX, event.clientY);
        return;
      }
      clearTimeout(focusTimer);
      focusTimer = 0;
      clearFocus();
      drag.dragging = true;
      fling.x = fling.y = 0;
      setHoveredId(null);
      plane.classList.add("is-dragging");
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const dtMs = Math.max(event.timeStamp - drag.t, 1);
    target.x += dx;
    target.y += dy;
    // Smoothed pointer velocity, used as the release fling.
    const blend = 0.35;
    fling.x += ((dx / dtMs) * 1000 - fling.x) * blend;
    fling.y += ((dy / dtMs) * 1000 - fling.y) * blend;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.t = event.timeStamp;
    kick();
  };

  const endDrag = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (pinch) {
      // The finger left over after a pinch is not a click or a drag.
      if (touches.size < 2) pinch = null;
      kick();
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    const { dragging, swapping, t } = drag;
    drag = null;
    if (dragging) {
      // A pause before letting go means "put it here", not a throw.
      if (event.timeStamp - t > FLING_STALE_MS) fling.x = fling.y = 0;
      const speed = Math.hypot(fling.x, fling.y);
      if (speed > FLING_MAX) {
        fling.x *= FLING_MAX / speed;
        fling.y *= FLING_MAX / speed;
      }
      plane.classList.remove("is-dragging");
      dropPlaceholder();
    } else if (swapping && hitsPlaceholder(event.clientX, event.clientY)) {
      startMix();
    } else {
      // A quick click released before the delay still focuses.
      if (!swapping && focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = 0;
        if (event.type !== "pointercancel") pickFocus(event.clientX, event.clientY);
      }
      if (swapping) swapFarther(event.clientX, event.clientY);
      const ids = focusedIds();
      if (ids && ids.length === 2) placePlaceholder(ids);
    }
    kick();
  };

  onMount(() => {
    measure();
    paint();
    // The quads read the proxies' CSS fade each frame; keep drawing through the staggered intro.
    heat(ENTER_MS + 200);
    plane.addEventListener("wheel", onWheel, { passive: false });
    const resize = new ResizeObserver(() => {
      measure();
      paint();
    });
    resize.observe(plane);
    // Label sizes change when the web font swaps in.
    for (const key of LABEL_KEYS) resize.observe(labels[key]);
    onCleanup(() => resize.disconnect());
  });

  // CSS fades on the proxies only reach the quads while the engine draws.
  createEffect(() => {
    const busy = Object.keys(generating()).length > 0;
    focusedIds();
    revealed();
    heat(busy ? 10_000 : 1_600);
  });

  onCleanup(() => {
    disposed = true;
    disposeHeat();
    clearTimeout(hoverTimer);
    clearTimeout(focusTimer);
    cancelAnimationFrame(raf);
    plane?.removeEventListener("wheel", onWheel);
  });

  return (
    <div class="mood-page" role="application" aria-label="Generative moodboard">
      <div
        ref={plane}
        class="mood-plane"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endHover}
      >
        <div class="mood-fade">
          <div
            ref={world}
            class="mood-world"
            classList={{ "is-focusing": focusedIds() !== null }}
          >
            <For each={blocks()}>
              {(block, index) => {
                const near = () => focusedIds()?.includes(block.id) ?? false;
                return (
                <figure
                  class="mood-block"
                  data-tile={block.id}
                  role="img"
                  aria-label={block.alt}
                  classList={{
                    "is-near": near(),
                    "is-pending": isBlend(block),
                    "is-generating": isGenerating(block),
                    "is-revealed": !!block.pending && !isBlend(block),
                  }}
                  style={{
                    left: `${posOf(block).x * 100}%`,
                    top: `${(1 - posOf(block).y) * 100}%`,
                    width: `calc(${block.w * 100}% * var(--tile-scale, 1))`,
                    "aspect-ratio": String(block.aspect),
                    "--depth": String(depthFor(block)),
                    "--enter": block.sources ? "0s" : `${enterDelayOf(block.id).toFixed(3)}s`,
                    ...(block.sources
                      ? {}
                      : (() => {
                          const from = enterFrom(block.id, posOf(block));
                          return { "--fly-x": `${from.x.toFixed(1)}vmax`, "--fly-y": `${from.y.toFixed(1)}vmax` };
                        })()),
                  }}
                >
                  <MoodTileGl
                    id={block.id}
                    paper={paper}
                    full={
                      zoomedIn() ||
                      near() ||
                      // Faded tiles stay put: a hover swap under the fade reads as a flash.
                      (focusedIds() === null && hoveredId() === block.id)
                    }
                    src={srcOf(block)}
                    enterMs={block.sources ? 0 : (0.5 + enterDelayOf(block.id) + 1.4) * 1000 + 100}
                    layer={
                      (isGenerating(block)
                        ? TILE_LAYER_GENERATING
                        : near()
                          ? TILE_LAYER_NEAR
                          : isBlend(block)
                            ? TILE_LAYER_BLEND
                            : TILE_LAYER) + index() * TILE_ORDER_STEP
                    }
                  />
                  <Show when={block.pending}>
                    <span class="mood-block-wash" aria-hidden="true" />
                  </Show>
                </figure>
                );
              }}
            </For>
          </div>
        </div>
        <div class="mood-axes">
          <span ref={axisX} class="mood-axis is-x" aria-hidden="true">
            <GlFill />
          </span>
          <span ref={axisY} class="mood-axis is-y" aria-hidden="true">
            <GlFill />
          </span>
          <AxisLabel text={x().low} ref={(el) => (labels.xLow = el)} />
          <AxisLabel text={x().high} ref={(el) => (labels.xHigh = el)} />
          <AxisLabel text={y().high} ref={(el) => (labels.yHigh = el)} />
          <AxisLabel text={y().low} ref={(el) => (labels.yLow = el)} />
        </div>
      </div>
      <div class="mood-corner" data-board-exclude>
        <nav class="mood-views" aria-label="Axes">
          <For each={AXIS_VIEWS}>
            {(v) => (
              <NavHitButton
                class="mood-view"
                active={v.id === viewId()}
                label={`${v.name}: ${AXIS_LABELS[v.pair.x].low} to ${AXIS_LABELS[v.pair.x].high}, ${AXIS_LABELS[v.pair.y].low} to ${AXIS_LABELS[v.pair.y].high}`}
                onClick={() => switchView(v.id)}
              >
                <NavHitText text={v.name} font="AlteHaasGroteskBold" />
              </NavHitButton>
            )}
          </For>
        </nav>
        <button
          type="button"
          class="mood-map"
          style={{ "aspect-ratio": String(mapAspect()) }}
          aria-label="Minimap: recentre the board"
          onClick={recenter}
        >
          <For each={blocks()}>
            {(block) => (
              <span class="mood-map-tile" style={mapRect(block)}>
                <GlFill layer={MAP_LAYER} alpha={isBlend(block) ? 0.35 : 1} />
              </span>
            )}
          </For>
          <span ref={mapView} class="mood-map-view">
            <For each={MAP_CORNERS}>{(corner) => <GlFill class={corner} layer={MAP_LAYER} />}</For>
          </span>
        </button>
      </div>
    </div>
  );
}
