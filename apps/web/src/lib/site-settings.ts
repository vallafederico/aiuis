/**
 * Site-wide data from the CMS `site` collection (one document, slug `site`):
 * the author and the outbound links. Read in the nav corner, in /llms.txt and
 * in every page's structured data. Until the collection exists on the host,
 * the fallback below keeps the site rendering the same links.
 */
import { query } from "@solidjs/router";

export type SiteLink = { label: string; href: string };

export type SiteSettings = {
  author: string;
  authorUrl: string;
  links: SiteLink[];
  /** Where these came from, for debugging: the CMS, or the in-code fallback. */
  source: "cms" | "fallback";
};

export const SITE_FALLBACK: SiteSettings = {
  author: "Federico",
  authorUrl: "https://federic.ooo/",
  links: [
    { label: "Portfolio", href: "https://federic.ooo/" },
    { label: "Twitter", href: "https://federic.ooo/s/twitter" },
    { label: "Instagram", href: "https://federic.ooo/s/instagram" },
  ],
  source: "fallback",
};

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function parse(data: Record<string, unknown>): SiteSettings | null {
  const links = (Array.isArray(data.links) ? data.links : [])
    .map((item) => {
      const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return { label: str(rec.label), href: str(rec.href) };
    })
    .filter((link) => link.label && /^https?:\/\//.test(link.href));
  const author = str(data.author);
  if (!author && links.length === 0) return null;
  return {
    author: author || SITE_FALLBACK.author,
    authorUrl: str(data.author_url) || SITE_FALLBACK.authorUrl,
    links,
    source: "cms",
  };
}

export async function loadSiteSettings(): Promise<SiteSettings> {
  // Dynamic: Nav and Metadata import this module on every page's client graph,
  // and the CMS client must stay on the server.
  const { cms, cmsStatus } = await import("~/lib/cms");
  try {
    const data = await cms().getDoc("site", "site", { format: "json" });
    return parse(data as unknown as Record<string, unknown>) ?? SITE_FALLBACK;
  } catch (error) {
    // 404 until the `site` collection and document exist; anything else is logged.
    if (cmsStatus(error) !== 404) console.warn("site settings: CMS unreachable", error);
    return SITE_FALLBACK;
  }
}

export const getSite = query(async (): Promise<SiteSettings> => {
  "use server";
  return loadSiteSettings();
}, "site-settings");
