import sitemapPlugin from "@crawl-me-maybe/sitemap";
import { defineConfig } from "@solidjs/start/config";
import { contentPlugin } from "@local/content/vite";
import glsl from "vite-plugin-glsl";
import solidSvg from "vite-plugin-solid-svg";
import glReloadPlugin from "./vite/vite-plugin-gl-reload";
import componentDataAttr from "./vite/vite-pulugin-component-attrs";

const plugins = [
	contentPlugin(),
	glsl({
		include: ["**/*.glsl", "**/*.vert", "**/*.frag"],
		exclude: undefined,
		warnDuplicatedImports: true,
		defaultExtension: "glsl",
		minify: false,
		watch: true,
		root: "/",
	}),
	componentDataAttr(),
	sitemapPlugin({
		domain: "https://yourdomain.com",
		outDir: "dist",
		sitemaps: {
			pages: async () => [
				{ url: "/", updated: "2025-10-17" },
				{ url: "/about", updated: "2025-10-16" },
			],
		},
	}),
	solidSvg({
		defaultAsComponent: true,
	}),
	glReloadPlugin(),
];

export default defineConfig({
	// .mdx/.md files are compiled to solid components by @local/content's plugin
	extensions: ["mdx", "md"],
	server: {
		preset: "vercel",
		prerender: {
			crawlLinks: true,
		},
		vercel: {
			config: {
				bypassToken: process.env.VERCEL_BYPASS_TOKEN,
			},
		},
	},
	vite: {
		plugins,
		resolve: {
			dedupe: ["@solidjs/router", "solid-js"],
		},
		server: {
			fs: {
				allow: [".", "../.."],
			},
		},
	},
});
