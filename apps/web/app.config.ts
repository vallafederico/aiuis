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
	solidSvg({
		defaultAsComponent: true,
	}),
	glReloadPlugin(),
];

export default defineConfig({
	// .mdx/.md files are compiled to solid components by @local/content's plugin
	extensions: ["mdx", "md"],
	// serves /llms.txt and per-page /<path>/llms.txt from the cms
	middleware: "./src/middleware.ts",
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
