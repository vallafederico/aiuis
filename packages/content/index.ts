import type { z } from "zod";

export { z } from "zod";

// ————————————————————————————————————————————————— collections

export type CollectionConfig<S extends z.ZodTypeAny = z.ZodTypeAny> = {
	/** zod schema the frontmatter is validated against */
	schema?: S;
};

export function defineCollection<S extends z.ZodTypeAny>(
	config: CollectionConfig<S>,
): CollectionConfig<S> {
	return config;
}

// ————————————————————————————————————————————————— entries

/** shape of a compiled .md/.mdx module */
export type EntryModule = {
	default: (props: Record<string, unknown>) => unknown;
	frontmatter?: Record<string, unknown>;
};

export type CollectionEntry<C extends CollectionConfig = CollectionConfig> = {
	/** "posts/hello-world" */
	id: string;
	/** file path inside the collection folder, extension stripped */
	slug: string;
	collection: string;
	/** schema-validated frontmatter */
	data: C["schema"] extends z.ZodTypeAny
		? z.output<C["schema"]>
		: Record<string, unknown>;
	/** lazy import of the compiled module — default export is the solid component */
	load: () => Promise<EntryModule>;
};

const ENTRY_RE = /^\.\/(.+?)\/(.+)\.(md|mdx)$/;

/**
 * Builds the collection index from two `import.meta.glob` results over the
 * content folder. Frontmatter is validated eagerly (a bad file fails the
 * build, not a random page view); bodies stay lazy.
 *
 *   export const { getCollection, getEntry } = createContent(collections, {
 *     frontmatter: import.meta.glob("./** /*.{md,mdx}", { eager: true, import: "frontmatter" }),
 *     modules: import.meta.glob("./** /*.{md,mdx}"),
 *   });
 */
export function createContent<C extends Record<string, CollectionConfig<any>>>(
	collections: C,
	source: {
		frontmatter: Record<string, unknown>;
		modules: Record<string, () => Promise<unknown>>;
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

		let data = (fm ?? {}) as Record<string, unknown>;
		if (config.schema) {
			const parsed = config.schema.safeParse(data);
			if (!parsed.success) {
				const issues = parsed.error.issues
					.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
					.join("\n");
				throw new Error(`[content] invalid frontmatter in ${path}\n${issues}`);
			}
			data = parsed.data;
		}

		const list = byCollection.get(collection) ?? [];
		list.push({
			id: `${collection}/${slug}`,
			slug,
			collection,
			data,
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

	return { getCollection, getEntry };
}
