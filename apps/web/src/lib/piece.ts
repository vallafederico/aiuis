import { query } from "@solidjs/router";
import { cms, cmsStatus, siteSection } from "~/lib/cms";
import type { HastNode } from "~/components/cms/hast";
import { resolvePieceTags } from "~/lib/piece-tags";
import { isPieceVisible } from "~/lib/publish";
import { formatUpdated } from "~/uis/meta";
import { resolveUiName } from "~/uis/registry";

export type PieceResult =
  | {
      slug: string;
      section: string;
      body_hast: HastNode | null;
      title: string;
      excerpt: string;
      component: string | null;
      tags: string[];
      updated: string | null;
      updatedIso: string | null;
    }
  | { unavailable: true }
  | null;

async function publishedMeta(slug: string): Promise<{
  updated: string | null;
  updatedIso: string | null;
  tags: unknown;
}> {
  try {
    const list = await cms().listCollection("pieces");
    const item = list.items.find((entry) => entry.slug === slug);
    return {
      updated: formatUpdated(item?.updated),
      updatedIso: item?.updated ?? null,
      tags: item?.card?.tags,
    };
  } catch {
    return { updated: null, updatedIso: null, tags: undefined };
  }
}

export const getPiece = query(
  async (slug: string, expectedSection: string): Promise<PieceResult> => {
    "use server";
    if (!isPieceVisible(expectedSection, slug)) return null;
    try {
      // Independent requests: the doc and the collection listing (for updated
      // date / tags) run together instead of back to back.
      const [data, published] = await Promise.all([
        cms().getDoc("pieces", slug, { format: "json" }),
        publishedMeta(slug),
      ]);
      const section =
        typeof data.section === "string" ? siteSection(data.section) : null;
      if (!section || section !== expectedSection) return null;
      const title = typeof data.title === "string" && data.title ? data.title : slug;
      const body_hast = (data.body_hast as HastNode | undefined) ?? null;
      const excerpt = typeof data.excerpt === "string" ? data.excerpt : "";
      const component = resolveUiName(
        (data as { component?: unknown }).component,
        slug,
        section,
      );
      const tags = await resolvePieceTags(
        slug,
        {
          tags: (data as { tags?: unknown }).tags ?? published.tags,
          description: (data as { description?: unknown }).description,
        },
        cms(),
      );
      return {
        slug,
        section,
        body_hast,
        title,
        excerpt,
        component,
        tags,
        updated: published.updated,
        updatedIso: published.updatedIso,
      };
    } catch (e: unknown) {
      const status = cmsStatus(e);
      if (status === 404) return null;
      if (status === 503) return { unavailable: true };
      throw e;
    }
  },
);
