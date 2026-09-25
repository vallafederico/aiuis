/**
 * A schematic of how a UI piece actually works: stages top to bottom, parallel
 * steps side by side, what flows between them on the connectors. Each step
 * wears its role, so the reader can see where code decides, where a model
 * writes, and where the numbers come from.
 *
 * Interactive: a walkthrough steps through the stages; clicking a step opens
 * what is inside it. With `live`, the reader can run the real pipeline and
 * watch each stage light up with what it actually produced.
 */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { isServer } from "solid-js/web";
import { nestedScroll } from "~/lib/utils/nested-scroll";
import "./Pipeline.css";

export type Role = "reader" | "code" | "llm" | "jev" | "image" | "source";

export const ROLE_LABELS: Record<Role, string> = {
  reader: "reader",
  code: "code",
  llm: "language model",
  jev: "judgment",
  image: "image model",
  source: "data source",
};

export type Step = {
  role: Role;
  title: string;
  detail?: string;
  /** Model, API or timing, in small type. */
  meta?: string;
  /** Specifics from the code, shown when the step is opened. */
  inside?: string[];
  /** Where it lives, relative to apps/web/src. */
  file?: string;
};

export type Stage = {
  /** More than one step runs in parallel, or are alternatives when `branch` is set. */
  steps: Step[];
  /** The steps are alternatives, not parallel work. */
  branch?: boolean;
  /** What this stage hands to the next. */
  out?: string;
};

/** Reports progress of a live run: which stage is working, and what it produced. */
export type LiveMark = (stage: number, state: "active" | "done" | "skip", note?: string) => void;

export type LiveRun = {
  label: string;
  placeholder: string;
  /** Example inputs, clickable. */
  examples?: string[];
  run: (input: string, mark: LiveMark, signal: AbortSignal) => Promise<void>;
};

export type PipelineSpec = {
  stages: Stage[];
  /** The edge back to the top, e.g. a follow-up that edits the result. */
  loop?: string;
};

type StageState = { state: "idle" | "active" | "done" | "skip"; note?: string };

const STEP_MS = 1400;
/** Matches --pipe-delay / --pipe-stagger / --pipe-in in Pipeline.css. */
const INTRO_DELAY_MS = 450;
const INTRO_STAGGER_MS = 90;
const INTRO_MS = 1200;

