import type { APIEvent } from "@solidjs/start/server";
import {
  draftFromPartial,
  finishSection,
  streamArticleSection,
  type ArticleAside,
  type ArticleForm,
  type ArticlePath,
  type ArticleRequest,
  type ReadingTrace,
} from "~/lib/article-stream";

const FORMS = new Set<ArticleForm>([
  "heading",
  "continuation",
  "note",
  "question",
  "contrast",
  "list",
]);
const PATHS = new Set<ArticlePath>(["advance", "unpack", "instance", "objection", "define"]);

function parse(body: unknown): ArticleRequest | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const reading = rec.reading;
  if (typeof rec.title !== "string" || typeof rec.tail !== "string") return null;
  if (!Array.isArray(rec.headings) || !rec.headings.every((item) => typeof item === "string")) {
    return null;
  }
  if (!reading || typeof reading !== "object") return null;
  const trace = reading as Record<string, unknown>;
  if (
    typeof trace.dwellMs !== "number" ||
    typeof trace.returned !== "boolean" ||
    typeof trace.focus !== "string"
  ) {
    return null;
  }
  const recentForms = Array.isArray(trace.recentForms)
    ? trace.recentForms.filter((item): item is ArticleForm => typeof item === "string" && FORMS.has(item as ArticleForm))
    : [];
  const recentPaths = Array.isArray(trace.recentPaths)
    ? trace.recentPaths.filter((item): item is ArticlePath => typeof item === "string" && PATHS.has(item as ArticlePath))
    : [];
  const parsed: ReadingTrace = {
    dwellMs: Math.max(0, Math.min(trace.dwellMs, 600_000)),
    returned: trace.returned,
    focus: trace.focus.slice(0, 400),
    aimed: trace.aimed === true,
    near: Array.isArray(trace.near)
      ? trace.near
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .slice(0, 3)
          .map((item) => item.slice(0, 500))
      : [],
    recentForms,
    recentPaths,
  };
  let aside: ArticleAside | undefined;
  const rawAside = rec.aside;
  if (rawAside && typeof rawAside === "object") {
    const quote = (rawAside as Record<string, unknown>).quote;
    const around = (rawAside as Record<string, unknown>).around;
    if (typeof quote === "string" && quote.trim()) {
      aside = {
        quote: quote.trim().slice(0, 600),
        around: typeof around === "string" ? around.trim().slice(0, 1200) : "",
      };
    }
  }
  return {
    title: rec.title.slice(0, 200),
    headings: rec.headings.slice(0, 40).map((item) => item.slice(0, 200)),
    tail: rec.tail.slice(-4000),
    reading: parsed,
    aside,
  };
}

export async function POST({ request }: APIEvent) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const input = parse(body);
  if (!input) return new Response("Bad request", { status: 400 });

  let opened: ReturnType<typeof streamArticleSection>;
  try {
    opened = streamArticleSection(input);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unavailable";
    return Response.json({ error: message }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        let last: Parameters<typeof draftFromPartial>[0] | null = null;
        for await (const partial of opened.partialOutputStream) {
          last = partial;
          const block = draftFromPartial(partial, opened.steered);
          if (block) send({ kind: "draft", block });
        }
        const done = last ? finishSection(last, opened.steered) : null;
        if (!done) send({ kind: "error", message: "Empty section" });
        else send({ kind: "done", block: done });
      } catch (cause) {
        send({
          kind: "error",
          message: cause instanceof Error ? cause.message : "Stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
