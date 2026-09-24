/**
 * Sketch Generation state machine, shared by the schematic pad and the
 * directed page: ink thresholds, the idle auto-trigger, request ids, abort on
 * redraw, and the ai-viz activity hooks. The views own layout and GL setup.
 */
import { createSignal, onCleanup } from "solid-js";
import {
  SKETCH_BRIEF_CHIPS,
  generateFromSketch,
  type SketchBriefId,
  type SketchGenerationResult,
} from "~/lib/sketch-generation";
import {
  pulseAiVizResponse,
  resetAiVizActivity,
  setAiVizActivity,
} from "~/lib/ai-viz-activity";
import type { SketchGl } from "./sketch-generation-gl";

/** Stroke length, in pad short sides, before the first render. */
const FIRST_INK = 3.2;
/** New ink needed to render again once a result exists. */
const REVISE_INK = 1.2;
const MIN_STROKES = 2;
const IDLE_MS = 1500;
/** Floor on the waiting bleed so an instant answer still reads as a render. */
const MIN_WAIT_MS = 1200;

export type SketchPhase = "empty" | "sketching" | "armed" | "generating" | "developing";

export type SketchShown = {
  prompt: string;
  label: string;
  source: string;
  fallback: boolean;
};

const LOOK: Record<SketchBriefId, number> = {
  "still-life": 0,
  portrait: 1,
  interior: 2,
};

export function sketchChipLabel(id: SketchBriefId) {
  return SKETCH_BRIEF_CHIPS.find((chip) => chip.id === id)?.label ?? id;
}

