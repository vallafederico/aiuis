// Plain .js on purpose: app.config.ts is loaded by vinxi with native node
// ESM, which can't import .ts across package boundaries.
import mdxPkg from "@vinxi/plugin-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";

const mdx = mdxPkg.default ?? mdxPkg;

/**
 * Compiles .md/.mdx into solid components. Frontmatter becomes a named
 * `frontmatter` export — that's what createContent's eager glob reads, and
 * it's also in scope inside the file ({frontmatter.title}).
 *
 * Pair with `extensions: ["mdx", "md"]` in defineConfig.
 *
 * @param {{ remarkPlugins?: any[], rehypePlugins?: any[] }} [options]
 */
export function contentPlugin(options = {}) {
	return mdx.withImports({})({
		jsx: true,
		jsxImportSource: "solid-js",
		providerImportSource: "solid-mdx",
		remarkPlugins: [
			remarkFrontmatter,
			[remarkMdxFrontmatter, { name: "frontmatter" }],
			...(options.remarkPlugins ?? []),
		],
		rehypePlugins: options.rehypePlugins ?? [],
	});
}
