import { createContent } from "@local/content";
import { collections } from "./config";

export const { getCollection, getEntry, getPage, getLlms } = createContent(
	collections,
	{
		frontmatter: import.meta.glob("./**/*.{md,mdx}", {
			eager: true,
			import: "frontmatter",
		}),
		modules: import.meta.glob("./**/*.{md,mdx}"),
		llms: import.meta.glob(["./llms.txt", "./**/*.llms.txt"], {
			eager: true,
			query: "?raw",
			import: "default",
		}) as Record<string, string>,
	},
);
