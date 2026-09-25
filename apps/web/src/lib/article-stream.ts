import { Output, streamText } from "ai";
import { z } from "zod";

const MODEL = "google/gemini-2.5-flash";

const VOICE = `You write the next piece of an endless essay on aiu.is, a research site about interfaces for systems that think, or seem to.

Voice: a scientific essay with a writer's ear. The first sentence of a paragraph is the claim; argue it. The reader is technical. Sentences under 40 words.

Craft: ground claims in something the reader can see (a spinner, a caret, a frame, an exact duration) before the abstraction. When a number reframes the problem, build it in one full sentence and land it in a short one. Let a long accumulating sentence be followed by a short one that says what it means. Lists of three. When the reader probably believes something wrong, name the belief, then correct it. Contrast the small with the large: one token, one hover, and what it carries. At most one dry aside, no sarcasm, no hype. No em dashes and no en dashes as punctuation: use periods, commas, colons, or parentheses. No marketing language (never: synergy, cutting-edge, next-generation, seamless, leverage, utilize, game-changer). Do not announce what you will say, do not summarise what came before, do not close by restating. Do not perform excitement.

Citations: only when you are certain the work exists (for example Clark and Chalmers 1998, Norman 1988, Shneiderman 1983, Weiser 1991, Suchman 1987, Gibson 1979). Name the author and year in the sentence. Never invent a source, a quotation, a number, or a finding. If unsure, make the claim as the author's own design judgment instead.

Themes to move between, never repeating a point already made: judgment versus generation, selecting before generating, silence when confidence is low, calibration and latency, attribution, representing a thinking process on screen, restraint, scope as model context, stopping as a first-class act.`;

export type ArticleForm =
  | "heading"
  | "continuation"
  | "note"
  | "question"
  | "contrast"
  | "list";

export type ArticlePath = "advance" | "unpack" | "instance" | "objection" | "define";

export type ArticleBlock = {
  form: ArticleForm;
  path: ArticlePath;
  heading?: string;
  paragraphs: string[];
  items?: string[];
  leftLabel?: string;
  left?: string;
  rightLabel?: string;
  right?: string;
};

export type ReadingTrace = {
  /** Milliseconds the reader spent with the latest section before asking for more. */
  dwellMs: number;
  /** They scrolled back up before asking for more. */
  returned: boolean;
  /** The pointer is beside an earlier passage, not the one just written. */
  aimed: boolean;
  /** Passages nearest the pointer, closest first. */
  near: string[];
  /** The stretch they were actually on, heading or opening line. */
  focus: string;
  recentForms: ArticleForm[];
  recentPaths: ArticlePath[];
};

const sectionSchema = z.object({
  form: z.enum(["heading", "continuation", "note", "question", "contrast", "list"]),
  path: z.enum(["advance", "unpack", "instance", "objection", "define"]),
  heading: z.string().optional(),
  paragraphs: z.array(z.string()).optional(),
  items: z.array(z.string()).optional(),
  leftLabel: z.string().optional(),
  left: z.string().optional(),
  rightLabel: z.string().optional(),
  right: z.string().optional(),
});

const FORMS: ArticleForm[] = [
  "heading",
  "continuation",
  "note",
  "question",
  "contrast",
  "list",
];
/** Body sections never use the note form. A note is only the margin beside a selection. */
const BODY_FORMS: ArticleForm[] = ["heading", "continuation", "question", "contrast", "list"];
const PATHS: ArticlePath[] = ["advance", "unpack", "instance", "objection", "define"];

function clean(text: string) {
  return text.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim();
}

/** Mid-stream: drop dashes, keep the tail so words don't jump. */
function soften(text: string) {
  return text.replace(/\s*[\u2014\u2013]\s*/g, ", ");
}

function asForm(value: string | undefined): ArticleForm | null {
  return FORMS.includes(value as ArticleForm) ? (value as ArticleForm) : null;
}

