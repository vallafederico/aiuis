/**
 * Dev-only: score image tiles onto Generative Moodboard axes via Vercel AI Gateway.
 *
 * Usage:
 *   pnpm score:moodboard <input-dir> [--relative] [--out scores.json] [--model google/gemini-2.5-flash] [--concurrency 3] [--force]
 */
import { generateObject } from "ai";
import { readFile, readdir, writeFile, access } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { z } from "zod";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
]);

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const DEFAULT_CONCURRENCY = 3;
const RELATIVE_BATCH_SIZE = 8;

const MOOD_DIMENSION_SPECS = [
  {
    key: "humanPresence",
    zero: "still-life, no person or only incidental body parts/props",
    one: "portrait, a person is clearly the subject",
  },
  {
    key: "styleGlam",
    zero: "quiet, understated, documentary",
    one: "glamorous, fashion/editorial, high styling",
  },
  {
    key: "sparseDense",
    zero: "sparse, airy, generous whitespace",
    one: "dense, crowded, visually packed composition",
  },
  {
    key: "material",
    zero: "organic — body, flowers, food, soft natural textures",
    one: "technical — circuits, plastic, hard props, synthetic surfaces",
  },
  {
    key: "colorTemp",
    zero: "warm palette (reds, golds, skin, lamplight)",
    one: "cool palette (blues, greens, cold whites)",
  },
  {
    key: "lightHardness",
    zero: "diffuse, soft shadows",
    one: "direct, crisp shadows, flash",
  },
  {
    key: "framing",
    zero: "tight crop / detail",
    one: "wide shot, whole scene",
  },
  {
    key: "candor",
    zero: "arranged, posed, art-directed",
    one: "caught, spontaneous, documentary",
  },
  {
    key: "tone",
    zero: "humorous, light, ironic",
    one: "earnest, grave",
  },
  {
    key: "tension",
    zero: "still, at rest",
    one: "charged, unsettling, dramatic",
  },
] as const;

type MoodDimension = (typeof MOOD_DIMENSION_SPECS)[number]["key"];

type MoodScores = Record<MoodDimension, number>;

const MOOD_KEYS: MoodDimension[] = MOOD_DIMENSION_SPECS.map((s) => s.key);

type ScoredTile = {
  id: string;
  file: string;
  caption: string;
  scores: MoodScores;
};

type ScoresFile = {
  model: string;
  scoredAt: string;
  mode?: "relative" | "per-image";
  tiles: ScoredTile[];
};

function axisBulletLines(): string {
  return MOOD_DIMENSION_SPECS.map(
    (s) => `- ${s.key}: 0 = ${s.zero}; 1 = ${s.one}.`,
  ).join("\n");
}

const axisCount = MOOD_DIMENSION_SPECS.length;

const scoreShape = Object.fromEntries(
  MOOD_DIMENSION_SPECS.map((s) => [
    s.key,
    z.number().min(0).max(1),
  ]),
) as Record<MoodDimension, z.ZodNumber>;

const scoreSchema = z.object({ ...scoreShape, caption: z.string() });

const relativeTileSchema = z.object({
  id: z.string(),
  ...scoreShape,
  caption: z.string(),
});

const relativeSetSchema = z.object({
  tiles: z.array(relativeTileSchema),
});

const AXIS_INSTRUCTIONS = `Score this editorial/fashion photograph on ${axisCount} moodboard axes. Each axis is a number from 0 to 1.

${axisBulletLines()}

Use continuous values (e.g. 0.35, 0.62), not just 0 / 0.5 / 1. Differentiate similar images — avoid dumping many tiles on the exact same score. Prefer the open interval (0.05–0.95) unless the image is an extreme archetype.

Also write a short caption (roughly 5–12 words) describing the image for a moodboard seed tile.`;

