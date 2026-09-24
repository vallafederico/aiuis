import type { APIEvent } from "@solidjs/start/server";
import { normalizeBoard } from "~/lib/dashboard";
import { dashboardEvents, type DashboardRequest } from "~/lib/dashboard-compose";

function parse(body: unknown): DashboardRequest | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const refresh = normalizeBoard(rec.refresh) ?? undefined;
  const need = typeof rec.need === "string" ? rec.need : undefined;
  if (!refresh && !need) return null;
  return { need, refresh, current: normalizeBoard(rec.current) ?? undefined };
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

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of dashboardEvents(input)) send(event);
      } catch (cause) {
        send({ kind: "error", message: cause instanceof Error ? cause.message : "Stream failed" });
      } finally {
        send({ kind: "done" });
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
