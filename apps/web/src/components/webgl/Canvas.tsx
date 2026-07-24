import { onCleanup, onMount } from "solid-js";
import { createScene, type Scene, type SceneOptions } from "@ssscript/webgl";
import { setScene, setWebgl } from "~/lib/stores/webglStore";

export default function Canvas(props: { options?: SceneOptions }) {
  let canvas!: HTMLCanvasElement;
  let scene: Scene | null = null;

  onMount(async () => {
    scene = createScene(canvas, {
      dpr: { max: 2 },
      clearColor: { r: 0.9137, g: 0.9137, b: 0.9176, a: 1 },
      onInitError: (error) => console.error("[webgl]", error),
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