export function Pipeline(props: { spec: PipelineSpec; live?: LiveRun }) {
  const count = () => props.spec.stages.length;
  const [active, setActive] = createSignal(-1);
  const [playing, setPlaying] = createSignal(false);
  const [open, setOpen] = createSignal<string | null>(null);
  const [states, setStates] = createSignal<StageState[]>([]);
  const [running, setRunning] = createSignal(false);
  const [liveError, setLiveError] = createSignal<string | null>(null);
  const roles = () => [...new Set(props.spec.stages.flatMap((s) => s.steps.map((step) => step.role)))];
  const isLive = () => states().length > 0;
  let input: HTMLInputElement | undefined;
  let abort: AbortController | undefined;
  let timer = 0;
  let introTimer = 0;

  const stop = () => {
    setPlaying(false);
    window.clearInterval(timer);
    window.clearTimeout(introTimer);
  };
  const play = () => {
    window.clearInterval(timer);
    setPlaying(true);
    timer = window.setInterval(() => setActive((i) => (i + 1) % (count() + 1)), STEP_MS);
  };
  const step = (by: number) => {
    stop();
    setActive((i) => (i + by + count() + 1) % (count() + 1));
  };

  onMount(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setActive(0);
      return;
    }
    // The walkthrough starts once the last stage has landed.
    introTimer = window.setTimeout(
      () => {
        setActive(0);
        play();
      },
      INTRO_DELAY_MS + (count() + 2) * INTRO_STAGGER_MS + INTRO_MS * 0.6,
    );
  });
  onCleanup(() => {
    // Also runs when SSR re-renders a resolved Suspense; a throw there hangs the stream.
    if (isServer) return;
    window.clearInterval(timer);
    window.clearTimeout(introTimer);
    abort?.abort();
  });

  const toggle = (key: string, stage: number) => {
    stop();
    setActive(stage);
    setOpen((cur) => (cur === key ? null : key));
  };

  const mark: LiveMark = (stage, state, note) => {
    setStates((list) => {
      const next = [...list];
      // Reaching a stage settles everything before it.
      if (state === "active") {
        for (let i = 0; i < stage; i++) if (next[i]?.state === "active") next[i] = { ...next[i]!, state: "done" };
      }
      next[stage] = { state, note: note ?? next[stage]?.note };
      return next;
    });
    if (state === "active") setActive(stage);
  };

  const runLive = async (value: string) => {
    const live = props.live;
    const text = value.trim();
    if (!live || !text || running()) return;
    stop();
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    setOpen(null);
    setLiveError(null);
    setStates(props.spec.stages.map(() => ({ state: "idle" as const })));
    setRunning(true);
    try {
      await live.run(text, mark, controller.signal);
      setStates((list) => list.map((s) => (s.state === "active" ? { ...s, state: "done" } : s)));
      setActive(-1);
    } catch (error) {
      if (!controller.signal.aborted) setLiveError(error instanceof Error ? error.message : "The run failed.");
    } finally {
      if (abort === controller) setRunning(false);
    }
  };

  const reset = () => {
    abort?.abort();
    setRunning(false);
    setStates([]);
    setLiveError(null);
    play();
  };

  const stageState = (i: number): StageState | undefined => states()[i];

  return (
    <div class="pipe" ref={(el) => onMount(() => nestedScroll(el))} classList={{ "is-live": isLive() }}>
      <Show when={props.live}>
        {(live) => (
          <form
            class="pipe-live"
            style={{ "--i": "0" }}
            onSubmit={(event) => {
              event.preventDefault();
              void runLive(input?.value ?? "");
            }}
          >
            <p class="pipe-role">{live().label}</p>
            <div class="pipe-live-row">
              <input
                ref={input}
                class="pipe-live-input"
                type="text"
                autocomplete="off"
                maxlength={240}
                placeholder={live().placeholder}
                disabled={running()}
              />
              <button type="submit" class="pipe-btn" disabled={running()}>
                {running() ? "running" : "run"}
              </button>
              <Show when={isLive() && !running()}>
                <button type="button" class="pipe-btn" onClick={reset}>
                  reset
                </button>
              </Show>
            </div>
            <Show when={live().examples?.length && !isLive()}>
              <p class="pipe-examples">
                <For each={live().examples}>
                  {(example) => (
                    <button
                      type="button"
                      onClick={() => {
                        if (input) input.value = example;
                        void runLive(example);
                      }}
                    >
                      {example}
                    </button>
                  )}
                </For>
              </p>
            </Show>
            <Show when={liveError()}>{(message) => <p class="pipe-live-error">{message()}</p>}</Show>
          </form>
        )}
      </Show>

      <ol class="pipe-stages">
        <For each={props.spec.stages}>
          {(stage, i) => (
            <li
              class="pipe-stage"
              style={{ "--i": String(i() + 1) }}
              classList={{
                "is-active": isLive() ? stageState(i())?.state === "active" : active() === i(),
                "is-done": stageState(i())?.state === "done",
                "is-skip": stageState(i())?.state === "skip",
              }}
            >
              <div class="pipe-row" classList={{ "is-branch": stage.branch }} style={{ "--n": String(stage.steps.length) }}>
                <For each={stage.steps}>
                  {(s, si) => {
                    const key = () => `${i()}:${si()}`;
                    const expandable = () => Boolean(s.inside?.length || s.file);
                    return (
                      <button
                        type="button"
                        class="pipe-step"
                        data-role={s.role}
                        classList={{ "is-open": open() === key(), "is-expandable": expandable() }}
                        aria-expanded={expandable() ? open() === key() : undefined}
                        onClick={() => expandable() && toggle(key(), i())}
                      >
                        <span class="pipe-role">
                          {ROLE_LABELS[s.role]}
                          <Show when={stage.branch && si() > 0}> · or</Show>
                        </span>
                        <span class="pipe-title">{s.title}</span>
                        <Show when={s.detail}>
                          <span class="pipe-detail">{s.detail}</span>
                        </Show>
                        <Show when={s.meta}>
                          <span class="pipe-meta">{s.meta}</span>
                        </Show>
                        <Show when={open() === key()}>
                          <span class="pipe-inside">
                            <For each={s.inside ?? []}>{(fact) => <span class="pipe-fact">{fact}</span>}</For>
                            <Show when={s.file}>
                              <span class="pipe-file">src/{s.file}</span>
                            </Show>
                          </span>
                        </Show>
                        <Show when={expandable() && open() !== key()}>
                          <span class="pipe-more" aria-hidden="true">
                            +
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
              <Show when={stage.out || stageState(i())?.note}>
                <p class="pipe-edge" classList={{ "is-note": Boolean(stageState(i())?.note) }}>
                  <span>{stageState(i())?.note ?? stage.out}</span>
                </p>
              </Show>
            </li>
          )}
        </For>
      </ol>

      <Show when={props.spec.loop}>
        <p class="pipe-loop" style={{ "--i": String(count() + 1) }} classList={{ "is-active": !isLive() && active() === count() }}>
          ↺ {props.spec.loop}
        </p>
      </Show>

      <div class="pipe-foot" style={{ "--i": String(count() + 2) }}>
        <ul class="pipe-legend" aria-label="Roles">
          <For each={roles()}>
            {(role) => (
              <li data-role={role}>
                <i />
                {ROLE_LABELS[role]}
              </li>
            )}
          </For>
        </ul>
        <Show when={!isLive()}>
          <div class="pipe-controls" role="group" aria-label="Walkthrough">
            <button type="button" class="pipe-btn" aria-label="Previous stage" onClick={() => step(-1)}>
              ‹
            </button>
            <button type="button" class="pipe-btn" onClick={() => (playing() ? stop() : play())}>
              {playing() ? "pause" : "play"}
            </button>
            <button type="button" class="pipe-btn" aria-label="Next stage" onClick={() => step(1)}>
              ›
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
