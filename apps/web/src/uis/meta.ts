/**
 * DATA labels — taxonomy `data` on pieces (`type: tax`).
 *
 * Stored as lowercase slugs in the CMS; displayed with the titles below.
 * `uiTags` is the fallback when a piece has no CMS tags yet.
 */

/** Display titles for known data-taxonomy slugs. */
export const DATA_LABELS: Record<string, string> = {
  jev: "JEV",
  "llama-3-2": "LLAMA-3.2",
  "language-model": "LANGUAGE-MODEL",
  "image-model": "IMAGE-MODEL",
  "workers-ai": "WORKERS-AI",
  select: "SELECT",
  exists: "EXISTS",
  rank: "RANK",
  needle: "NEEDLE",
  highlight: "HIGHLIGHT",
  generation: "GENERATION",
  prompt: "PROMPT",
  provenance: "PROVENANCE",
  score: "SCORE",
  axes: "AXES",
  mix: "MIX",
  iteration: "ITERATION",
  scroll: "SCROLL",
  filter: "FILTER",
  chip: "CHIP",
  control: "CONTROL",
  sketch: "SKETCH",
};

const TAG_LABEL = /^[A-Z0-9][A-Z0-9.-]*$/;
const TAG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True when a string looks like comma-separated DATA tag slugs or labels. */
export function tagLikeString(value: string): boolean {
  const parts = value.split(/,\s*/).map((tag) => tag.trim()).filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((tag) => TAG_LABEL.test(tag) || TAG_SLUG.test(tag))
  );
}

/** Card/list payload: taxonomy slugs, legacy description tags, or neither. */
export function cmsTagsFromCard(card?: {
  tags?: unknown;
  description?: unknown;
}): unknown {
  const cardTags = card?.tags;
  if (cardTags != null && (!Array.isArray(cardTags) || cardTags.length > 0)) {
    return cardTags;
  }
  const raw = typeof card?.description === "string" ? card.description.trim() : "";
  if (raw && tagLikeString(raw)) return raw;
  return undefined;
}

/** Fallback DATA tags per UI slug when the CMS card has none yet. */
export const uiTags: Record<string, string[]> = {
  faqs: ["jev", "llama-3-2", "select"],
  "infinite-article": ["language-model", "generation", "scroll"],
  navigation: ["jev", "rank", "exists"],
  images: ["provenance", "prompt", "score"],
  find: ["jev", "needle", "exists"],
  "generative-moodboard": ["image-model", "axes", "mix"],
  "image-generation": ["image-model", "prompt", "iteration"],
  "sketch-generation": ["image-model", "prompt", "sketch"],
  filters: ["jev", "filter", "score"],
  "type-an-analytic": ["language-model", "generation", "prompt"],
};

export function tagsFor(slug: string, fromCms: unknown): string[] {
  const parsed = labelsFromCms(fromCms);
  const tags = parsed.length > 0 ? parsed : (uiTags[slug] ?? []);
  return tags.map(canonicalTagSlug);
}

/** Normalize a CMS / seed tag to the taxonomy slug form. */
export function canonicalTagSlug(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/g, "-")
    .replace(/\./g, "-");
}

/** Display label for a data-tag slug (DATA strip + /data pages). */
export function labelForTag(tag: string): string {
  const slug = canonicalTagSlug(tag);
  return DATA_LABELS[slug] ?? slug.toUpperCase();
}

/** @deprecated use canonicalTagSlug */
export function canonicalTag(tag: string): string {
  return canonicalTagSlug(tag);
}

export function isDataTag(tag: string): boolean {
  const slug = canonicalTagSlug(tag);
  if (!slug) return false;
  // Accept known labels or any well-formed taxonomy slug.
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function tagPath(tag: string): string {
  return `/data/${encodeURIComponent(canonicalTagSlug(tag))}`;
}

export function labelsFromCms(fromCms: unknown): string[] {
  const parsed = parseTags(fromCms);
  return parsed.length > 0 && parsed.every(isDataTag)
    ? parsed.map(canonicalTagSlug)
    : [];
}

/** Pull `tags` or a DATA-label `description` out of published markdown. */
export function tagsFromMarkdown(raw: string): unknown {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return undefined;
  const lines = match[1].split("\n");
  const tags: string[] = [];
  let description: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "tags") {
      if (value) {
        const inner = value.replace(/^\[/, "").replace(/\]$/, "");
        tags.push(...parseTags(inner));
      }
      while (i + 1 < lines.length && /^\s+-\s+\S/.test(lines[i + 1])) {
        i += 1;
        tags.push(unquote(lines[i].replace(/^\s+-\s+/, "").trim()));
      }
    } else if (key === "description" && value) {
      description = unquote(value);
    }
  }
  if (tags.length > 0) return tags;
  return description;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function tagSlugFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value && typeof value === "object" && "slug" in value) {
    const slug = (value as { slug: unknown }).slug;
    if (typeof slug === "string" && slug.trim()) return slug.trim();
  }
  return null;
}

function parseTags(fromCms: unknown): string[] {
  if (Array.isArray(fromCms)) {
    return fromCms
      .map(tagSlugFromValue)
      .filter((tag): tag is string => Boolean(tag));
  }
  if (typeof fromCms === "string" && fromCms.trim()) {
    return fromCms
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

export function formatUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}
