import { lazy, type Component } from "solid-js";
import { MDXProvider } from "solid-mdx";
import type { CollectionEntry } from "../index";

export { MDXProvider } from "solid-mdx";

/**
 * Renders an entry's markdown body. `components` are injected into the mdx
 * scope (custom tags used without an import, plus html tag overrides like
 * h2/a/code). Re-mount per entry — wrap in <Show keyed> when the entry
 * changes in place.
 */
export function MDXContent(props: {
	entry: CollectionEntry;
	components?: Record<string, Component<any>>;
}) {
	const Body = lazy(
		props.entry.load as () => Promise<{ default: Component }>,
	);

	return (
		<MDXProvider components={props.components ?? {}}>
			<Body />
		</MDXProvider>
	);
}
