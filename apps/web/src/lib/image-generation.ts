/**
 * Image Generation — prompt-to-control loop for the contained demo.
 *
 * Jev picks iterate / vary / stop and scores prompt–result gap (Noul over
 * caption text as an honest stand-in for vision; no vision client yet).
 * LLM rewrites the prompt on iterate/vary when Cloudflare AI is available.
 * Result tiles are CSS gradients keyed to the prompt hash when no image model
 * is wired.
 */
import { choice, judgeAvailable, noul, systemOne } from "~/lib/judge";

const LLM_MODEL = "@cf/meta/llama-3.2-3b-instruct";

export type GenerationResult = {
  prompt: string;
  caption: string;
  tint: string;
  model: string;
  /** Text-based prompt faithfulness estimate (0..1); higher = closer match. Not pixel-grounded. */
  promptFaithful?: number;
};

export type GenerationHistoryEntry = {
  prompt: string;
  caption: string;
  mode?: "seed" | "iterate" | "vary";
};

export type SliderSuggestion = {
  id: string;
  label: string;
  value: number;
};

export type ControlOption = {
  mode: "iterate" | "vary" | "stop";
  label: string;
  score?: number;
};

export type ControlsResult = {
  judge: boolean;
  options: ControlOption[];
  sliders: SliderSuggestion[];
  /** When Jev thinks stopping is warranted (informational only). */
  suggestStop?: boolean;
};

export type IterationResult =
  | { kind: "result"; result: GenerationResult; synthesis: "llm" | "heuristic" }
  | { kind: "error"; message: string };

export const SEED_PROMPT =
  "editorial still life, ceramic cup on linen, soft daylight, quiet grain";

export const SEED_RESULT: GenerationResult = {
  prompt: SEED_PROMPT,
  caption: "Ceramic cup on folded linen, diffuse window light, fine film grain",
  tint: tintFromPrompt(SEED_PROMPT),
  model: "css-tile",
};

const CONTROL_LABELS: Record<"iterate" | "vary" | "stop", string> = {
  iterate: "Iterate",
  vary: "Vary",
  stop: "Stop",
};

const SLIDER_LEXICON: Array<{
  id: string;
  label: string;
  patterns: RegExp[];
  low: string;
  high: string;
}> = [
  {
    id: "grain",
    label: "grain",
    patterns: [/grain/i, /grit/i, /noise/i],
    low: "less grain",
    high: "more grain",
  },
  {
    id: "warmth",
    label: "warmth",
    patterns: [/warm/i, /cool/i, /cold/i, /temperature/i],
    low: "cooler",
    high: "warmer",
  },
  {
    id: "type",
    label: "type",
    patterns: [/type/i, /typography/i, /text/i, /letter/i],
    low: "less type",
    high: "more type",
  },
  {
    id: "contrast",
    label: "contrast",
    patterns: [/contrast/i, /flat/i, /muted/i, /punch/i],
    low: "softer",
    high: "harder",
  },
  {
    id: "density",
    label: "density",
    patterns: [/sparse/i, /dense/i, /busy/i, /minimal/i],
    low: "sparser",
    high: "denser",
  },
];

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

/** Deterministic CSS gradient from prompt text (honest stand-in for pixels). */
export function tintFromPrompt(prompt: string): string {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (Math.imul(31, hash) + prompt.charCodeAt(i)) >>> 0;
  }
  const angle = 90 + (hash % 180);
  const a1 = 0.12 + ((hash >> 8) % 18) / 100;
  const a2 = 0.04 + ((hash >> 16) % 10) / 100;
  return `linear-gradient(${angle}deg, rgb(0 0 255 / ${a1.toFixed(2)}), rgb(0 0 255 / ${a2.toFixed(2)}))`;
}

