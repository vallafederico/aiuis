/**
 * Draft / published for pieces. The hosted CMS schema has no status field, so
 * the site owns the decision here. Drafts render in dev and are absent
 * everywhere on the deployed site: nav, pages, .md / llms.txt, sitemap,
 * search and the FAQ index.
 */

/** UI pieces that are live. Every other `uis` piece is a draft. */
export const PUBLISHED_UIS: ReadonlySet<string> = new Set([
  "faqs",
  "filters",
  "infinite-article",
  "generative-moodboard",
  "sketch-generation",
  "type-an-analytic",
]);

/** UI pieces still being worked out: hidden everywhere, even from drafts in dev. */
export const SHELVED_UIS: ReadonlySet<string> = new Set(["image-generation"]);

export type PieceStatus = "shelved" | "draft" | "published";

export function pieceStatus(section: string, slug: string): PieceStatus {
  if (section !== "uis") return "published";
  if (SHELVED_UIS.has(slug)) return "shelved";
  return PUBLISHED_UIS.has(slug) ? "published" : "draft";
}

/** SHOW_DRAFTS=1 shows drafts in a build; SHOW_DRAFTS=0 hides them in dev (to preview the live set). */
export function showDrafts(): boolean {
  const flag = typeof process !== "undefined" ? process.env.SHOW_DRAFTS : undefined;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return import.meta.env.DEV;
}

/** Whether this piece may be listed or served in the current environment. */
export function isPieceVisible(section: string, slug: string): boolean {
  const status = pieceStatus(section, slug);
  if (status === "shelved") return false;
  return showDrafts() || status === "published";
}
