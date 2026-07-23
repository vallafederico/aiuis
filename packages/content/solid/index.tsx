import {
	createContext,
	createMemo,
	lazy,
	Show,
	useContext,
	type Component,
	type JSX,
} from "solid-js";
import { MDXProvider } from "solid-mdx";
import { Meta, Title } from "@solidjs/meta";
import { useLocation } from "@solidjs/router";
import type { CollectionEntry, PageMetadata } from "../index";

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
	const Body = lazy(props.entry.load as () => Promise<{ default: Component }>);

	return (
		<MDXProvider components={props.components ?? {}}>
			<Body />
		</MDXProvider>
	);
}

// ————————————————————————————————————————————————— metadata

/** head tags — title/description/og — from an entry's base metadata */
export function PageMeta(props: { data: PageMetadata }) {
	return (
		<>
			<Title>{props.data.title}</Title>
			<Meta property="og:title" content={props.data.title} />
			<Show when={props.data.description}>
				{(description) => (
					<>
						<Meta name="description" content={description()} />
						<Meta property="og:description" content={description()} />
					</>
				)}
			</Show>
			<Show when={props.data.image}>
				{(image) => (
					<>
						<Meta property="og:image" content={image().src} />
						<Meta property="og:image:alt" content={image().alt} />
					</>
				)}
			</Show>
		</>
	);
}

// ————————————————————————————————————————————————— provider

type ContentApi = {
	getPage: (pathname: string) => CollectionEntry | undefined;
};

type ContentContextValue = {
	content: ContentApi;
	components: Record<string, Component<any>>;
};

const ContentContext = createContext<ContentContextValue>();

/**
 * Mounts the content api (the object returned by `createContent`) once at the
 * app root so <Slot> can resolve pages anywhere. `components` are injected
 * into the mdx scope of every document a <Slot> renders.
 */
export function ContentProvider(props: {
	content: ContentApi;
	components?: Record<string, Component<any>>;
	children: JSX.Element;
}) {
	return (
		<ContentContext.Provider
			value={{ content: props.content, components: props.components ?? {} }}
		>
			{props.children}
		</ContentContext.Provider>
	);
}

// ————————————————————————————————————————————————— slot

/**
 * Renders the cms page whose slug matches the current route — same name in
 * the cms and in the router — so a custom-developed page can pull its
 * document (head metadata + body) from `src/content/pages`.
 *
 *   // routes/about.tsx ← content/pages/about.mdx
 *   <Slot />
 *
 * `name` targets a page explicitly instead of the current path; `children`
 * render when no document matches; `meta={false}` skips the head tags (e.g.
 * for a second slot on the same page).
 */
export function Slot(props: {
	name?: string;
	components?: Record<string, Component<any>>;
	meta?: boolean;
	children?: JSX.Element;
}) {
	const ctx = useContext(ContentContext);
	if (!ctx)
		throw new Error(
			"[content] <Slot> needs a <ContentProvider> at the app root",
		);
	const location = useLocation();

	const entry = createMemo(() =>
		ctx.content.getPage(props.name ?? location.pathname),
	);

	return (
		<Show when={entry()} keyed fallback={props.children}>
			{(page) => (
				<>
					<Show when={props.meta !== false}>
						<PageMeta data={page.data} />
					</Show>
					<MDXContent
						entry={page}
						components={{ ...ctx.components, ...props.components }}
					/>
				</>
			)}
		</Show>
	);
}
