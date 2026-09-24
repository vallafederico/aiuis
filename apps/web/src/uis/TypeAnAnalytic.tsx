/**
 * Schematic of Type an Analytic: the pipeline from a typed need to a
 * captioned board, runnable live against /api/dashboard. The dashboard itself
 * is the directed component (directed/TypeAnAnalytic.tsx).
 */
import type { Board } from "~/lib/dashboard";
import { MockFrame } from "./Mock";
import { Pipeline, type LiveRun, type PipelineSpec } from "./schematics/Pipeline";
import { postSse } from "./schematics/sse";
import type { UiProps } from "./types";
import "./TypeAnAnalytic.css";

const PIPELINE: PipelineSpec = {
  stages: [
    {
      steps: [
        {
          role: "reader",
          title: "Types a need",
          detail: "Any words. The board on screen goes along, so a follow-up edits it.",
          inside: ["Up to 240 characters.", "The current board is sent as `current`; the composer revises it when the need refers to it."],
          file: "uis/directed/TypeAnAnalytic.tsx",
        },
      ],
      out: "need + current board",
    },
    {
      steps: [
        {
          role: "llm",
          title: "Composer",
          detail:
            "Writes the board: title, reading, range, 3–6 widgets, their kind and size, ratios, comparisons. Sees metric names, never numbers.",
          meta: "gemini 2.5 flash · structured output · streamed",
          inside: [
            "Reads a catalog of 22 metrics, each marked UNAVAILABLE when its source has no key.",
            "Told to read loose or random words generously and never refuse.",
            "An impossible ask gets the nearest honest board plus a note.",
            "Thinking budget 0, so drafts start streaming within a second.",
          ],
          file: "lib/dashboard-compose.ts",
        },
      ],
      out: "board spec, streamed as tiles form",
    },
    {
      steps: [
        {
          role: "code",
          title: "Guard",
          detail: "Keeps known metrics and widget kinds that fit them. At most 8 widgets, at most 2 on a missing source.",
          inside: [
            "normalizeBoard drops unknown metrics and shapes that do not fit the widget kind.",
            "A ratio needs exactly two metrics; a trend takes up to three.",
            "limitUnavailable keeps the first 2 widgets on a missing source (MAX_UNAVAILABLE).",
          ],
          file: "lib/dashboard.ts",
        },
      ],
      out: "widgets, fetched in parallel",
    },
    {
      steps: [
        {
          role: "source",
          title: "Cloudflare",
          detail: "Visitors, pages, countries, devices, threats, Workers AI neurons.",
          meta: "graphql analytics",
          inside: [
            "httpRequests1dGroups, or 1hGroups for 24h.",
            "Pages and devices come from sampled adaptive groups, html only.",
            "Needs CF_API_TOKEN; zone and account are looked up from the host.",
          ],
          file: "lib/dashboard-data.ts",
        },
        {
          role: "source",
          title: "AI Gateway",
          detail: "Spend, calls and tokens by day and model; credit left.",
          meta: "spend report · credits",
          inside: ["gateway.getSpendReport grouped by day or model.", "gateway.getCredits for balance and total used."],
          file: "lib/dashboard-data.ts",
        },
        {
          role: "source",
          title: "Content",
          detail: "Chapters, sections, tags, last updates.",
          meta: "cms catalog",
          inside: ["listSeoPieces: the published chapters.", "Needs no key, so a board always has something real."],
          file: "lib/dashboard-data.ts",
        },
      ],
      out: "real numbers, per widget as each lands · 5 min cache",
    },
    {
      steps: [
        {
          role: "code",
          title: "Digest",
          detail: "Each widget's numbers as one line of text, with the change against the period before.",
          inside: ["compare fetches the window just before, same length.", "Changes are written as +12% or −8% so the captioner can copy them."],
          file: "lib/dashboard.ts",
        },
      ],
      out: "digest",
    },
    {
      steps: [
        {
          role: "llm",
          title: "Captioner",
          detail: "A headline and one caption per widget. May copy a number from the digest, may not compute one.",
          meta: "gemini 2.5 flash · streamed",
          inside: ["No sums, multiples or percentages that are not already in the digest.", "Notes and unavailable widgets get no caption."],
          file: "lib/dashboard-compose.ts",
        },
      ],
      out: "headline + captions",
    },
    {
      steps: [
        {
          role: "reader",
          title: "Reads the board",
          detail: "It forms, fills, then speaks. Range buttons re-fetch and recaption without redesigning.",
          file: "uis/directed/TypeAnAnalytic.tsx",
        },
      ],
    },
  ],
  loop: "the next need goes back to the composer with this board",
};

type DashEvent =
  | { kind: "draft" | "board"; board: Board }
  | { kind: "data"; id: string }
  | { kind: "captions"; headline: string }
  | { kind: "error"; message: string }
  | { kind: "done" };

const LIVE: LiveRun = {
  label: "run it",
  placeholder: "type a need, watch it go through",
  examples: ["are we broke", "is anyone out there?", "banana"],
  run: async (need, mark, signal) => {
    mark(0, "done", `“${need}”`);
    mark(1, "active", "writing the board…");
    let widgets = 0;
    let landed = 0;
    let failure: string | null = null;
    await postSse<DashEvent>("/api/dashboard", { need }, signal, (event) => {
      if (event.kind === "draft") {
        mark(1, "active", `“${event.board.title || "…"}”, ${event.board.widgets.length} widgets so far`);
      } else if (event.kind === "board") {
        widgets = event.board.widgets.length;
        mark(1, "done", `“${event.board.title}” · ${event.board.reading ?? ""}`);
        mark(2, "done", event.board.widgets.map((w) => `${w.kind}(${w.metrics.join(" / ") || "text"})`).join(", "));
        mark(3, "active", `0 of ${widgets} fetched`);
      } else if (event.kind === "data") {
        landed += 1;
        mark(3, landed >= widgets ? "done" : "active", `${landed} of ${widgets} fetched`);
        if (landed >= widgets) mark(4, "done", "numbers written out as one line per widget");
      } else if (event.kind === "captions") {
        mark(5, "active", event.headline ? `“${event.headline}”` : "captioning…");
      } else if (event.kind === "error") {
        failure = event.message;
      }
    });
    if (failure) throw new Error(failure);
    mark(5, "done");
    mark(6, "done", "open the component to see the board");
  },
};

export default function TypeAnAnalytic(_props: UiProps) {
  return (
    <MockFrame name="type-an-analytic" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} live={LIVE} />
    </MockFrame>
  );
}
