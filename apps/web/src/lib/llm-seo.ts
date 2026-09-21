import type { CollectionDocItem } from "@content-software/client";
import { pagePath } from "@local/content";
import { getCollection, getLlms } from "~/content";
import { cms, cmsStatus, siteSection } from "~/lib/cms";
import { tagsFor } from "~/uis/meta";
import { SITE } from "~/lib/site";

export const SECTION_ORDER = ["preface", "foundations", "uis"] as const;
export const SECTION_LABEL: Record<(typeof SECTION_ORDER)[number], string> = {
  preface: "Preface",
  foundations: "Foundations",
  uis: "UIs",
};

type PieceCard = {
  section?: unknown;
  order?: unknown;
  description?: unknown;
  tags?: unknown;
};

export type SeoPiece = {
  slug: string;
  section: (typeof SECTION_ORDER)[number];
  title: string;
  summary: string;
  updated: string | null;
  order: number;
  tags: string[];
};

export function isPieceSection(
  value: string,
): value is (typeof SECTION_ORDER)[number] {
  return (SECTION_ORDER as readonly string[]).includes(value);
}

export function piecePath(section: string, slug: string): string {
  return `/${section}/${slug}`;
}

export function pieceMarkdownPath(section: string, slug: string): string {
  return `${piecePath(section, slug)}.md`;
}

/** `/preface/foreword.md` or `/preface/foreword/llms.txt` */
export function parsePieceSeoPath(
  pathname: string,
): { section: (typeof SECTION_ORDER)[number]; slug: string } | null {
  const match = pathname.match(
    /^\/(preface|foundations|uis)\/([^/]+?)(?:\.md|\/llms\.txt)$/,
  );
  if (!match) return null;
  const section = match[1];
  const slug = match[2];
  if (!isPieceSection(section) || !slug) return null;
  return { section, slug };
}

function looksLikeTags(value: string): boolean {
  const parts = value.split(/,\s*/).map((tag) => tag.trim()).filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((tag) => /^[A-Z0-9][A-Z0-9-]*$/.test(tag))
  );
}

async function listAllPieceItems(): Promise<CollectionDocItem<PieceCard>[]> {
  const first = await cms().listCollection<PieceCard>("pieces");
  const items = [...first.items];
  let cursor = first.next_cursor ?? undefined;
  while (cursor) {
    const page = await cms().listCollection<PieceCard>("pieces", {
      limit: 100,
      cursor,
    });
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  }
  return items;
}

export async function listSeoPieces(): Promise<SeoPiece[]> {
  const items = await listAllPieceItems();
  return items
    .map((item) => {
      const section = siteSection(String(item.card?.section ?? ""));
      if (!isPieceSection(section)) return null;
      const raw =
        typeof item.card?.description === "string" ? item.card.description.trim() : "";
      const summary = raw && !looksLikeTags(raw) ? raw : "";
      const order =
        typeof item.card?.order === "number" ? item.card.order : Number.POSITIVE_INFINITY;
      const cmsTags = item.card?.tags ?? (raw && looksLikeTags(raw) ? raw : undefined);
      return {
        slug: item.slug,
        section,
        title: item.title || item.slug,
        summary,
        updated: item.updated || null,
        order,
        tags: tagsFor(item.slug, cmsTags),
      };
    })
    .filter((piece): piece is SeoPiece => piece !== null)
    .sort((a, b) => {
      const bySection =
        SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
      if (bySection) return bySection;
      return a.order - b.order;
    });
}

