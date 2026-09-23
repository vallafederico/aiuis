import type { CmsClient } from "@content-software/client";
import {
  cmsTagsFromCard,
  labelsFromCms,
  tagsFor,
  tagsFromMarkdown,
} from "~/uis/meta";

type PieceCard = {
  description?: unknown;
  tags?: unknown;
};

/** Resolve canonical DATA tag slugs for a piece (card → markdown → uiTags). */
export async function resolvePieceTags(
  slug: string,
  card: PieceCard | undefined,
  cms: CmsClient,
): Promise<string[]> {
  let cmsTags: unknown = cmsTagsFromCard(card);
  if (labelsFromCms(cmsTags).length === 0) {
    try {
      const markdown = await cms.getDoc("pieces", slug, { format: "md" });
      if (typeof markdown === "string") {
        cmsTags = tagsFromMarkdown(markdown) ?? cmsTags;
      }
    } catch {
      /* list + piece paths treat missing docs as untagged */
    }
  }
  return tagsFor(slug, cmsTags);
}
