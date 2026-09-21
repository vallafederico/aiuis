/** DATA labels (Figma [LABEL] style). Used when the CMS card/doc has none yet. */
export const uiTags: Record<string, string[]> = {
  faqs: ["CHAT-GPT", "ASSISTANT", "INSTRUCTION"],
  "infinite-article": ["LANGUAGE-MODEL", "SCROLL", "GENERATION"],
  navigation: ["CONTEXT", "BREADCRUMB", "SCOPE"],
  images: ["GENERATED", "PROVENANCE", "PROMPT"],
  bot: ["CHAT", "AVATAR", "TYPING"],
  "look-at": ["ATTENTION", "VISION", "OVERLAY"],
  "image-generation": ["PROMPT", "ITERATION", "MODEL"],
};

export function tagsFor(slug: string, fromCms: unknown): string[] {
  const parsed = labelsFromCms(fromCms);
  const tags = parsed.length > 0 ? parsed : (uiTags[slug] ?? []);
  return tags.map(canonicalTag);
}

export function canonicalTag(tag: string): string {
  return tag.replaceAll("_", "-").replace(/\s+/g, "-").toUpperCase();
}

export function isDataTag(tag: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]*$/.test(canonicalTag(tag));
}

export function tagPath(tag: string): string {
  return `/data/${encodeURIComponent(canonicalTag(tag))}`;
}

export function labelsFromCms(fromCms: unknown): string[] {
  const parsed = parseTags(fromCms);
  return isDataLabels(parsed) ? parsed : [];
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

function parseTags(fromCms: unknown): string[] {
  if (Array.isArray(fromCms)) {
    return fromCms.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof fromCms === "string" && fromCms.trim()) {
    return fromCms
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function isDataLabels(tags: string[]): boolean {
  return tags.length > 0 && tags.every((tag) => /^[A-Z0-9][A-Z0-9-]*$/.test(tag));
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
