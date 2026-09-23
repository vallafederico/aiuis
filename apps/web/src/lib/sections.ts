import { query } from "@solidjs/router";
import {
  SECTION_LABEL,
  SECTION_ORDER,
  listSeoPieces,
  piecePath,
  type SeoPiece,
} from "~/lib/llm-seo";

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

function uisBasePath(path: string) {
  const normalized = normalizePath(path);
  if (normalized.endsWith("/schematics")) {
    return normalizePath(normalized.slice(0, -"/schematics".length));
  }
  return normalized;
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
  const normalized = normalizePath(pathname);
  const schematics = normalized.endsWith("/schematics");
  const base = uisBasePath(pathname);
  const index = items.findIndex((item) => normalizePath(item.href) === base);
  if (index < 0) return null;
  const suffix = schematics ? "/schematics" : "";
  const withSuffix = (item: NavItem): NavItem => ({
    ...item,
    href: `${normalizePath(item.href)}${suffix}`,
  });
  return {
    prev: withSuffix(items[(index - 1 + items.length) % items.length]!),
    next: withSuffix(items[(index + 1) % items.length]!),
  };
}
