import { pagePath } from "@local/content";
import { getCollection } from "~/content";
import { SITE } from "~/lib/site";

// generated from the cms: pages route by file path, posts under /_/content
export function GET() {
	const entries = [
		...getCollection("pages", (page) => !page.data.draft).map((page) => ({
			url: pagePath(page.slug),
			updated: page.data.updated,
		})),
		...getCollection("posts", (post) => !post.data.draft).map((post) => ({
			url: `/_/content/${post.slug}`,
			updated: post.data.updated ?? post.data.date,
		})),
	];

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
	.map((entry) =>
		[
			"<url>",
			`  <loc>${SITE.url}${entry.url}</loc>`,
			...(entry.updated
				? [`  <lastmod>${entry.updated.toISOString().slice(0, 10)}</lastmod>`]
				: []),
			"</url>",
		].join("\n"),
	)
	.join("\n")}
</urlset>`;

	return new Response(xml, {
		headers: { "Content-Type": "application/xml; charset=utf-8" },
	});
}
