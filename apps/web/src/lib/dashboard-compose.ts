/**
 * Server-only: a language model writes the board, code fills it with real
 * numbers, then the model captions what the numbers say.
 *
 * The model picks metrics, widget kinds, layout, ratios, comparisons and
 * words. It never sees a number before the numbers exist, and captions are
 * written only from a digest of what was fetched.
 */
import { Output, streamText } from "ai";
import { z } from "zod";
import {
  METRICS,
  METRIC_IDS,
  WIDGET_KINDS,
  digest,
  normalizeBoard,
  type Board,
  type MetricId,
  type Resolved,
} from "~/lib/dashboard";
import { resolveWidget, sourcesAvailable } from "~/lib/dashboard-data";

const MODEL = "google/gemini-2.5-flash";

const boardSchema = z.object({
  reading: z.string(),
  title: z.string(),
  range: z.enum(["day", "week", "month"]),
  widgets: z.array(
    z.object({
      kind: z.enum(WIDGET_KINDS as [string, ...string[]]),
      title: z.string(),
      size: z.enum(["s", "m", "l"]),
      metrics: z.array(z.enum(METRIC_IDS as [string, ...string[]])),
      compare: z.boolean().optional(),
      scale: z.number().optional(),
      per: z.string().optional(),
      text: z.string().optional(),
    }),
  ),
});

const captionSchema = z.object({
  headline: z.string(),
  captions: z.array(z.object({ id: z.string(), text: z.string() })),
});

const SYSTEM = `You compose live dashboards for aiu.is, a research site about interfaces for systems that think. A reader types a need; you design the board that answers it from the site's own data. Code fetches every number afterwards. You never write a number yourself.

Always build a board. Read loose, vague, playful or random words generously and find the angle on this site's data that best answers their spirit. "is anyone out there" is visitors and countries. "are we broke" is AI spend against credit left. "vibes" or "banana" is your pick of an interesting, varied board, with a note saying how you read it. If the need asks for something the site cannot know (weather, stock prices, a person's mood), build the nearest honest board from what it has and add a note saying what it cannot see.

Design:
- 3 to 6 widgets, varied kinds. Lead with the answer: the first widget is usually a "number" or "trend" at size l or m.
- Sizes: s is a third of the row, m is half, l is the full row. Fill rows sensibly.
- number: one metric, a series (collapsed over the window) or a scalar. Set compare when change matters (growth, "how are we doing", "more or less than").
- trend: 1 to 3 series metrics with the same unit and a similar scale (never calls with tokens), over time.
- ranking: one breakdown metric.
- ratio: exactly two metrics, numerator then denominator, each a series or scalar. Use scale and per for a readable figure, e.g. ai_spend over visitors, scale 1000, per "per 1k visitors". Derived views like cost per call, tokens per call, spend per chapter make a board feel thought through.
- list: recent_chapters only.
- note: one or two sentences in plain words, no numbers, no metrics. Use it for how you read a loose need or what the site cannot see. At most one.
- Titles are short plain labels or questions, sentence case, no numbers, no trailing period.
- title: the board's name, a few words, in the reader's terms.
- reading: under 12 words, how you read the need, starting "Read as".
- range: day, week or month from the need; week when it names none.

Prefer metrics whose source is available. Use an unavailable one only when the need is centrally about it, and then at most two such widgets; its widget will say what is missing. Fill the rest of the board with the nearest available views (AI calls are a trace of readers using the site's live interfaces; the chapters show what there is to read), so the board always shows something real.

If a current board is given and the need refers to it (more, less, also, instead, remove, bigger, monthly, compare, explain), return the full revised board, keeping what the reader did not ask to change. Otherwise build a new board.`;

function metricCatalog(): string {
  const available = sourcesAvailable();
  return METRIC_IDS.map((id) => {
    const m = METRICS[id];
    const ok = m.sources.some((s) => available[s]);
    return `- ${id} (${m.shape}, ${m.unit}${ok ? "" : ", UNAVAILABLE"}): ${m.about}`;
  }).join("\n");
}

const MAX_UNAVAILABLE = 2;

function unavailableMetrics(): MetricId[] {
  const available = sourcesAvailable();
  return METRIC_IDS.filter((id) => !METRICS[id].sources.some((s) => available[s]));
}

/** A board of empty widgets says nothing; keep the first few and let the rest go. */
function limitUnavailable(board: Board, missing: Set<MetricId>): Board {
  let kept = 0;
  const widgets = board.widgets.filter((w) => {
    if (!w.metrics.some((id) => missing.has(id))) return true;
    kept += 1;
    return kept <= MAX_UNAVAILABLE;
  });
  return { ...board, widgets: widgets.map((w, i) => ({ ...w, id: `w${i}` })) };
}

