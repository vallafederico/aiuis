/**
 * Section names and piece paths. Kept apart from llm-seo.ts, which imports
 * every local content module: the nav needs these on every page.
 */
export const SECTION_ORDER = ["preface", "foundations", "uis"] as const;
export const SECTION_LABEL: Record<(typeof SECTION_ORDER)[number], string> = {
  preface: "Preface",
  foundations: "Foundations",
  uis: "UIs",
};

export function isPieceSection(
  value: string,
): value is (typeof SECTION_ORDER)[number] {
  return (SECTION_ORDER as readonly string[]).includes(value);
}

export function piecePath(section: string, slug: string): string {
  return `/${section}/${slug}`;
}

export function pieceMarkdownPath(section: string, slug: string): string {
  return `${piecePath(section, slug)}.md`;
}
