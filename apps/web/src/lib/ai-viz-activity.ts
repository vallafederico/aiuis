import { createSignal } from "solid-js";
import type { AiVizState } from "~/components/webgl/ai-viz-params";

const [activity, setActivity] = createSignal<AiVizState>("idle");
let respondTimer: ReturnType<typeof setTimeout> | undefined;

/** What the AI on the current UI page is doing. The corner viz follows this. */
export function aiVizActivity() {
  return activity();
}

export function setAiVizActivity(state: AiVizState) {
  clearTimeout(respondTimer);
  respondTimer = undefined;
  setActivity(state);
}

/** Outward beat when a result lands, then rest unless a newer state arrives. */
export function pulseAiVizResponse() {
  setAiVizActivity("responding");
  respondTimer = setTimeout(() => {
    if (activity() === "responding") setActivity("idle");
  }, 700);
}

export function resetAiVizActivity() {
  setAiVizActivity("idle");
}
