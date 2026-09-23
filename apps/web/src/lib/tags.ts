import { query } from "@solidjs/router";
import { cmsStatus } from "~/lib/cms";
import { listSeoPieces, type SeoPiece } from "~/lib/llm-seo";
import { canonicalTagSlug, isDataTag, labelForTag } from "~/uis/meta";

export type TagPage =
  | { tag: string; label: string; pieces: SeoPiece[] }
  | { unavailable: true }
  | null;

export const getTagPage = query(async (raw: string): Promise<TagPage> => {
  "use server";
  const tag = canonicalTagSlug(decodeURIComponent(raw || ""));
  if (!isDataTag(tag)) return null;
  try {
    const pieces = (await listSeoPieces()).filter((piece) =>
      piece.tags.includes(tag),
    );
    if (pieces.length === 0) return null;
    return { tag, label: labelForTag(tag), pieces };
  } catch (error) {
    if (cmsStatus(error) === 503) return { unavailable: true };
    throw error;
  }
}, "tag-page");