function heuristicSliders(prompt: string): SliderSuggestion[] {
  const lower = prompt.toLowerCase();
  const found: SliderSuggestion[] = [];
  for (const entry of SLIDER_LEXICON) {
    if (entry.patterns.some((pattern) => pattern.test(lower))) {
      let value = 0.5;
      if (/\bmore\b|\bharder\b|\bdenser\b|\bwarmer\b/i.test(prompt)) value = 0.72;
      if (/\bless\b|\bsofter\b|\bsparser\b|\bcooler\b/i.test(prompt)) value = 0.28;
      found.push({ id: entry.id, label: entry.label, value });
    }
    if (found.length >= 2) break;
  }
  if (found.length === 0) {
    found.push({ id: "grain", label: "grain", value: 0.5 });
  }
  return found.slice(0, 2);
}

function applySliders(
  prompt: string,
  sliders: Record<string, number> | undefined,
): string {
  if (!sliders || Object.keys(sliders).length === 0) return prompt;
  const parts: string[] = [];
  for (const entry of SLIDER_LEXICON) {
    const value = sliders[entry.id];
    if (value === undefined) continue;
    parts.push(value >= 0.5 ? entry.high : entry.low);
  }
  if (parts.length === 0) return prompt;
  return `${prompt.replace(/\s*,\s*$/, "")}, ${parts.join(", ")}`;
}

function heuristicRewrite(prompt: string, mode: "iterate" | "vary"): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (mode === "vary") {
    const swapped = trimmed
      .replace(/\bsoft\b/i, "bold")
      .replace(/\bquiet\b/i, "loud")
      .replace(/\bminimal\b/i, "layered");
    return swapped === trimmed
      ? `${trimmed}, alternate angle, shifted palette`
      : `${swapped}, alternate framing`;
  }
  return `${trimmed}, refined detail, tighter crop`;
}

function heuristicCaption(prompt: string): string {
  const words = prompt
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 8);
  if (words.length === 0) return "Abstract composition from prompt";
  const lead = words.slice(0, 4).join(" ");
  const tail = words.slice(4).join(" ");
  return tail ? `${lead}, ${tail}` : lead;
}

async function rewritePrompt(
  prompt: string,
  mode: "iterate" | "vary",
  history: GenerationHistoryEntry[],
): Promise<string> {
  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  if (!ai) return heuristicRewrite(prompt, mode);

  const modeHint =
    mode === "iterate"
      ? "Nudge the prompt slightly: same subject, small refinement."
      : "Vary the prompt more: shift mood, angle, or palette while keeping the theme.";

  let raw: unknown;
  try {
    raw = await ai.run(LLM_MODEL, {
      max_tokens: 120,
      temperature: mode === "iterate" ? 0.35 : 0.65,
      messages: [
        {
          role: "system",
          content:
            "You rewrite image generation prompts for aiu.is. One line only. No greeting, no quotes, no em dashes. Reply with JSON only.",
        },
        {
          role: "user",
          content: `Current prompt: ${prompt}\nPrior captions: ${history
            .slice(-3)
            .map((entry) => entry.caption)
            .join(" | ") || "none"}\n\n${modeHint}\n\nReturn {"prompt":"<rewritten prompt>"}.`,
        },
      ],
    });
  } catch {
    return heuristicRewrite(prompt, mode);
  }

  const parsed = extractJsonObject(runText(raw));
  const next =
    typeof parsed?.prompt === "string"
      ? parsed.prompt.replace(/\s+/g, " ").trim()
      : "";
  return next || heuristicRewrite(prompt, mode);
}

async function writeCaption(prompt: string): Promise<string> {
  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  if (!ai) return heuristicCaption(prompt);

  let raw: unknown;
  try {
    raw = await ai.run(LLM_MODEL, {
      max_tokens: 80,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Write a short image caption (one sentence) describing what the prompt would produce. Plain prose, no em dashes. JSON only.",
        },
        {
          role: "user",
          content: `Prompt: ${prompt}\n\nReturn {"caption":"<caption>"}.`,
        },
      ],
    });
  } catch {
    return heuristicCaption(prompt);
  }

  const parsed = extractJsonObject(runText(raw));
  const caption =
    typeof parsed?.caption === "string"
      ? parsed.caption.replace(/\s+/g, " ").trim()
      : "";
  return caption || heuristicCaption(prompt);
}

