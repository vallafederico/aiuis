import { onCleanup, onMount } from "solid-js";
import { createScene, type Scene, type SceneOptions } from "@ssscript/webgl";
import { setWebgl } from "~/lib/stores/webglStore";

let scene: Scene | null = null;

/** Current scene — null until <Canvas /> has mounted (client only). */
export const getScene = () => scene;

export default function Canvas(props: { options?: SceneOptions }) {
  let canvas!: HTMLCanvasElement;

  onMount(async () => {
    scene = createScene(canvas, {
      dpr: { max: 2 },
      onInitError: (error) => console.error("[webgl]", error),
      ...props.options,
      autoInit: false,
    });
    await scene.init();
    if (import.meta.env.DEV) (window as unknown as { __scene?: Scene }).__scene = scene;
    setWebgl({ loaded: true });
  });

  onCleanup(() => {
    scene?.destroy();
    scene = null;
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
