import { createSignal } from "solid-js";
import { getDefaultEngine } from "shooosh";
import {
  PAGE_ENTRY_MS,
  cutMosaic,
  mosaicProgress,
  playMosaic,
  requestMosaicSnapshot,
  setMosaicChromeOnly,
  setMosaicFullFrame,
} from "~/components/webgl/mosaic-clock";
import { uis } from "~/uis/registry";

const [solo, setSolo] = createSignal(false);
/** 0 = expand corners, 1 = compress corners. Tweens with the solo mosaic. */
const [iconMorph, setIconMorph] = createSignal(0);
let busy = false;
/** Latest requested state; a toggle during a transition runs once it ends. */
let wanted = false;
let morphFrame = 0;

export { solo, iconMorph };

export const SOLO_PARAM = "solo";

export function hasSoloQuery(search: string) {
  const q = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(q).has(SOLO_PARAM);
}

/** `/uis/faqs` → `/uis/faqs?solo`. Strips a previous flag when `on` is false. */
export function withSoloPath(pathname: string, search = "", on = true) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete(SOLO_PARAM);
  const rest = params.toString();
  if (!on) return rest ? `${pathname}?${rest}` : pathname;
  return rest ? `${pathname}?${rest}&${SOLO_PARAM}` : `${pathname}?${SOLO_PARAM}`;
}

export function isComponentPath(path: string) {
  const match = path.match(/^\/uis\/([^/]+)(?:\/schematics)?\/?$/);
  return !!match && !!uis[match[1]!];
}

function applySoloClass(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("ui-solo", on);
}

function tweenIconMorph(to: number, duration: number) {
  if (typeof requestAnimationFrame === "undefined") {
    setIconMorph(to);
    return;
  }
  cancelAnimationFrame(morphFrame);
  const from = iconMorph();
  const origin = performance.now();
  const step = (now: number) => {
    const t = duration <= 0 ? 1 : Math.min(1, (now - origin) / duration);
    setIconMorph(from + (to - from) * t);
    getDefaultEngine()?.requestFrame();
    if (t < 1) morphFrame = requestAnimationFrame(step);
  };
  morphFrame = requestAnimationFrame(step);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Drop focus mode without playing. Used when a page leave already owns the mosaic. */
export function resetSolo() {
  busy = false;
  wanted = false;
  if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(morphFrame);
  setMosaicFullFrame(false);
  setMosaicChromeOnly(false);
  applySoloClass(false);
  setSolo(false);
  setIconMorph(0);
}

/** Deep-link / first paint: chrome off, no mosaic. */
export function enterSoloInstant() {
  busy = false;
  wanted = true;
  if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(morphFrame);
  setMosaicFullFrame(false);
  setMosaicChromeOnly(false);
  applySoloClass(true);
  setSolo(true);
  setIconMorph(1);
}

export async function toggleSolo() {
  if (busy) return;
  if (solo()) await exitSolo();
  else await enterSolo();
}

/**
 * Same-page hide: chrome scatters, then gathers into the empty frame. Parked
 * tiles keep showing the pre-swap snapshot, so the full UI and the empty
 * frame mix tile by tile instead of switching at one frame.
 */
export async function enterSolo() {
  wanted = true;
  if (solo() || busy) return;
  busy = true;
  tweenIconMorph(1, PAGE_ENTRY_MS * 2);
  try {
    if (mosaicProgress() < 0.05) cutMosaic(1);
    setMosaicChromeOnly(true);
    const mix = await requestMosaicSnapshot();
    setMosaicChromeOnly(true, mix);
    void playMosaic(0, PAGE_ENTRY_MS);
    await wait(PAGE_ENTRY_MS);
    applySoloClass(true);
    setSolo(true);
    void playMosaic(1, PAGE_ENTRY_MS);
    await wait(PAGE_ENTRY_MS);
  } finally {
    setMosaicChromeOnly(false);
    busy = false;
  }
  if (!wanted) await exitSolo();
}

/** Same-page show: the snapshot of the empty frame gives way, tile by tile, to the full UI. */
export async function exitSolo() {
  wanted = false;
  if (!solo() || busy) return;
  busy = true;
  try {
    setMosaicChromeOnly(true);
    const mix = await requestMosaicSnapshot();
    setMosaicChromeOnly(true, mix);
    cutMosaic(0);
    applySoloClass(false);
    setSolo(false);
    tweenIconMorph(0, PAGE_ENTRY_MS * 2);
    void playMosaic(1, PAGE_ENTRY_MS * 2);
    await wait(PAGE_ENTRY_MS * 2);
  } finally {
    setMosaicChromeOnly(false);
    busy = false;
  }
  if (wanted) await enterSolo();
}