/** What the reading allows. Linger and return stay on the last point and change the form. */
function steer(reading: ReadingTrace): { path: ArticlePath; forms: ArticleForm[] } {
  const recentForms = reading.recentForms.slice(-2);
  const recentPaths = reading.recentPaths.slice(-2);
  const headingRecently = recentForms.includes("heading");
  const linger = reading.aimed || reading.returned || reading.dwellMs >= 18_000;
  const skim = !reading.aimed && !reading.returned && reading.dwellMs < 7_000;

  if (linger) {
    const path =
      (["unpack", "instance", "objection", "define"] as const).find(
        (item) => !recentPaths.includes(item),
      ) ?? "instance";
    const forms = (["question", "contrast", "list", "continuation"] as const).filter(
      (form) => !recentForms.includes(form),
    );
    return { path, forms: forms.length > 0 ? [...forms] : ["continuation"] };
  }

  if (skim) {
    return {
      path: "advance",
      forms: recentForms.includes("continuation") ? ["question"] : ["continuation"],
    };
  }

  const path =
    PATHS.find((item) => !recentPaths.includes(item)) ?? "advance";
  const forms = BODY_FORMS.filter((form) => {
    if (recentForms.includes(form)) return false;
    if (form === "heading" && headingRecently) return false;
    return true;
  });
  return { path, forms: forms.length > 0 ? forms : ["continuation"] };
}

function normalize(
  raw: z.infer<typeof sectionSchema>,
  steered: { path: ArticlePath; forms: ArticleForm[] },
): ArticleBlock | null {
  const paragraphs = (raw.paragraphs ?? []).map(clean).filter(Boolean).slice(0, 3);
  const items = (raw.items ?? []).map(clean).filter(Boolean).slice(0, 4);
  const heading = clean(raw.heading ?? "");
  const left = clean(raw.left ?? "");
  const right = clean(raw.right ?? "");
  let form = asForm(raw.form) ?? steered.forms[0]!;
  if (!steered.forms.includes(form)) form = steered.forms[0]!;
  const path = steered.path;

  if (form === "contrast" && left && right) {
    return {
      form,
      path,
      leftLabel: clean(raw.leftLabel ?? "") || "One side",
      left,
      rightLabel: clean(raw.rightLabel ?? "") || "The other",
      right,
      paragraphs: [],
    };
  }
  if (form === "list" && items.length >= 2) {
    return { form, path, heading: heading || undefined, items, paragraphs: [] };
  }
  if (form === "question" && heading && paragraphs.length > 0) {
    return { form, path, heading, paragraphs: paragraphs.slice(0, 2) };
  }
  if (form === "note" && (paragraphs[0] || items[0])) {
    return { form, path, paragraphs: [paragraphs[0] || items[0]!] };
  }
  if (form === "heading" && heading && paragraphs.length > 0) {
    return { form, path, heading, paragraphs };
  }
  if (paragraphs.length > 0) {
    return { form: "continuation", path, paragraphs: paragraphs.slice(0, 2) };
  }
  if (items.length > 0) {
    return { form: "list", path, items, paragraphs: [] };
  }
  return null;
}

export type ArticleAside = {
  /** The words the reader left selected. */
  quote: string;
  /** The passage those words sit in. */
  around: string;
};

export type ArticleRequest = {
  title: string;
  headings: string[];
  tail: string;
  reading: ReadingTrace;
  /** Set when the reader left a selection. The reply is a margin note, not a next section. */
  aside?: ArticleAside;
};

type PartialSection = {
  form?: string;
  heading?: string;
  paragraphs?: string[];
  items?: string[];
  leftLabel?: string;
  left?: string;
  rightLabel?: string;
  right?: string;
};

/** A block the page can paint before the model has finished the object. */
export function draftFromPartial(
  raw: PartialSection,
  steered: { path: ArticlePath; forms: ArticleForm[] },
): ArticleBlock | null {
  let form = asForm(raw.form) ?? steered.forms[0]!;
  if (!steered.forms.includes(form)) form = steered.forms[0]!;
  const heading = soften(raw.heading ?? "");
  const paragraphs = (raw.paragraphs ?? []).map((item) => soften(item ?? "")).filter((item) => item.trim());
  const items = (raw.items ?? []).map((item) => soften(item ?? "")).filter((item) => item.trim());
  const left = soften(raw.left ?? "");
  const right = soften(raw.right ?? "");
  const visible =
    heading.trim() ||
    paragraphs.some((item) => item.trim()) ||
    items.some((item) => item.trim()) ||
    left.trim() ||
    right.trim();
  if (!visible) return null;
  return {
    form,
    path: steered.path,
    heading: heading.trim() ? heading : undefined,
    paragraphs,
    items: items.length > 0 ? items : undefined,
    leftLabel: soften(raw.leftLabel ?? "").trim() || undefined,
    left: left.trim() ? left : undefined,
    rightLabel: soften(raw.rightLabel ?? "").trim() || undefined,
    right: right.trim() ? right : undefined,
  };
}

