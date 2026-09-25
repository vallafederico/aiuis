import { Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import GlFill from "~/components/webgl/GlFill";
import { createAsync } from "@acme/router";
import { createItem, getDefaultEngine, type ItemController } from "shooosh";
import type { UiProps } from "../types";
import { KEEP_AT, getFilterRows, judgeFilterRule, type FilterRow } from "~/lib/filters";
import { getCanvasDensity, webgl } from "~/lib/stores/webglStore";
import { ballShaders, titleTexture } from "./filter-ball-gl";
import { GlTextLine } from "./filter-bar-gl";
import "./Filters.css";

const SEARCH_DEBOUNCE_MS = 450;
const PLACEHOLDER = "Find something about…";
/** Spring pull toward the bar for a passing row, scaled by its score. */
const PULL_K = 22;
/** Spring onto a spot on the ring, used only to bring balls in. */
const HOME_K = 5;
/** How long after its entrance a ball is guided home; after that it is free. */
const ENTRANCE_HOME_MS = 1800;
/** Share of critical damping on the springs: a little overshoot, then rest. */
const SPRING_DAMPING = 0.55;
/** Drag on balls drawn to the bar, and the much lighter drag on free ones, which glide. */
const DRAG = 1.6;
const FREE_DRAG = 0.45;
const RESTITUTION = 0.45;
const MOUSE_REACH = 140;
const MOUSE_PUSH = 5200;
const MOUSE_CARRY = 0.9;
const SLEEP_SPEED = 3;
/** Contacts slower than this (px/s) stop dead instead of bouncing: no rest jitter. */
const REST_SPEED = 60;
const ENTER_MS = 900;
const ENTER_STAGGER_MS = 55;
const WALLS_AFTER_MS = 2500;
const WAKE_GRACE_MS = 300;

type Mat3 = [number, number, number, number, number, number, number, number, number];

type Body = {
  row: FilterRow;
  el?: HTMLAnchorElement;
  item?: ItemController;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Resting spot as a unit offset from the stage centre. */
  hx: number;
  hy: number;
  /** Object-from-view rotation, row-major. */
  m: Mat3;
  hit: number;
  score: number | null;
  /** Above (-1) or below (1) the bar while drawn in: whichever side it was on. */
  side: number;
  /** Its own seat by the bar: px from the bar's centre, and which row out. */
  seatX: number;
  seatRow: number;
  inside: boolean;
  born: number;
};

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as unknown as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return out;
}

/** Rodrigues: rotation by `angle` about the unit axis (x, y, z). */
function axisAngle(x: number, y: number, z: number, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t,
  ];
}

/**
 * Roll about an axis in the screen plane (ax, ay, 0). m maps view → object,
 * so the view-space turn is applied on the right, inverted.
 */
function rotate(m: Mat3, ax: number, ay: number, angle: number): Mat3 {
  return mul(m, axisAngle(ax, ay, 0, -angle));
}

