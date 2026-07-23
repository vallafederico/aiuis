const robots = `User-agent: *
Allow: /
Disallow: /api/
`;

export function GET() {
	return new Response(robots, {
		headers: { "Content-Type": "text/plain" },
	});
}
