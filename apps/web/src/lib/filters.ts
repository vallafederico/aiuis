import { query } from "@solidjs/router";
import { SECTION_LABEL, piecePath } from "~/lib/piece-sections";

/** One row of the Filters catalog: a published chapter, as the CMS has it. */
export type FilterRow = {
  slug: string;
  title: string;
  href: string;
  section: string;
  summary: string;
  tags: string[];
};

/** The closed list Filters moves. Same pieces `judgeChip` scores, in nav order. */
export const getFilterRows = query(async (): Promise<FilterRow[]> => {
  "use server";
  const { listSeoPieces } = await import("~/lib/llm-seo");
  const pieces = await listSeoPieces();
  return pieces.map((piece) => ({
    slug: piece.slug,
    title: piece.title,
    href: piecePath(piece.section, piece.slug),
    section: SECTION_LABEL[piece.section],
    summary: piece.summary,
    tags: piece.tags,
  }));
}, "filter-rows");

/** A row at or above this passes the rule and is drawn to the bar. */
export const KEEP_AT = 0.5;

/**
 * A typed rule, judged once per row. Null is silence: no model, a failed
 * call, or no row that clearly passes. Nothing moves unless one does.
 */
export async function judgeFilterRule(
  rule: string,
): Promise<{ scores: Record<string, number> } | null> {
  "use server";
  const { judgeChip } = await import("~/lib/catalog-search");
  const result = await judgeChip(rule);
  if (!result) return null;
  const best = Math.max(0, ...Object.values(result.scores));
  return best >= KEEP_AT ? result : null;
}