function describeBoard(board: Board): string {
  return JSON.stringify({
    title: board.title,
    range: board.range,
    widgets: board.widgets.map(({ id: _id, ...w }) => w),
  });
}

export type DashboardEvent =
  | { kind: "draft"; board: Board }
  | { kind: "board"; board: Board }
  | { kind: "data"; id: string; resolved: Resolved }
  | { kind: "captions"; headline: string; captions: Record<string, string> }
  | { kind: "error"; message: string };

export type DashboardRequest = {
  need?: string;
  /** The board on screen; a need may edit it. */
  current?: Board;
  /** Re-fetch this board's numbers without redesigning it; with `need`, recaption too. */
  refresh?: Board;
};

async function* compose(need: string, current: Board | undefined): AsyncGenerator<DashboardEvent, Board | null> {
  const missing = unavailableMetrics();
  const result = streamText({
    model: MODEL,
    system: SYSTEM,
    output: Output.object({ schema: boardSchema }),
    prompt: `Metrics:
${metricCatalog()}

${current ? `Current board: ${describeBoard(current)}\n\n` : ""}${
      missing.length
        ? `Unavailable right now: ${missing.join(", ")}. At most ${MAX_UNAVAILABLE} widgets may use them; build the rest from available metrics.\n\n`
        : ""
    }Need: "${need}"`,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });

  const missingSet = new Set(missing);
  let last: Board | null = null;
  for await (const partial of result.partialOutputStream) {
    const normalized = normalizeBoard(partial, current?.range);
    if (!normalized) continue;
    const board = limitUnavailable(normalized, missingSet);
    last = board;
    yield { kind: "draft", board };
  }
  return last;
}

async function* caption(need: string, board: Board, resolved: Map<string, Resolved>): AsyncGenerator<DashboardEvent> {
  const lines = board.widgets
    .map((w) => `- ${w.id} "${w.title}" (${w.kind}): ${digest(w, resolved.get(w.id))}`)
    .join("\n");
  const result = streamText({
    model: MODEL,
    system: `You caption a live dashboard on aiu.is. Use only the numbers in the digest, copied exactly as written, without quotation marks. Never compute anything: no sums, multiples ("4x"), percentages or averages that are not already in the digest. Plain, specific, calm; no hype, no dashes as punctuation.
- headline: under 14 words, the one thing this board says. Do not repeat a loose or playful need back; say what the numbers show.
- captions: one per widget id except notes and unavailable widgets, under 18 words, what the reader should notice.`,
    output: Output.object({ schema: captionSchema }),
    prompt: `Need: "${need}"
Board: ${board.title} (${board.range})
${lines}`,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });
  for await (const partial of result.partialOutputStream) {
    const captions: Record<string, string> = {};
    for (const c of partial.captions ?? []) {
      if (c?.id && typeof c.text === "string") captions[c.id] = c.text;
    }
    yield { kind: "captions", headline: partial.headline ?? "", captions };
  }
}

/** Resolve widgets in parallel; yield each as it lands. */
async function* fill(board: Board, resolved: Map<string, Resolved>): AsyncGenerator<DashboardEvent> {
  const pending = new Map(
    board.widgets.map((w) => [w.id, resolveWidget(w, board.range).then((r) => ({ id: w.id, r }))]),
  );
  while (pending.size) {
    const { id, r } = await Promise.race(pending.values());
    pending.delete(id);
    resolved.set(id, r);
    yield { kind: "data", id, resolved: r };
  }
}

export async function* dashboardEvents(input: DashboardRequest): AsyncGenerator<DashboardEvent> {
  const resolved = new Map<string, Resolved>();

  const need = (input.need ?? "").replace(/\s+/g, " ").trim().slice(0, 240);

  if (input.refresh) {
    yield* fill(input.refresh, resolved);
    if (need && process.env.AI_GATEWAY_API_KEY) yield* caption(need, input.refresh, resolved);
    return;
  }

  if (!need) {
    yield { kind: "error", message: "Type an analytic." };
    return;
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    yield { kind: "error", message: "The composer needs AI_GATEWAY_API_KEY." };
    return;
  }

  const board = yield* compose(need, input.current);
  if (!board || board.widgets.length === 0) {
    yield { kind: "error", message: "The composer came back empty. Try again." };
    return;
  }
  yield { kind: "board", board };
  yield* fill(board, resolved);
  yield* caption(need, board, resolved);
}
