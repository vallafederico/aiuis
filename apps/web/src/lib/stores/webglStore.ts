import { createStore } from "solid-js/store";
import type { Scene } from "shooosh";

const [webgl, setWebgl] = createStore({
  loaded: false,
});

// scene handle lives here (not exported from Canvas.tsx) so Canvas stays a
// component-only module — that keeps it a solid-refresh HMR boundary and
// engine edits hot-swap instead of full-reloading the page
let scene: Scene | null = null;

/** Current scene — null until <Canvas /> has mounted (client only). */
export const getScene = () => scene;
export const setScene = (next: Scene | null) => {
  scene = next;
};

/** Backing-store pixels per CSS pixel — MSDF/SDF coverage is in this space. */
export function getCanvasDensity() {
  const canvas = scene?.getEngine()?.canvas;
  if (!canvas) {
    return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  }
  const css = canvas.clientWidth;
  return css > 0 ? canvas.width / css : window.devicePixelRatio || 1;
}

export { webgl, setWebgl };
