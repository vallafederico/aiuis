import { createSignal } from "solid-js";

// Keep this module free of ~/uis/registry: the WebGL canvas imports it, and a
// registry edge would make every component edit reload the page and the scene.

const [componentView, setComponentView] = createSignal(false);

export { componentView };

export function isComponentView(path: string) {
  const n = path.replace(/\/+$/, "") || "/";
  return /^\/uis\/[^/]+\/component$/.test(n);
}

function applyComponentViewClass(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("ui-component", on);
}

export function syncComponentView(path: string) {
  const on = isComponentView(path);
  applyComponentViewClass(on);
  setComponentView(on);
}