function stripPrivateFrontmatter(raw: string): string {
  const match = raw.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!match) return raw;
  const kept: string[] = [];
  let dropping = false;
  for (const line of match[1].split("\n")) {
    const indented = /^\s/.test(line) && line.trim() !== "";
    if (!indented) dropping = line.trim().startsWith("_");
    if (dropping) continue;
    if (line.startsWith("section:")) {
      const value = line.slice("section:".length).trim().replace(/['"]/g, "");
      kept.push(`section: ${siteSection(value)}`);
      continue;
    }
    kept.push(line);
  }
  const body = raw.slice(match[0].length);
  if (kept.every((line) => line.trim() === "")) return body;
  return `---\n${kept.join("\n")}\n---\n${body}`;
}

export async function pieceMarkdown(
  section: string,
  slug: string,
): Promise<string | null> {
  let markdown: unknown;
  try {
    markdown = await cms().getDoc("pieces", slug, { format: "md" });
  } catch (error) {
    if (cmsStatus(error) === 404) return null;
    throw error;
  }
  if (typeof markdown !== "string") return null;
  const hosted = markdown.match(/^---\n[\s\S]*?^section:\s*(\S+)/m);
  const mapped = hosted
    ? siteSection(hosted[1].replace(/['"]/g, ""))
    : section;
  if (mapped !== section) return null;
  return stripPrivateFrontmatter(markdown).replace(/\n*$/, "\n");
}

function fileCmsLinks(): string[] {
  const pages = getCollection("pages", (page) => !page.data.draft).map((page) => {
    const path = pagePath(page.slug);
    const href = `${SITE.url}${path}/llms.txt`;
    const note = page.data.description ? `: ${page.data.description}` : "";
    return `- [${page.data.title}](${href})${note}`;
  });
  const posts = getCollection("posts", (post) => !post.data.draft).map((post) => {
    const href = `${SITE.url}/_/content/${post.slug}/llms.txt`;
    const note = post.data.description ? `: ${post.data.description}` : "";
    return `- [${post.data.title}](${href})${note}`;
  });
  return [...pages, ...posts];
}

export async function buildLlmsTxt(): Promise<string> {
  let pieces: SeoPiece[] = [];
  try {
    pieces = await listSeoPieces();
  } catch {
    const fallback = getLlms();
    if (fallback) return fallback;
    throw new Error("llms.txt: content service unavailable");
  }

  const lines = [
    "# aiuis",
    "",
    "> Working notes on designing interfaces for systems that think back. HTML pages paint WebGL over hidden copy — prefer the markdown versions linked here.",
    "",
    `This index covers ${SITE.url}. Each chapter links to its markdown source (\`rel="alternate" type="text/markdown"\` on the HTML page). The concatenated corpus is at ${SITE.url}/llms-full.txt.`,
    "",
  ];

  for (const section of SECTION_ORDER) {
    const group = pieces.filter((piece) => piece.section === section);
    if (group.length === 0) continue;
    lines.push(`## ${SECTION_LABEL[section]}`, "");
    for (const piece of group) {
      const href = `${SITE.url}${pieceMarkdownPath(piece.section, piece.slug)}`;
      const note = piece.summary ? `: ${piece.summary}` : "";
      lines.push(`- [${piece.title}](${href})${note}`);
    }
    lines.push("");
  }

  const extra = fileCmsLinks();
  if (extra.length > 0) {
    lines.push("## Optional", "", ...extra, "");
  }

  return `${lines.join("\n").replace(/\n*$/, "\n")}`;
}

export async function buildLlmsFullTxt(): Promise<string> {
  const pieces = await listSeoPieces();
  const chapters: string[] = [
    "# aiuis — full text",
    "",
    `> Concatenated markdown of published chapters. Index: ${SITE.url}/llms.txt`,
    "",
  ];
  for (const piece of pieces) {
    const markdown = await pieceMarkdown(piece.section, piece.slug);
    if (!markdown) continue;
    chapters.push(
      `<!-- ${piecePath(piece.section, piece.slug)} -->`,
      markdown.trim(),
      "",
    );
  }
  return `${chapters.join("\n").replace(/\n*$/, "\n")}`;
}

export type SitemapEntry = { url: string; updated?: Date | string | null };

export async function sitemapEntries(): Promise<SitemapEntry[]> {
  const filePages: SitemapEntry[] = [
    { url: "/" },
    { url: "/preface" },
    { url: "/foundations" },
    { url: "/uis" },
    { url: "/llms.txt" },
    ...getCollection("pages", (page) => !page.data.draft).map((page) => ({
      url: pagePath(page.slug),
      updated: page.data.updated,
    })),
    ...getCollection("posts", (post) => !post.data.draft).map((post) => ({
      url: `/_/content/${post.slug}`,
      updated: post.data.updated ?? post.data.date,
    })),
  ];

  let pieces: SeoPiece[] = [];
  try {
    pieces = await listSeoPieces();
  } catch {
    return filePages;
  }

  return [
    ...filePages,
    ...pieces.map((piece) => ({
      url: piecePath(piece.section, piece.slug),
      updated: piece.updated,
    })),
    ...[...new Set(pieces.flatMap((piece) => piece.tags))].sort().map((tag) => ({
      url: `/data/${encodeURIComponent(tag)}`,
    })),
  ];
}

const LLM_CACHE = "public, max-age=60, stale-while-revalidate=600";

export function llmTextResponse(
  body: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": LLM_CACHE,
      ...extraHeaders,
    },
  });
}
