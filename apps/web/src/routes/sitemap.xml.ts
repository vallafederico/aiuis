import { sitemapEntries } from "~/lib/llm-seo";
import { SITE } from "~/lib/site";

function lastmod(updated: Date | string | null | undefined): string | null {
	if (!updated) return null;
	const date = updated instanceof Date ? updated : new Date(updated);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10);
}

export async function GET() {
	const entries = await sitemapEntries();

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
	.map((entry) => {
		const mod = lastmod(entry.updated);
		return [
			"<url>",
			`  <loc>${SITE.url}${entry.url}</loc>`,
			...(mod ? [`  <lastmod>${mod}</lastmod>`] : []),
			"</url>",
		].join("\n");
	})
	.join("\n")}
</urlset>`;

	return new Response(xml, {
		headers: { "Content-Type": "application/xml; charset=utf-8" },
	});
}
