/**
 * Schematic of Infinite Article: how the reader's attention steers the next
 * section, which Gemini streams in as it writes. Runnable live against the
 * real /api/article-stream.
 */
import type { ArticleBlock, ReadingTrace } from "~/lib/article-stream";
import { MockFrame } from "./Mock";
import { Pipeline, type LiveRun, type PipelineSpec } from "./schematics/Pipeline";
import { postSse } from "./schematics/sse";
import type { UiProps } from "./types";

const PIPELINE: PipelineSpec = {
  stages: [
    {
      steps: [
        {
          role: "reader",
          title: "Reads and aims",
          detail: "Scrolls the essay. How long they stay, whether they go back, and where the pointer rests are all read.",
          meta: "near 140px · up to 40 sections",
          inside: [
            "Scrolling back more than 40px marks the passage as returned to.",
            "The passages nearest the pointer, closest first, go along.",
            "Selecting text asks for a margin note instead.",
          ],
          file: "uis/directed/InfiniteArticle.tsx",
        },
      ],
      out: "reading trace + title, headings, last passage",
    },
    {
      steps: [
        {
          role: "code",
          title: "Steer",
          detail: "Picks the path and the allowed forms from how the last part was read, before the model sees anything.",
          meta: "linger ≥ 18s · skim < 7s",
          inside: [
            "Linger or go back: unpack, instance, objection or define, and no new heading.",
            "Skim: advance, as a continuation or a question.",
            "Paths: advance, unpack, instance, objection, define.",
          ],
          file: "lib/article-stream.ts",
        },
      ],
      out: "path + forms, written into the prompt",
    },
    {
      steps: [
        {
          role: "llm",
          title: "Writes the section",
          detail: "Streams one structured section. The draft paints while it is still being written.",
          meta: "google/gemini-2.5-flash · ai gateway · streamed",
          inside: [
            "Forms: heading, continuation, note, question, contrast, list.",
            "Only the last 4000 characters of the essay are sent.",
            "The voice forbids invented sources, numbers and dashes.",
            "No AI_GATEWAY_API_KEY: the endpoint answers 503.",
          ],
          file: "lib/article-stream.ts",
        },
      ],
      out: "a finished section, appended",
    },
    {
      steps: [
        {
          role: "image",
          title: "Draws a plate",
          detail: "Every third section gets a blue pencil plate drawn from its subject.",
          meta: "google/gemini-3.1-flash-image · 2 tries",
          inside: ["Non-blue pixels are snapped to the paper colour.", "A failed plate simply leaves no gap."],
          file: "lib/article-image.ts",
        },
        {
          role: "llm",
          title: "Margin note",
          detail: "A selection asks the same endpoint for a short note beside it.",
          meta: "form note · path unpack",
          inside: ["Placed left or right at random.", "Selecting again cancels the note in flight."],
          file: "uis/directed/InfiniteArticle.tsx",
        },
      ],
      out: "plate and notes, alongside",
    },
    {
      steps: [
        {
          role: "code",
          title: "Waits",
          detail: "Arms again only once the reader leaves the end and comes back to it.",
          inside: ["Three failed streams stop the essay.", "It stops for good after 40 sections."],
          file: "uis/directed/InfiniteArticle.tsx",
        },
      ],
    },
  ],
  loop: "reaching the end again writes the next section",
};

type ArticleEvent = { kind: "draft" | "done"; block: ArticleBlock } | { kind: "error"; message: string };

const clip = (text: string, n = 120) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

function firstLine(block: ArticleBlock): string {
  return block.heading ?? block.paragraphs[0] ?? block.items?.[0] ?? block.left ?? "";
}

const LIVE: LiveRun = {
  label: "run it: continue from a passage",
  placeholder: "paste or write a passage to continue from",
  examples: [
    "A button promised the system was fast and certain. A model is neither.",
    "Silence is an answer when the system is not sure.",
  ],
  run: async (tail, mark, signal) => {
    const reading: ReadingTrace = {
      dwellMs: 12_000,
      returned: false,
      aimed: false,
      near: [],
      focus: tail.slice(0, 200),
      recentForms: [],
      recentPaths: [],
    };
    mark(0, "done", "a steady read of your passage");
    mark(1, "active", "steering…");
    let failure: string | null = null;
    let steered = false;
    await postSse<ArticleEvent>(
      "/api/article-stream",
      { title: "Infinite Article", headings: [], tail, reading },
      signal,
      (event) => {
        if (event.kind === "error") {
          failure = event.message;
          return;
        }
        if (!steered) {
          steered = true;
          mark(1, "done", `path ${event.block.path} · form ${event.block.form}`);
        }
        mark(2, event.kind === "done" ? "done" : "active", clip(firstLine(event.block)));
      },
    );
    if (failure) throw new Error(failure);
    mark(3, "skip", "plates and notes happen in the component");
    mark(4, "done", "open the component to keep reading");
  },
};

export default function InfiniteArticle(_props: UiProps) {
  return (
    <MockFrame name="infinite-article" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} live={LIVE} />
    </MockFrame>
  );
}
