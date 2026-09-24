import type { APIEvent } from "@solidjs/start/server";
import { drawArticlePlate } from "~/lib/article-image";

function subjectOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const subject = (body as Record<string, unknown>).subject;
  if (typeof subject !== "string") return null;
  const text = subject.replace(/\s+/g, " ").trim().slice(0, 180);
  return text.length >= 8 ? text : null;
}

export async function POST({ request }: APIEvent) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const subject = subjectOf(body);
  if (!subject) return new Response("Bad request", { status: 400 });

  try {
    const src = await drawArticlePlate(subject);
    if (!src) return Response.json({ error: "No image" }, { status: 503 });
    return Response.json({ src });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unavailable";
    return Response.json({ error: message }, { status: 503 });
  }
}
