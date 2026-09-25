/**
 * Catalog search + rule judgment over the published pieces. `searchCatalog`
 * and the soft chips serve the Navigation demo; `judgeChip` is also the
 * Filters judge (one noul per piece, via lib/filters.ts), whose passing
 * rows are drawn to the search bar.
 *
 * Doctrine (uis/experiments.md): search RANKS the existing index in place,
 * a rule never adds a row, a miss is silence not a bogus #1, and no judgment
 * call happens when the model layer is unavailable — we fall back to honest
 * literal substring matching (search) or to nothing at all (rules).
 *
 * These functions never throw; they degrade to the literal fallback / null.
 */
import { choice, judgeAvailable, noul, systemOne } from "~/lib/judge";
import { listSeoPieces } from "~/lib/llm-seo";

export type CatalogSearchResult = {
  mode: "judge" | "literal";
  /** Probability (0..1) that anything in the catalog relates to the query. */
  exists: number;
  /** slug -> relevance. Judge: choice probabilities. Literal: 1 or 0. */
  scores: Record<string, number>;
};

export type ChipResult = {
  /** slug -> probability (0..1) that the piece satisfies the rule. */
  scores: Record<string, number>;
};

type CatalogEntry = {
  slug: string;
  section: string;
  /** What the piece is, in words: the section alone does not tell the judge. */
  kind: string;
  title: string;
  summary: string;
  tags: string[];
};

const KIND: Record<string, string> = {
  preface: "front matter about the site itself",
  foundations: "an essay on designing AI interfaces",
  uis: "a chapter with a working interactive prototype you can use on the site",
};

async function loadCatalog(): Promise<CatalogEntry[]> {
  const pieces = await listSeoPieces();
  return pieces.map(({ slug, section, title, summary, tags }) => ({
    slug,
    section,
    kind: KIND[section] ?? section,
    title,
    summary,
    tags,
  }));
}

function literalSearch(q: string, catalog: CatalogEntry[]): CatalogSearchResult {
  const needle = q.toLowerCase();
  const scores: Record<string, number> = {};
  let matches = 0;
  for (const entry of catalog) {
    const haystack = [entry.title, entry.summary, ...entry.tags]
      .join(" ")
      .toLowerCase();
    const hit = needle.length > 0 && haystack.includes(needle);
    scores[entry.slug] = hit ? 1 : 0;
    if (hit) matches += 1;
  }
  return { mode: "literal", exists: matches > 0 ? 1 : 0, scores };
}

/** Client probe: the pin/chips UI is model-only and hides without a key. */
export async function catalogJudgeAvailable(): Promise<boolean> {
  "use server";
  return judgeAvailable();
}

export async function searchCatalog(q: string): Promise<CatalogSearchResult> {
  "use server";
  const query = q.replace(/\s+/g, " ").trim();
  let catalog: CatalogEntry[] = [];
  try {
    catalog = await loadCatalog();
  } catch {
    return { mode: "literal", exists: 0, scores: {} };
  }
  if (!query || catalog.length === 0) {
    return { mode: "literal", exists: 0, scores: {} };
  }

  if (judgeAvailable()) {
    try {
      // One systemOne call: the ranking and the existence check share a state.
      const answers = await systemOne(
        { query, catalog },
        {
          where: choice(
            "Which piece in `catalog` best matches `query`? Options are the piece slugs; judge by each piece's title, summary, and tags.",
            Object.fromEntries(catalog.map((entry) => [entry.slug, null])),
          ),
          exists: noul("Does any piece in `catalog` relate to `query`?", {
            true: "At least one piece in `catalog` genuinely relates to `query`.",
            false: "Nothing in `catalog` relates to `query`.",
          }),
        },
      );
      const where = answers?.where;
      const exists = answers?.exists;
      if (where?.type === "choice" && exists?.type === "noul") {
        return { mode: "judge", exists: exists.noul, scores: where.probabilities };
      }
    } catch {
      // Fall through to the literal path.
    }
  }
  return literalSearch(query, catalog);
}

export async function judgeChip(rule: string): Promise<ChipResult | null> {
  "use server";
  const reading = rule.replace(/\s+/g, " ").trim();
  if (!reading || !judgeAvailable()) return null;
  try {
    const catalog = await loadCatalog();
    if (catalog.length === 0) return null;
    // One systemOne call: one narrow noul per piece, keyed by slug.
    const questions = Object.fromEntries(
      catalog.map((entry) => [
        entry.slug,
        noul(
          {
            piece: entry.slug,
            question: `Does the piece in \`catalog\` whose slug is "${entry.slug}" satisfy the reader's rule in \`rule\`?`,
          },
          {
            true: "This piece satisfies the reader's rule.",
            false: "This piece does not satisfy the reader's rule.",
          },
        ),
      ]),
    );
    const answers = await systemOne({ rule: reading, catalog }, questions);
    if (!answers) return null;
    const scores: Record<string, number> = {};
    for (const [slug, answer] of Object.entries(answers)) {
      if (answer.type === "noul") scores[slug] = answer.noul;
    }
    return { scores };
  } catch {
    return null;
  }
}
