import { onCleanup, onMount } from "solid-js";
import { createScene, type Scene, type SceneOptions } from "shooosh";
import { setScene, setWebgl } from "~/lib/stores/webglStore";

export default function Canvas(props: { options?: SceneOptions }) {
  let canvas!: HTMLCanvasElement;
  let scene: Scene | null = null;

  onMount(async () => {
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
    setScene(scene);
    if (import.meta.env.DEV) (window as unknown as { __scene?: Scene }).__scene = scene;
    setWebgl({ loaded: true });
  });

  onCleanup(() => {
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
