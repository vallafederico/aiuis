/**
 * Images catalog search + soft provenance chips — judgment layer for the
 * Images chapter's contained demo.
 *
 * Doctrine (uis/experiments.md): search RANKS the grid in place, a miss is
 * silence not a bogus #1, and chips are model-only when the key is missing.
 *
 * Prompt-match uses Jev Noul over caption + prompt text as an honest stand-in
 * for vision ("does this image match the prompt?"). No vision client yet.
 *
 * These functions never throw; they degrade to literal fallback / null.
 */
import { choice, judgeAvailable, noul, systemOne } from "~/lib/judge";

export type ImageProvenance = {
  origin: "generated" | "documented";
  promptFit: "prompt-gap" | "prompt-faithful";
  brief: "on-brief" | "off-brief";
};

export type ImageItem = {
  id: string;
  title: string;
  caption: string;
  prompt: string;
  model: string;
  provenance: ImageProvenance;
  /** CSS background for the tile placeholder (no binary assets). */
  tint: string;
  /** Literal fallback hints keyed by lowercase topic tokens. */
  baseline?: Record<string, number>;
};

export type ImageSearchResult = {
  mode: "judge" | "literal";
  /** Probability (0..1) that anything in the catalog relates to the query. */
  exists: number;
  /** id -> relevance. Judge: choice probabilities. Literal: 1 or 0. */
  scores: Record<string, number>;
  /** id -> text-based prompt faithfulness estimate when judged; empty in literal mode. */
  promptMatch: Record<string, number>;
};

export type ImageChipResult = {
  /** id -> probability (0..1) that the image satisfies the rule. */
  scores: Record<string, number>;
};

/** Hardcoded seed catalog (~8 abstract tiles). */
export const IMAGE_CATALOG: ImageItem[] = [
  {
    id: "waiting-room",
    title: "Waiting room",
    caption: "Empty hospital waiting area, fluorescent light",
    prompt: "clinical waiting room, chairs in rows, soft daylight",
    model: "flux-schnell",
    provenance: {
      origin: "generated",
      promptFit: "prompt-faithful",
      brief: "on-brief",
    },
    tint: "linear-gradient(135deg, rgb(0 0 255 / 0.22), rgb(0 0 255 / 0.08))",
    baseline: { waiting: 0.9, clinical: 0.7, states: 0.5 },
  },
  {
    id: "loading-spinner",
    title: "Loading spinner",
    caption: "UI loading spinner on muted background",
    prompt: "minimal waiting state spinner, soft gray",
    model: "flux-schnell",
    provenance: {
      origin: "generated",
      promptFit: "prompt-faithful",
      brief: "on-brief",
    },
    tint: "linear-gradient(160deg, rgb(0 0 255 / 0.16), rgb(0 0 255 / 0.04))",
    baseline: { waiting: 0.85, states: 0.8, ui: 0.7 },
  },
  {
    id: "platform-dusk",
    title: "Platform dusk",
    caption: "Train platform at dusk, lone figure",
    prompt: "crowded morning commuter platform",
    model: "sdxl",
    provenance: {
      origin: "generated",
      promptFit: "prompt-gap",
      brief: "on-brief",
    },
    tint: "linear-gradient(200deg, rgb(0 0 255 / 0.28), rgb(0 0 255 / 0.1))",
    baseline: { transit: 0.6, dusk: 0.7 },
  },
  {
    id: "fern-window",
    title: "Fern window",
    caption: "Monstera by window, morning light",
    prompt: "houseplant window sill, documentary calm",
    model: "flux-dev",
    provenance: {
      origin: "generated",
      promptFit: "prompt-faithful",
      brief: "on-brief",
    },
    tint: "linear-gradient(120deg, rgb(0 0 255 / 0.14), rgb(0 0 255 / 0.06))",
    baseline: { calm: 0.6, interior: 0.5 },
  },
  {
    id: "archive-shelf",
    title: "Archive shelf",
    caption: "Film negatives on archival shelves",
    prompt: "documentary archive interior, contact sheets",
    model: "contact-sheet",
    provenance: {
      origin: "documented",
      promptFit: "prompt-faithful",
      brief: "on-brief",
    },
    tint: "linear-gradient(90deg, rgb(0 0 255 / 0.2), rgb(0 0 255 / 0.12))",
    baseline: { documentary: 0.95, archive: 0.9 },
  },
  {
    id: "crowd-blur",
    title: "Crowd blur",
    caption: "Motion blur crowd crossing",
    prompt: "documentary street crossing, long exposure",
    model: "contact-sheet",
    provenance: {
      origin: "documented",
      promptFit: "prompt-faithful",
      brief: "on-brief",
    },
    tint: "linear-gradient(45deg, rgb(0 0 255 / 0.18), rgb(0 0 255 / 0.08))",
    baseline: { documentary: 0.85, street: 0.7 },
  },
  {
    id: "street-rain",
    title: "Street rain",
    caption: "Rain on pavement, cropped abstract",
    prompt: "wide documentary street scene, rainy day",
    model: "leica-digital",
    provenance: {
      origin: "documented",
      promptFit: "prompt-gap",
      brief: "off-brief",
    },
    tint: "linear-gradient(225deg, rgb(0 0 255 / 0.24), rgb(0 0 255 / 0.06))",
    baseline: { documentary: 0.5, rain: 0.8 },
  },
  {
    id: "typography-poster",
    title: "Typography poster",
    caption: "Bold typography poster, wrong palette",
    prompt: "quiet editorial spread, small type",
    model: "sdxl",
    provenance: {
      origin: "generated",
      promptFit: "prompt-gap",
      brief: "off-brief",
    },
    tint: "linear-gradient(315deg, rgb(0 0 255 / 0.26), rgb(0 0 255 / 0.1))",
    baseline: { typography: 0.9, editorial: 0.4 },
  },
];

