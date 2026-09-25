import { createSignal } from "solid-js";

// Keep this module free of ~/uis/registry: the WebGL canvas imports it, and a
// registry edge would make every component edit reload the page and the scene.

const [componentView, setComponentView] = createSignal(false);
/** Pointer lens strength on the open component view, as a share of the site's (0 = off). */
const [componentLens, setComponentLens] = createSignal(0);

/** Component views that keep the pointer lens, and how strong; the rest switch it off. */
const LENS_COMPONENTS: Record<string, number> = { "generative-moodboard": 0.5 };

export { componentView, componentLens };

export function isComponentView(path: string) {
  const n = path.replace(/\/+$/, "") || "/";
  return /^\/uis\/[^/]+\/component$/.test(n);
}

function componentSlug(path: string): string | null {
  const n = path.replace(/\/+$/, "") || "/";
  return n.match(/^\/uis\/([^/]+)\/component$/)?.[1] ?? null;
}

function applyComponentViewClass(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("ui-component", on);
}

export function syncComponentView(path: string) {
  const on = isComponentView(path);
  applyComponentViewClass(on);
  setComponentView(on);
  const slug = componentSlug(path);
  setComponentLens(slug ? (LENS_COMPONENTS[slug] ?? 0) : 0);
}