const RELATIVE_SET_INSTRUCTIONS = `You are scoring a SET of editorial/fashion photographs together for a generative moodboard.

Score each image RELATIVE to this entire set (not in isolation). Use the full continuous range 0–1 on each axis. Spread ranks on every axis: the lowest score in the set should be clearly below the highest on humanPresence, styleGlam, sparseDense, material, colorTemp, lightHardness, framing, candor, tone, and tension. Differentiate similar images — do not assign the same score to many tiles. Avoid dumping many tiles on exactly 0 or 1 unless the set truly has that few extremes; prefer the open interval (0.05–0.95) for most tiles.

Axes (each 0–1):
${axisBulletLines()}

Return exactly one entry per id listed before each image. Include a short caption (roughly 5–12 words) per tile.`;

function printHelp(): void {
  console.log(`Score images onto Generative Moodboard axes (Vercel AI Gateway).

Usage:
  pnpm score:moodboard <input-dir> [options]

Options:
  --relative           Score the whole input set in one (or batched) relative pass
  --out <path>         Output JSON (default: <input-dir>/moodboard-scores.json)
  --model <id>         Gateway model id (default: ${DEFAULT_MODEL})
  --concurrency <n>    Parallel requests in per-image mode (default: ${DEFAULT_CONCURRENCY})
  --force              Re-score tiles already present in the output file
  --help               Show this message

Per-image mode (default): one API call per image, skips ids already in the output unless --force.
Relative mode (--relative): always scores every image in the input dir; writes mode "relative".

Requires AI_GATEWAY_API_KEY in the environment.
`);
}

type CliOptions = {
  inputDir: string;
  outPath: string;
  model: string;
  concurrency: number;
  force: boolean;
  relative: boolean;
};

function parseArgs(argv: string[]): CliOptions | "help" | "error" {
  const positional: string[] = [];
  let outPath: string | undefined;
  let model = DEFAULT_MODEL;
  let concurrency = DEFAULT_CONCURRENCY;
  let force = false;
  let relativeMode = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--relative") {
      relativeMode = true;
      continue;
    }
    if (arg === "--out") {
      const next = argv[++i];
      if (!next) return "error";
      outPath = next;
      continue;
    }
    if (arg === "--model") {
      const next = argv[++i];
      if (!next) return "error";
      model = next;
      continue;
    }
    if (arg === "--concurrency") {
      const next = argv[++i];
      if (!next) return "error";
      const n = Number.parseInt(next, 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error("--concurrency must be a positive integer");
        return "error";
      }
      concurrency = n;
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      return "error";
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    console.error("Expected exactly one argument: <input-dir>");
    return "error";
  }

  const inputDir = resolve(positional[0]!);
  const resolvedOut = outPath
    ? resolve(outPath)
    : join(inputDir, "moodboard-scores.json");

  return {
    inputDir,
    outPath: resolvedOut,
    model,
    concurrency,
    force,
    relative: relativeMode,
  };
}

function mediaTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

async function collectImages(inputDir: string): Promise<string[]> {
  const entries = await readdir(inputDir, { recursive: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    paths.push(join(inputDir, entry));
  }
  paths.sort((a, b) => a.localeCompare(b));
  return paths;
}

async function loadExisting(outPath: string): Promise<ScoresFile | null> {
  try {
    await access(outPath);
  } catch {
    return null;
  }
  const raw = await readFile(outPath, "utf8");
  const parsed = JSON.parse(raw) as ScoresFile;
  if (!Array.isArray(parsed.tiles)) {
    throw new Error(`Invalid scores file (missing tiles[]): ${outPath}`);
  }
  return parsed;
}

async function writeScores(outPath: string, data: ScoresFile): Promise<void> {
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

type ImagePart = {
  id: string;
  relFile: string;
  absPath: string;
  mediaType: string;
};

async function buildImageParts(
  inputDir: string,
  absPaths: string[],
): Promise<ImagePart[]> {
  return absPaths.map((absPath) => ({
    id: basename(absPath, extname(absPath)),
    relFile: relative(inputDir, absPath),
    absPath,
    mediaType: mediaTypeForExt(extname(absPath)),
  }));
}

async function imageContentParts(parts: ImagePart[]) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: Uint8Array; mediaType: string }
  > = [{ type: "text", text: RELATIVE_SET_INSTRUCTIONS }];

  for (const part of parts) {
    const bytes = await readFile(part.absPath);
    content.push({ type: "text", text: `id: ${part.id}` });
    content.push({
      type: "file",
      data: new Uint8Array(bytes),
      mediaType: part.mediaType,
    });
  }

  return content;
}

