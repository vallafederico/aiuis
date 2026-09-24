/**
 * Schematic of FAQs: an asked question goes through an exact match, a Jev
 * duplicate gate, retrieval over the site's paragraphs, then a short answer
 * that names its source. Runnable live through the real askFaq.
 */
import { SEED_FAQS, askFaq } from "~/lib/faq";
import { MockFrame } from "./Mock";
import { Pipeline, type LiveRun, type PipelineSpec } from "./schematics/Pipeline";
import type { UiProps } from "./types";

const PIPELINE: PipelineSpec = {
  stages: [
    {
      steps: [
        {
          role: "reader",
          title: "Asks",
          detail: "Types into the last row. A pending row opens where the answer will land.",
          meta: "max 240 characters · remembered in this browser",
          inside: [
            "The first letter is sentence-cased.",
            "The questions already on the list go along as { id, question }.",
            "Up to 32 extra answers are remembered (FAQ_MEMORY_LIMIT).",
          ],
          file: "uis/directed/Faqs.tsx",
        },
      ],
      out: "question + the questions already listed",
    },
    {
      steps: [
        {
          role: "code",
          title: "Exact match",
          detail: "The same words, case and spacing aside, open the existing row instead.",
          inside: ["Empty asks and asks over 240 characters stop here with a short reply.", "An exact hit skips every model."],
          file: "lib/faq.ts",
        },
      ],
      out: "no exact match",
    },
    {
      steps: [
        {
          role: "jev",
          title: "Duplicate gate",
          detail: "One judgment: does an existing question already ask this, and which one?",
          meta: "jev · choice + noul · one call",
          inside: [
            "Accepted when duplicate ≥ 0.7 and the pick's confidence ≥ 0.5.",
            "Up to 250 existing questions are options, plus none.",
            "Without TYPESAFE_API_KEY, or on any failure, it falls through to answering.",
          ],
          file: "lib/faq.ts",
        },
      ],
      out: "not a duplicate: answer it",
    },
    {
      steps: [
        {
          role: "source",
          title: "Find passages",
          detail: "Searches the published paragraphs; falls back to the CMS search.",
          meta: "find index · 5 min cache · top 4",
          inside: [
            "A hit is citable when its exists score ≥ 0.35.",
            "CMS passages must be at least 120 characters.",
            "Weak hits can still inform the answer; they are just not quoted.",
          ],
          file: "lib/faq.ts",
        },
        {
          role: "jev",
          title: "Rank paragraphs",
          detail: "Inside Find: a choice over paragraph ids and an exists gate.",
          meta: "jev · or literal match without a key",
          inside: ["Paragraphs go in as P042| text lines.", "The top 5 by probability come back.", "No key: a literal substring match."],
          file: "lib/find.ts",
        },
      ],
      out: "passages, and whether they can be cited",
    },
    {
      branch: true,
      steps: [
        {
          role: "llm",
          title: "Answer",
          detail: "Restates the answer from the passages and a short site brief, or says it is not covered.",
          meta: "@cf/meta/llama-3.2-3b-instruct · workers ai · 320 tokens",
          inside: [
            "The brief is the seed answers plus up to 16 chapter summaries.",
            "Answers that read like a refusal are thrown away.",
            "Runs on Workers AI's free daily neurons.",
          ],
          file: "lib/faq.ts",
        },
        {
          role: "code",
          title: "Cite",
          detail: "No model or a failed answer: quote the best citable passage and name it.",
          inside: ["Nothing citable and not about the site: “That's outside what this site is about.”", "The answer always ends “From <chapter>.”"],
          file: "lib/faq.ts",
        },
      ],
      out: "a new question and its answer",
    },
    {
      steps: [
        {
          role: "reader",
          title: "Reads",
          detail: "The pending row fills. The cited chapter becomes a link.",
          inside: ["A duplicate simply opens the existing row.", "On load, the seed answers are re-answered from the current index."],
          file: "uis/directed/Faqs.tsx",
        },
      ],
    },
  ],
  loop: "the next question goes back through the same gates",
};

const clip = (text: string, n = 110) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

const LIVE: LiveRun = {
  label: "run it",
  placeholder: "ask the site something",
  examples: ["What is this site?", "why do buttons fail with models?", "what's the best pizza in Naples"],
  run: async (question, mark) => {
    mark(0, "done", `“${question}”`);
    mark(1, "active", "waiting for the server…");
    const result = await askFaq({
      question,
      existing: SEED_FAQS.map(({ id, question: q }) => ({ id, question: q })),
    });
    if (result.kind === "match") {
      const hit = SEED_FAQS.find((item) => item.id === result.id);
      const exact = hit && hit.question.trim().toLowerCase() === question.trim().toLowerCase();
      if (exact) {
        mark(1, "done", `exact match: “${hit!.question}”`);
        mark(2, "skip");
      } else {
        mark(1, "done", "no exact match");
        mark(2, "done", `duplicate of “${hit?.question ?? result.id}”`);
      }
      mark(3, "skip");
      mark(4, "skip");
      mark(5, "done", "opens the existing row");
      return;
    }
    mark(1, "done", "no exact match");
    mark(2, "done", "not a duplicate");
    if (result.kind === "error") {
      mark(3, "done");
      mark(4, "done", result.message);
      mark(5, "skip");
      return;
    }
    mark(3, "done");
    mark(4, "done", clip(result.answer));
    mark(5, "done", `a new row: “${result.question}”`);
  },
};

export default function Faqs(_props: UiProps) {
  return (
    <MockFrame name="faqs" class="max-h-[80svh] w-grids-5">
      <Pipeline spec={PIPELINE} live={LIVE} />
    </MockFrame>
  );
}
