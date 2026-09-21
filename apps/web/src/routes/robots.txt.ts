import { SITE } from "~/lib/site";

const robots = `User-agent: *
Allow: /
Disallow: /api/

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Anthropic-AI
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

# LLM index (https://llmstxt.org)
# ${SITE.url}/llms.txt

Sitemap: ${SITE.url}/sitemap.xml
`;

export function GET() {
	return new Response(robots, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