async function scoreRelativeBatch(
  model: string,
  parts: ImagePart[],
): Promise<z.infer<typeof relativeSetSchema>> {
  const content = await imageContentParts(parts);
  const idList = parts.map((p) => p.id).join(", ");
  const messages = [
    {
      role: "user" as const,
      content: [
        ...content,
        {
          type: "text" as const,
          text: `Ids in this batch (return exactly one tile object per id): ${idList}`,
        },
      ],
    },
  ];

  const { object } = await generateObject({
    model,
    schema: relativeSetSchema,
    schemaName: "MoodboardRelativeSetScores",
    schemaDescription:
      "Relative axis scores (0–1) and captions for a set of moodboard tiles.",
    messages,
  });
  return object;
}

function partsToTiles(
  parts: ImagePart[],
  batchResult: z.infer<typeof relativeSetSchema>,
): ScoredTile[] {
  const byId = new Map(batchResult.tiles.map((t) => [t.id, t]));
  const tiles: ScoredTile[] = [];
  for (const part of parts) {
    const row = byId.get(part.id);
    if (!row) {
      throw new Error(`Missing score for id "${part.id}" in model response`);
    }
    const scores = {} as MoodScores;
    for (const key of MOOD_KEYS) {
      scores[key] = row[key];
    }
    tiles.push({
      id: part.id,
      file: part.relFile,
      caption: row.caption.trim(),
      scores,
    });
  }
  return tiles;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Spread merged batch scores onto [lo, hi] by rank per axis. */
function quantileNormalizeTiles(tiles: ScoredTile[], lo = 0.05, hi = 0.95): void {
  const n = tiles.length;
  if (n <= 1) return;

  for (const key of MOOD_KEYS) {
    const order = tiles
      .map((t, i) => ({ i, v: t.scores[key] }))
      .sort((a, b) => a.v - b.v || a.i - b.i);

    for (let rank = 0; rank < n; rank++) {
      const t = n === 1 ? 0.5 : rank / (n - 1);
      const normalized = lo + t * (hi - lo);
      tiles[order[rank]!.i]!.scores[key] = normalized;
    }
  }
}

function isLikelyRequestFailure(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /token|context|length|size|payload|too large|413|429|timeout/i.test(msg) ||
    /rate limit/i.test(msg)
  );
}

async function scoreRelativeSet(
  model: string,
  parts: ImagePart[],
): Promise<{ tiles: ScoredTile[]; batched: boolean }> {
  try {
    console.log(`Relative scoring ${parts.length} image(s) in one request…`);
    const result = await scoreRelativeBatch(model, parts);
    return { tiles: partsToTiles(parts, result), batched: false };
  } catch (error) {
    if (!isLikelyRequestFailure(error)) throw error;
    console.warn(
      "One-shot relative scoring failed; falling back to batched relative passes with quantile normalization.",
    );
    console.warn(error instanceof Error ? error.message : error);
  }

  const batches = chunk(parts, RELATIVE_BATCH_SIZE);
  console.log(
    `Relative scoring in ${batches.length} batch(es) of ~${RELATIVE_BATCH_SIZE}…`,
  );
  const merged: ScoredTile[] = [];
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    console.log(`  Batch ${b + 1}/${batches.length} (${batch.length} images)…`);
    const result = await scoreRelativeBatch(model, batch);
    merged.push(...partsToTiles(batch, result));
  }
  quantileNormalizeTiles(merged);
  return { tiles: merged, batched: true };
}

