import { createContext, onCleanup, onMount, type JSX } from "solid-js";
import { bindArticleFocus, updateArticleFocus } from "~/lib/article-focus";

export const PieceReadContext = createContext(false);

/** Article column. */
export function ArticleFocus(props: { children: JSX.Element }) {
  let root: HTMLDivElement | undefined;

  onMount(() => {
    const stop = bindArticleFocus();
    const observer = new ResizeObserver(() => updateArticleFocus());
    if (root) observer.observe(root);
    onCleanup(() => {
      stop();
      observer.disconnect();
    });
  });

  return (
    <div ref={root} class="w-full">
      <PieceReadContext.Provider value={true}>
        {props.children}
      </PieceReadContext.Provider>
    </div>
  );
}
