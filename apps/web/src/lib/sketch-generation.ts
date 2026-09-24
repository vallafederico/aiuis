/**
 * Sketch Generation — closed prompt pack + sketch-to-image server call.
 *
 * The reader draws; the site holds the prompt. Chips on screen carry only a
 * short label. The full brief is returned with the result so it can be shown
 * as provenance after the image exists.
 *
 * The client sends the strokes twice: as a plain line drawing, which FLUX.2
 * reads as a reference to edit from, and as a procedural underpainting
 * (painted in WebGL), which is the init image when only SD 1.5 answers.
 * Without Workers AI the client shows the underpainting itself, labelled.
 */

/**
 * Tried in order until one returns an image. FLUX.2 [klein] 9B follows the
 * sketch's composition best and answers in a few seconds; [dev] is several
 * times slower for no gain here. The inpainting model with a full mask and
 * strength < 1 behaves as img2img (the plain img2img model is no longer served).
 */
const FLUX_MODELS = [
  { id: "@cf/black-forest-labs/flux-2-klein-9b", label: "FLUX.2 [klein] 9B" },
  { id: "@cf/black-forest-labs/flux-2-klein-4b", label: "FLUX.2 [klein] 4B" },
] as const;
const SD_MODEL = { id: "@cf/runwayml/stable-diffusion-v1-5-inpainting", label: "SD 1.5 inpainting" };
/** FLUX.2 output: long side in px, multiples of 16, about 1 MP at most. */
const FLUX_LONG_SIDE = 1024;
const MAX_IMAGE_CHARS = 1_500_000;
/** A solid-colour PNG (safety filter or failed run) is tiny; a painting is not. */
const MIN_OUTPUT_BYTES = 4096;

export type SketchBriefId = "still-life" | "portrait" | "interior";

export type SketchBriefChip = {
  id: SketchBriefId;
  label: string;
};

/** What the client may show before generation: labels only. */
export const SKETCH_BRIEF_CHIPS: SketchBriefChip[] = [
  { id: "still-life", label: "still life" },
  { id: "portrait", label: "portrait" },
  { id: "interior", label: "interior" },
];

/** Subject and style per brief, for the FLUX.2 edit instruction. */
const FLUX_BRIEFS: Record<SketchBriefId, { subject: string; style: string }> = {
  "still-life": {
    subject: "still life",
    style:
      "A few simple objects on a table, soft diffuse window light from the left, muted ceramic and linen tones, gentle shadows. Quiet oil painting, visible brushwork.",
  },
  portrait: {
    subject: "portrait",
    style:
      "A single figure against a plain muted field, soft even light, calm expression. Painterly oil portrait, visible brushwork.",
  },
  interior: {
    subject: "interior",
    style:
      "A quiet room with a single window, daylight falling across the floor, muted plaster walls, sparse furniture. Painterly, visible brushwork.",
  },
};

function fluxPrompt(briefId: SketchBriefId): string {
  const { subject, style } = FLUX_BRIEFS[briefId];
  return `Turn the rough line sketch in the reference image into a finished ${subject} painting. Keep the composition, placement and proportions of the drawn shapes exactly; the lines are guides, not part of the image. ${style} No text, no border.`;
}

/** SD 1.5 prompts; also the provenance shown with every result. */
const BRIEF_PROMPTS: Record<SketchBriefId, string> = {
  "still-life":
    "still life under soft light, a few simple objects on a table, diffuse window light from the left, muted ceramic and linen tones, gentle shadows, quiet oil painting",
  portrait:
    "portrait against a plain field, a single figure, soft even light, muted flat background, calm expression, painterly oil portrait",
  interior:
    "interior with a single window, a quiet room, daylight falling across the floor, muted plaster walls, sparse furniture, painterly",
};

const NEGATIVE_PROMPT =
  "text, letters, watermark, signature, frame, border, blurry, deformed, extra limbs, lowres";

export type SketchGenerationInput = {
  /** PNG or JPEG data URL of the strokes as dark lines on white (the drawing area only). */
  sketchImage: string;
  /** JPEG or PNG data URL of the underpainting, same framing and size. */
  underImage: string;
  briefId: SketchBriefId;
  width: number;
  height: number;
};

export type SketchGenerationResult =
  | {
      kind: "image";
      image: string;
      prompt: string;
      briefId: SketchBriefId;
      model: string;
    }
  | {
      kind: "fallback";
      prompt: string;
      briefId: SketchBriefId;
      reason: "unavailable" | "failed" | "quota";
    };

function isBriefId(value: string): value is SketchBriefId {
  return value in BRIEF_PROMPTS;
}

