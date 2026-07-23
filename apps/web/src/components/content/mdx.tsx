import type { JSX } from "solid-js";

/**
 * Injected into the mdx scope of every document (via <ContentProvider> for
 * slots/pages, or passed to <MDXContent> directly) — usable in markdown
 * without an import, like astro shortcodes.
 */
export const mdxComponents = {
	Marker: (props: { children?: JSX.Element }) => (
		<mark class="bg-key/15 text-key px-1">{props.children}</mark>
	),
};
