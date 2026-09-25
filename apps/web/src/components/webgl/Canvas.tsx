import { onCleanup, onMount } from "solid-js";
import { createScene, type Scene, type SceneOptions } from "shooosh";
import { setScene, setWebgl } from "~/lib/stores/webglStore";

const START_CAP_MS = 1500;

function firstPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (performance.getEntriesByName("first-contentful-paint").length) {
      resolve();
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        if (!list.getEntriesByName("first-contentful-paint").length) return;
        observer.disconnect();
        resolve();
      });
      observer.observe({ type: "paint", buffered: true });
    } catch {
      resolve();
    }
  });
}

function pageLoad(): Promise<void> {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true });
  });
}

/**
 * Resolves once the first contentful frame is on screen and the page has
 * loaded, or after a cap. Shader links and atlas uploads queue in the GPU
 * process ahead of compositor frames, so starting the scene first can hold
 * FCP back by seconds; the 2 MB of MSDF atlases would also compete with the
 * page's own requests.
 */
function readyForScene(): Promise<void> {
  const cap = new Promise<void>((resolve) => window.setTimeout(resolve, START_CAP_MS));
  return Promise.race([Promise.all([firstPaint(), pageLoad()]).then(() => {}), cap]);
}

export default function Canvas(props: { options?: SceneOptions }) {
  let canvas!: HTMLCanvasElement;
  let scene: Scene | null = null;
  let disposed = false;

  onMount(async () => {
    await readyForScene();
    if (disposed) return;
    scene = createScene(canvas, {
      // Site shaders are authored as GLSL 300 es (nav "weird" MSDF bakes
      // glyph arrays, SDF, AiViz). WebGPU ignores that escape hatch, so the
      // nav/page-numbers vanish and coverage looks washed. Pin WebGL2 to
      // match the deployed look.
      backend: "webgl2",
      // Native retina (2), not 1.5 — that upsample is what made MSDF look soft.
      // No `scale: 2` supersample: the fullscreen distortion pass would 4× fill.
      dpr: { max: 2 },
      clearColor: { r: 0.9137, g: 0.9137, b: 0.9176, a: 1 },
      onInitError: (error) => console.error("[shooosh]", error),
      ...props.options,
      autoInit: false,
    });
    await scene.init();
    if (disposed) return;
    setScene(scene);
    if (import.meta.env.DEV) (window as unknown as { __scene?: Scene }).__scene = scene;
    setWebgl({ loaded: true });
  });

  onCleanup(() => {
    disposed = true;
    scene?.destroy();
    scene = null;
    setScene(null);
    setWebgl({ loaded: false });
  });

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      class="pointer-events-none fixed inset-0 -z-10 h-lvh w-screen"
    />
  );
}
