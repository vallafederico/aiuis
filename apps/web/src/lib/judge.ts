/**
 * TypeSafe System One (Jev) — the site's judgment layer.
 *
 * Server-side only: import this inside "use server" functions. Reads
 * TYPESAFE_API_KEY the same way cms.ts reads its env (process.env).
 * Batch every question for a given state into ONE systemOne call —
 * questions run in parallel on the API side.
 */

export type ChoiceQuestion = {
  type: "choice";
  instructions: string | object;
  /** One entry per option; value is a description or null when the state carries the text. */
  criteria: Record<string, string | null>;
};

export type NoulQuestion = {
  type: "noul";
  instructions: string | object;
  criteria?: { true: string; false: string };
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type NoulAnswer = {
  type: "noul";
  /** Probability of yes, 0..1. */
  noul: number;
};

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 800;

function apiKey(): string | undefined {
  const value =
    typeof process !== "undefined" ? process.env.TYPESAFE_API_KEY : undefined;
  return value?.trim() || undefined;
}

export function judgeAvailable(): boolean {
  return Boolean(apiKey());
}

export function choice(
  instructions: string | object,
  criteria: Record<string, string | null>,
): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

export function noul(
  instructions: string | object,
  criteria?: { true: string; false: string },
): NoulQuestion {
  return { type: "noul", instructions, criteria };
}

/**
 * One judgment request. Returns null on missing key or any failure —
 * callers treat null as "no judgment" and keep their fallback path.
 * Retries once on 429/529.
 */
export async function systemOne(
  state: unknown,
  questions: Record<string, ChoiceQuestion | NoulQuestion>,
): Promise<Record<string, ChoiceAnswer | NoulAnswer> | null> {
  const key = apiKey();
  if (!key) return null;

  const body = JSON.stringify({ state, model: MODEL, questions });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 429 || response.status === 529) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
          continue;
        }
        console.warn(`judge: systemOne rate limited (${response.status})`);
        return null;
      }

      if (!response.ok) {
        console.warn(`judge: systemOne failed (${response.status})`);
        return null;
      }

      const parsed = (await response.json()) as {
        answers?: Record<string, ChoiceAnswer | NoulAnswer>;
      };
      return parsed.answers ?? null;
    } catch (error) {
      console.warn("judge: systemOne unreachable", error);
      return null;
    }
  }
  return null;
}
