// app.config.ts
import { defineConfig } from "@solidjs/start/config";
import { contentPlugin } from "@local/content/vite";
import glsl from "vite-plugin-glsl";
import solidSvg from "vite-plugin-solid-svg";

// vite/vite-plugin-gl-reload.js
var isGlCore = (file) => /packages\/webgl\/src\/(engine|scene)\//.test(file.replace(/\\/g, "/"));
function glReloadPlugin() {
  return {
    name: "vite-plugin-gl-reload",
    handleHotUpdate({ file, server }) {
      if (!isGlCore(file)) return;
      server.ws.send({ type: "full-reload", path: "*" });
      return [];
    }
  };
}

// vite/vite-pulugin-component-attrs.ts
function componentDataAttr() {
  return {
    name: "vite-plugin-component-data",
    enforce: "pre",
    apply: "serve",
    // dev only
    async transform(code, id) {
      if (!id.endsWith(".tsx")) return;
      const match = id.match(/\/([^/]+)\.tsx$/);
      const componentName = match?.[1];
      if (!componentName || componentName[0] !== componentName[0].toUpperCase())
        return;
      const updated = code.replace(
        /return\s*\(\s*<([A-Za-z0-9]+)/,
        `return (<$1 data-component="${componentName}"`
      );
      return { code: updated, map: null };
    }
  };
}

// app.config.ts
var plugins = [
  contentPlugin(),
  glsl({
    include: ["**/*.glsl", "**/*.vert", "**/*.frag"],
    exclude: void 0,
    warnDuplicatedImports: true,
    defaultExtension: "glsl",
    minify: false,
    watch: true,
    root: "/"
  }),
  componentDataAttr(),
  solidSvg({
    defaultAsComponent: true
  }),
  glReloadPlugin()
];
var app_config_default = defineConfig({
  // .mdx/.md files are compiled to solid components by @local/content's plugin
  extensions: ["mdx", "md"],
  // serves /llms.txt and per-page /<path>/llms.txt from the cms
  middleware: "./src/middleware.ts",
  server: {
    // cloudflare workers + static assets — deploy with `pnpm deploy` (wrangler)
    preset: "cloudflare_module",
    prerender: {
      crawlLinks: true
    }
  },
  vite: {
    plugins,
    resolve: {
      dedupe: ["@solidjs/router", "solid-js"]
    },
    server: {
      fs: {
        allow: [".", "../.."]
      }
    }
  }
});
export {
  app_config_default as default
};
