import { lazy, type Component } from "solid-js";
import { clientOnly } from "@solidjs/start";
import type { UiProps } from "./types";

/**
 * CMS `component` (or, on /uis, the piece slug) → frontend implementation.
 * Add a module here; the document only stores the name.
 */
export const uis: Record<string, Component<UiProps>> = {
  faqs: lazy(() => import("./Faqs")),
  "infinite-article": lazy(() => import("./InfiniteArticle")),
  navigation: lazy(() => import("./Navigation")),
  images: lazy(() => import("./Images")),
  find: lazy(() => import("./Find")),
  "generative-moodboard": lazy(() => import("./GenerativeMoodboard")),
  "image-generation": lazy(() => import("./ImageGeneration")),
  "sketch-generation": lazy(() => import("./SketchGeneration")),
  filters: lazy(() => import("./Filters")),
  "type-an-analytic": lazy(() => import("./TypeAnAnalytic")),
};

export function resolveUiName(
  component: unknown,
  slug: string,
  section: string,
): string | null {
  if (typeof component === "string" && component.trim()) return component.trim();
  return section === "uis" ? slug : null;
}

export function resolveUi(name: string | null): Component<UiProps> | undefined {
  if (!name) return undefined;
  return uis[name];
}

/** Art-directed pages for `/uis/:slug`. Schematics stay on the `uis` map. */
export const directedUis: Record<string, Component<UiProps>> = {
  faqs: lazy(() => import("./directed/Faqs")),
  filters: lazy(() => import("./directed/Filters")),
  "infinite-article": lazy(() => import("./directed/InfiniteArticle")),
  // Client-only: its SSR render never resolves after the first request in dev.
  "generative-moodboard": clientOnly(() => import("./directed/GenerativeMoodboard")),
  "type-an-analytic": lazy(() => import("./directed/TypeAnAnalytic")),
  // Client-only: draws into the site engine's WebGL context from the first frame.
  "sketch-generation": clientOnly(() => import("./directed/SketchGeneration")),
};

export function resolveDirectedUi(name: string | null): Component<UiProps> | undefined {
  if (!name) return undefined;
  return directedUis[name];
}