/** Output size for FLUX.2: the drawing's aspect, multiples of 16. */
function fluxSize(width: number, height: number) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const snap = (v: number) => Math.max(256, Math.round(v / 16) * 16);
  return aspect >= 1
    ? { width: FLUX_LONG_SIDE, height: snap(FLUX_LONG_SIDE / aspect) }
    : { width: snap(FLUX_LONG_SIDE * aspect), height: FLUX_LONG_SIDE };
}

function clampDimension(value: number): number {
  const rounded = Math.round((Number.isFinite(value) ? value : 512) / 64) * 64;
  return Math.min(768, Math.max(256, rounded));
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function imageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/png";
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Solid white RGB PNG: the "repaint everything" mask. */
async function whiteMask(width: number, height: number): Promise<Uint8Array> {
  const row = 1 + width * 3;
  const raw = new Uint8Array(row * height).fill(255);
  for (let y = 0; y < height; y++) raw[y * row] = 0;
  const deflated = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflated),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function outputBytes(raw: unknown): Promise<Uint8Array | null> {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw && typeof raw === "object") {
    if (typeof (raw as ReadableStream).getReader === "function") {
      const buffer = await new Response(raw as ReadableStream).arrayBuffer();
      return new Uint8Array(buffer);
    }
    const image = (raw as { image?: unknown }).image;
    if (typeof image === "string") return base64ToBytes(image);
  }
  return null;
}

export async function generateFromSketch(
  input: SketchGenerationInput,
): Promise<SketchGenerationResult> {
  "use server";

  const briefId: SketchBriefId = isBriefId(input.briefId)
    ? input.briefId
    : "still-life";
  const prompt = BRIEF_PROMPTS[briefId];

  const sketch = decodeDataUrl(input.sketchImage);
  const under = decodeDataUrl(input.underImage);
  if (!sketch || !under) {
    return { kind: "fallback", prompt, briefId, reason: "failed" };
  }

  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  if (!ai) return { kind: "fallback", prompt, briefId, reason: "unavailable" };

  // Each attempt carries the brief it was steered by, for the provenance line.
  const attempts: Array<{ label: string; shown: string; run: () => Promise<unknown> }> = [
    ...FLUX_MODELS.map((model) => ({
      label: model.label,
      shown: FLUX_BRIEFS[briefId].style,
      run: () => runFlux(ai, model.id, fluxPrompt(briefId), sketch, input),
    })),
    { label: SD_MODEL.label, shown: prompt, run: () => runSd(ai, prompt, under, input) },
  ];
  let quota = false;
  for (const attempt of attempts) {
    try {
      const bytes = await outputBytes(await attempt.run());
      if (!bytes || bytes.length < MIN_OUTPUT_BYTES) continue;
      return {
        kind: "image",
        image: `data:${imageMime(bytes)};base64,${bytesToBase64(bytes)}`,
        prompt: attempt.shown,
        briefId,
        model: attempt.label,
      };
    } catch (error) {
      console.warn(`sketch-generation: ${attempt.label} failed`, error);
      // 4006: the account's daily Workers AI allocation is spent, for every model.
      if (String(error).includes("4006")) {
        quota = true;
        break;
      }
    }
  }
  return { kind: "fallback", prompt, briefId, reason: quota ? "quota" : "failed" };
}

type Ai = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
type Decoded = { bytes: Uint8Array; mime: string };

function decodeDataUrl(url: string | undefined): Decoded | null {
  const match = /^data:(image\/(?:jpeg|png));base64,/.exec(url ?? "");
  if (!match || !url || url.length > MAX_IMAGE_CHARS) return null;
  return { bytes: base64ToBytes(url.slice(match[0].length)), mime: match[1] };
}

/** FLUX.2 on Workers AI takes multipart form data; the sketch is reference image 0. */
async function runFlux(
  ai: Ai,
  model: string,
  prompt: string,
  sketch: Decoded,
  input: SketchGenerationInput,
) {
  const size = fluxSize(input.width, input.height);
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("input_image_0", new Blob([sketch.bytes], { type: sketch.mime }));
  form.append("width", String(size.width));
  form.append("height", String(size.height));
  form.append("seed", String(Math.floor(Math.random() * 2 ** 31)));
  const request = new Request("http://form.local", { method: "POST", body: form });
  return ai.run(model, {
    multipart: { body: request.body, contentType: request.headers.get("content-type") },
  });
}

async function runSd(ai: Ai, prompt: string, under: Decoded, input: SketchGenerationInput) {
  const width = clampDimension(input.width);
  const height = clampDimension(input.height);
  const mask = await whiteMask(width, height);
  return ai.run(SD_MODEL.id, {
    prompt,
    negative_prompt: NEGATIVE_PROMPT,
    image: Array.from(under.bytes),
    mask: Array.from(mask),
    width,
    height,
    strength: 0.75,
    num_steps: 20,
    guidance: 7.5,
    seed: Math.floor(Math.random() * 2 ** 31),
  });
}