/** Text estimate: Noul over prompt vs caption, not pixels. */
async function promptFaithfulness(
  prompt: string,
  caption: string,
): Promise<number | undefined> {
  if (!judgeAvailable()) return undefined;
  const answers = await systemOne(
    { prompt, caption },
    {
      match: noul(
        {
          prompt,
          caption,
          question:
            "Given the prompt and the caption text (not pixels), does the caption faithfully describe what the prompt asked for?",
        },
        {
          true: "The caption matches the prompt intent.",
          false: "There is a gap between the prompt and the caption.",
        },
      ),
    },
  );
  const match = answers?.match;
  if (match?.type === "noul") return match.noul;
  return undefined;
}

function plainControls(): ControlOption[] {
  return (["iterate", "vary", "stop"] as const).map((mode) => ({
    mode,
    label: CONTROL_LABELS[mode],
  }));
}

function rankedControls(
  probabilities: Record<string, number>,
): ControlOption[] {
  return (["iterate", "vary", "stop"] as const)
    .map((mode) => ({
      mode,
      label: CONTROL_LABELS[mode],
      score: probabilities[mode] ?? 0,
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/** Client probe: ranked choice chips need a key. */
export async function imageGenerationJudgeAvailable(): Promise<boolean> {
  "use server";
  return judgeAvailable();
}

export async function suggestControls(input: {
  prompt: string;
  history: GenerationHistoryEntry[];
}): Promise<ControlsResult> {
  "use server";

  const prompt = input.prompt.replace(/\s+/g, " ").trim();
  const history = input.history.filter((entry) => entry.prompt.length > 0);
  const sliders = heuristicSliders(prompt);

  if (!judgeAvailable()) {
    return { judge: false, options: plainControls(), sliders };
  }

  const state = {
    prompt,
    history: history.slice(-4),
    iterationCount: history.length,
  };

  const answers = await systemOne(state, {
    next: choice(
      "What should the reader do with this image generation loop?",
      {
        iterate: "Refine the current result with a small prompt nudge",
        vary: "Try a meaningful variation while keeping the theme",
        stop: "Stop iterating; the result is good enough or further tries are not worth it",
      },
    ),
    shouldStop: noul(
      "Given the prompt, captions so far, and iteration count, should the reader stop iterating?",
      {
        true: "Stopping now is reasonable; further iteration has diminishing returns",
        false: "There is still room to iterate on this prompt/result pair",
      },
    ),
  });

  const next = answers?.next;
  const shouldStop = answers?.shouldStop;

  if (next?.type === "choice") {
    return {
      judge: true,
      options: rankedControls(next.probabilities),
      sliders,
      suggestStop:
        shouldStop?.type === "noul" ? shouldStop.noul >= 0.55 : undefined,
    };
  }

  return {
    judge: false,
    options: plainControls(),
    sliders,
    suggestStop:
      shouldStop?.type === "noul" ? shouldStop.noul >= 0.55 : undefined,
  };
}

export async function runIteration(input: {
  prompt: string;
  mode: "iterate" | "vary";
  sliders?: Record<string, number>;
  prior?: GenerationResult;
}): Promise<IterationResult> {
  "use server";

  const basePrompt = input.prompt.replace(/\s+/g, " ").trim();
  if (!basePrompt) {
    return { kind: "error", message: "Prompt is empty." };
  }

  const history: GenerationHistoryEntry[] = input.prior
    ? [{ prompt: input.prior.prompt, caption: input.prior.caption }]
    : [];

  const withSliders = applySliders(basePrompt, input.sliders);
  const rewritten = await rewritePrompt(withSliders, input.mode, history);
  const caption = await writeCaption(rewritten);
  const promptFaithful = await promptFaithfulness(rewritten, caption);

  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  const model = ai ? "llama-prompt" : "css-tile";

  return {
    kind: "result",
    synthesis: ai ? "llm" : "heuristic",
    result: {
      prompt: rewritten,
      caption,
      tint: tintFromPrompt(rewritten),
      model,
      promptFaithful,
    },
  };
}
