/**
 * Site-wide semantic find (⌘F).
 *
 * Choice over paragraph IDs + Noul `exists` gate. The answer is a location
 * in the published text — never generated prose. A weak `exists` keeps the
 * page dark: a miss is silence, not a bogus first hit.
 */

export type FindHit = {
  /** Corpus paragraph id (e.g. P042) — client highlights by id, not fuzzy text overlap. */
  id: string;
  path: string;
  title: string;
  /** First ~110 chars of the paragraph, for the result row. */
  preview: string;
  /** Full normalized paragraph text. */
  text: string;
  score: number;
};

export type FindResult = {
  mode: "judge" | "literal";
  /** Probability the site addresses the query. 0/1 in literal mode. */
  exists: number;
  hits: FindHit[];
};

const CORPUS_TTL_MS = 5 * 60_000;
/** Choice questions cap at 255 options; keep headroom. */
const CORPUS_MAX_PARAGRAPHS = 254;
const MIN_PARAGRAPH_CHARS = 40;
const MAX_HITS = 5;
const PREVIEW_CHARS = 110;

type CorpusEntry = {
  id: string;
  path: string;
  title: string;
  text: string;
};

let corpusCache: { entries: CorpusEntry[]; at: number } | null = null;

/** Drop inline markdown so corpus text tracks the rendered plain text. */
function plainInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Body markdown → paragraphs. Frontmatter, headings, code fences, directive
 * markers (`:::foreword` fences — the inner text stays), images, and HTML
 * comments are stripped; blank lines separate paragraphs.
 */
function paragraphsFromMarkdown(markdown: string): string[] {
  let body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  body = body.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "");

  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const text = plainInline(current.join(" "));
    current = [];
    if (text.length >= MIN_PARAGRAPH_CHARS) paragraphs.push(text);
  };

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    const isBreak =
      !trimmed ||
      trimmed.startsWith(":::") ||
      /^#{1,6}\s/.test(trimmed) ||
      /^<!--[\s\S]*-->$/.test(trimmed) ||
      /^!\[/.test(trimmed);
    if (isBreak) {
      flush();
      continue;
    }
    current.push(trimmed);
  }
  flush();
  return paragraphs;
}

/** Evenly spaced samples so later chapters are not dropped by head-only truncation. */
function sampleParagraphs(paragraphs: string[], count: number): string[] {
  if (paragraphs.length <= count) return paragraphs;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor((i + 0.5) * paragraphs.length / count);
    out.push(paragraphs[index]!);
  }
  return out;
}

async function buildCorpus(): Promise<CorpusEntry[]> {
  const { listSeoPieces, pieceMarkdown, piecePath } = await import(
    "~/lib/llm-seo"
  );
  const pieces = await listSeoPieces();

  const perPiece: Array<{
    path: string;
    title: string;
    paragraphs: string[];
  }> = [];
  for (const piece of pieces) {
    const markdown = await pieceMarkdown(piece.section, piece.slug);
    if (!markdown) continue;
    const paragraphs = paragraphsFromMarkdown(markdown);
    if (paragraphs.length === 0) continue;
    perPiece.push({
      path: piecePath(piece.section, piece.slug),
      title: piece.title,
      paragraphs,
    });
  }

  const total = perPiece.reduce((n, p) => n + p.paragraphs.length, 0);
  if (total > CORPUS_MAX_PARAGRAPHS) {
    console.warn(
      `find: corpus has ${total} paragraphs; sampling evenly across pieces to fit ${CORPUS_MAX_PARAGRAPHS} (Choice cap is 255 options)`,
    );
    const scale = CORPUS_MAX_PARAGRAPHS / total;
    for (const piece of perPiece) {
      const budget = Math.max(1, Math.floor(piece.paragraphs.length * scale));
      piece.paragraphs = sampleParagraphs(piece.paragraphs, budget);
    }
  }

  const entries: CorpusEntry[] = [];
  for (const piece of perPiece) {
    for (const text of piece.paragraphs) {
      if (entries.length >= CORPUS_MAX_PARAGRAPHS) break;
      entries.push({
        id: `P${String(entries.length).padStart(3, "0")}`,
        path: piece.path,
        title: piece.title,
        text,
      });
    }
  }
  return entries;
}

