import { createCmsClient, CmsClientError, type CmsClient } from "@content-software/client";

export { CmsClientError };

/** Hosted default pieces schema uses notes/product; the site nav is preface/uis. */
const HOSTED_SECTION_TO_SITE: Record<string, string> = {
  notes: "preface",
  product: "uis",
  foundations: "foundations",
  preface: "preface",
  uis: "uis",
};

export function siteSection(section: string): string {
  return HOSTED_SECTION_TO_SITE[section] ?? section;
}

function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value?.trim() || undefined;
}

let cached: CmsClient | null = null;

export function cms(): CmsClient {
  if (cached) return cached;
  cached = createCmsClient({
    projectId: env("CONTENT_PROJECT_ID"),
    baseUrl: env("CONTENT_API_URL"),
    cdnUrl: env("CONTENT_CDN_URL"),
    token: env("CONTENT_TOKEN"),
  });
  return cached;
}

export function cmsStatus(error: unknown): number | undefined {
  if (error instanceof CmsClientError) return error.status;
  if (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
}
