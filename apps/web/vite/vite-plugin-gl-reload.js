import path from "node:path";
import { fileURLToPath } from "node:url";

const normalize = (filePath) => filePath.replace(/\\/g, "/");
const currentDir = path.dirname(fileURLToPath(import.meta.url));

// @ssscript/webgl is pnpm-linked from workspace/LIBS — a rebuild there (pnpm dev
// in the lib) rewrites dist/, which should hard-reload the app.
export default function glReloadPlugin() {
  const packagePath = normalize(
    path.resolve(currentDir, "../../../../LIBS/ssscript-webgl/dist"),
  );
  const isWebglPackageFile = (file) =>
    normalize(file).includes("/ssscript-webgl/dist/");

  return {
    name: "vite-plugin-gl-reload",
    configureServer(server) {
      // Ensure Vite watcher listens for the linked package too.
      server.watcher.add(packagePath);

      const triggerFullReload = (file) => {
        if (!isWebglPackageFile(file)) return;
        server.ws.send({
          type: "full-reload",
          path: "*",
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
        path: "*",
      });
      return [];
    },
  };
}