/** A margin note beside a selection: one short paragraph, nothing else. */
function streamAside(input: ArticleRequest) {
  const steered = { path: "unpack" as const, forms: ["note"] as ArticleForm[] };
  const quote = input.aside?.quote ?? "";
  const around = input.aside?.around || quote;
  const result = streamText({
    model: MODEL,
    system: VOICE,
    output: Output.object({ schema: sectionSchema }),
    prompt: `Essay title: ${input.title}

The reader selected this and left it selected:
"${quote}"

The passage it sits in:
${around}

Write a margin note beside that passage. Explain or expand what they selected. Two or three sentences, one paragraph, no heading. Do not repeat their words back. Do not summarise the essay.
Form: note.
Path: unpack.
Leave unused strings empty and unused arrays empty.`,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });
  return { steered, partialOutputStream: result.partialOutputStream };
}

/** Streams partial sections, then a finished block, as the model writes. */
export function streamArticleSection(input: ArticleRequest) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("Missing AI_GATEWAY_API_KEY");
  }
  if (input.aside?.quote) return streamAside(input);
  const steered = steer(input.reading);
  const linger = input.reading.aimed || input.reading.returned || input.reading.dwellMs >= 18_000;
  const beside = input.reading.near.filter(Boolean).slice(0, 3);
  const result = streamText({
    model: MODEL,
    system: VOICE,
    output: Output.object({ schema: sectionSchema }),
    prompt: `Essay title: ${input.title}

Section headings so far (do not repeat these points):
${input.headings.map((h) => `- ${h}`).join("\n")}

The last part the reader read:
${input.tail.slice(-2400)}

How they read it: ${
      input.reading.aimed
        ? "their pointer is beside an earlier passage"
        : input.reading.returned
          ? "they scrolled back"
          : input.reading.dwellMs >= 18_000
            ? "they stayed with it"
            : input.reading.dwellMs < 7_000
              ? "they moved through it quickly"
              : "they read it at a steady pace"
    }.
Passages nearest the pointer, closest first:
${beside.length > 0 ? beside.map((line) => `- ${line}`).join("\n") : "- (the pointer is not beside a passage)"}
The stretch to write from: ${beside[0] || input.reading.focus || "(the last paragraphs)"}

Write one next piece, not a menu.
Path (required): ${steered.path}.
${
  steered.path === "advance"
    ? "Move the argument somewhere it has not been."
    : steered.path === "unpack"
      ? "Stay on that stretch and say it more carefully. Do not open a new topic."
      : steered.path === "instance"
        ? "Stay on that stretch and give one concrete interface case. Do not open a new topic."
        : steered.path === "objection"
          ? "Stay on that stretch. Give the serious counter, then the reply. Do not open a new topic."
          : "Stay on that stretch and define the term it depended on. Do not open a new topic."
}
Form: one of ${steered.forms.join(", ")}.
${linger ? "Do not use a heading-plus-paragraphs section." : "Do not repeat a form already used in the last sections."}

Field rules:
- heading: sentence-case heading, no trailing period, plus 2 paragraphs.
- continuation: no heading. 1 or 2 paragraphs that keep going.
- note: no heading. One short paragraph.
- question: heading is the question. One paragraph answers it.
- contrast: leftLabel, left, rightLabel, right. Each side is one sentence. Labels are two or three words.
- list: 3 or 4 items, each one sentence. Heading only if it earns its place.
Leave unused strings empty and unused arrays empty.`,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });
  return { steered, partialOutputStream: result.partialOutputStream };
}

export function finishSection(
  raw: PartialSection,
  steered: { path: ArticlePath; forms: ArticleForm[] },
): ArticleBlock | null {
  return normalize(
    {
      form: asForm(raw.form) ?? steered.forms[0]!,
      path: steered.path,
      heading: raw.heading,
      paragraphs: raw.paragraphs,
      items: raw.items,
      leftLabel: raw.leftLabel,
      left: raw.left,
      rightLabel: raw.rightLabel,
      right: raw.right,
    },
    steered,
  );
}
