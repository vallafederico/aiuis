import { createEffect, on, onCleanup, onMount, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { useLocation } from "@acme/router";
import gsap from "~/lib/gsap";
import { aiVizActivity } from "~/lib/ai-viz-activity";
import AiViz from "./AiViz";
import { AI_VIZ_PRESETS, type AiVizParams } from "./ai-viz-params";

/** Visible glow sits inside the 14rem box; keep that glow clear of the copy and the window edge. */
const GLOW = 64;

/** Bottom-right blob. Motion eases toward the active UI's AI state. */
export default function AiVizCorner() {
  const location = useLocation();
  const [params, setParams] = createStore<AiVizParams>({ ...AI_VIZ_PRESETS.idle });
  let tween: gsap.core.Tween | undefined;
  let slot: HTMLDivElement | undefined;
  let bind = () => place();

  const place = () => {
    const el = slot;
    const col = document.querySelector(".uis-meta-col");
    if (!el || !col) return;
    const c = col.getBoundingClientRect();
    if (c.width < 1 || c.height < 1) return;
    const box = el.offsetWidth || 224;
    const cx = c.left + c.width / 2;
    const gapTop = c.bottom;
    const gapBottom = window.innerHeight;
    const minCy = gapTop + GLOW + 28;
    const maxCy = gapBottom - GLOW - 32;
    let cy = (gapTop + gapBottom) / 2;
    if (minCy <= maxCy) cy = Math.min(Math.max(cy, minCy), maxCy);
    el.style.left = `${cx - box / 2}px`;
    el.style.top = `${cy - box / 2}px`;
  };

  createEffect(
    on(aiVizActivity, (state) => {
      tween?.kill();
      const proxy: AiVizParams = { ...untrack(() => ({ ...params })) };
      tween = gsap.to(proxy, {
        ...AI_VIZ_PRESETS[state],
        duration: 0.45,
        ease: "power2.out",
        onUpdate: () => setParams({ ...proxy }),
      });
    }),
  );

  onMount(() => {
    const ro = new ResizeObserver(place);
    bind = () => {
      ro.disconnect();
      const col = document.querySelector(".uis-meta-col");
      if (col) ro.observe(col);
      place();
    };
    bind();
    const mo = new MutationObserver(bind);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("resize", place);
    onCleanup(() => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", place);
    });
  });

  createEffect(() => {
    location.pathname;
    queueMicrotask(bind);
  });

  onCleanup(() => {
    tween?.kill();
  });

  return (
    <div ref={slot} class="pointer-events-none fixed z-20 size-56">
      <AiViz params={() => params} anchor="corner" />
    </div>
  );
}
