/**
 * Contained Image Generation — prompt-to-control loop inside this MockFrame.
 * Judgment is silent; typing indicator only on the generate path.
 */
import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { MockFrame } from "./Mock";
import type { UiProps } from "./types";
import {
  SEED_PROMPT,
  SEED_RESULT,
  imageGenerationJudgeAvailable,
  runIteration,
  suggestControls,
  type ControlOption,
  type GenerationHistoryEntry,
  type GenerationResult,
  type SliderSuggestion,
} from "~/lib/image-generation";
import "./ImageGeneration.css";
import {
  aiVizActivity,
  pulseAiVizResponse,
  resetAiVizActivity,
  setAiVizActivity,
} from "~/lib/ai-viz-activity";

type Phase = "idle" | "generating" | "stopped";

export default function ImageGeneration(_props: UiProps) {
  const [prompt, setPrompt] = createSignal(SEED_PROMPT);
  const [result, setResult] = createSignal<GenerationResult>(SEED_RESULT);
  const [history, setHistory] = createSignal<GenerationHistoryEntry[]>([
    { prompt: SEED_RESULT.prompt, caption: SEED_RESULT.caption, mode: "seed" },
  ]);
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [options, setOptions] = createSignal<ControlOption[]>([]);
  const [sliders, setSliders] = createSignal<SliderSuggestion[]>([]);
  const [sliderValues, setSliderValues] = createSignal<Record<string, number>>(
    {},
  );
  const [judgeOn, setJudgeOn] = createSignal(false);
  const [suggestStop, setSuggestStop] = createSignal(false);
  const [synthesis, setSynthesis] = createSignal<"llm" | "heuristic" | "seed">(
    "seed",
  );
  const [error, setError] = createSignal<string | null>(null);

  let controlsToken = 0;
  let generateToken = 0;
  let promptTimer: ReturnType<typeof setTimeout> | undefined;

  const refreshControls = (nextPrompt: string, nextHistory: GenerationHistoryEntry[]) => {
    const token = ++controlsToken;
    if (
      aiVizActivity() !== "responding" &&
      aiVizActivity() !== "acting" &&
      aiVizActivity() !== "awaiting"
    ) {
      setAiVizActivity("thinking");
    }
    void suggestControls({ prompt: nextPrompt, history: nextHistory })
      .then((controls) => {
        if (token !== controlsToken) return;
        setOptions(controls.options);
        setSliders(controls.sliders);
        setSuggestStop(Boolean(controls.suggestStop));
        setSliderValues(
          Object.fromEntries(
            controls.sliders.map((slider) => [slider.id, slider.value]),
          ),
        );
        if (aiVizActivity() === "thinking") setAiVizActivity("idle");
      })
      .catch(() => {
        if (token !== controlsToken) return;
        setOptions([
          { mode: "iterate", label: "Iterate" },
          { mode: "vary", label: "Vary" },
          { mode: "stop", label: "Stop" },
        ]);
        if (aiVizActivity() === "thinking") setAiVizActivity("idle");
      });
  };

  onMount(() => {
    void imageGenerationJudgeAvailable()
      .then(setJudgeOn)
      .catch(() => setJudgeOn(false));
    refreshControls(SEED_PROMPT, history());
  });

  onCleanup(() => {
    clearTimeout(promptTimer);
    controlsToken += 1;
    generateToken += 1;
    resetAiVizActivity();
  });

  const formatFaithful = (value: number) => value.toFixed(2);

  const pick = (mode: "iterate" | "vary" | "stop") => {
    if (phase() === "generating" || phase() === "stopped") return;
    if (mode === "stop") {
      setPhase("stopped");
      setError(null);
      setAiVizActivity("awaiting");
      return;
    }
    void generate(mode);
  };

  const generate = async (mode: "iterate" | "vary") => {
    if (phase() === "generating" || phase() === "stopped") return;
    const token = ++generateToken;
    setError(null);
    setPhase("generating");
    setAiVizActivity("acting");

    const iteration = await runIteration({
      prompt: prompt(),
      mode,
      sliders: sliderValues(),
      prior: result(),
    });

    if (token !== generateToken) return;

    if (iteration.kind === "error") {
      setError(iteration.message);
      setPhase("idle");
      setAiVizActivity("idle");
      return;
    }

    const next = iteration.result;
    setResult(next);
    setSynthesis(iteration.synthesis);
    setPrompt(next.prompt);
    const nextHistory: GenerationHistoryEntry[] = [
      ...history(),
      { prompt: next.prompt, caption: next.caption, mode },
    ];
    setHistory(nextHistory);
    setPhase("idle");
    pulseAiVizResponse();
    refreshControls(next.prompt, nextHistory);
  };

  const onSliderInput = (id: string, raw: string) => {
    const value = Number.parseFloat(raw);
    setSliderValues((map) => ({
      ...map,
      [id]: Number.isFinite(value) ? value : 0.5,
    }));
  };

  const showControls = () => phase() === "idle" && !error();

  return (
    <MockFrame name="image-generation" class="h-[60svh] w-grids-5">
      <div class="uis-imgen">
        <div class="uis-imgen-prompt-row">
          <input
            class="uis-imgen-prompt"
            type="text"
            autocomplete="off"
            spellcheck={false}
            placeholder="Image prompt"
            aria-label="Image prompt"
            value={prompt()}
            disabled={phase() === "generating" || phase() === "stopped"}
            onInput={(event) => {
              const next = event.currentTarget.value;
              setPrompt(next);
              if (phase() !== "idle") return;
              setAiVizActivity("listening");
              clearTimeout(promptTimer);
              promptTimer = setTimeout(() => {
                refreshControls(next.replace(/\s+/g, " ").trim(), history());
              }, 400);
            }}
          />
        </div>

        <div class="uis-imgen-body">
          <article
            class="uis-imgen-tile"
            classList={{ "is-pending": phase() === "generating" }}
          >
            <Show
              when={phase() !== "generating"}
              fallback={
                <div class="uis-imgen-thumb" aria-busy="true">
                  <span class="uis-imgen-pending">…</span>
                </div>
              }
            >
              <div
                class="uis-imgen-thumb"
                style={{ background: result().tint }}
                role="img"
                aria-label={result().caption}
              />
            </Show>
            <div class="uis-imgen-tile-body">
              <div class="uis-imgen-caption-row">
                <span class="uis-imgen-caption">
                  {phase() === "generating" ? "…" : result().caption}
                </span>
                <Show when={result().promptFaithful != null && phase() !== "generating"}>
                  <span class="uis-imgen-gap" title="Text estimate — not pixel-grounded">
                    text est. {formatFaithful(result().promptFaithful!)}
                  </span>
                </Show>
              </div>
              <span class="uis-imgen-prompt-echo">{result().prompt}</span>
              <div class="uis-imgen-meta">
                <span class="uis-imgen-tag">{result().model}</span>
                <Show when={result().promptFaithful != null}>
                  <span class="uis-imgen-tag">
                    {(result().promptFaithful ?? 0) >= 0.5
                      ? "prompt-faithful"
                      : "prompt-gap"}
                  </span>
                </Show>
              </div>
            </div>
          </article>

          <Show when={showControls() && sliders().length > 0}>
            <div class="uis-imgen-sliders">
              <For each={sliders()}>
                {(slider) => (
                  <div class="uis-imgen-slider-row">
                    <span class="uis-imgen-slider-label">{slider.label}</span>
                    <input
                      class="uis-imgen-slider"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={sliderValues()[slider.id] ?? slider.value}
                      aria-label={slider.label}
                      onInput={(event) => {
                        onSliderInput(slider.id, event.currentTarget.value);
                      }}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="uis-imgen-footer">
          <Show when={phase() === "stopped"}>
            <p class="uis-imgen-stopped">
              Stopped. The last result stands; no further iterations were run.
            </p>
          </Show>

          <Show when={error()}>
            <p class="uis-imgen-stopped">{error()}</p>
          </Show>

          <Show when={showControls()}>
            <div class="uis-imgen-chips">
              <For each={options()}>
                {(option) => (
                  <button
                    type="button"
                    class="uis-imgen-chip"
                    classList={{
                      "is-stop": option.mode === "stop",
                      "is-ranked": judgeOn() && option.score != null,
                    }}
                    disabled={phase() === "generating"}
                    onClick={() => pick(option.mode)}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
          </Show>

          <Show when={showControls() && suggestStop()}>
            <p class="uis-imgen-note">
              Judgment suggests stopping may be reasonable.
            </p>
          </Show>

          <Show when={synthesis() === "heuristic" && phase() === "idle"}>
            <p class="uis-imgen-note">no synthesis · heuristic rewrite</p>
          </Show>

          <Show when={!judgeOn() && phase() === "idle"}>
            <p class="uis-imgen-note">no judge · plain controls</p>
          </Show>
        </div>
      </div>
    </MockFrame>
  );
}
