import { createMiddleware } from "@solidjs/start/middleware";
import { getEntry, getLlms, getPage } from "~/content";

/**
 * Serves llms.txt for cms-backed urls: `/llms.txt` is the base document,
 * `/<page>/llms.txt` is the entry's pair (linked in its frontmatter) or the
 * base as fallback. Urls without a cms entry fall through to the 404.
 */
export default createMiddleware({
	onRequest: (event) => {
		const url = new URL(event.request.url);
		if (!url.pathname.endsWith("/llms.txt") && url.pathname !== "/llms.txt")
			return;

		if (url.pathname === "/llms.txt") return respond(getLlms());

		const path = url.pathname.slice(0, -"/llms.txt".length);
		const entry = resolveEntry(path);
		if (!entry) return;

		return respond(getLlms(entry));
	},
});

// url → entry; posts live under /_/content/<slug>, everything else is a page
function resolveEntry(path: string) {
	const post = path.match(/^\/_\/content\/(.+)$/);
	if (post) return getEntry("posts", post[1]);
	return getPage(path);
}

const respond = (text: string | undefined) =>
	text !== undefined
		? new Response(text, {
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			})
		: undefined;