async function loadCorpus(): Promise<CorpusEntry[]> {
  const now = Date.now();
  if (corpusCache && now - corpusCache.at < CORPUS_TTL_MS) {
    return corpusCache.entries;
  }
  const entries = await buildCorpus();
  corpusCache = { entries, at: now };
  return entries;
}

/** Paragraphs for the Find chapter's in-frame document pane. */
export async function listFindParagraphs(): Promise<
  Array<{ id: string; path: string; title: string; text: string }>
> {
  "use server";
  try {
    return await loadCorpus();
  } catch (error) {
    console.warn("find: listFindParagraphs failed", error);
    return [];
  }
}

function toHit(entry: CorpusEntry, score: number): FindHit {
  const preview =
    entry.text.length > PREVIEW_CHARS
      ? `${entry.text.slice(0, PREVIEW_CHARS).trimEnd()}…`
      : entry.text;
  return {
    id: entry.id,
    path: entry.path,
    title: entry.title,
    preview,
    text: entry.text,
    score,
  };
}

/** Client probe: semantic find needs a key; without it, literal substring only. */
export async function findJudgeAvailable(): Promise<boolean> {
  "use server";
  const { judgeAvailable } = await import("~/lib/judge");
  return judgeAvailable();
}

export async function findInSite(q: string): Promise<FindResult> {
  "use server";

  try {
    const query = q.replace(/\s+/g, " ").trim();
    if (!query) return { mode: "literal", exists: 0, hits: [] };

    const corpus = await loadCorpus();
    if (corpus.length === 0) return { mode: "literal", exists: 0, hits: [] };

    const { judgeAvailable, systemOne, choice, noul } = await import(
      "~/lib/judge"
    );

    if (judgeAvailable()) {
      // Tagged document, one paragraph per line: "P042| <text>".
      const state = corpus
        .map((entry) => `${entry.id}| ${entry.text}`)
        .join("\n");
      const criteria: Record<string, string | null> = {};
      for (const entry of corpus) criteria[entry.id] = null;

      const answers = await systemOne(state, {
        where: choice(
          `Each line of the document is a paragraph tagged with its id. Which line contains the passage that answers or matches this query: "${query}"?`,
          criteria,
        ),
        exists: noul(
          `Does any line of the document address this query: "${query}"?`,
          {
            true: "Some line of the document addresses the query",
            false: "No line of the document addresses the query",
          },
        ),
      });

      const where = answers?.where;
      const exists = answers?.exists;
      if (where?.type === "choice" && exists?.type === "noul") {
        const byId = new Map(corpus.map((entry) => [entry.id, entry]));
        const hits = Object.entries(where.probabilities)
          .sort(([, a], [, b]) => b - a)
          .slice(0, MAX_HITS)
          .flatMap(([id, probability]) => {
            const entry = byId.get(id);
            return entry ? [toHit(entry, probability)] : [];
          });
        return { mode: "judge", exists: exists.noul, hits };
      }
      // systemOne returned null (failure) — fall through to the literal path.
    }

    // The honest browser-⌘F behavior: literal case-insensitive substring.
    const needle = query.toLowerCase();
    const hits = corpus
      .filter((entry) => entry.text.toLowerCase().includes(needle))
      .slice(0, MAX_HITS)
      .map((entry) => toHit(entry, 1));
    return { mode: "literal", exists: hits.length > 0 ? 1 : 0, hits };
  } catch (error) {
    console.warn("find: findInSite failed", error);
    return { mode: "literal", exists: 0, hits: [] };
  }
}
