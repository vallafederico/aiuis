import { SITE } from "~/lib/site";

const robots = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE.url}/sitemap.xml
`;

export function GET() {
	return new Response(robots, {
		headers: { "Content-Type": "text/plain" },
	});
}
