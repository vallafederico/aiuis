/**
 * Generative Moodboard — geometry, mix recipes, and demo tile generation.
 *
 * Code owns distances and click rules. Jev may score axis placement when a key
 * is present; seed corners use fixed scores so the demo works without one.
 */
import { judgeAvailable, noul, systemOne } from "~/lib/judge";

export type MoodDimension =
  | "humanPresence"
  | "styleGlam"
  | "sparseDense"
  | "material"
  | "colorTemp"
  | "lightHardness"
  | "framing"
  | "candor"
  | "tone"
  | "tension";

export type MoodScores = Record<MoodDimension, number>;

export type AxisPair = {
  x: MoodDimension;
  y: MoodDimension;
};

export type MoodTile = {
  id: string;
  prompt: string;
  caption: string;
  scores: MoodScores;
  /** Public URL for a photo tile (e.g. `/moodboard/foo.webp`). */
  src?: string;
  /** Width ÷ height when known; used by the art-directed board. */
  aspect?: number;
  /** CSS background for the tile placeholder. */
  tint: string;
  sources?: Array<{ id: string; weight: number; role: string }>;
};

export { MOODBOARD_SEED_TILES, MOODBOARD_IMAGE_BASE } from "./moodboard-seeds";

export type MixRecipe = {
  target: { x: number; y: number; scores: MoodScores };
  sources: Array<{ tile: MoodTile; weight: number; role: string }>;
  mode: "cross" | "along-x" | "along-y" | "vary";
  message: string;
};

export type MixResult =
  | { kind: "mix"; recipe: MixRecipe }
  | { kind: "vary"; recipe: MixRecipe }
  | { kind: "restrain"; message: string };

export const MOOD_DIMENSIONS: MoodDimension[] = [
  "humanPresence",
  "styleGlam",
  "sparseDense",
  "material",
  "colorTemp",
  "lightHardness",
  "framing",
  "candor",
  "tone",
  "tension",
];

export const AXIS_LABELS: Record<
  MoodDimension,
  { low: string; high: string }
> = {
  humanPresence: { low: "still-life", high: "portrait" },
  styleGlam: { low: "quiet", high: "glamorous" },
  sparseDense: { low: "sparse", high: "dense" },
  material: { low: "organic", high: "technical" },
  colorTemp: { low: "warm", high: "cool" },
  lightHardness: { low: "soft light", high: "hard light" },
  framing: { low: "close-up", high: "wide" },
  candor: { low: "staged", high: "candid" },
  tone: { low: "playful", high: "serious" },
  tension: { low: "calm", high: "tense" },
};

export type AxisView = { id: string; name: string; pair: AxisPair };

export const AXIS_VIEWS: AxisView[] = [
  { id: "subject", name: "Subject", pair: { x: "humanPresence", y: "styleGlam" } },
  { id: "surface", name: "Surface", pair: { x: "sparseDense", y: "material" } },
  { id: "light", name: "Light", pair: { x: "colorTemp", y: "lightHardness" } },
  { id: "framing", name: "Framing", pair: { x: "framing", y: "candor" } },
  { id: "mood", name: "Mood", pair: { x: "tone", y: "tension" } },
];

export const DEFAULT_AXIS_PAIR: AxisPair = {
  x: "humanPresence",
  y: "styleGlam",
};

export const AXIS_PAIR_OPTIONS: AxisPair[] = AXIS_VIEWS.map((v) => v.pair);

const TILE_HIT_RADIUS = 0.09;
const DENSE_CLUSTER_RADIUS = 0.14;
const DENSE_CLUSTER_MIN = 3;
const VARY_RATIO = 2.4;

