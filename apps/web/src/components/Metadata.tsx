import { Title, Meta, Link } from "@solidjs/meta";
import { SITE } from "~/lib/site";

const DEFAULTS = {
  title: "aiuis",
  description: "Working notes on designing interfaces for systems that think back.",
  image: { src: `${SITE.url}/og.png`, alt: "aiuis" },
};

export default function Metadata({
  title = DEFAULTS.title,
  description = DEFAULTS.description,
  image = DEFAULTS.image,
  path,
  type = "website",
  markdown,
  dateModified,
}: {
  title?: string;
  description?: string;
  image?: { src: string; alt: string };
  path?: string;
  type?: "website" | "article";
  markdown?: string;
  dateModified?: string | null;
}) {
  const canonical = path
    ? `${SITE.url}${path === "/" ? "" : path}`
    : undefined;
  const markdownHref = markdown
    ? markdown.startsWith("http")
      ? markdown
      : `${SITE.url}${markdown}`
    : undefined;

  const jsonLd = canonical
    ? {
        "@context": "https://schema.org",
        "@type": type === "article" ? "Article" : "WebSite",
        name: title,
        headline: title,
        description,
        url: canonical,
        isPartOf: {
          "@type": "WebSite",
          name: "aiuis",
          url: SITE.url,
        },
        ...(dateModified ? { dateModified } : {}),
      }
    : null;

  return (
    <>
      <Title>{title}</Title>
      <Meta name="description" content={description} />
      <Meta property="og:site_name" content="aiuis" />
      <Meta property="og:title" content={title} />
      <Meta property="og:description" content={description} />
      <Meta property="og:type" content={type} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={title} />
      <Meta name="twitter:description" content={description} />
      {canonical && <Link rel="canonical" href={canonical} />}
      {canonical && <Meta property="og:url" content={canonical} />}
      {image.src && <Meta property="og:image" content={image.src} />}
      {image.src && <Meta property="og:image:alt" content={image.alt} />}
      {image.src && <Meta property="og:image:width" content="1200" />}
      {image.src && <Meta property="og:image:height" content="630" />}
      {image.src && <Meta name="twitter:image" content={image.src} />}
      {image.src && <Meta name="twitter:image:alt" content={image.alt} />}
      {markdownHref && (
        <Link rel="alternate" type="text/markdown" href={markdownHref} />
      )}
      <Link rel="describedby" href={`${SITE.url}/llms.txt`} />
      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(jsonLd).replace(/</g, "\\u003c")}
        </script>
      )}
    </>
  );
}
