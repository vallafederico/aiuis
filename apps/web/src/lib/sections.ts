import { query } from "@solidjs/router";
import type { SeoPiece } from "~/lib/llm-seo";
import { SECTION_LABEL, SECTION_ORDER, piecePath } from "~/lib/piece-sections";

export type NavItem = { title: string; href: string; updated?: string | null };

export type NavSection = {
  title: string;
  href: string;
  items: NavItem[];
};

/** Group published pieces into the preface, foundations, and UI sections. */
export function sectionsFromPieces(pieces: SeoPiece[]): NavSection[] {
  return SECTION_ORDER.map((section) => ({
    title: SECTION_LABEL[section],
    href: `/${section}`,
    items: pieces
      .filter((piece) => piece.section === section)
      .map((piece) => ({
        title: piece.title,
        href: piecePath(piece.section, piece.slug),
        updated: piece.updated,
      })),
  })).filter((section) => section.items.length > 0);
}

/** Published chapters, in nav order. The sidebar, counts, and section indexes read this. */
export const getNavCatalog = query(async (): Promise<NavSection[]> => {
  "use server";
  // Dynamic: llm-seo pulls every local content module, and this file is on
  // every page's client graph.
  const { listSeoPieces } = await import("~/lib/llm-seo");
  return sectionsFromPieces(await listSeoPieces());
});

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

export function sectionByHref(sections: NavSection[], href: string) {
  const path = normalizePath(href);
  return sections.find((section) => normalizePath(section.href) === path);
}

/** Every piece, in nav order. Item numbers count through this list. */
export function navPieces(sections: NavSection[]) {
  return sections.flatMap((section) => section.items);
}

export function navTotal(sections: NavSection[]) {
  return navPieces(sections).length;
}

/** Sub-views of a UI piece; prev / next keep whichever one you are on. */
const UIS_SUFFIXES = ["/component", "/schematics"];

function uisSuffix(path: string) {
  const normalized = normalizePath(path);
  return UIS_SUFFIXES.find((suffix) => normalized.endsWith(suffix)) ?? "";
}

function uisBasePath(path: string) {
  const normalized = normalizePath(path);
  const suffix = uisSuffix(normalized);
  return suffix ? normalizePath(normalized.slice(0, -suffix.length)) : normalized;
}

/** 1-based index of a piece href, or null when the path is not a piece. */
export function navNumberFor(sections: NavSection[], href: string): number | null {
  const path = uisBasePath(href);
  const index = navPieces(sections).findIndex((item) => normalizePath(item.href) === path);
  return index === -1 ? null : index + 1;
}

/** Previous and next component page, wrapping the UIs list. */
export function componentNeighbors(sections: NavSection[], pathname: string) {
  const items = sections.find((section) => section.href === "/uis")?.items;
  if (!items?.length) return null;
  const base = uisBasePath(pathname);
  const index = items.findIndex((item) => normalizePath(item.href) === base);
  if (index < 0) return null;
  const suffix = uisSuffix(pathname) === "/component" ? "/component" : "";
  const withSuffix = (item: NavItem): NavItem => ({
    ...item,
    href: `${normalizePath(item.href)}${suffix}`,
  });
  return {
    prev: withSuffix(items[(index - 1 + items.length) % items.length]!),
    next: withSuffix(items[(index + 1) % items.length]!),
  };
}
