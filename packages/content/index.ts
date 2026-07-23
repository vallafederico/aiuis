import { z } from "zod";

export { z };

// ————————————————————————————————————————————————— metadata

/**
 * Every entry carries page metadata by default — the fields <PageMeta> needs
 * to render a document's head (title, description, og image). Collection
 * schemas extend this; a collection can also override a field.
 */
export const metadata = z.object({
	title: z.string(),
	description: z.string().optional(),
	image: z.object({ src: z.string(), alt: z.string().default("") }).optional(),
	draft: z.boolean().default(false),
	/** last content change — sitemap lastmod */
	updated: z.coerce.date().optional(),
	/** link to a pair llms.txt document overriding the base one for this entry */
	llms: z.string().optional(),
});

export type PageMetadata = z.output<typeof metadata>;

// ————————————————————————————————————————————————— collections

export type CollectionConfig = {
	/** zod schema for frontmatter fields beyond the base `metadata` */
	schema?: z.AnyZodObject;
};

// overloads keep `schema` non-optional in the returned type, so entry data
// can be conditionally typed on its presence
export function defineCollection<S extends z.AnyZodObject>(config: {
	schema: S;
}): { schema: S };
export function defineCollection(config?: Record<string, never>): {
	schema?: undefined;
};
export function defineCollection(config: CollectionConfig = {}): CollectionConfig {
	return config;
}

// ————————————————————————————————————————————————— entries

/** shape of a compiled .md/.mdx module */
export type EntryModule = {
	default: (props: Record<string, unknown>) => unknown;
	frontmatter?: Record<string, unknown>;
};

type EntryData<C extends CollectionConfig> = C extends {
	schema: infer S extends z.AnyZodObject;
}
	? PageMetadata & z.output<S>
	: PageMetadata;

export type CollectionEntry<C extends CollectionConfig = CollectionConfig> = {
	/** "posts/hello-world" */
	id: string;
	/** file path inside the collection folder, extension stripped */
	slug: string;
	collection: string;
	/** schema-validated frontmatter: base metadata + collection fields */
	data: EntryData<C>;
	/** text of the llms.txt pair document linked in the frontmatter */
	llms?: string;
	/** lazy import of the compiled module — default export is the solid component */
	load: () => Promise<EntryModule>;
};

const ENTRY_RE = /^\.\/(.+?)\/(.+)\.(md|mdx)$/;

/** page slug → url path ("about/index" → "/about", "index" → "/") */
export function pagePath(slug: string): string {
	const path = slug.replace(/(^|\/)index$/, "$1").replace(/\/+$/, "");
	return `/${path}`;
}

/** url path → page slug ("/about/" → "about", "/" → "index") */
function pageSlug(pathname: string): string {
	const path = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "");
	return path === "" ? "index" : path;
}

type PagesConfig<C extends Record<string, CollectionConfig>> = C extends {
	pages: infer P extends CollectionConfig;
}
	? P
	: CollectionConfig;

/** the base llms.txt lives at the content root */
const LLMS_BASE = "./llms.txt";

/** resolve a frontmatter document link against the entry's folder (./x) or the content root */
function resolveDoc(dir: string, link: string): string {
	const from = link.startsWith(".") ? `${dir}/${link}` : `./${link}`;
	const parts: string[] = [];
	for (const part of from.split("/")) {
		if (part === "." || part === "") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `./${parts.join("/")}`;
}

/**
 * Builds the collection index from two `import.meta.glob` results over the
 * content folder. Frontmatter is validated eagerly (a bad file fails the
 * build, not a random page view); bodies stay lazy.
 *
 *   export const { getCollection, getEntry, getPage, getLlms } = createContent(collections, {
 *     frontmatter: import.meta.glob("./** /*.{md,mdx}", { eager: true, import: "frontmatter" }),
 *     modules: import.meta.glob("./** /*.{md,mdx}"),
 *     llms: import.meta.glob(["./llms.txt", "./** /*.llms.txt"], { eager: true, query: "?raw", import: "default" }),
 *   });
 */
export function createContent<C extends Record<string, CollectionConfig>>(
	collections: C,
	source: {
		frontmatter: Record<string, unknown>;
		modules: Record<string, () => Promise<unknown>>;
		/** raw text of llms.txt documents — the base at the root plus per-entry pairs */
		llms?: Record<string, string>;
	},
) {
	const byCollection = new Map<string, CollectionEntry<C[keyof C]>[]>();

	for (const [path, fm] of Object.entries(source.frontmatter)) {
		const match = path.match(ENTRY_RE);
		if (!match) continue; // files outside a collection folder are ignored
		const [, collection, slug] = match;

		const config = collections[collection];
		if (!config) {
			console.warn(`[content] "${path}" is not a defined collection — skipped`);
			continue;
		}

		const schema = config.schema ? metadata.merge(config.schema) : metadata;
		const parsed = schema.safeParse(fm ?? {});
		if (!parsed.success) {
			const issues = parsed.error.issues
				.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
				.join("\n");
			throw new Error(`[content] invalid frontmatter in ${path}\n${issues}`);
		}

		// the frontmatter links its llms.txt pair — resolve it eagerly so a
		// dead link fails the build, not a crawler request
		let llms: string | undefined;
		if (parsed.data.llms) {
			const key = resolveDoc(path.slice(0, path.lastIndexOf("/")), parsed.data.llms);
			llms = source.llms?.[key];
			if (llms === undefined)
				throw new Error(
					`[content] ${path}: linked llms document "${parsed.data.llms}" not found (looked for ${key})`,
				);
		}

		const list = byCollection.get(collection) ?? [];
		list.push({
			id: `${collection}/${slug}`,
			slug,
			collection,
			data: parsed.data,
			llms,
			load: source.modules[path],
		} as CollectionEntry<C[keyof C]>);
		byCollection.set(collection, list);
	}

	function getCollection<K extends keyof C & string>(
		name: K,
		filter?: (entry: CollectionEntry<C[K]>) => boolean,
	): CollectionEntry<C[K]>[] {
		const list = (byCollection.get(name) ?? []) as CollectionEntry<C[K]>[];
		return filter ? list.filter(filter) : [...list];
	}

	function getEntry<K extends keyof C & string>(
		name: K,
		slug: string,
	): CollectionEntry<C[K]> | undefined {
		return getCollection(name).find((entry) => entry.slug === slug);
	}

	/**
	 * Resolves a url pathname (or a bare slug) to an entry of the `pages`
	 * collection: "/about" → pages/about.mdx or pages/about/index.mdx.
	 * Drafts resolve only in dev, so an unfinished page never ships.
	 */
	function getPage(pathname: string): CollectionEntry<PagesConfig<C>> | undefined {
		const slug = pageSlug(pathname);
		const pages = (byCollection.get("pages") ?? []) as unknown as CollectionEntry<PagesConfig<C>>[];
		const entry = pages.find(
			(e) => e.slug === slug || e.slug === `${slug}/index`,
		);
		// package is consumed as source by the app's vite, so import.meta.env exists
		const prod = (import.meta as { env?: { PROD?: boolean } }).env?.PROD;
		if (entry?.data.draft && prod) return undefined;
		return entry;
	}

	/**
	 * llms.txt for an entry: the pair document linked in its frontmatter
	 * (`llms: ./about.llms.txt`), else the base `llms.txt` at the content
	 * root. No argument → the base document.
	 */
	function getLlms(entry?: CollectionEntry): string | undefined {
		return entry?.llms ?? source.llms?.[LLMS_BASE];
	}

	return { getCollection, getEntry, getPage, getLlms };
}