export const IMAGE_CHIP_RULES = {
  generated:
    "This image was AI-generated rather than documentary photography",
  documented:
    "This image is documentary photography rather than AI-generated",
  "prompt-gap":
    "This image has a prompt-gap: the result diverged from what the prompt asked for",
  "off-brief":
    "This image is off-brief relative to the creative direction",
} as const;

export type ImageChipKey = keyof typeof IMAGE_CHIP_RULES;

/** Client-safe: filter catalog by hard provenance tags (no model call). */
export function filterByProvenance(
  catalog: ImageItem[],
  tag: Partial<ImageProvenance>,
): ImageItem[] {
  return catalog.filter((item) =>
    Object.entries(tag).every(
      ([key, value]) =>
        item.provenance[key as keyof ImageProvenance] === value,
    ),
  );
}

function catalogHaystack(entry: ImageItem): string {
  return [
    entry.title,
    entry.caption,
    entry.prompt,
    entry.model,
    entry.provenance.origin,
    entry.provenance.promptFit,
    entry.provenance.brief,
  ]
    .join(" ")
    .toLowerCase();
}

function literalSearch(q: string, catalog: ImageItem[]): ImageSearchResult {
  const needle = q.toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);
  const scores: Record<string, number> = {};
  let matches = 0;
  for (const entry of catalog) {
    const haystack = catalogHaystack(entry);
    const substringHit = needle.length > 0 && haystack.includes(needle);
    let tokenScore = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) tokenScore += 1;
      tokenScore += entry.baseline?.[token] ?? 0;
    }
    const score = substringHit ? 1 : tokens.length > 0 ? tokenScore / tokens.length : 0;
    scores[entry.id] = Math.min(1, score);
    if (scores[entry.id] > 0) matches += 1;
  }
  return {
    mode: "literal",
    exists: matches > 0 ? 1 : 0,
    scores,
    promptMatch: {},
  };
}

/** Client probe: chip row is model-only and hides without a key. */
export async function imagesJudgeAvailable(): Promise<boolean> {
  "use server";
  return judgeAvailable();
}

export async function searchImages(q: string): Promise<ImageSearchResult> {
  "use server";
  const query = q.replace(/\s+/g, " ").trim();
  const catalog = IMAGE_CATALOG;
  if (!query || catalog.length === 0) {
    return { mode: "literal", exists: 0, scores: {}, promptMatch: {} };
  }

  if (judgeAvailable()) {
    try {
      const matchQuestions = Object.fromEntries(
        catalog.map((entry) => [
          `match_${entry.id}`,
          noul(
            {
              image: entry.id,
              caption: entry.caption,
              prompt: entry.prompt,
              question: `Given the caption and prompt text for image "${entry.id}", does the described image faithfully match its stated prompt?`,
            },
            {
              true: "The caption and prompt indicate the image matches its prompt.",
              false: "The caption and prompt indicate a gap between prompt and result.",
            },
          ),
        ]),
      );
      const answers = await systemOne(
        { query, catalog },
        {
          where: choice(
            "Which image in `catalog` best matches `query`? Options are image ids; judge by each image's caption, prompt, model, and provenance tags.",
            Object.fromEntries(catalog.map((entry) => [entry.id, null])),
          ),
          exists: noul("Does any image in `catalog` relate to `query`?", {
            true: "At least one image in `catalog` genuinely relates to `query`.",
            false: "Nothing in `catalog` relates to `query`.",
          }),
          ...matchQuestions,
        },
      );
      const where = answers?.where;
      const exists = answers?.exists;
      if (where?.type === "choice" && exists?.type === "noul") {
        const promptMatch: Record<string, number> = {};
        for (const entry of catalog) {
          const answer = answers?.[`match_${entry.id}`];
          if (answer?.type === "noul") {
            promptMatch[entry.id] = answer.noul;
          }
        }
        return {
          mode: "judge",
          exists: exists.noul,
          scores: where.probabilities,
          promptMatch,
        };
      }
    } catch {
      // Fall through to the literal path.
    }
  }
  return literalSearch(query, catalog);
}

export async function judgeImageChip(
  rule: ImageChipKey,
): Promise<ImageChipResult | null> {
  "use server";
  const reading = IMAGE_CHIP_RULES[rule];
  if (!reading || !judgeAvailable()) return null;
  try {
    const catalog = IMAGE_CATALOG;
    if (catalog.length === 0) return null;
    const questions = Object.fromEntries(
      catalog.map((entry) => [
        entry.id,
        noul(
          {
            image: entry.id,
            caption: entry.caption,
            prompt: entry.prompt,
            provenance: entry.provenance,
            rule: reading,
            question: `Does image "${entry.id}" satisfy this rule: ${reading}?`,
          },
          {
            true: "This image satisfies the rule.",
            false: "This image does not satisfy the rule.",
          },
        ),
      ]),
    );
    const answers = await systemOne({ rule: reading, catalog }, questions);
    if (!answers) return null;
    const scores: Record<string, number> = {};
    for (const [id, answer] of Object.entries(answers)) {
      if (answer.type === "noul") scores[id] = answer.noul;
    }
    return { scores };
  } catch {
    return null;
  }
}
