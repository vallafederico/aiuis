import { For, onCleanup, onMount } from "solid-js";
import type { UiProps } from "../types";
import {
  AXIS_LABELS,
  DEFAULT_AXIS_PAIR,
  SEED_CORNER_TILES,
  type AxisPair,
} from "~/lib/moodboard";
import "./GenerativeMoodboard.css";

type Block = {
  id: string;
  /** Scores on the active pair, 0–1. */
  x: number;
  y: number;
  /** Width as a share of the plane width at zoom 1. */
  w: number;
  aspect: number;
  alpha: number;
};

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 6;
/** Wheel pixels per e-fold of zoom. */
const WHEEL_ZOOM = 0.0016;
/** Follow rate (1/s) of the rendered view toward the target. */
const VIEW_K = 18;
/** Follow rate while dragging: a slight lag behind the pointer. */
const DRAG_K = 14;
/** Glide decay after release (1/s); higher stops sooner. */
const FLING_FRICTION = 4.5;
/** Below this (px/s) the glide stops. */
const FLING_MIN = 8;
const FLING_MAX = 4000;
/** Held still this long (ms) before release: no throw. */
const FLING_STALE_MS = 90;
const ASPECTS = [3 / 4, 1, 4 / 3, 16 / 9, 2 / 3];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed corners plus a fixed scatter, so every visit shows the same board. */
function seedBlocks(pair: AxisPair, count: number): Block[] {
  const rand = mulberry32(7);
  const corners = SEED_CORNER_TILES.map((tile) => ({
    id: tile.id,
    x: tile.scores[pair.x],
    y: tile.scores[pair.y],
    w: 0.11,
    aspect: 4 / 3,
    alpha: 0.2,
  }));
  const scatter = Array.from({ length: count }, (_, i) => ({
    id: `block-${i}`,
    x: 0.04 + rand() * 0.92,
    y: 0.04 + rand() * 0.92,
    w: 0.045 + rand() * 0.065,
    aspect: ASPECTS[Math.floor(rand() * ASPECTS.length)]!,
    alpha: 0.07 + rand() * 0.16,
  }));
  return [...corners, ...scatter];
}

/** Gap between a label and its axis line, and between a label and the board edge. */
const LABEL_GAP = 8;

/** HTML, not MSDF: nothing inside the board goes through the WebGL lens. */
function AxisLabel(props: { text: string; ref: (el: HTMLSpanElement) => void }) {
  return (
    <span ref={props.ref} class="mood-axis-label">
      {props.text}
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
  const pair = DEFAULT_AXIS_PAIR;
  const x = AXIS_LABELS[pair.x];
  const y = AXIS_LABELS[pair.y];
  const blocks = seedBlocks(pair, 26);

  let plane!: HTMLDivElement;
  let world!: HTMLDivElement;
  let axisX!: HTMLSpanElement;
  let axisY!: HTMLSpanElement;
  const labels = {} as Record<"xLow" | "xHigh" | "yHigh" | "yLow", HTMLSpanElement>;

  // Pan is in px from the plane centre, where the board's midpoint sits at rest.
  const target = { x: 0, y: 0, z: 1 };
  const view = { x: 0, y: 0, z: 1 };
  let raf = 0;
  let last = 0;
  let drag: { id: number; x: number; y: number; t: number } | null = null;

  /** Plane size and the board's box inside it at zoom 1. Re-read on resize. */
  const box = { w: 0, h: 0, insetY: 0 };
  const measure = () => {
    box.w = plane.clientWidth;
    box.h = plane.clientHeight;
    box.insetY = world.offsetTop;
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

    axisX.style.transform = `translate3d(0px, ${cy}px, 0) scaleX(${w})`;
    axisY.style.transform = `translate3d(${cx}px, ${top}px, 0) scaleY(${bottom - top})`;

    const g = LABEL_GAP;
    const inX = (el: HTMLElement, x: number) => clamp(x, 0, w - el.offsetWidth);
    const inY = (el: HTMLElement, y: number) => clamp(y, top, bottom - el.offsetHeight);
    const { xLow, xHigh, yHigh, yLow } = labels;
    place(xLow, 0, inY(xLow, cy - xLow.offsetHeight - g));
    place(xHigh, w - xHigh.offsetWidth, inY(xHigh, cy - xHigh.offsetHeight - g));
    place(yHigh, inX(yHigh, cx + g), top);
    place(yLow, inX(yLow, cx + g), bottom - yLow.offsetHeight);
  };

  const paint = () => {
    world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.z})`;
    paintAxes();
  };

  /** Release velocity in px/s; the board glides on it after a drag. */
  const fling = { x: 0, y: 0 };

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
    const pan = 1 - Math.exp(-(drag ? DRAG_K : VIEW_K) * dt);
    const zoom = 1 - Math.exp(-VIEW_K * dt);
    view.x += (target.x - view.x) * pan;
    view.y += (target.y - view.y) * pan;
    view.z += (target.z - view.z) * zoom;
    const settled =
      !drag &&
      fling.x === 0 &&
      fling.y === 0 &&
      Math.abs(target.x - view.x) < 0.1 &&
      Math.abs(target.y - view.y) < 0.1 &&
      Math.abs(target.z - view.z) < 0.0005;
    if (settled) Object.assign(view, target);
    paint();
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

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    // Grabbing the board stops any glide where it is.
    fling.x = fling.y = 0;
    target.x = view.x;
    target.y = view.y;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp };
    try {
      plane.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone; the drag still ends on pointerup / cancel.
    }
    plane.classList.add("is-dragging");
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
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
    if (!drag || event.pointerId !== drag.id) return;
    // A pause before letting go means "put it here", not a throw.
    if (event.timeStamp - drag.t > FLING_STALE_MS) fling.x = fling.y = 0;
    const speed = Math.hypot(fling.x, fling.y);
    if (speed > FLING_MAX) {
      fling.x *= FLING_MAX / speed;
      fling.y *= FLING_MAX / speed;
    }
    drag = null;
    plane.classList.remove("is-dragging");
    kick();
  };

  onMount(() => {
    measure();
    paint();
    plane.addEventListener("wheel", onWheel, { passive: false });
    const resize = new ResizeObserver(() => {
      measure();
      paint();
    });
    resize.observe(plane);
    onCleanup(() => resize.disconnect());
  });

  onCleanup(() => {
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
      >
        <div ref={world} class="mood-world">
          <For each={blocks}>
            {(block) => (
              <span
                class="mood-block"
                style={{
                  left: `${block.x * 100}%`,
                  top: `${(1 - block.y) * 100}%`,
                  width: `${block.w * 100}%`,
                  "aspect-ratio": String(block.aspect),
                  "--alpha": String(block.alpha),
                }}
                aria-hidden="true"
              />
            )}
          </For>
        </div>
        <div class="mood-axes">
          <span ref={axisX} class="mood-axis is-x" aria-hidden="true">
            <i />
          </span>
          <span ref={axisY} class="mood-axis is-y" aria-hidden="true">
            <i />
          </span>
          <AxisLabel text={x.low} ref={(el) => (labels.xLow = el)} />
          <AxisLabel text={x.high} ref={(el) => (labels.xHigh = el)} />
          <AxisLabel text={y.high} ref={(el) => (labels.yHigh = el)} />
          <AxisLabel text={y.low} ref={(el) => (labels.yLow = el)} />
        </div>
      </div>
    </div>
  );
}
