// @ssscript/webgl hot-reloads like solid components — items/screens rebuild
// via component remounts. The exception is the engine/scene core: it owns
// singleton state (default engine, raf loop) and <Canvas /> lives at the app
// root above every HMR boundary, so core edits can't hot-swap — new items
// would register against a never-initialised engine instance and the page
// goes blank. Full-reload for those two folders only.
const isGlCore = (file) =>
  /packages\/webgl\/src\/(engine|scene)\//.test(file.replace(/\\/g, "/"));

export default function glReloadPlugin() {
  return {
    name: "vite-plugin-gl-reload",
    handleHotUpdate({ file, server }) {
      if (!isGlCore(file)) return;
      server.ws.send({ type: "full-reload", path: "*" });
      return [];
    },
  };
}
