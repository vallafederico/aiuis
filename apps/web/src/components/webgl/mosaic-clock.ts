import { getDefaultEngine } from "shooosh";

/** Linear 0→1 (in) / 1→0 (out) clock for the mosaic post pass. */

export const MOSAIC_MS = 700;
/** Page-to-page is one play, nothing → chaos → page, at twice the mosaic speed. */
export const PAGE_ENTRY_MS = MOSAIC_MS / 2;
export const CRUMB_MOSAIC_MS = 300;
/** Start the crumb mosaic once the page-in play is this far through. */
const CRUMB_START_AT = 0.8;
/**
 * Release the leave gate once the clock has fallen this low. At this point
 * nearly every mosaic cell is fully displaced, so the DOM swap lands under
 * full scramble and the content flip is unrecognizable.
 */
const LEAVE_RELEASE_AT = 0.08;
/**
 * Content opacity keeps this floor through most of the transition, so the
 * scrambled cells stay visible and leave/entry read as one continuous
 * scatter-then-gather instead of two plays around a blank beat.
 */
const CONTENT_FLOOR = 0.35;
/**
 * Exception: a brief dip around the DOM swap. Below SWAP_DIP_START the
 * opacity eases toward zero, reaching it near SWAP_DIP_END — just under the
 * gate release point — so the frames on either side of the swap are nearly
 * identical and the content flip cannot be seen. The dip lasts only a few
 * frames each way, too short to read as a beat.
 */
const SWAP_DIP_START = 0.16;
const SWAP_DIP_END = 0.03;

type Play = {
  from: number;
  to: number;
  origin: number;
  duration: number;
  resolvers: Array<() => void>;
};

let progress = 0;
let current: Play | null = null;
let crumb = 0;
let crumbPlay: Play | null = null;
let sink: ((page: number, crumbs: number) => void) | undefined;
const pageInListeners = new Set<() => void>();
let pageInArmed = false;
let pageEntry = false;
let pageLeave = false;
let leaveGate: Array<() => void> | null = null;
let fullFrame = false;
let snapshotMode = false;

function emit() {
  sink?.(progress, crumb);
  getDefaultEngine()?.requestFrame();
}

export function mosaicProgress() {
  return progress;
}

export function crumbProgress() {
  return crumb;
}

/** When true the post mosaics the whole frame, including nav chrome. */
export function mosaicFullFrame() {
  return fullFrame;
}

export function setMosaicFullFrame(on: boolean) {
  fullFrame = on;
  emit();
}

/**
 * When the post pass holds a snapshot of the outgoing page, parked mosaic
 * cells keep showing old-page tiles through the swap, so the DOM never needs
 * to fade: content stays at full opacity and the shader does all the mixing.
 * Off (e.g. WebGPU, no snapshot support) falls back to the opacity dip.
 */
export function setMosaicSnapshotMode(on: boolean) {
  snapshotMode = on;
}

export function setMosaicSink(
  fn: ((page: number, crumbs: number) => void) | undefined,
) {
  sink = fn;
}

export function onPageMosaicIn(fn: () => void) {
  pageInListeners.add(fn);
  return () => pageInListeners.delete(fn);
}

function startPlay(
  play: Play | null,
  progressNow: number,
  to: 0 | 1,
  duration: number,
): { play: Play; promise: Promise<void> } {
  if (play?.to === to) {
    return {
      play,
      promise: new Promise((resolve) => play.resolvers.push(resolve)),
    };
  }
  if (play) {
    const stale = play.resolvers;
    for (const resolve of stale) resolve();
  }
  const next: Play = {
    from: progressNow,
    to,
    origin: performance.now(),
    duration,
    resolvers: [],
  };
  const promise = new Promise<void>((resolve) => {
    next.resolvers.push(resolve);
  });
  return { play: next, promise };
}

function paintPageOpacity() {
  if ((!pageLeave && !pageEntry) || typeof document === "undefined") return;
  const el = document.querySelector("[data-router-branch]");
  if (!(el instanceof HTMLElement)) return;
  if (snapshotMode) {
    el.style.opacity = "1";
    return;
  }
  const p = Math.max(0, progress);
  const base = CONTENT_FLOOR + (1 - CONTENT_FLOOR) * p;
  const t = Math.min(
    1,
    Math.max(0, (p - SWAP_DIP_END) / (SWAP_DIP_START - SWAP_DIP_END)),
  );
  const dip = t * t * (3 - 2 * t);
  el.style.opacity = progress >= 0.999 ? "1" : (base * dip).toFixed(3);
}

function releaseLeaveGate() {
  if (!leaveGate) return;
  const gates = leaveGate;
  leaveGate = null;
  for (const resolve of gates) resolve();
}

