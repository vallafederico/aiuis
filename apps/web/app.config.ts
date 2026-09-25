import { defineConfig } from "@solidjs/start/config";
import { contentPlugin } from "@local/content/vite";
import { fileURLToPath } from "node:url";
import glsl from "vite-plugin-glsl";
import solidSvg from "vite-plugin-solid-svg";
import { shoooshShaders } from "../../../shooosh/package/build/index.ts";
import glReloadPlugin from "./vite/vite-plugin-gl-reload";
import componentDataAttr from "./vite/vite-pulugin-component-attrs";

/**
 * vinxi emits the route's <link rel="modulepreload"> tags at default (high)
 * priority, so ~30 hydration chunks compete with the render-blocking CSS and
 * fonts for the first paint. Low priority lets the page paint first.
 */
function lowPriorityModulePreloads() {
	const from = `: { rel: "modulepreload" }`;
	return {
		name: "aiuis:low-priority-modulepreload",
		transform(code: string, id: string) {
			if (!id.includes("vinxi/lib/manifest/prod-server-manifest")) return;
			if (!code.includes(from)) {
				throw new Error("[aiuis:low-priority-modulepreload] vinxi manifest changed; update the pattern.");
			}
			return code.replace(from, `: { rel: "modulepreload", fetchPriority: "low" }`);
		},
	};
}

const shoooshRoot = new URL("../../../shooosh/package/", import.meta.url);
const contentSoftwareRoot = new URL("../../../content.software/", import.meta.url);

const plugins = [
	contentPlugin(),
	shoooshShaders(),
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
	// /llms.txt, /llms-full.txt, piece .md, and file-CMS pair documents
	middleware: "./src/middleware.ts",
	server: {
		// cloudflare workers + static assets — deploy with `pnpm deploy` (wrangler)
		preset: "cloudflare_module",
		prerender: {
			crawlLinks: true,
		},
		routeRules: {
			"/preface/**": { prerender: false },
			"/foundations/**": { prerender: false },
			"/uis/**": { prerender: false },
			"/api/**": { prerender: false },
			"/llms.txt": { prerender: false },
			"/llms-full.txt": { prerender: false },
		},
		rollupConfig: {
			plugins: [lowPriorityModulePreloads()],
		},
	},
	vite: {
		plugins,
		define: {
			__SHOOOSH_GPU__: true,
			__SHOOOSH_GL__: true,
		},
		ssr: {
			noExternal: ["@content-software/client", "@content-software/json"],
		},
		resolve: {
			dedupe: ["@solidjs/router", "solid-js"],
			alias: {
				"@content-software/client": fileURLToPath(
					new URL("./packages/client/src/index.ts", contentSoftwareRoot),
				),
				"@content-software/json": fileURLToPath(
					new URL("./packages/json/src/index.ts", contentSoftwareRoot),
				),
				"shooosh/compiler": fileURLToPath(new URL("./compiler/index.ts", shoooshRoot)),
				"shooosh/build": fileURLToPath(new URL("./build/index.ts", shoooshRoot)),
				shooosh: fileURLToPath(new URL("./index.ts", shoooshRoot)),
			},
		},
		server: {
			fs: {
				allow: [".", "../..", fileURLToPath(shoooshRoot), fileURLToPath(contentSoftwareRoot)],
			},
		},
	},
});
