import { createStore } from "solid-js/store";
import type { Scene } from "@ssscript/webgl";

const [webgl, setWebgl] = createStore({
  loaded: false,
});

// scene handle lives here (not exported from Canvas.tsx) so Canvas stays a
// component-only module — that keeps it a solid-refresh HMR boundary and
// engine edits hot-swap instead of full-reloading the page
let scene: Scene | null = null;

/** Current scene — null until <Canvas /> has mounted (client only). */
export const getScene = () => scene;
export const setScene = (next: Scene | null) => {
  scene = next;
};

export { webgl, setWebgl };
