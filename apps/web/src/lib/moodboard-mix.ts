"use server";

import { generateText } from "ai";
import { getRequestEvent } from "solid-js/web";

const MODEL = "google/gemini-3.1-flash-image";

// The editorial / clothed / no-weapons framing matters: without it Google's
// image safety filter randomly blocks about half the blends of this set.
const MIX_PROMPT =
  "Art-directed fashion editorial. Blend these two photos into one new tasteful image that sits exactly between them: an equal mix of their styling, colour and composition, one scene, not a collage. Adults, fully clothed, no weapons.";

/** The safety filter is random per call, so a blocked blend gets one more try. */
const MAX_ATTEMPTS = 2;

/** Gemini output ratios we pick from, matched to the pair's average aspect (w / h). */
const RATIOS = [
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["4:3", 4 / 3],
  ["2:3", 2 / 3],
  ["3:2", 3 / 2],
  ["4:5", 4 / 5],
  ["5:4", 5 / 4],
] as const;

function closestRatio(aspect: number) {
  let best: (typeof RATIOS)[number] = RATIOS[0];
  for (const r of RATIOS) {
    if (Math.abs(Math.log(r[1] / aspect)) < Math.abs(Math.log(best[1] / aspect))) best = r;
  }
  return best[0];
}

function mediaTypeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    default:
      return "image/jpeg";
  }
}

function parseDataUrl(src: string): { data: Uint8Array; mediaType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(src);
  if (!match) return null;
  const buf = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  return { data: new Uint8Array(buf), mediaType: match[1]! };
}

async function loadImageBytes(
  src: string,
): Promise<{ data: Uint8Array; mediaType: string } | { error: string }> {
  if (!src) return { error: "Empty image source" };

  if (src.startsWith("data:")) {
    return parseDataUrl(src) ?? { error: "Invalid data URL" };
  }

  let url = src;
  if (src.startsWith("/")) {
    const base = getRequestEvent()?.request.url ?? "http://127.0.0.1:3000";
    url = new URL(src, base).href;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `Failed to load image (${res.status})` };
    const mediaType =
      res.headers.get("content-type")?.split(";")[0]?.trim() || mediaTypeFromPath(url);
    return { data: new Uint8Array(await res.arrayBuffer()), mediaType };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { error: `Failed to fetch image: ${message}` };
  }
}

/**
 * Blend two reference images at the smallest output Gemini offers.
 * Refs should arrive already downscaled (the client sends ~512px JPEG data URLs).
 */
export async function mixMoodboardPair(input: {
  srcA: string;
  srcB: string;
  /** Average w / h of the pair; picks the output ratio. */
  aspect?: number;
}): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  try {
    if (!process.env.AI_GATEWAY_API_KEY) {
      return { ok: false, error: "Missing AI_GATEWAY_API_KEY" };
    }

    const [a, b] = await Promise.all([loadImageBytes(input.srcA), loadImageBytes(input.srcB)]);
    if ("error" in a) return { ok: false, error: a.error };
    if ("error" in b) return { ok: false, error: b.error };

    let reason = "no image";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await generateText({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: MIX_PROMPT },
              { type: "file", data: a.data, mediaType: a.mediaType },
              { type: "file", data: b.data, mediaType: b.mediaType },
            ],
          },
        ],
        providerOptions: {
          google: {
            responseModalities: ["IMAGE"],
            thinkingConfig: { thinkingLevel: "minimal" },
            imageConfig: {
              imageSize: "512",
              aspectRatio: closestRatio(input.aspect ?? 3 / 4),
              imageOutputOptions: { mimeType: "image/jpeg", compressionQuality: 80 },
            },
          },
        },
      });

      const file = result.files?.find((f) => f.mediaType?.startsWith("image/"));
      if (file?.uint8Array?.length) {
        const b64 = Buffer.from(file.uint8Array).toString("base64");
        return { ok: true, dataUrl: `data:${file.mediaType || "image/jpeg"};base64,${b64}` };
      }
      reason = result.rawFinishReason || result.finishReason || reason;
    }

    return { ok: false, error: `Model returned no image (${reason})` };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: message };
  }
}
