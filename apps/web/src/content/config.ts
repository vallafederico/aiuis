import { defineCollection, z } from "@local/content";

export const collections = {
	posts: defineCollection({
		schema: z.object({
			title: z.string(),
			description: z.string().optional(),
			date: z.coerce.date(),
			draft: z.boolean().default(false),
			tags: z.array(z.string()).default([]),
		}),
	}),
};
