import { defineCollection, z } from "@local/content";

// every collection gets the base metadata (title, description, image, draft)
// for free — schemas here only add collection-specific fields
export const collections = {
	/** routed documents: file path = url path (pages/about.mdx → /about) */
	pages: defineCollection({}),
	posts: defineCollection({
		schema: z.object({
			date: z.coerce.date(),
			tags: z.array(z.string()).default([]),
		}),
	}),
};
