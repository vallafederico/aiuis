/**
 * Draft / published for pieces. The hosted CMS schema has no status field, so
 * the site owns the decision here. Drafts render in dev and are absent
 * everywhere on the deployed site: nav, pages, .md / llms.txt, sitemap,
 * search and the FAQ index.
 */

/** UI pieces that are live. Every other `uis` piece is a draft. */
export const PUBLISHED_UIS: ReadonlySet<string> = new Set([
  "faqs",
  "infinite-article",
  "generative-moodboard",
  "sketch-generation",
  "type-an-analytic",
]);

export type PieceStatus = "draft" | "published";

export function pieceStatus(section: string, slug: string): PieceStatus {
  if (section !== "uis") return "published";
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
  return showDrafts() || pieceStatus(section, slug) === "published";
}
