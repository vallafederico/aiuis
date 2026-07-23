import { createContent } from "@local/content";
import { collections } from "./config";

export const { getCollection, getEntry } = createContent(collections, {
	frontmatter: import.meta.glob("./**/*.{md,mdx}", {
		eager: true,
		import: "frontmatter",
	}),
	modules: import.meta.glob("./**/*.{md,mdx}"),
});
