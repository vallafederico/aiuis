import { Scroll } from "~/lib/utils/scroll";

export type ArticleFocusSample = {
  scale: number;
  alpha: number;
  blur: number;
};

type Line = {
  el: HTMLElement;
  apply: (sample: ArticleFocusSample) => void;
};

const lines = new Set<Line>();

/** Lines stay put. Edge scramble lives in the post pass, not on the glyphs. */
export function sampleArticleFocus(_el: HTMLElement): ArticleFocusSample {
  return { scale: 1, alpha: 1, blur: 0 };
}

export function registerArticleLine(
  el: HTMLElement,
  apply: (sample: ArticleFocusSample) => void,
) {
  const line: Line = { el, apply };
  lines.add(line);
  apply(sampleArticleFocus(el));
  return () => lines.delete(line);
}

export function updateArticleFocus() {
  for (const line of lines) {
    if (!line.el.isConnected) continue;
    line.apply(sampleArticleFocus(line.el));
  }
}

export function bindArticleFocus() {
  const off = Scroll.add(() => updateArticleFocus());
  window.addEventListener("resize", updateArticleFocus);
  updateArticleFocus();
  return () => {
    off();
    window.removeEventListener("resize", updateArticleFocus);
  };
}
