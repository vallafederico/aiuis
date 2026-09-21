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
  bot: lazy(() => import("./Bot")),
  "look-at": lazy(() => import("./LookAt")),
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
