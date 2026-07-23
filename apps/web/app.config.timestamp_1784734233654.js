// app.config.ts
import sitemapPlugin from "@crawl-me-maybe/sitemap";
import { defineConfig } from "@solidjs/start/config";
import { contentPlugin } from "@local/content/vite";
import glsl from "vite-plugin-glsl";
import solidSvg from "vite-plugin-solid-svg";

// vite/vite-plugin-gl-reload.js
import path from "node:path";
import { fileURLToPath } from "node:url";
var normalize = (filePath) => filePath.replace(/\\/g, "/");
var currentDir = path.dirname(fileURLToPath(import.meta.url));
function glReloadPlugin() {
  const packagePath = normalize(
    path.resolve(currentDir, "../../../../LIBS/ssscript-webgl/dist")
  );
  const isWebglPackageFile = (file) => normalize(file).includes("/ssscript-webgl/dist/");
  return {
    name: "vite-plugin-gl-reload",
    configureServer(server) {
      server.watcher.add(packagePath);
      const triggerFullReload = (file) => {
        if (!isWebglPackageFile(file)) return;
        server.ws.send({
          type: "full-reload",
          path: "*"
        });
      };
      server.watcher.on("add", triggerFullReload);
      server.watcher.on("change", triggerFullReload);
      server.watcher.on("unlink", triggerFullReload);
    },
    handleHotUpdate({ file, server }) {
      if (!isWebglPackageFile(file)) return;
      server.ws.send({
        type: "full-reload",
        path: "*"
      });
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
  sitemapPlugin({
    domain: "https://yourdomain.com",
    outDir: "dist",
    sitemaps: {
      pages: async () => [
        { url: "/", updated: "2025-10-17" },
        { url: "/about", updated: "2025-10-16" }
      ]
    }
  }),
  solidSvg({
    defaultAsComponent: true
  }),
  glReloadPlugin()
];
var app_config_default = defineConfig({
  // .mdx/.md files are compiled to solid components by @local/content's plugin
  extensions: ["mdx", "md"],
  server: {
    preset: "vercel",
    prerender: {
      crawlLinks: true
    },
    vercel: {
      config: {
        bypassToken: process.env.VERCEL_BYPASS_TOKEN
      }
    }
  },
  vite: {
    plugins,
    resolve: {
      dedupe: ["@solidjs/router", "solid-js"]
    },
    server: {
      fs: {
        // @ssscript/webgl is pnpm-linked from workspace/LIBS — allow serving it in dev
        allow: [".", "../..", "../../../LIBS/ssscript-webgl"]
      }
    }
  }
});
export {
  app_config_default as default
};