function orthonormalize(m: Mat3): Mat3 {
  const a = [m[0], m[1], m[2]];
  const la = Math.hypot(a[0], a[1], a[2]) || 1;
  a[0] /= la; a[1] /= la; a[2] /= la;
  const b = [m[3], m[4], m[5]];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  b[0] -= dot * a[0]; b[1] -= dot * a[1]; b[2] -= dot * a[2];
  const lb = Math.hypot(b[0], b[1], b[2]) || 1;
  b[0] /= lb; b[1] /= lb; b[2] /= lb;
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Speed off a contact: slow ones stop dead, or packed balls buzz forever. */
function bounce(v: number) {
  const speed = Math.abs(v);
  return speed < REST_SPEED ? 0 : speed * RESTITUTION;
}

function seeded(i: number) {
  const x = Math.sin(i * 91.7 + 13.1) * 43758.5453;
  return x - Math.floor(x);
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function FiltersDirected(_props: UiProps) {
  const rows = createAsync(() => getFilterRows(), { deferStream: true });
  const [query, setQuery] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [quiet, setQuiet] = createSignal<string | null>(null);
  const [drawn, setDrawn] = createSignal<number | null>(null);
  const [focused, setFocused] = createSignal(false);
  const [caret, setCaret] = createSignal(0);
  /** The input's rendered font size; the WebGL line is laid out to match it. */
  const [fieldPx, setFieldPx] = createSignal(40);
  const syncCaret = () => {
    setCaret(input?.selectionStart ?? query().length);
    // Focus events can lag (a window not yet focused); typing proves the focus.
    setFocused(document.activeElement === input);
  };

  let stage!: HTMLDivElement;
  let bar!: HTMLFormElement;
  let input!: HTMLInputElement;
  const bodies: Body[] = [];
  const els: HTMLAnchorElement[] = [];
  const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0, active: false };
  let raf = 0;
  let last = 0;
  let awakeUntil = 0;
  /** Centre-to-centre spacing of the seats by the bar. */
  let seatPitch = 0;
  let generation = 0;
  let debounce = 0;

  const size = () => ({ w: stage.clientWidth, h: stage.clientHeight });

  const barBox = () => {
    const s = stage.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return { l: b.left - s.left, t: b.top - s.top, r: b.right - s.left, b: b.bottom - s.top };
  };

  const radiusFor = (w: number, h: number, i: number) =>
    Math.max(w < 600 ? 32 : 40, Math.min(96, Math.min(w, h) * 0.075)) * (0.88 + seeded(i) * 0.24);

  const place = (list: FilterRow[]) => {
    const { w, h } = size();
    const now = performance.now();
    list.forEach((row, i) => {
      // Golden-angle steps mix the sections around the ring, so any search draws
      // balls from all sides of the bar.
      const angle = i * GOLDEN_ANGLE + seeded(i + 3) * 0.3;
      const reach = 0.62 + seeded(i + 7) * 0.3;
      const hx = Math.cos(angle) * reach;
      const hy = Math.sin(angle) * reach;
      const r = radiusFor(w, h, i);
      // Enter from well outside the stage, along the ring spoke.
      bodies.push({
        row,
        x: w / 2 + hx * w * 1.1,
        y: h / 2 + hy * h * 1.1,
        vx: 0,
        vy: 0,
        r,
        hx,
        hy,
        m: orthonormalize(rotate(IDENTITY, 0, 1, seeded(i + 11) * 1.2 - 0.6)),
        hit: 0,
        score: null,
        side: -1,
        seatX: 0,
        seatRow: 0,
        inside: false,
        born: now + i * ENTER_STAGGER_MS,
      });
    });
  };

  const wake = () => {
    // A resting board would read as settled on its first frame, before any
    // force has acted, and sleep again: stay up a moment after every wake.
    awakeUntil = performance.now() + WAKE_GRACE_MS;
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  };

  const spring = (b: Body, tx: number, ty: number, k: number, dt: number) => {
    const c = 2 * Math.sqrt(k) * SPRING_DAMPING;
    b.vx += (k * (tx - b.x) - c * b.vx) * dt;
    b.vy += (k * (ty - b.y) - c * b.vy) * dt;
  };

  const step = (dt: number, now: number) => {
    const { w, h } = size();
    const box = barBox();
    const cx = (box.l + box.r) / 2;
    const cy = (box.t + box.b) / 2;
    const from = bodies.map((b) => [b.x, b.y]);

    for (const b of bodies) {
      if (now < b.born) continue;
      const passing = b.score !== null && b.score >= KEEP_AT;
      if (passing) {
        // Every drawn ball has a seat of its own, so none shoves another for it.
        const tx = cx + b.seatX;
        const ty = cy + b.side * ((box.b - box.t) / 2 + seatPitch * (0.53 + b.seatRow));
        spring(b, tx, ty, PULL_K * b.score!, dt);
      } else if (now < b.born + ENTRANCE_HOME_MS) {
        // Only the entrance is guided. After it, a ball out of the search is free:
        // it keeps whatever motion it has and stays wherever it ends up.
        const hx = Math.max(b.r, Math.min(w - b.r, w / 2 + b.hx * w * 0.42));
        const hy = Math.max(b.r, Math.min(h - b.r, h / 2 + b.hy * h * 0.4));
        spring(b, hx, hy, HOME_K, dt);
      }

      if (pointer.active) {
        const dx = b.x - pointer.x;
        const dy = b.y - pointer.y;
        const dist = Math.hypot(dx, dy) || 1;
        const reach = b.r + MOUSE_REACH;
        if (dist < reach) {
          const f = (1 - dist / reach) ** 2;
          b.vx += ((dx / dist) * MOUSE_PUSH * f + pointer.vx * MOUSE_CARRY * f * 6) * dt;
          b.vy += ((dy / dist) * MOUSE_PUSH * f + pointer.vy * MOUSE_CARRY * f * 6) * dt;
        }
      }

      const drag = Math.exp(-(passing ? DRAG : FREE_DRAG) * dt);
      b.vx *= drag;
      b.vy *= drag;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      const target = passing ? 1 : 0;
      b.hit += (target - b.hit) * (1 - Math.exp(-6 * dt));
    }

    // Ball against ball: separate, then trade momentum along the contact.
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (now < a.born) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (now < b.born) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d;
        const ny = dy / d;
        const ma = a.r * a.r;
        const mb = b.r * b.r;
        const overlap = min - d;
        a.x -= nx * overlap * (mb / (ma + mb));
        a.y -= ny * overlap * (mb / (ma + mb));
        b.x += nx * overlap * (ma / (ma + mb));
        b.y += ny * overlap * (ma / (ma + mb));
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const e = -vn < REST_SPEED ? 0 : RESTITUTION;
          const jn = (-(1 + e) * vn) / (1 / ma + 1 / mb);
          a.vx -= (jn / ma) * nx;
          a.vy -= (jn / ma) * ny;
          b.vx += (jn / mb) * nx;
          b.vy += (jn / mb) * ny;
        }
      }
    }

    for (const b of bodies) {
      if (now < b.born) continue;
      // The bar is solid: balls gather around it, never over the words.
      const l = box.l - b.r;
      const r = box.r + b.r;
      const t = box.t - b.r;
      const bt = box.b + b.r;
      if (b.x > l && b.x < r && b.y > t && b.y < bt) {
        const pushes = [b.x - l, r - b.x, b.y - t, bt - b.y];
        const least = pushes.indexOf(Math.min(...pushes));
        if (least === 0) { b.x = l; b.vx = -bounce(b.vx); }
        if (least === 1) { b.x = r; b.vx = bounce(b.vx); }
        if (least === 2) { b.y = t; b.vy = -bounce(b.vy); }
        if (least === 3) { b.y = bt; b.vy = bounce(b.vy); }
      }
      if (!b.inside) {
        // A spring only approaches a home on the wall, so allow a little slack,
        // and let walls take over once the entrance is long done.
        const slack = 2;
        b.inside =
          now > b.born + WALLS_AFTER_MS ||
          (b.x >= b.r - slack && b.x <= w - b.r + slack && b.y >= b.r - slack && b.y <= h - b.r + slack);
        if (!b.inside) continue;
      }
      if (b.x < b.r) { b.x = b.r; b.vx = bounce(b.vx); }
      if (b.x > w - b.r) { b.x = w - b.r; b.vx = -bounce(b.vx); }
      if (b.y < b.r) { b.y = b.r; b.vy = bounce(b.vy); }
      if (b.y > h - b.r) { b.y = h - b.r; b.vy = -bounce(b.vy); }
    }

    // Roll by the distance each ball actually travelled this step, after
    // contacts. Velocity lies for a ball pressed into a neighbour: it keeps
    // pushing but goes nowhere, and would spin in place.
    bodies.forEach((b, i) => {
      if (now < b.born) return;
      const dx = b.x - from[i][0];
      const dy = b.y - from[i][1];
      const moved = Math.hypot(dx, dy);
      if (moved > 1e-3) b.m = orthonormalize(rotate(b.m, -dy / moved, dx / moved, moved / b.r));
    });
  };

  const draw = (now: number) => {
    const dpr = getCanvasDensity();
    bodies.forEach((b, i) => (b.el = els[i] ?? b.el));
    for (const b of bodies) {
      if (!b.el) continue;
      b.el.style.transform = `translate3d(${b.x - b.r}px, ${b.y - b.r}px, 0)`;
      b.el.style.width = b.el.style.height = `${b.r * 2}px`;
      const enter = Math.min(1, Math.max(0, (now - b.born) / ENTER_MS));
      const m = b.m;
      b.item?.setUni({
        value1: enter,
        value2: b.hit,
        value3: b.r * dpr,
        // Not value5–8: shooosh writes the texture fit there every frame.
        value9: m[0], value10: m[1], value11: m[2],
        value13: m[3], value14: m[4], value15: m[5],
      });
    }
    getDefaultEngine()?.requestFrame();
  };

  const tick = (now: number) => {
    // rAF's timestamp can trail the wake, so the first step is a nominal frame.
    const dt = last ? Math.max(0, Math.min((now - last) / 1000, 1 / 30)) : 1 / 60;
    last = now;
    const sub = 2;
    for (let i = 0; i < sub; i++) step(dt / sub, now);
    pointer.vx *= 0.85;
    pointer.vy *= 0.85;
    draw(now);

    const moving =
      performance.now() < awakeUntil ||
      bodies.some(
        (b) =>
          now < b.born + ENTER_MS ||
          now < b.born + ENTRANCE_HOME_MS ||
          Math.hypot(b.vx, b.vy) > SLEEP_SPEED,
      ) ||
      now - pointer.t < 400;
    raf = moving ? requestAnimationFrame(tick) : 0;
  };

  const onPointerMove = (event: PointerEvent) => {
    const s = stage.getBoundingClientRect();
    const x = event.clientX - s.left;
    const y = event.clientY - s.top;
    const now = performance.now();
    const dt = Math.max((now - pointer.t) / 1000, 1 / 240);
    if (pointer.active && dt < 0.1) {
      pointer.vx = pointer.vx * 0.5 + ((x - pointer.x) / dt) * 0.5;
      pointer.vy = pointer.vy * 0.5 + ((y - pointer.y) / dt) * 0.5;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.t = now;
    pointer.active = true;
    wake();
  };

  const onPointerLeave = () => {
    pointer.active = false;
    pointer.x = pointer.y = -1e4;
  };

  /**
   * Seats drawn balls in rows along the bar, on the side each already is (the
   * bar is solid), left to right in their current order so no two cross.
   */
  const seat = (drawnIn: Body[]) => {
    const box = barBox();
    const cy = (box.t + box.b) / 2;
    seatPitch = 2.08 * Math.max(0, ...drawnIn.map((b) => b.r));
    const perRow = Math.max(1, Math.floor(((box.r - box.l) * 1.1) / seatPitch));
    for (const side of [-1, 1]) {
      const group = drawnIn
        .filter((b) => (b.y < cy ? -1 : 1) === side)
        .sort((a, b) => a.x - b.x);
      group.forEach((b, k) => {
        const row = Math.floor(k / perRow);
        const inRow = Math.min(perRow, group.length - row * perRow);
        b.side = side;
        b.seatRow = row;
        b.seatX = (k % perRow - (inRow - 1) / 2) * seatPitch;
      });
    }
    return drawnIn.length;
  };

  const release = () => {
    for (const b of bodies) b.score = null;
    setDrawn(null);
    wake();
  };

  const search = async (text: string) => {
    const rule = text.replace(/\s+/g, " ").trim();
    const current = ++generation;
    setQuiet(null);
    if (rule.length < 3) {
      setPending(false);
      release();
      return;
    }
    setPending(true);
    const result = await judgeFilterRule(rule);
    if (current !== generation) return;
    setPending(false);
    if (!result) {
      // Silence: nothing is pulled in by a weak match.
      setQuiet(rule);
      release();
      return;
    }
    for (const b of bodies) b.score = result.scores[b.row.slug] ?? 0;
    setDrawn(seat(bodies.filter((b) => b.score! >= KEEP_AT)));
    wake();
  };

  const onInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    setQuery(event.currentTarget.value);
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void search(query()), SEARCH_DEBOUNCE_MS);
  };

  const onSubmit = (event: Event) => {
    event.preventDefault();
    window.clearTimeout(debounce);
    void search(query());
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    input.value = "";
    setQuery("");
    window.clearTimeout(debounce);
    void search("");
  };

  const status = () => {
    if (pending()) return "Judging";
    const miss = quiet();
    if (miss) return `Nothing here is “${miss}”`;
    const n = drawn();
    if (n !== null) return `${n} of ${bodies.length} drawn in`;
    return `${rows()?.length ?? 0} chapters. Type what you want; push them around.`;
  };

  // Rows land after hydration on a client navigation; place once, then mount quads.
  createEffect(() => {
    const list = rows();
    if (!list || bodies.length) return;
    place(list);
    wake();
  });

  // Keyed on content: the rows resolve again on hydration as a new array with
  // the same chapters, and remounting then would strand a second quad per ball.
  const rowsKey = createMemo(() => rows()?.map((row) => `${row.slug}:${row.title}`).join("|"));
  const quads = new Set<ItemController>();

  createEffect(() => {
    if (!webgl.loaded || !rowsKey()) return;
    const shaders = ballShaders();
    let disposed = false;
    void document.fonts.load("700 64px alte-haas").finally(() => {
      bodies.forEach((b, i) => {
        void titleTexture(b.row.title).then((texture) => {
          const el = els[i];
          if (disposed || !el) return;
          if (b.item) {
            quads.delete(b.item);
            b.item.destroy();
          }
          b.el = el;
          b.item = createItem(el, { shaders, texture, uni: { value1: 0 } });
          quads.add(b.item);
          wake();
        });
      });
    });
    onCleanup(() => {
      disposed = true;
      for (const quad of quads) quad.destroy();
      quads.clear();
      for (const b of bodies) b.item = undefined;
    });
  });

  onMount(() => {
    if (reducedMotion()) {
      for (const b of bodies) b.born = 0;
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    const readFieldPx = () => setFieldPx(parseFloat(getComputedStyle(input).fontSize) || 40);
    readFieldPx();
    const resize = new ResizeObserver(() => {
      readFieldPx();
      const { w, h } = size();
      bodies.forEach((b, i) => (b.r = radiusFor(w, h, i)));
      seat(bodies.filter((b) => b.score !== null && b.score >= KEEP_AT));
      wake();
    });
    resize.observe(stage);
    onCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      resize.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(debounce);
    });
  });

  return (
    <div ref={stage} class="flt-stage" data-own-intro>
      {/* Index keeps each circle's element when the rows resolve again. */}
      <Index each={rows() ?? []}>
        {(row, i) => (
          <a
            ref={(el) => (els[i] = el)}
            class="flt-ball"
            href={row().href}
            aria-label={row().title}
          >
            <span class="sr-only">{row().title}</span>
          </a>
        )}
      </Index>
      <form ref={bar} class="flt-bar" onSubmit={onSubmit} role="search">
        {/* The input only types and holds the caret's place; WebGL paints all of it. */}
        <div class="flt-bar-field">
          <input
            ref={input}
            class="flt-bar-input"
            type="search"
            name="q"
            autocomplete="off"
            maxlength={120}
            placeholder={PLACEHOLDER}
            aria-label="Find chapters"
            onInput={(event) => {
              onInput(event);
              syncCaret();
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onPointerUp={syncCaret}
            onSelect={syncCaret}
            onFocus={() => {
              setFocused(true);
              syncCaret();
            }}
            onBlur={() => setFocused(false)}
          />
          <GlTextLine
            text={query()}
            fontPx={fieldPx()}
            trackingEm={-0.09}
            caret={focused() ? caret() : null}
          />
          <Show when={!query()}>
            <GlTextLine text={PLACEHOLDER} fontPx={fieldPx()} trackingEm={-0.09} alpha={0.28} />
          </Show>
          <GlFill class="flt-bar-line" layer={10} />
        </div>
        <p class="flt-bar-status" aria-live="polite">
          <span class="flt-bar-status-dom">{status()}</span>
          <GlTextLine text={status().toUpperCase()} fontPx={9} trackingEm={0.32} />
        </p>
      </form>
    </div>
  );
}
