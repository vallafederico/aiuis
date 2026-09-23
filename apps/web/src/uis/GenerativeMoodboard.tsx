/**
 * Contained Generative Moodboard — the board is the prompt.
 * Two named axes, tiles placed by score, empty space is the generate verb.
 */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { MockFrame } from "./Mock";
import type { UiProps } from "./types";
import {
  AXIS_LABELS,
  AXIS_PAIR_OPTIONS,
  DEFAULT_AXIS_PAIR,
  SEED_CORNER_TILES,
  axisPairKey,
  axisPairLabel,
  generateTile,
  mixAtClick,
  moodboardJudgeAvailable,
  type AxisPair,
  type MixRecipe,
  type MixResult,
  type MoodTile,
} from "~/lib/moodboard";
import "./GenerativeMoodboard.css";
import {
  pulseAiVizResponse,
  resetAiVizActivity,
  setAiVizActivity,
} from "~/lib/ai-viz-activity";

const GENERATE_MS = 480;

type FooterState =
  | { kind: "idle"; hint: string }
  | { kind: "restrain"; message: string }
  | { kind: "recipe"; result: MixResult & { recipe: MixRecipe } }
  | { kind: "generating"; recipe: MixRecipe; result: MixResult };

export default function GenerativeMoodboard(_props: UiProps) {
  const [tiles, setTiles] = createSignal<MoodTile[]>([...SEED_CORNER_TILES]);
  const [axes, setAxes] = createSignal<AxisPair>(DEFAULT_AXIS_PAIR);
  const [footer, setFooter] = createSignal<FooterState>({
    kind: "idle",
    hint: "Click empty space to mix or vary toward a new tile.",
  });
  const [clickPoint, setClickPoint] = createSignal<{ x: number; y: number } | null>(
    null,
  );
  const [judgeOn, setJudgeOn] = createSignal(false);

  let boardEl: HTMLDivElement | undefined;
  let generateToken = 0;
  let generateTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    void moodboardJudgeAvailable()
      .then(setJudgeOn)
      .catch(() => setJudgeOn(false));
  });

  onCleanup(() => {
    generateToken += 1;
    clearTimeout(generateTimer);
    resetAiVizActivity();
  });

  const activePairKey = createMemo(() => axisPairKey(axes()));

  const tileStyle = (tile: MoodTile) => {
    const pair = axes();
    const x = tile.scores[pair.x];
    const y = tile.scores[pair.y];
    return {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
    };
  };

  const runGenerate = (result: MixResult & { recipe: MixRecipe }) => {
    const token = ++generateToken;
    setFooter({ kind: "generating", recipe: result.recipe, result });
    setAiVizActivity("acting");

    clearTimeout(generateTimer);
    generateTimer = setTimeout(() => {
      if (token !== generateToken) return;
      const next = generateTile(result.recipe, axes());
      setTiles((list) => [...list, next]);
      setFooter({
        kind: "idle",
        hint: result.kind === "vary"
          ? "Variation placed. Click another gap to continue."
          : "Mix placed. Click another gap to continue.",
      });
      pulseAiVizResponse();
    }, GENERATE_MS);
  };

  const onBoardClick = (event: MouseEvent) => {
    if (!boardEl || footer().kind === "generating") return;

    const rect = boardEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setClickPoint({ x, y });

    const result = mixAtClick({ tiles: tiles(), x, y, axes: axes() });

    if (result.kind === "restrain") {
      setFooter({ kind: "restrain", message: result.message });
      setAiVizActivity("awaiting");
      return;
    }

    setFooter({ kind: "recipe", result });
    runGenerate(result);
  };

  const swapAxes = (pair: AxisPair) => {
    if (axisPairKey(pair) === activePairKey()) return;
    generateToken += 1;
    clearTimeout(generateTimer);
    setClickPoint(null);
    setAxes(pair);
    setFooter({
      kind: "idle",
      hint: "Axes swapped. Tiles relayout from stored scores, no regeneration.",
    });
    setAiVizActivity("idle");
  };

  const pair = () => axes();
  const xLabels = () => AXIS_LABELS[pair().x];
  const yLabels = () => AXIS_LABELS[pair().y];

  const activeRecipe = (): MixRecipe | null => {
    const state = footer();
    if (state.kind === "generating") return state.recipe;
    if (state.kind === "recipe") return state.result.recipe;
    return null;
  };

  const recipeSources = () => activeRecipe()?.sources ?? [];

  const recipeMessage = () => activeRecipe()?.message ?? null;

  const recipeMode = () => {
    const state = footer();
    if (state.kind === "recipe" || state.kind === "generating") {
      return state.result.kind;
    }
    return null;
  };

  return (
    <MockFrame name="generative-moodboard" class="h-[58svh] w-grids-6">
      <div class="uis-moodboard">
        <div class="uis-moodboard-toolbar">
          <span class="uis-moodboard-toolbar-label">Axes</span>
          <div class="uis-moodboard-chips">
            <For each={AXIS_PAIR_OPTIONS}>
              {(option) => (
                <button
                  type="button"
                  class="uis-moodboard-chip"
                  classList={{ "is-active": axisPairKey(option) === activePairKey() }}
                  aria-pressed={axisPairKey(option) === activePairKey()}
                  title={axisPairLabel(option)}
                  onClick={() => swapAxes(option)}
                >
                  {axisPairLabel(option)}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="uis-moodboard-stage-wrap">
          <div
            class="uis-moodboard-stage"
            ref={boardEl}
            role="application"
            aria-label="Generative moodboard"
            onClick={onBoardClick}
          >
            <span class="uis-moodboard-axis is-x-low">{xLabels().low}</span>
            <span class="uis-moodboard-axis is-x-high">{xLabels().high}</span>
            <span class="uis-moodboard-axis is-y-low">{yLabels().low}</span>
            <span class="uis-moodboard-axis is-y-high">{yLabels().high}</span>

            <Show when={clickPoint()}>
              {(point) => (
                <span
                  class="uis-moodboard-click"
                  style={{
                    left: `${point().x * 100}%`,
                    top: `${point().y * 100}%`,
                  }}
                  aria-hidden="true"
                />
              )}
            </Show>

            <For each={tiles()}>
              {(tile) => (
                <article
                  class="uis-moodboard-tile"
                  style={tileStyle(tile)}
                  aria-label={tile.caption}
                >
                  <div
                    class="uis-moodboard-thumb"
                    style={{ background: tile.tint }}
                    role="img"
                    aria-hidden="true"
                  />
                  <div class="uis-moodboard-body">
                    <span class="uis-moodboard-caption">{tile.caption}</span>
                    <span class="uis-moodboard-prompt">{tile.prompt}</span>
                  </div>
                </article>
              )}
            </For>

            <Show when={footer().kind === "generating" && clickPoint()}>
              {() => {
                const pendingScores = (footer() as Extract<
                  FooterState,
                  { kind: "generating" }
                >).recipe.target;
                const style = {
                  left: `${pendingScores.x * 100}%`,
                  top: `${pendingScores.y * 100}%`,
                };
                return (
                  <article
                    class="uis-moodboard-tile is-pending"
                    style={style}
                    aria-hidden="true"
                  >
                    <div
                      class="uis-moodboard-thumb"
                      style={{
                        background: `linear-gradient(135deg, rgb(0 0 255 / 0.14), rgb(0 0 255 / 0.06))`,
                      }}
                    />
                    <div class="uis-moodboard-body">
                      <span class="uis-moodboard-caption">…</span>
                    </div>
                  </article>
                );
              }}
            </Show>
          </div>
        </div>

        <div class="uis-moodboard-footer">
          <Show when={footer().kind === "restrain"}>
            <p class="uis-moodboard-restrain">
              {(footer() as Extract<FooterState, { kind: "restrain" }>).message}
            </p>
          </Show>

          <Show
            when={
              footer().kind === "recipe" || footer().kind === "generating"
            }
          >
            <div class="uis-moodboard-recipe">
              <span class="uis-moodboard-recipe-mode">
                {recipeMode() === "vary" ? "Vary" : "Mix"}: {recipeMessage()}
              </span>
              <div class="uis-moodboard-recipe-sources">
                <For each={recipeSources()}>
                  {(entry) => (
                    <div class="uis-moodboard-recipe-source">
                      <span>
                        {entry.role}: {entry.tile.caption}
                      </span>
                      <span class="uis-moodboard-recipe-weight">
                        {Math.round(entry.weight * 100)}%
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={footer().kind === "generating"}>
            <p class="uis-moodboard-pending">…</p>
          </Show>

          <Show when={footer().kind === "idle"}>
            <p class="uis-moodboard-hint">
              {(footer() as Extract<FooterState, { kind: "idle" }>).hint}
            </p>
          </Show>

          <Show when={!judgeOn()}>
            <p class="uis-moodboard-hint">no judge · code-scored seed corners</p>
          </Show>

          <p class="uis-moodboard-hint">css tiles · not pixel renders</p>
        </div>
      </div>
    </MockFrame>
  );
}
