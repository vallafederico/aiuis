/**
 * TypeSafe System One (Jev) — the site's judgment layer.
 *
 * Server-side only: import this inside "use server" functions. Reads
 * TYPESAFE_API_KEY, else AI_GATEWAY_API_KEY, from process.env like cms.ts.
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

const TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 800;

/**
 * TypeSafe direct, or Jev on the Vercel AI Gateway. The gateway calls a
 * noul `boolean` and answers with `probability`; `systemOne` maps both ways
 * so callers only ever see nouls.
 */
type Endpoint = { url: string; model: string; key: string; gateway: boolean };

function readEnv(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value?.trim() || undefined;
}

function endpoint(): Endpoint | undefined {
  const direct = readEnv("TYPESAFE_API_KEY");
  if (direct) {
    return {
      url: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
      key: direct,
      gateway: false,
    };
  }
  const gateway = readEnv("AI_GATEWAY_API_KEY");
  if (gateway) {
    return {
      url: "https://ai-gateway.vercel.sh/v1/evaluate",
      model: "typesafe-ai/jev",
      key: gateway,
      gateway: true,
    };
  }
  return undefined;
}

export function judgeAvailable(): boolean {
  return Boolean(endpoint());
}

type WireAnswer =
  | ChoiceAnswer
  | NoulAnswer
  | { type: "boolean"; probability: number };

function toWire(questions: Record<string, ChoiceQuestion | NoulQuestion>) {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      question.type === "noul" ? { ...question, type: "boolean" } : question,
    ]),
  );
}

function fromWire(answers: Record<string, WireAnswer>): Record<string, ChoiceAnswer | NoulAnswer> {
  return Object.fromEntries(
    Object.entries(answers).map(([id, answer]) => [
      id,
      answer.type === "boolean" ? { type: "noul", noul: answer.probability } : answer,
    ]),
  );
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
 * Retries once on 429/502/503/529.
 */
export async function systemOne(
  state: unknown,
  questions: Record<string, ChoiceQuestion | NoulQuestion>,
): Promise<Record<string, ChoiceAnswer | NoulAnswer> | null> {
  const target = endpoint();
  if (!target) return null;

  const body = JSON.stringify({
    state,
    model: target.model,
    questions: target.gateway ? toWire(questions) : questions,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(target.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.key}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if ([429, 502, 503, 529].includes(response.status)) {
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
        answers?: Record<string, WireAnswer>;
      };
      return parsed.answers ? fromWire(parsed.answers) : null;
    } catch (error) {
      console.warn("judge: systemOne unreachable", error);
      return null;
    }
  }
  return null;
}
