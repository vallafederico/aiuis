import Lenis from "lenis";
import { onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import gsap from "~/lib/gsap";

/**
 * Smooth-scrolls an inner scroll container the way the page does. The page's
 * Lenis skips it through `data-lenis-prevent`; this instance takes its wheel.
 * Call from `onMount` (or as a ref) inside a component: it cleans up with it.
 *
 * `naiveDimensions` reads the limit live: these containers grow (streamed
 * sections, boards) without their own box changing size.
 */
export function nestedScroll(el: HTMLElement): void {
  if (isServer) return;
  el.setAttribute("data-lenis-prevent", "");
  const lenis = new Lenis({
    wrapper: el,
    content: el,
    autoRaf: false,
    autoResize: false,
    naiveDimensions: true,
  });
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  onCleanup(() => {
    gsap.ticker.remove(tick);
    lenis.destroy();
  });
}
