/**
 * Infinite Article — judgment gates the fork, LLM writes the block.
 *
 * forkArticle: Choice over continue|deepen|aside|stop + Noul engagement.
 * writeArticleBlock: LLM prose (or honest canned fallback) after the reader picks.
 */
import { choice, judgeAvailable, noul, systemOne } from "~/lib/judge";

export type ArticleDirection = "continue" | "deepen" | "aside";

export type ArticleSection = {
  id: string;
  direction?: ArticleDirection;
  paragraphs: string[];
};

export const SEED_OPENING: ArticleSection = {
  id: "seed",
  paragraphs: [
    "Buttons assumed a system that was fast, deterministic, and silent about its own uncertainty. Most LLM interfaces invert all three: they speak before they know, hide confidence, and treat every pause as failure.",
    "This chapter asks what an article should do when the reader might still be with the thread, or might not. The interface does not invent the next paragraph. It offers directions, waits, and only then generates.",
    "Judgment picks the fork. The model writes. A miss is silence. Stopping is a first-class act.",
  ],
};

const MODEL = "@cf/meta/llama-3.2-3b-instruct";
const ENGAGEMENT_MIN = 0.35;

const DIRECTION_LABELS: Record<ArticleDirection, string> = {
  continue: "Continue",
  deepen: "Deepen",
  aside: "Aside",
};

const GHOST_LINES: Record<ArticleDirection, string> = {
  continue: "The next pattern in the sequence follows the same constraint: legibility before fluency.",
  deepen: "To see why that matters, consider what happens when latency crosses from felt to forgotten.",
  aside: "A brief note on an adjacent problem: attribution when the source is a probability, not a link.",
};

const CANNED_BLOCKS: Record<ArticleDirection, string[]> = {
  continue: [
    "Representing thinking and representing result are different jobs. An interface that streams judgment and generation through the same spinner teaches the reader to distrust both.",
    "The experiments on this site keep those paths separate. Rank and filter without a typing indicator. Generate only when prose is the point, and show the wait there.",
  ],
  deepen: [
    "Latency is not just a number on a dashboard. It is whether the reader still believes the system is attending to the same question they asked.",
    "When the model answers before the index confirms a hit, the interface has traded calibration for speed. Restraint means the empty state is allowed to stay empty.",
  ],
  aside: [
    "Find on this site lights up a span that already exists. Infinite article is the opposite problem: the next block does not exist until the reader chooses a direction.",
    "Both use the same gate. If confidence is low, stay quiet. Select, do not generate, when a match or a stop is the honest answer.",
  ],
};

export type ForkOption = {
  direction: ArticleDirection;
  label: string;
  ghost: string;
  score: number;
};

export type ForkResult =
  | { kind: "stop"; reason: "choice" | "engagement" }
  | { kind: "directions"; judge: true; options: ForkOption[] }
  | { kind: "simple"; options: Array<{ direction: "continue" | "stop"; label: string }> }
  | { kind: "error"; message: string };

export type WriteResult =
  | { kind: "block"; section: ArticleSection; synthesis: "llm" | "canned" }
  | { kind: "error"; message: string };

function sectionSummary(sections: ArticleSection[]): string {
  return sections
    .flatMap((section) => section.paragraphs)
    .join("\n\n")
    .slice(-2400);
}

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