export function createSketchSession(options: {
  gl: () => SketchGl | null;
  /** The drawing element: pointer capture target and coordinate origin. */
  surface: () => HTMLElement;
}) {
  const [phase, setPhase] = createSignal<SketchPhase>("empty");
  const [progress, setProgress] = createSignal(0);
  const [briefId, setBriefId] = createSignal<SketchBriefId>("still-life");
  const [pendingBrief, setPendingBrief] = createSignal<SketchBriefId | null>(null);
  const [shown, setShown] = createSignal<SketchShown | null>(null);
  const [hasInk, setHasInk] = createSignal(false);

  let inkSince = 0;
  let inkAtGeneration = 0;
  let strokes = 0;
  let revising = false;
  let pointerId: number | null = null;
  let surfaceRect: DOMRect | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  const target = () => (revising ? REVISE_INK : FIRST_INK);
  const ready = () => inkSince >= target() && (revising || strokes >= MIN_STROKES);
  const busy = () => phase() === "generating" || phase() === "developing";
  const syncProgress = () => setProgress(Math.min(1, inkSince / target()));

  const settle = () => {
    if (busy()) return;
    if (ready()) {
      setPhase("armed");
      setAiVizActivity("awaiting");
      idleTimer = setTimeout(() => void generate(), IDLE_MS);
    } else {
      setPhase(hasInk() ? "sketching" : "empty");
      setAiVizActivity("idle");
    }
  };

  const abortGeneration = () => {
    if (phase() !== "generating") return;
    requestId++;
    options.gl()?.cancelGeneration();
    inkSince += inkAtGeneration;
    setPendingBrief(null);
    syncProgress();
    setPhase(hasInk() ? "sketching" : "empty");
  };

  const finish = (id: number, shownNext: SketchShown) => {
    if (id !== requestId) return;
    setShown(shownNext);
    setPendingBrief(null);
    pulseAiVizResponse();
    if (phase() === "developing") {
      setPhase(hasInk() ? "sketching" : "empty");
      if (ready()) settle();
    }
  };

  async function generate() {
    clearTimeout(idleTimer);
    const gl = options.gl();
    if (!gl || !hasInk() || busy()) return;
    const brief = briefId();
    const id = ++requestId;
    const snap = gl.beginGeneration(LOOK[brief]);
    if (!snap) return;

    inkAtGeneration = inkSince;
    inkSince = 0;
    syncProgress();
    setPendingBrief(brief);
    setPhase("generating");
    setAiVizActivity("thinking");
    const started = performance.now();

    let res: SketchGenerationResult | null = null;
    try {
      res = await generateFromSketch({
        sketchImage: snap.lines,
        underImage: snap.under,
        briefId: brief,
        width: snap.width,
        height: snap.height,
      });
    } catch {
      res = null;
    }
    const left = MIN_WAIT_MS - (performance.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    const live = options.gl();
    if (id !== requestId || !live) return;

    revising = true;
    syncProgress();
    setPhase("developing");
    setAiVizActivity("acting");

    const label = sketchChipLabel(brief);
    const prompt = res?.prompt ?? "The brief did not come back from the server.";
    const procedural = (reason: string) => {
      options.gl()?.revealProcedural(() =>
        finish(id, {
          prompt,
          label,
          source: `procedural · ${reason}`,
          fallback: true,
        }),
      );
    };

    if (res?.kind === "image") {
      const model = res.model;
      const ok = await live.revealImage(res.image, () =>
        finish(id, { prompt, label, source: model, fallback: false }),
      );
      if (!ok && id === requestId) procedural("image did not decode");
    } else if (res?.kind === "fallback") {
      const reasons = {
        unavailable: "Workers AI unavailable",
        quota: "Workers AI daily quota spent",
        failed: "generation failed",
      };
      procedural(reasons[res.reason]);
    } else {
      procedural("request failed");
    }
  }

  const localPoint = (e: PointerEvent) => {
    const r = surfaceRect ?? options.surface().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pressureOf = (e: PointerEvent) =>
    e.pointerType === "pen" ? e.pressure : null;

  const onPointerDown = (e: PointerEvent) => {
    const gl = options.gl();
    if (!gl || e.button > 0) return;
    e.preventDefault();
    const surface = options.surface();
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
    pointerId = e.pointerId;
    surfaceRect = surface.getBoundingClientRect();
    clearTimeout(idleTimer);
    abortGeneration();
    const p = localPoint(e);
    gl.beginStroke(p.x, p.y, e.timeStamp, pressureOf(e));
    setHasInk(true);
    if (!busy()) setPhase("sketching");
    setAiVizActivity("listening");
  };

  const onPointerMove = (e: PointerEvent) => {
    const gl = options.gl();
    if (!gl || e.pointerId !== pointerId) return;
    const events = e.getCoalescedEvents?.() ?? [];
    const unit = Math.max(1, Math.min(surfaceRect?.width ?? 1, surfaceRect?.height ?? 1));
    let added = 0;
    for (const ev of events.length > 0 ? events : [e]) {
      const p = localPoint(ev);
      added += gl.extendStroke(p.x, p.y, ev.timeStamp, pressureOf(ev));
    }
    if (added > 0) {
      inkSince += added / unit;
      syncProgress();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const gl = options.gl();
    if (!gl || e.pointerId !== pointerId) return;
    gl.endStroke();
    pointerId = null;
    strokes++;
    const surface = options.surface();
    if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    settle();
  };

  const clear = () => {
    clearTimeout(idleTimer);
    abortGeneration();
    inkSince = 0;
    inkAtGeneration = 0;
    strokes = 0;
    revising = false;
    setHasInk(false);
    syncProgress();
    // Drop whatever is developing too; its completion must not land.
    requestId++;
    options.gl()?.clearAll();
    setPendingBrief(null);
    setShown(null);
    setPhase("empty");
    setAiVizActivity("idle");
  };

  const pickBrief = (id: SketchBriefId) => {
    const changed = id !== briefId();
    setBriefId(id);
    if (!changed || phase() === "developing" || !hasInk()) return;
    if (phase() === "generating" || revising || ready()) {
      abortGeneration();
      void generate();
    }
  };

  const pickRandomBrief = () =>
    setBriefId(
      SKETCH_BRIEF_CHIPS[Math.floor(Math.random() * SKETCH_BRIEF_CHIPS.length)].id,
    );

  onCleanup(() => {
    clearTimeout(idleTimer);
    requestId++;
    resetAiVizActivity();
  });

  return {
    phase,
    progress,
    briefId,
    pendingBrief,
    shown,
    hasInk,
    busy,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    clear,
    pickBrief,
    pickRandomBrief,
  };
}
