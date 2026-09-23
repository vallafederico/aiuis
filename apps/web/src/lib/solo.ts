import { createSignal } from "solid-js";
import { getDefaultEngine } from "shooosh";
import {
  PAGE_ENTRY_MS,
  cutMosaic,
  playMosaic,
  setMosaicFullFrame,
} from "~/components/webgl/mosaic-clock";
import { uis } from "~/uis/registry";

const [solo, setSolo] = createSignal(false);
/** 0 = expand corners, 1 = compress corners. Tweens with the solo mosaic. */
const [iconMorph, setIconMorph] = createSignal(0);
let busy = false;
let morphFrame = 0;

export { solo, iconMorph };

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

/** Drop focus mode without playing. Used when a page leave already owns the mosaic. */
export function resetSolo() {
  busy = false;
  if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(morphFrame);
  setMosaicFullFrame(false);
  applySoloClass(false);
  setSolo(false);
  setIconMorph(0);
}

export async function toggleSolo() {
  if (busy) return;
  if (solo()) await exitSolo();
  else await enterSolo();
}

async function enterSolo() {
  if (solo() || busy) return;
  busy = true;
  setMosaicFullFrame(true);
  tweenIconMorph(1, PAGE_ENTRY_MS);
  try {
    await playMosaic(0, PAGE_ENTRY_MS);
    applySoloClass(true);
    setSolo(true);
    cutMosaic(1);
  } finally {
    setMosaicFullFrame(false);
    busy = false;
  }
}

async function exitSolo() {
  if (!solo() || busy) return;
  busy = true;
  setMosaicFullFrame(true);
  try {
    cutMosaic(0);
    applySoloClass(false);
    setSolo(false);
    tweenIconMorph(0, PAGE_ENTRY_MS);
    await playMosaic(1, PAGE_ENTRY_MS);
  } finally {
    setMosaicFullFrame(false);
    busy = false;
  }
}
