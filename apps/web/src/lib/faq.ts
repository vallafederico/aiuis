export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

export const SEED_FAQS: FaqItem[] = [
  {
    id: "seed-site",
    question: "What is this site?",
    answer:
      "aiu.is is the research. It is a set of working notes on interfaces for a system that thinks back, or only seems to. The chapters are the argument, and the pages are the prototypes. From Foreword.",
  },
  {
    id: "seed-research",
    question: "What is the research about?",
    answer:
      "Buttons assumed a system that was fast, deterministic, and silent about its own uncertainty. This project asks what the interface should do when a model is none of those. From Foreword.",
  },
  {
    id: "seed-index",
    question: "Where do these answers come from?",
    answer:
      "From whatever is published. A change is indexed with the document, and a question searches that index. The answer names the source. If nothing in the index covers it, this list does not invent one.",
  },
];

const FAQ_STORAGE_KEY = "aiuis:faqs";
const FAQ_MEMORY_LIMIT = 32;

function normQuestion(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Sentence-case the first letter if the typed question starts lowercase. */
export function formatQuestion(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/^\p{Ll}/u, (ch) => ch.toLocaleUpperCase());
}

export function loadRememberedFaqs(): FaqItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(FAQ_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seedQuestions = new Set(SEED_FAQS.map((item) => normQuestion(item.question)));
    const out: FaqItem[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      const question =
        typeof rec.question === "string" ? formatQuestion(rec.question) : "";
      const answer = stripFaqSelfCite(
        typeof rec.answer === "string" ? rec.answer.trim() : "",
      );
      if (!id || !question || !answer) continue;
      if (looksLikeRefusal(answer)) continue;
      if (SEED_FAQS.some((item) => item.id === id)) continue;
      if (seedQuestions.has(normQuestion(question))) continue;
      if (out.some((item) => item.id === id || normQuestion(item.question) === normQuestion(question))) {
        continue;
      }
      out.push({ id, question, answer });
    }
    return out.slice(-FAQ_MEMORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveRememberedFaqs(items: FaqItem[]) {
  if (typeof localStorage === "undefined") return;
  const seedIds = new Set(SEED_FAQS.map((item) => item.id));
  const extras = items
    .filter(
      (item) =>
        !seedIds.has(item.id) && item.question.trim() && item.answer.trim(),
    )
    .slice(-FAQ_MEMORY_LIMIT);
  localStorage.setItem(FAQ_STORAGE_KEY, JSON.stringify(extras));
}

export type AskFaqResult =
  | { kind: "match"; id: string }
  | { kind: "new"; question: string; answer: string }
  | { kind: "error"; message: string };

const MODEL = "@cf/meta/llama-3.2-3b-instruct";
/** Used only to mark a hit as citable. Synthesis still runs below this. */
const FAQ_EXISTS_MIN = 0.35;
const FAQ_PASSAGE_LIMIT = 4;

// Tunable thresholds for the Jev duplicate judgment in askFaq.
// A match is accepted only when the duplicate probability and the
// pick's confidence both clear these bars; otherwise we generate.
const FAQ_DUPLICATE_MIN_NOUL = 0.7;
const FAQ_PICK_MIN_CONFIDENCE = 0.5;
// Choice questions cap at 255 options; keep headroom for "none".
const FAQ_JUDGE_MAX_OPTIONS = 250;
/** Card teasers shorter than this are not citable as answers. */
const FAQ_MIN_PASSAGE_CHARS = 120;

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    if (typeof rec.response === "string") return rec.response;
    const choices = rec.choices;
    if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
      const message = (choices[0] as { message?: { content?: unknown } }).message;
      if (typeof message?.content === "string") return message.content;
    }
  }
  return "";
}

type Passage = { title: string; slug: string; excerpt: string };

type IndexedPassages = {
  passages: Passage[];
  /** findInSite cleared the exists gate — safe to cite when synthesis fails. */
  grounded: boolean;
};

function slugFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function questionTerms(question: string): string[] {
  return question
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 2);
}

function looksLikeRefusal(text: string): boolean {
  const norm = text.toLowerCase();
  return (
    norm.includes("unfortunately") ||
    norm.includes("provided passages") ||
    norm.includes("passages do not") ||
    norm.includes("passage does not") ||
    norm.includes("do not contain") ||
    norm.includes("does not contain") ||
    norm.includes("cannot answer") ||
    norm.includes("can't answer") ||
    norm.includes("no direct answer") ||
    norm.includes("not enough information")
  );
}

/**
 * Hybrid search over the CMS index, hydrated with full paragraph text
 * from the find corpus when card excerpts are too thin.
 */
async function passagesFromCmsSearch(question: string): Promise<Passage[]> {
  const { cms } = await import("~/lib/cms");
  const { listFindParagraphs } = await import("~/lib/find");
  const found = await cms().search(question, {
    mode: "hybrid",
    limit: 8,
  });
  const slugs = new Set<string>();
  const titles = new Map<string, string>();
  for (const item of found.results ?? []) {
    const slug = typeof item.slug === "string" ? item.slug : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (slug && title) {
      slugs.add(slug);
      titles.set(slug, title);
    }
  }
  if (slugs.size === 0) return [];

  const terms = questionTerms(question);
  const corpus = await listFindParagraphs();
  const scored: Array<{ passage: Passage; score: number }> = [];
  for (const entry of corpus) {
    const slug = slugFromPath(entry.path);
    if (!slugs.has(slug)) continue;
    const haystack = entry.text.toLowerCase();
    const overlap = terms.filter((term) => haystack.includes(term)).length;
    scored.push({
      passage: {
        title: titles.get(slug) ?? entry.title,
        slug,
        excerpt: entry.text,
      },
      score: overlap,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const passages: Passage[] = [];
  for (const { passage } of scored) {
    if (seen.has(passage.slug)) continue;
    seen.add(passage.slug);
    passages.push(passage);
    if (passages.length >= FAQ_PASSAGE_LIMIT) break;
  }
  return passages;
}

function substantialPassages(passages: Passage[]): Passage[] {
  return passages.filter((passage) => passage.excerpt.length >= FAQ_MIN_PASSAGE_CHARS);
}

/** Exists gate for CMS-hydrated passages — ungrounded fallback stays silent. */
async function passagesGrounded(
  question: string,
  passages: Passage[],
): Promise<boolean> {
  if (passages.length === 0) return false;
  const { judgeAvailable, systemOne, noul } = await import("~/lib/judge");
  if (!judgeAvailable()) return false;
  const text = passages
    .map((passage, index) => `${index + 1}. ${passage.excerpt}`)
    .join("\n");
  const answers = await systemOne(
    { question, passages: text },
    {
      exists: noul(
        `Do these indexed passages address the question: "${question}"?`,
        {
          true: "At least one passage addresses the question",
          false: "Nothing in these passages addresses the question",
        },
      ),
    },
  );
  return (
    answers?.exists?.type === "noul" && answers.exists.noul >= FAQ_EXISTS_MIN
  );
}

/**
 * Paragraph-level retrieval. Hits are used even when the exists gate is
 * weak — FAQ may still answer from the site brief. `grounded` only means
 * a passage is safe to cite verbatim.
 */
async function indexedPassages(question: string): Promise<IndexedPassages> {
  const { findInSite } = await import("~/lib/find");
  const found = await findInSite(question);
  if (found.hits.length > 0) {
    return {
      grounded: found.exists >= FAQ_EXISTS_MIN,
      passages: found.hits.slice(0, FAQ_PASSAGE_LIMIT).map((hit) => ({
        title: hit.title,
        slug: slugFromPath(hit.path),
        excerpt: hit.text,
      })),
    };
  }

  const cmsPassages = substantialPassages(await passagesFromCmsSearch(question));
  if (cmsPassages.length === 0) return { passages: [], grounded: false };
  const grounded = await passagesGrounded(question, cmsPassages);
  return { passages: cmsPassages, grounded };
}

async function siteBrief(): Promise<string> {
  const seeds = SEED_FAQS.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n");
  try {
    const { listSeoPieces } = await import("~/lib/llm-seo");
    const pieces = await listSeoPieces();
    const catalog = pieces
      .slice(0, 16)
      .map((piece) => `- ${piece.title}: ${piece.summary}`.trim())
      .filter((line) => line.length > 4)
      .join("\n");
    return catalog ? `${seeds}\n\nPublished chapters:\n${catalog}` : seeds;
  } catch {
    return seeds;
  }
}

function seedFallback(question: string): { question: string; answer: string } | null {
  const asked = question.toLowerCase();
  const aboutSite =
    /\b(you|site|aiu\.?is|this|purpose|research|project|about|who|what)\b/.test(asked);
  if (!aboutSite) return null;
  if (/\b(answer|index|where|source|come from)\b/.test(asked)) return SEED_FAQS[2] ?? null;
  if (/\bresearch\b/.test(asked)) return SEED_FAQS[1] ?? null;
  return SEED_FAQS[0] ?? null;
}

export function stripFaqSelfCite(text: string) {
  return text.replace(/\s*From FAQs\.?\s*$/i, "").trim();
}

/** Splits the trailing "From <Title>." that `cited()` appends. */
export function splitFaqCite(text: string): { body: string; source: string | null } {
  const match = text.match(/^(.*?)\s*From ([^.]+?)\.\s*$/s);
  if (!match) return { body: text, source: null };
  return { body: match[1]!, source: match[2]!.trim() };
}

function cited(excerpt: string, title: string) {
  const text = stripFaqSelfCite(excerpt.replace(/\s+/g, " ").trim());
  if (!title || title === "Brief" || /^faqs?$/i.test(title.trim())) return text;
  if (/\bfrom\s+\S+/i.test(text)) return text;
  return `${text} From ${title}.`;
}

function answerFromPassage(question: string, passage: Passage) {
  return { question, answer: cited(passage.excerpt, passage.title) };
}

async function answerFromIndex(question: string): Promise<{ question: string; answer: string } | null> {
  const { passages, grounded } = await indexedPassages(question);
  const citeTop = () =>
    grounded && passages[0] ? answerFromPassage(question, passages[0]) : seedFallback(question);

  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  if (!ai) return citeTop();

  const brief = await siteBrief();
  const sources = passages
    .map((passage, index) => `${index + 1}. ${passage.title}: ${passage.excerpt}`)
    .join("\n");
  let raw: unknown;
  try {
    raw = await ai.run(MODEL, {
      max_tokens: 320,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "You answer questions for visitors to aiu.is, a research site on interfaces for systems that think (or seem to). Prefer indexed passages when they help. You may also use the site brief to explain what the project is, who it is for, and how pages work. Speak plainly in 2 to 4 sentences. Do not invent unpublished chapters, APIs, or products. Off-topic questions (weather, recipes, personal advice, other companies) get {\"covered\":false} only. Never write a refusal sentence in the answer field. No greeting. JSON only.",
        },
        {
          role: "user",
          content: `Site brief:\n${brief}\n\n${sources ? `Passages:\n${sources}\n\n` : ""}Question: ${question}\n\nIf the question is about this site or its research, answer it. Return {"covered":true,"question":"<short FAQ title>","answer":"<2 to 4 sentences>","source":"<document title or Brief>"}. If it is off-topic, {"covered":false}.`,
        },
      ],
    });
  } catch {
    return citeTop();
  }

  const parsed = extractJsonObject(runText(raw));
  if (!parsed || parsed.covered === false) return citeTop();

  const sourceTitle =
    typeof parsed.source === "string" &&
    (parsed.source === "Brief" || passages.some((passage) => passage.title === parsed.source))
      ? parsed.source
      : passages[0]?.title ?? "Foreword";
  const nextQuestion =
    typeof parsed.question === "string" && parsed.question.trim()
      ? parsed.question.trim()
      : question;
  const body =
    typeof parsed.answer === "string" && parsed.answer.trim()
      ? parsed.answer.trim()
      : passages[0]?.excerpt ?? "";
  if (!body || looksLikeRefusal(body)) return citeTop();
  return { question: nextQuestion, answer: cited(body, sourceTitle) };
}

/** Client probe: duplicate gate and CMS exists check need a key. */
export async function faqJudgeAvailable(): Promise<boolean> {
  "use server";
  const { judgeAvailable } = await import("~/lib/judge");
  return judgeAvailable();
}

/** Client probe: LLM restatement path needs Workers AI. */
export async function faqSynthesisAvailable(): Promise<boolean> {
  "use server";
  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  return Boolean(ai);
}

/** Starter questions, answered from the current index rather than a fixed FAQ list. */
export async function indexFaqs(): Promise<FaqItem[]> {
  "use server";

  const items: FaqItem[] = [];
  for (const seed of SEED_FAQS) {
    try {
      const answered = await answerFromIndex(seed.question);
      items.push({
        id: seed.id,
        question: seed.question,
        answer: answered?.answer ?? seed.answer,
      });
    } catch {
      items.push(seed);
    }
  }
  return items;
}

export async function askFaq(input: {
  question: string;
  existing: Pick<FaqItem, "id" | "question">[];
}): Promise<AskFaqResult> {
  "use server";

  const question = formatQuestion(input.question);
  if (!question) return { kind: "error", message: "Ask something." };
  if (question.length > 240) return { kind: "error", message: "Shorter, please." };

  const asked = normQuestion(question);
  const prior = input.existing.find((item) => normQuestion(item.question) === asked);
  if (prior) return { kind: "match", id: prior.id };

  // The judgment gates the generate path: when an existing FAQ already asks
  // this, select it instead of generating a near-duplicate. Select, don't
  // generate, when a match exists. On missing key or any judge failure,
  // behavior is identical to the pre-judgment flow below.
  const { judgeAvailable, systemOne, choice, noul } = await import("~/lib/judge");
  if (judgeAvailable() && input.existing.length > 0) {
    const faqs = input.existing
      .filter((item) => typeof item.id === "string" && item.id)
      .slice(-FAQ_JUDGE_MAX_OPTIONS)
      .map(({ id, question: q }) => ({ id, question: q }));
    if (faqs.length > 0) {
      const criteria: Record<string, string | null> = {
        none: "No existing FAQ asks this",
      };
      for (const faq of faqs) criteria[faq.id] = null;
      const answers = await systemOne(
        { asked: question, faqs },
        {
          pick: choice(
            "Which existing FAQ in `faqs` (by id) asks the same thing as `asked`? Pick \"none\" if no existing FAQ asks it.",
            criteria,
          ),
          duplicate: noul(
            "Does any FAQ in `faqs` ask essentially the same question as `asked`?",
            {
              true: "An existing FAQ asks essentially the same question",
              false: "No existing FAQ asks this question",
            },
          ),
        },
      );
      const pick = answers?.pick;
      const duplicate = answers?.duplicate;
      if (
        pick?.type === "choice" &&
        duplicate?.type === "noul" &&
        duplicate.noul >= FAQ_DUPLICATE_MIN_NOUL &&
        pick.choice !== "none" &&
        pick.confidence >= FAQ_PICK_MIN_CONFIDENCE
      ) {
        return { kind: "match", id: pick.choice };
      }
    }
  }

  try {
    const answered = await answerFromIndex(question);
    if (!answered) return { kind: "error", message: "That's outside what this site is about." };
    return { kind: "new", question: formatQuestion(answered.question), answer: answered.answer };
  } catch {
    return { kind: "error", message: "The index is not reachable." };
  }
}
