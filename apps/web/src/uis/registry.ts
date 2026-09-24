import { lazy, type Component } from "solid-js";
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
  "generative-moodboard": lazy(() => import("./directed/GenerativeMoodboard")),
};

export function resolveDirectedUi(name: string | null): Component<UiProps> | undefined {
  if (!name) return undefined;
  return directedUis[name];
}
