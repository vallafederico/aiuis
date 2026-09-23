/**
 * Contained Infinite Article — fork at section end, generate on pick.
 * Judgment is silent; typing indicator only on the LLM write path.
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
  SEED_OPENING,
  articleJudgeAvailable,
  forkArticle,
  writeArticleBlock,
  type ArticleDirection,
  type ArticleSection,
  type ForkResult,
} from "~/lib/infinite-article";
import "./InfiniteArticle.css";
import {
  pulseAiVizResponse,
  resetAiVizActivity,
  setAiVizActivity,
} from "~/lib/ai-viz-activity";

type Phase = "reading" | "choosing" | "generating" | "stopped";

export default function InfiniteArticle(_props: UiProps) {
  const [sections, setSections] = createSignal<ArticleSection[]>([SEED_OPENING]);
  const [phase, setPhase] = createSignal<Phase>("reading");
  const [fork, setFork] = createSignal<ForkResult | null>(null);
  const [judgeOn, setJudgeOn] = createSignal(false);
  const [pendingText, setPendingText] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [lastSynthesis, setLastSynthesis] = createSignal<"llm" | "canned" | null>(
    null,
  );

  let scrollEl: HTMLDivElement | undefined;
  let generateToken = 0;

  onMount(() => {
    void articleJudgeAvailable()
      .then(setJudgeOn)
      .catch(() => setJudgeOn(false));
  });

  onCleanup(() => {
    generateToken += 1;
    resetAiVizActivity();
  });

  const lastDirection = () => {
    for (let i = sections().length - 1; i >= 0; i--) {
      const dir = sections()[i]?.direction;
      if (dir) return dir;
    }
    return undefined;
  };

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  };

  const beginFork = async () => {
    if (phase() === "generating" || phase() === "stopped") return;
    setError(null);
    setFork(null);
    setAiVizActivity("thinking");

    const result = await forkArticle({
      sections: sections(),
      lastDirection: lastDirection(),
    });

    if (result.kind === "error") {
      setError(result.message);
      setAiVizActivity("idle");
      return;
    }

    if (result.kind === "stop") {
      setPhase("stopped");
      setFork(result);
      setAiVizActivity("awaiting");
      return;
    }

    setFork(result);
    setPhase("choosing");
    setAiVizActivity("awaiting");
    scrollToEnd();
  };

  const finishStop = () => {
    setPhase("stopped");
    setFork({ kind: "stop", reason: "choice" });
    setAiVizActivity("awaiting");
  };

  const generate = async (
    direction: ArticleDirection,
    ghost?: string,
  ) => {
    if (phase() === "generating" || phase() === "stopped") return;
    const token = ++generateToken;
    setError(null);
    setPhase("generating");
    setAiVizActivity("acting");
    setPendingText("…");
    setFork(null);
    scrollToEnd();

    const result = await writeArticleBlock({
      sections: sections(),
      direction,
      ghost,
    });

    if (token !== generateToken) return;

    if (result.kind === "error") {
      setError(result.message);
      setPendingText(null);
      setPhase("reading");
      setAiVizActivity("idle");
      return;
    }

    setSections((list) => [...list, result.section]);
    setLastSynthesis(result.synthesis);
    setPendingText(null);
    setPhase("reading");
    pulseAiVizResponse();
    scrollToEnd();
  };

  const pickSimple = (direction: "continue" | "stop") => {
    if (direction === "stop") {
      finishStop();
      return;
    }
    void generate("continue");
  };

  const pickDirection = (direction: ArticleDirection, ghost?: string) => {
    void generate(direction, ghost);
  };

  const stopReason = () => {
    const result = fork();
    return result?.kind === "stop" ? result.reason : null;
  };

  const showForkPrompt = () =>
    phase() === "reading" && !pendingText() && sections().length > 0;

  const allDirections: ArticleDirection[] = ["continue", "deepen", "aside"];
  const directionsFork = () => fork()?.kind === "directions";

  return (
    <MockFrame name="infinite-article" class="h-[72svh] w-grids-6">
      <div class="uis-article">
        <div class="uis-article-scroll" ref={scrollEl}>
          <div class="uis-article-body">
            <For each={sections()}>
              {(section, index) => (
                <>
                  <Show when={index() > 0}>
                    <div class="uis-article-section-gap" aria-hidden="true" />
                  </Show>
                  <For each={section.paragraphs}>
                    {(paragraph) => <p class="uis-article-p">{paragraph}</p>}
                  </For>
                </>
              )}
            </For>
            <Show when={pendingText()}>
              <p class="uis-article-p is-pending">{pendingText()}</p>
            </Show>
          </div>

          <Show when={phase() === "choosing" && directionsFork()}>
            <div class="uis-article-ghosts">
              <For each={(fork() as Extract<ForkResult, { kind: "directions" }>).options}>
                {(option) => (
                  <button
                    type="button"
                    class="uis-article-ghost"
                    disabled={phase() === "generating"}
                    onClick={() => pickDirection(option.direction, option.ghost)}
                  >
                    <span class="uis-article-ghost-label">{option.label}</span>
                    {option.ghost}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="uis-article-footer">
          <Show when={phase() === "stopped"}>
            <p class="uis-article-stopped">
              {stopReason() === "engagement"
                ? "The thread ended here. Low engagement, so nothing more was invented."
                : "Stopped. The article ends where you left it."}
            </p>
          </Show>

          <Show when={error()}>
            <p class="uis-article-stopped">{error()}</p>
          </Show>

          <Show when={lastSynthesis() === "canned" && phase() === "reading"}>
            <p class="uis-article-stopped">
              no synthesis · canned block (Workers AI unavailable)
            </p>
          </Show>

          <Show when={showForkPrompt()}>
            <button
              type="button"
              class="uis-article-fork"
              onClick={() => void beginFork()}
            >
              What next?
            </button>
          </Show>

          <Show when={phase() === "choosing" && !directionsFork()}>
            <div class="uis-article-chips">
              <Show
                when={fork()?.kind === "simple"}
                fallback={
                  <>
                    <For each={allDirections}>
                      {(direction) => (
                        <button
                          type="button"
                          class="uis-article-chip"
                          disabled={phase() === "generating"}
                          onClick={() => pickDirection(direction)}
                        >
                          {direction === "continue"
                            ? "Continue"
                            : direction === "deepen"
                              ? "Deepen"
                              : "Aside"}
                        </button>
                      )}
                    </For>
                    <button
                      type="button"
                      class="uis-article-chip is-stop"
                      disabled={phase() === "generating"}
                      onClick={finishStop}
                    >
                      Stop
                    </button>
                  </>
                }
              >
                <For each={(fork() as Extract<ForkResult, { kind: "simple" }>).options}>
                  {(option) => (
                    <button
                      type="button"
                      class="uis-article-chip"
                      classList={{ "is-stop": option.direction === "stop" }}
                      disabled={phase() === "generating"}
                      onClick={() => pickSimple(option.direction)}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>

          <Show when={phase() === "choosing" && directionsFork()}>
            <button
              type="button"
              class="uis-article-chip is-stop"
              disabled={phase() === "generating"}
              onClick={finishStop}
            >
              Stop
            </button>
          </Show>

          <Show when={!judgeOn() && phase() === "reading" && !pendingText()}>
            <p class="uis-article-stopped">
              no judge · forks offer continue or stop only
            </p>
          </Show>
        </div>
      </div>
    </MockFrame>
  );
}
