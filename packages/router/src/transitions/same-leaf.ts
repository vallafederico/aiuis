import type { Location } from "@solidjs/router";

/** Resolve the pathname `to` navigates to (query/hash changes only → same pathname). */
export function destinationPathname(from: Location, to: string): string {
  if (typeof window === "undefined") return from.pathname;
  return new URL(to, window.location.href).pathname;
}

/** Leaf branch key — mirrors BranchStack / Router branchKey. */
export function getBranchKey(
  matches: readonly { path: string }[],
  fallbackPathname: string,
): string {
  const leaf = matches[matches.length - 1];
  return leaf ? leaf.path : fallbackPathname;
}

/** Query string with `solo` stripped so UI-only mode is not a new location. */
export function locationKeySearch(search: string) {
  const q = search.startsWith("?") ? search.slice(1) : search;
  if (!q) return "";
  const params = new URLSearchParams(q);
  params.delete("solo");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/**
 * True when navigation stays on the same matched route leaf — pathname unchanged,
 * only search (or hash) differs. These swap in place with no leave/enter.
 *
 * Compare against `from.pathname`, not the branch key: the leaf key is the
 * route pattern (`/uis/:slug`), so a query-only change would otherwise look
 * like a new page and play the full leave/enter mosaic.
 */
export function isSameLeafNavigation(
  from: Location,
  to: string,
  _currentBranchKey?: string,
): boolean {
  return destinationPathname(from, to) === from.pathname;
}
