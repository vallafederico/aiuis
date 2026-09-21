import { createMiddleware } from "@solidjs/start/middleware";
import { getEntry, getLlms, getPage } from "~/content";
import {
  buildLlmsFullTxt,
  buildLlmsTxt,
  llmTextResponse,
  parsePieceSeoPath,
  pieceMarkdown,
  piecePath,
} from "~/lib/llm-seo";
import { SITE } from "~/lib/site";

/**
 * LLM-facing text: `/llms.txt` is the CMS-backed index, `/llms-full.txt`
 * concatenates published chapters, piece URLs serve markdown at `.md` and
 * `/llms.txt`. File-CMS pages keep their pair documents.
 */
export default createMiddleware({
	onRequest: async (event) => {
		const url = new URL(event.request.url);

		if (url.hostname === "www.aiu.is")
			return redirect(`https://aiu.is${url.pathname}${url.search}`);

		if (url.pathname === "/llms.txt") {
			try {
				return llmTextResponse(await buildLlmsTxt());
			} catch {
				return respond(getLlms());
			}
		}

		if (url.pathname === "/llms-full.txt") {
			try {
				return llmTextResponse(await buildLlmsFullTxt());
			} catch {
				return undefined;
			}
		}

		const piece = parsePieceSeoPath(url.pathname);
		if (piece) {
			try {
				const markdown = await pieceMarkdown(piece.section, piece.slug);
				if (markdown === null) return;
				const html = `${SITE.url}${piecePath(piece.section, piece.slug)}`;
				return llmTextResponse(markdown, {
					Link: `<${html}>; rel="canonical", <${SITE.url}/llms.txt>; rel="describedby"`,
				});
			} catch {
				return undefined;
			}
		}

		if (!url.pathname.endsWith("/llms.txt")) return;

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

const redirect = (location: string) =>
	new Response(null, { status: 301, headers: { Location: location } });

const respond = (text: string | undefined) =>
	text !== undefined
		? new Response(text, {
				headers: { "Content-Type": "text/markdown; charset=utf-8" },
			})
		: undefined;
