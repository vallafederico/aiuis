import { createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import gsap from "~/lib/gsap";
import Metadata from "~/components/Metadata";
import AiViz from "~/components/webgl/AiViz";
import AiVizControls from "~/components/webgl/AiVizControls";
import {
  AI_VIZ_DEFAULTS,
  AI_VIZ_PRESETS,
  type AiVizParams,
  type AiVizState,
} from "~/components/webgl/ai-viz-params";

export default function AiVizPage() {
  const [params, setParams] = createStore<AiVizParams>({ ...AI_VIZ_DEFAULTS });
  const [activeState, setActiveState] = createSignal<AiVizState>();

  let tween: gsap.core.Tween | undefined;

  const handleChange = (key: keyof AiVizParams, value: number) => {
    tween?.kill();
    tween = undefined;
    setParams(key, value);
    setActiveState(undefined);
  };

  const handleSelectState = (state: AiVizState) => {
    tween?.kill();
    setActiveState(state);
    const proxy: AiVizParams = { ...params };
    tween = gsap.to(proxy, {
      ...AI_VIZ_PRESETS[state],
      duration: 0.4,
      ease: "power2.out",
      onUpdate: () => {
        setParams({ ...proxy });
      },
    });
  };

  onCleanup(() => {
    tween?.kill();
  });

  return (
    <>
      <Metadata
        title="AI Viz"
        description="AI visualization"
      />
      <div class="relative h-svh min-h-svh w-full overflow-hidden">
        <AiViz params={() => params} />
        <AiVizControls
          params={params}
          onChange={handleChange}
          activeState={activeState()}
          onSelectState={handleSelectState}
        />
      </div>
    </>
  );
}
