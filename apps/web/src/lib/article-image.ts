import { generateText } from "ai";

const MODEL = "google/gemini-3.1-flash-image";

/**
 * One plate style for the whole essay: a blue notebook sketch on the site
 * paper. The subject changes. The drawing does not.
 */
const STYLE = `Draw one sketch for a research essay.

Style, every time: a quick hand-drawn sketch in blue pencil. Loose construction lines, a few overlapping strokes, slightly uneven, like a notebook sketch. Not a finished diagram, not vector art, not a clean icon. Marks are only #0000FF. One simple subject, centered, with a large empty margin.

The background is one flat colour, exactly #E9E9EA, edge to edge. No gradient, no vignette, no paper texture, no shadow, no border, no frame.

No shading, no photograph, no 3D, no caption. Do not draw any letters, numbers, words, logos, or screens.`;

const MAX_ATTEMPTS = 2;

/** A plate for one idea, or null when the model returns nothing. */
export async function drawArticlePlate(subject: string): Promise<string | null> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("Missing AI_GATEWAY_API_KEY");
  }
  const idea = subject.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!idea) return null;

  let reason = "no image";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await generateText({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: `${STYLE}

The idea to draw as an object, never as written words: ${idea}`,
        },
      ],
      providerOptions: {
        google: {
          responseModalities: ["IMAGE"],
          thinkingConfig: { thinkingLevel: "minimal" },
          imageConfig: {
            imageSize: "512",
            aspectRatio: "4:3",
            imageOutputOptions: { mimeType: "image/jpeg", compressionQuality: 80 },
          },
        },
      },
    });

    const file = result.files?.find((item) => item.mediaType?.startsWith("image/"));
    if (file?.uint8Array?.length) {
      const b64 = Buffer.from(file.uint8Array).toString("base64");
      return `data:${file.mediaType || "image/jpeg"};base64,${b64}`;
    }
    reason = result.rawFinishReason || result.finishReason || reason;
  }
  console.error("[article plate]", reason);
  return null;
}