async function scoreImage(
  model: string,
  absolutePath: string,
  mediaType: string,
): Promise<z.infer<typeof scoreSchema>> {
  const bytes = await readFile(absolutePath);
  const { object } = await generateObject({
    model,
    schema: scoreSchema,
    schemaName: "MoodboardTileScores",
    schemaDescription:
      "Axis scores (0–1) and a short caption for a generative moodboard tile.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: AXIS_INSTRUCTIONS },
          {
            type: "image",
            image: new Uint8Array(bytes),
            mediaType,
          },
        ],
      },
    ],
  });
  return object;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
}

async function mainRelative(
  inputDir: string,
  outPath: string,
  model: string,
): Promise<void> {
  const images = await collectImages(inputDir);
  if (images.length === 0) {
    console.error(`No images found under ${inputDir}`);
    process.exit(1);
  }

  const parts = await buildImageParts(inputDir, images);
  console.log(`Found ${parts.length} image(s) for relative scoring.`);
  console.log(`Model: ${model}`);
  console.log(`Output: ${outPath}`);

  const { tiles, batched } = await scoreRelativeSet(model, parts);
  tiles.sort((a, b) => a.file.localeCompare(b.file));

  const scoresFile: ScoresFile = {
    model,
    scoredAt: new Date().toISOString(),
    mode: "relative",
    tiles,
  };
  await writeScores(outPath, scoresFile);

  console.log(
    `Done. Wrote ${tiles.length} tile(s) (relative${batched ? ", batched+quantile" : ", one-shot"}) to ${outPath}`,
  );
}

async function mainPerImage(
  inputDir: string,
  outPath: string,
  model: string,
  concurrency: number,
  force: boolean,
): Promise<void> {
  const images = await collectImages(inputDir);
  if (images.length === 0) {
    console.error(`No images found under ${inputDir}`);
    process.exit(1);
  }

  const existing = await loadExisting(outPath);
  const tileById = new Map<string, ScoredTile>();
  for (const tile of existing?.tiles ?? []) {
    tileById.set(tile.id, tile);
  }

  const toScore = images.filter((absPath) => {
    const id = basename(absPath, extname(absPath));
    return force || !tileById.has(id);
  });

  console.log(
    `Found ${images.length} image(s); scoring ${toScore.length} (${images.length - toScore.length} skipped).`,
  );
  console.log(`Model: ${model}`);
  console.log(`Output: ${outPath}`);

  const scoresFile: ScoresFile = {
    model,
    scoredAt: new Date().toISOString(),
    mode: "per-image",
    tiles: [...tileById.values()],
  };

  await runPool(toScore, concurrency, async (absPath) => {
    const relFile = relative(inputDir, absPath);
    const id = basename(absPath, extname(absPath));
    const mediaType = mediaTypeForExt(extname(absPath));

    try {
      console.log(`Scoring ${relFile}…`);
      const result = await scoreImage(model, absPath, mediaType);
      const scores = {} as MoodScores;
      for (const key of MOOD_KEYS) {
        scores[key] = result[key];
      }
      const tile: ScoredTile = {
        id,
        file: relFile,
        caption: result.caption.trim(),
        scores,
      };
      tileById.set(id, tile);
      scoresFile.tiles = [...tileById.values()].sort((a, b) =>
        a.file.localeCompare(b.file),
      );
      scoresFile.scoredAt = new Date().toISOString();
      await writeScores(outPath, scoresFile);
      console.log(`  ✓ ${id}`);
    } catch (error) {
      console.error(`  ✗ ${relFile}:`, error);
      throw error;
    }
  });

  console.log(`Done. Wrote ${scoresFile.tiles.length} tile(s) to ${outPath}`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    printHelp();
    return;
  }
  if (parsed === "error") {
    printHelp();
    process.exit(1);
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      "Missing AI_GATEWAY_API_KEY. Set it to your Vercel AI Gateway API key.",
    );
    process.exit(1);
  }

  const { inputDir, outPath, model, concurrency, force, relative } = parsed;

  if (relative) {
    await mainRelative(inputDir, outPath, model);
  } else {
    await mainPerImage(inputDir, outPath, model, concurrency, force);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