function rankedDirections(
  probabilities: Record<string, number>,
): ForkOption[] {
  const order: ArticleDirection[] = ["continue", "deepen", "aside"];
  return order
    .map((direction) => ({
      direction,
      label: DIRECTION_LABELS[direction],
      ghost: GHOST_LINES[direction],
      score: probabilities[direction] ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

/** Client probe: ghost split and ranked forks need a key. */
export async function articleJudgeAvailable(): Promise<boolean> {
  "use server";
  return judgeAvailable();
}

export async function forkArticle(input: {
  sections: ArticleSection[];
  lastDirection?: ArticleDirection;
}): Promise<ForkResult> {
  "use server";

  const sections = input.sections.filter(
    (section) => section.paragraphs.length > 0,
  );
  if (sections.length === 0) {
    return { kind: "error", message: "Nothing to continue from." };
  }

  if (!judgeAvailable()) {
    return {
      kind: "simple",
      options: [
        { direction: "continue", label: "Continue" },
        { direction: "stop", label: "Stop" },
      ],
    };
  }

  const state = {
    text: sectionSummary(sections),
    lastDirection: input.lastDirection ?? null,
    sectionCount: sections.length,
  };

  const answers = await systemOne(state, {
    direction: choice(
      "What should the article do next? Pick one.",
      {
        continue: "Move forward with the main thread on AI interfaces",
        deepen: "Go deeper on the current point before moving on",
        aside: "Take a brief tangent related to the thesis",
        stop: "End here; the reader has had enough of this thread",
      },
    ),
    engaged: noul("Is the reader still with this thread?", {
      true: "The reader is still engaged with this thread",
      false: "The reader has likely moved on or lost the thread",
    }),
  });

  const direction = answers?.direction;
  const engaged = answers?.engaged;

  if (
    engaged?.type === "noul" &&
    engaged.noul < ENGAGEMENT_MIN
  ) {
    return { kind: "stop", reason: "engagement" };
  }

  if (direction?.type === "choice" && direction.choice === "stop") {
    return { kind: "stop", reason: "choice" };
  }

  if (direction?.type === "choice") {
    const options = rankedDirections(direction.probabilities);
    if (options.length === 0 || options[0]!.score <= 0) {
      return { kind: "stop", reason: "engagement" };
    }
    return { kind: "directions", judge: true, options };
  }

  return {
    kind: "simple",
    options: [
      { direction: "continue", label: "Continue" },
      { direction: "stop", label: "Stop" },
    ],
  };
}

function cannedBlock(direction: ArticleDirection): ArticleSection {
  const paragraphs = CANNED_BLOCKS[direction];
  return {
    id: `block-${Date.now()}`,
    direction,
    paragraphs,
  };
}

export async function writeArticleBlock(input: {
  sections: ArticleSection[];
  direction: ArticleDirection;
  ghost?: string;
}): Promise<WriteResult> {
  "use server";

  const sections = input.sections.filter(
    (section) => section.paragraphs.length > 0,
  );
  if (sections.length === 0) {
    return { kind: "error", message: "Nothing to continue from." };
  }

  const context = sectionSummary(sections);
  const ghost = input.ghost?.replace(/\s+/g, " ").trim();
  const direction = input.direction;

  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  if (!ai) {
    return { kind: "block", section: cannedBlock(direction), synthesis: "canned" };
  }

  const directionHint =
    direction === "continue"
      ? "Advance the main argument about AI interfaces and judgment."
      : direction === "deepen"
        ? "Stay on the current point and unpack it further."
        : "Take a short tangent that still connects to the thesis, then hint back.";

  let raw: unknown;
  try {
    raw = await ai.run(MODEL, {
      max_tokens: 320,
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content:
            "You write the next section of a research article on AI interfaces for aiu.is. Two short paragraphs only. Plain, precise prose. No greeting, no headings, no em dashes. Stay on theme: judgment vs generation, select-don't-generate, restraint when confidence is low. Reply with JSON only.",
        },
        {
          role: "user",
          content: `Article so far:\n${context}\n\nDirection: ${direction}. ${directionHint}${ghost ? `\nOpening line to follow: ${ghost}` : ""}\n\nReturn {"paragraphs":["<p1>","<p2>"]}.`,
        },
      ],
    });
  } catch {
    return { kind: "block", section: cannedBlock(direction), synthesis: "canned" };
  }

  const parsed = extractJsonObject(runText(raw));
  const paragraphs = Array.isArray(parsed?.paragraphs)
    ? (parsed.paragraphs as unknown[])
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  if (paragraphs.length === 0) {
    return { kind: "block", section: cannedBlock(direction), synthesis: "canned" };
  }

  return {
    kind: "block",
    section: {
      id: `block-${Date.now()}`,
      direction,
      paragraphs,
    },
    synthesis: "llm",
  };
}