/** Play the page out. Resolves once the exit is underway, while the play keeps going. */
export function beginPageLeave(): Promise<void> {
  if (current?.to === 0 && leaveGate) {
    return new Promise((resolve) => leaveGate!.push(resolve));
  }
  pageEntry = false;
  pageLeave = true;
  interruptCrumb(1);
  pageInArmed = false;
  if (Math.abs(progress) < 0.001 && !current) {
    progress = 0;
    paintPageOpacity();
    emit();
    return Promise.resolve();
  }
  if (current) {
    const stale = current.resolvers;
    current = null;
    for (const resolve of stale) resolve();
  }
  const next = startPlay(null, progress, 0, PAGE_ENTRY_MS);
  current = next.play;
  const promise = new Promise<void>((resolve) => {
    leaveGate = [resolve];
  });
  emit();
  return promise;
}

/** Drop the clock to a settled value without playing. Used so leave does not finish before entry. */
export function cutMosaic(to: 0 | 1) {
  if (to === 0) {
    interruptCrumb(1);
    pageInArmed = false;
    pageEntry = false;
  }
  progress = to;
  if (!current) {
    emit();
    return;
  }
  const stale = current.resolvers;
  current = null;
  emit();
  for (const resolve of stale) resolve();
}

/**
 * One page-entry play: starts at nothing even if the clock was settled on the
 * previous page, then runs through to the new page.
 */
export function beginPageEntry(): Promise<void> {
  if (current?.to === 1) {
    return new Promise((resolve) => current!.resolvers.push(resolve));
  }
  if (current) {
    const stale = current.resolvers;
    current = null;
    for (const resolve of stale) resolve();
  }
  releaseLeaveGate();
  pageLeave = false;
  pageInArmed = true;
  pageEntry = true;
  paintPageOpacity();
  const next = startPlay(null, progress, 1, PAGE_ENTRY_MS);
  current = next.play;
  emit();
  return next.promise;
}

export function playMosaic(to: 0 | 1, duration = MOSAIC_MS): Promise<void> {
  if (to === 0) {
    interruptCrumb(1);
    pageInArmed = false;
  }
  if (Math.abs(progress - to) < 0.001 && !current) {
    progress = to;
    emit();
    return Promise.resolve();
  }
  const joining = current?.to === to;
  const next = startPlay(current, progress, to, duration);
  current = next.play;
  if (to === 1 && !joining) pageInArmed = true;
  emit();
  return next.promise;
}

export function playCrumbMosaic(to: 0 | 1): Promise<void> {
  if (Math.abs(crumb - to) < 0.001 && !crumbPlay) {
    crumb = to;
    emit();
    return Promise.resolve();
  }
  const next = startPlay(crumbPlay, crumb, to, CRUMB_MOSAIC_MS);
  crumbPlay = next.play;
  emit();
  return next.promise;
}

function interruptCrumb(to: 0 | 1) {
  crumb = to;
  if (!crumbPlay) {
    emit();
    return;
  }
  const stale = crumbPlay.resolvers;
  crumbPlay = null;
  emit();
  for (const resolve of stale) resolve();
}

function notifyPageIn() {
  for (const fn of pageInListeners) fn();
}

function advance(play: Play, now: number): { progress: number; t: number; done: boolean } {
  const t = Math.max(0, Math.min(1, (now - play.origin) / play.duration));
  return {
    t,
    progress: play.from + (play.to - play.from) * t,
    done: t >= 1,
  };
}

/** Advance both clocks. Returns true while either play is in flight. */
export function tickMosaic(now: number): boolean {
  let running = false;

  if (current) {
    running = true;
    const step = advance(current, now);
    progress = step.progress;
    sink?.(progress, crumb);
    paintPageOpacity();
    if (current.to === 0 && progress <= LEAVE_RELEASE_AT) releaseLeaveGate();
    if (current.to === 1 && pageInArmed && step.t >= CRUMB_START_AT) {
      pageInArmed = false;
      notifyPageIn();
    }
    if (step.done) {
      progress = current.to;
      if (current.to === 1) pageEntry = false;
      if (current.to === 0) releaseLeaveGate();
      const { resolvers } = current;
      current = null;
      sink?.(progress, crumb);
      if (progress >= 1) {
        const el = document.querySelector("[data-router-branch]");
        if (el instanceof HTMLElement) el.style.opacity = "1";
      }
      for (const resolve of resolvers) resolve();
    }
  }

  if (crumbPlay) {
    running = true;
    const step = advance(crumbPlay, now);
    crumb = step.progress;
    sink?.(progress, crumb);
    if (step.done) {
      crumb = crumbPlay.to;
      const { resolvers } = crumbPlay;
      crumbPlay = null;
      sink?.(progress, crumb);
      for (const resolve of resolvers) resolve();
    }
  }

  return running;
}