function axisLabel(dim: MoodDimension, value: number): string {
  const labels = AXIS_LABELS[dim];
  return value < 0.5 ? labels.low : labels.high;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function tilePosition(tile: MoodTile, axes: AxisPair): { x: number; y: number } {
  return { x: tile.scores[axes.x], y: tile.scores[axes.y] };
}

function mergeScores(
  base: MoodScores,
  axes: AxisPair,
  x: number,
  y: number,
): MoodScores {
  return { ...base, [axes.x]: clamp01(x), [axes.y]: clamp01(y) };
}

function crossMixRecipe(
  nearestX: { tile: MoodTile; dx: number },
  nearestY: { tile: MoodTile; dy: number },
  x: number,
  y: number,
  axes: AxisPair,
): MixRecipe {
  const wx = 1 / (nearestX.dx + 0.04);
  const wy = 1 / (nearestY.dy + 0.04);
  const wSum = wx + wy;
  const scores = mergeScores(nearestX.tile.scores, axes, x, y);
  return {
    target: { x, y, scores },
    mode: "cross",
    message: "Quadrant fill: X from one source, Y from the other.",
    sources: [
      {
        tile: nearestX.tile,
        weight: wx / wSum,
        role: `X (${AXIS_LABELS[axes.x].low} ↔ ${AXIS_LABELS[axes.x].high})`,
      },
      {
        tile: nearestY.tile,
        weight: wy / wSum,
        role: `Y (${AXIS_LABELS[axes.y].low} ↔ ${AXIS_LABELS[axes.y].high})`,
      },
    ],
  };
}

function alongAxisRecipe(
  a: { tile: MoodTile; tx: number; ty: number; dist: number },
  b: { tile: MoodTile; tx: number; ty: number; dist: number },
  x: number,
  y: number,
  axes: AxisPair,
  axis: "x" | "y",
): MixRecipe {
  const wa = 1 / (a.dist + 0.04);
  const wb = 1 / (b.dist + 0.04);
  const wSum = wa + wb;
  const dim = axis === "x" ? axes.x : axes.y;
  const hold = axis === "x" ? axes.y : axes.x;
  const scores = mergeScores(a.tile.scores, axes, x, y);
  const holdValue = axis === "x" ? y : x;
  scores[hold] = clamp01(holdValue);
  return {
    target: { x, y, scores },
    mode: axis === "x" ? "along-x" : "along-y",
    message: `Along-axis blend on ${AXIS_LABELS[dim].low} ↔ ${AXIS_LABELS[dim].high}; other axis held.`,
    sources: [
      { tile: a.tile, weight: wa / wSum, role: "source A" },
      { tile: b.tile, weight: wb / wSum, role: "source B" },
    ],
  };
}

function varyRecipe(
  anchor: { tile: MoodTile; dist: number },
  x: number,
  y: number,
  axes: AxisPair,
): MixRecipe {
  const scores = mergeScores(anchor.tile.scores, axes, x, y);
  return {
    target: { x, y, scores },
    mode: "vary",
    message: `Variation of "${anchor.tile.caption}" toward the click, not a two-source mix.`,
    sources: [{ tile: anchor.tile, weight: 1, role: "anchor" }],
  };
}

/** Pure geometry: nearest neighbors + click rules → mix, vary, or restrain. */
export function mixAtClick(input: {
  tiles: MoodTile[];
  x: number;
  y: number;
  axes: AxisPair;
}): MixResult {
  const { tiles, axes } = input;
  const x = clamp01(input.x);
  const y = clamp01(input.y);

  if (tiles.length === 0) {
    return { kind: "restrain", message: "No seed tiles to mix from." };
  }

  for (const tile of tiles) {
    const pos = tilePosition(tile, axes);
    if (Math.hypot(x - pos.x, y - pos.y) < TILE_HIT_RADIUS) {
      return {
        kind: "restrain",
        message: "Click empty space between images.",
      };
    }
  }

  const nearby = tiles.filter((tile) => {
    const pos = tilePosition(tile, axes);
    return Math.hypot(x - pos.x, y - pos.y) < DENSE_CLUSTER_RADIUS;
  });
  if (nearby.length >= DENSE_CLUSTER_MIN) {
    return {
      kind: "restrain",
      message: "Dense cluster. The board is already speaking here.",
    };
  }

  const ranked = tiles
    .map((tile) => {
      const pos = tilePosition(tile, axes);
      return {
        tile,
        tx: pos.x,
        ty: pos.y,
        dist: Math.hypot(x - pos.x, y - pos.y),
        dx: Math.abs(x - pos.x),
        dy: Math.abs(y - pos.y),
      };
    })
    .sort((a, b) => a.dist - b.dist);

  const first = ranked[0];
  const second = ranked[1];
  if (!first) {
    return { kind: "restrain", message: "No sources to mix from." };
  }

  if (!second || second.dist > first.dist * VARY_RATIO) {
    const recipe = varyRecipe(first, x, y, axes);
    return { kind: "vary", recipe };
  }

  const nearestX = [...ranked].sort((a, b) => a.dx - b.dx)[0]!;
  const nearestY = [...ranked].sort((a, b) => a.dy - b.dy)[0]!;

  if (nearestX.tile.id !== nearestY.tile.id) {
    const recipe = crossMixRecipe(nearestX, nearestY, x, y, axes);
    return { kind: "mix", recipe };
  }

  const axisDeltaX = Math.abs(first.tx - second.tx);
  const axisDeltaY = Math.abs(first.ty - second.ty);

  if (axisDeltaX > axisDeltaY * 1.15) {
    const recipe = alongAxisRecipe(first, second, x, y, axes, "x");
    return { kind: "mix", recipe };
  }
  if (axisDeltaY > axisDeltaX * 1.15) {
    const recipe = alongAxisRecipe(first, second, x, y, axes, "y");
    return { kind: "mix", recipe };
  }

  const recipe = crossMixRecipe(
    { tile: first.tile, dx: first.dx },
    { tile: second.tile, dy: second.dy },
    x,
    y,
    axes,
  );
  return { kind: "mix", recipe };
}

export function composePrompt(recipe: MixRecipe, axes: AxisPair): string {
  const { target, sources, mode, message } = recipe;
  const xLabel = axisLabel(axes.x, target.x);
  const yLabel = axisLabel(axes.y, target.y);

  if (mode === "vary") {
    const anchor = sources[0]?.tile;
    if (!anchor) return `New tile toward ${xLabel}, ${yLabel}.`;
    return `${anchor.prompt}; vary toward ${xLabel} and ${yLabel} (${message.toLowerCase()})`;
  }

  const parts = sources.map(
    (entry) => `${entry.tile.prompt} (${Math.round(entry.weight * 100)}%)`,
  );
  return `Mix at ${xLabel} × ${yLabel}: ${parts.join(" + ")}`;
}

function tintFromTarget(
  recipe: MixRecipe,
  axes: AxisPair,
): string {
  const { target, sources } = recipe;
  let angle = 120 + target.x * 80 + target.y * 40;
  let alphaA = 0.12;
  let alphaB = 0.28;

  if (sources.length === 1) {
    angle += 35;
    alphaA = 0.14 + target.x * 0.08;
    alphaB = 0.22 + target.y * 0.1;
  } else {
    const w0 = sources[0]?.weight ?? 0.5;
    alphaA = 0.1 + w0 * 0.14;
    alphaB = 0.18 + (1 - w0) * 0.14;
    angle = 90 + target.scores[axes.x] * 120 + target.scores[axes.y] * 60;
  }

  return `linear-gradient(${angle.toFixed(0)}deg, rgb(0 0 255 / ${alphaA.toFixed(2)}), rgb(0 0 255 / ${alphaB.toFixed(2)}))`;
}

let tileCounter = 0;

export function generateTile(
  recipe: MixRecipe,
  axes: AxisPair,
): MoodTile {
  tileCounter += 1;
  const id = `generated-${tileCounter}`;
  const prompt = composePrompt(recipe, axes);
  const xLabel = axisLabel(axes.x, recipe.target.x);
  const yLabel = axisLabel(axes.y, recipe.target.y);
  const caption =
    recipe.mode === "vary"
      ? `Variation toward ${xLabel}, ${yLabel}`
      : `Mix at ${xLabel} × ${yLabel}`;

  return {
    id,
    prompt,
    caption,
    scores: { ...recipe.target.scores },
    tint: tintFromTarget(recipe, axes),
    sources: recipe.sources.map((entry) => ({
      id: entry.tile.id,
      weight: entry.weight,
      role: entry.role,
    })),
  };
}

/** Four corner seeds from axis extremes on the default pair. */
export const SEED_CORNER_TILES: MoodTile[] = [
  {
    id: "corner-still-quiet",
    caption: "Still-life, quiet styling",
    prompt: "minimal still-life, soft natural light, understated props",
    scores: {
      humanPresence: 0.08,
      styleGlam: 0.1,
      sparseDense: 0.35,
      material: 0.2,
      colorTemp: 0.35,
      lightHardness: 0.2,
      framing: 0.45,
      candor: 0.25,
      tone: 0.3,
      tension: 0.15,
    },
    tint: "linear-gradient(135deg, rgb(0 0 255 / 0.12), rgb(0 0 255 / 0.05))",
  },
  {
    id: "corner-portrait-quiet",
    caption: "Portrait, documentary quiet",
    prompt: "subject in frame, natural light, low-key wardrobe",
    scores: {
      humanPresence: 0.92,
      styleGlam: 0.12,
      sparseDense: 0.55,
      material: 0.25,
      colorTemp: 0.4,
      lightHardness: 0.25,
      framing: 0.55,
      candor: 0.7,
      tone: 0.55,
      tension: 0.2,
    },
    tint: "linear-gradient(200deg, rgb(0 0 255 / 0.24), rgb(0 0 255 / 0.08))",
  },
  {
    id: "corner-still-glam",
    caption: "Still-life, high glam",
    prompt: "styled product tableau, glossy surfaces, saturated palette",
    scores: {
      humanPresence: 0.1,
      styleGlam: 0.9,
      sparseDense: 0.75,
      material: 0.15,
      colorTemp: 0.55,
      lightHardness: 0.65,
      framing: 0.5,
      candor: 0.15,
      tone: 0.45,
      tension: 0.25,
    },
    tint: "linear-gradient(45deg, rgb(0 0 255 / 0.18), rgb(0 0 255 / 0.1))",
  },
  {
    id: "corner-portrait-glam",
    caption: "Portrait, editorial glam",
    prompt: "fashion portrait, bold styling, studio lighting",
    scores: {
      humanPresence: 0.88,
      styleGlam: 0.88,
      sparseDense: 0.6,
      material: 0.3,
      colorTemp: 0.5,
      lightHardness: 0.75,
      framing: 0.6,
      candor: 0.35,
      tone: 0.6,
      tension: 0.35,
    },
    tint: "linear-gradient(315deg, rgb(0 0 255 / 0.26), rgb(0 0 255 / 0.12))",
  },
];

export function axisPairKey(pair: AxisPair): string {
  return `${pair.x}:${pair.y}`;
}

export function axisPairLabel(pair: AxisPair): string {
  const x = AXIS_LABELS[pair.x];
  const y = AXIS_LABELS[pair.y];
  return `${x.low} ↔ ${x.high} × ${y.low} ↔ ${y.high}`;
}

/** Client probe: optional Jev scoring path. */
export async function moodboardJudgeAvailable(): Promise<boolean> {
  "use server";
  return judgeAvailable();
}

/** Optional Jev pass: infer axis scores from caption + prompt text. */
export async function scoreTileAxes(tile: {
  caption: string;
  prompt: string;
}): Promise<MoodScores | null> {
  "use server";
  if (!judgeAvailable()) return null;
  try {
    const answers = await systemOne(
      { caption: tile.caption, prompt: tile.prompt },
      {
        humanPresence: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question:
              "Is a person clearly the subject rather than a still-life?",
          },
          {
            true: "A person is the subject — portrait-like.",
            false: "Still-life or no/minimal human presence.",
          },
        ),
        styleGlam: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does this image read glamorous rather than quiet?",
          },
          {
            true: "Fashion/editorial glam and high styling.",
            false: "Understated, quiet, or documentary.",
          },
        ),
        sparseDense: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does this image read dense rather than sparse?",
          },
          {
            true: "The image is dense, crowded, or visually packed.",
            false: "The image is sparse or airy.",
          },
        ),
        material: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does this image read technical rather than organic?",
          },
          {
            true: "Circuits, plastic, hard props, synthetic surfaces.",
            false: "Body, flowers, food, soft natural textures.",
          },
        ),
        colorTemp: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does the palette read cool rather than warm?",
          },
          {
            true: "Cool palette — blues, greens, cold whites.",
            false: "Warm palette — reds, golds, skin, lamplight.",
          },
        ),
        lightHardness: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does the light read hard rather than soft?",
          },
          {
            true: "Direct, crisp shadows, flash, hard light.",
            false: "Diffuse, soft shadows, gentle light.",
          },
        ),
        framing: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does the framing read wide rather than close-up?",
          },
          {
            true: "Wide shot, whole scene in frame.",
            false: "Tight crop, detail, close-up.",
          },
        ),
        candor: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does this image read candid rather than staged?",
          },
          {
            true: "Caught, spontaneous, documentary.",
            false: "Arranged, posed, art-directed.",
          },
        ),
        tone: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does the tone read serious rather than playful?",
          },
          {
            true: "Earnest, grave, serious.",
            false: "Humorous, light, ironic, playful.",
          },
        ),
        tension: noul(
          {
            caption: tile.caption,
            prompt: tile.prompt,
            question: "Does the image read tense rather than calm?",
          },
          {
            true: "Charged, unsettling, dramatic tension.",
            false: "Still, at rest, calm.",
          },
        ),
      },
    );
    if (!answers) return null;
    const scores: Partial<MoodScores> = {};
    for (const dim of MOOD_DIMENSIONS) {
      const answer = answers[dim];
      if (answer?.type === "noul") scores[dim] = answer.noul;
    }
    if (MOOD_DIMENSIONS.every((dim) => typeof scores[dim] === "number")) {
      return scores as MoodScores;
    }
    return null;
  } catch {
    return null;
  }
}
