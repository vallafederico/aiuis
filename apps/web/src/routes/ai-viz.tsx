import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
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

  const handleChange = (key: keyof AiVizParams, value: number) => {
    setParams(key, value);
    setActiveState(undefined);
  };

  const handleSelectState = (state: AiVizState) => {
    setParams({ ...AI_VIZ_PRESETS[state] });
    setActiveState(state);
  };

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
