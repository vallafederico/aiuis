import { For } from "solid-js";
import {
  AI_VIZ_STATES,
  type AiVizParams,
  type AiVizState,
} from "./ai-viz-params";

type SliderDef = {
  key: keyof AiVizParams;
  label: string;
  min: number;
  max: number;
  step: number;
};

const SLIDERS: SliderDef[] = [
  { key: "breathPeriod", label: "breath period (s)", min: 1, max: 8, step: 0.1 },
  { key: "pulseAmount", label: "pulse amount", min: 0, max: 0.25, step: 0.005 },
  { key: "rotateSpeed", label: "rotate speed", min: 0, max: 0.4, step: 0.005 },
  { key: "deformAmount", label: "deform amount", min: 0, max: 0.15, step: 0.005 },
  { key: "deformSpeed", label: "deform speed", min: 0, max: 1, step: 0.01 },
  { key: "layerOpacity", label: "layer opacity", min: 0, max: 1, step: 0.01 },
  { key: "driftAmount", label: "drift amount", min: 0, max: 3, step: 0.05 },
];

export default function AiVizControls(props: {
  params: AiVizParams;
  onChange: (key: keyof AiVizParams, value: number) => void;
  activeState?: AiVizState;
  onSelectState: (state: AiVizState) => void;
}) {
  return (
    <div
      class="pointer-events-auto fixed top-4 right-4 z-10 max-h-[calc(100svh-2rem)] w-56
        overflow-y-auto rounded-lg border border-black/10 bg-white/80 p-3 font-sans
        text-[11px] text-black shadow-sm backdrop-blur-sm"
    >
      <p class="mb-2 font-garara text-[10px] tracking-wider text-black/60 uppercase">
        ai-viz controls
      </p>

      <div class="mb-3 flex flex-wrap gap-1">
        <For each={AI_VIZ_STATES}>
          {(state) => (
            <button
              type="button"
              onClick={() => props.onSelectState(state)}
              class="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
              classList={{
                "border-black bg-black text-white": props.activeState === state,
                "border-black/20 bg-transparent text-black hover:border-black/50":
                  props.activeState !== state,
              }}
            >
              {state}
            </button>
          )}
        </For>
      </div>

      <div class="flex flex-col gap-2.5">
        <For each={SLIDERS}>
          {(slider) => (
            <label class="flex flex-col gap-0.5">
              <span class="flex items-baseline justify-between">
                <span class="text-black/70">{slider.label}</span>
                <span class="tabular-nums text-black/50">
                  {props.params[slider.key].toFixed(3)}
                </span>
              </span>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={props.params[slider.key]}
                onInput={(e) =>
                  props.onChange(slider.key, e.currentTarget.valueAsNumber)
                }
                class="h-1 w-full accent-black"
              />
            </label>
          )}
        </For>
      </div>
    </div>
  );
}
