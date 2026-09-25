import { SITE } from "~/lib/site";

/** Another origin (or mailto:/tel:). Absolute links back to this site stay internal. */
export function isExternalHref(href: string): boolean {
  if (/^(mailto|tel):/i.test(href)) return true;
  if (!/^(https?:)?\/\//i.test(href)) return false;
  try {
    return new URL(href, SITE.url).origin !== new URL(SITE.url).origin;
  } catch {
    return false;
  }
}

/** Anchor attributes for an outbound link: new tab, no opener, no referrer. */
export function externalLinkProps(href: string) {
  return isExternalHref(href)
    ? ({ target: "_blank", rel: "noopener noreferrer" } as const)
    : {};
}
