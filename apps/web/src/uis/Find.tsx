/**
 * Contained Find experiment — semantic needle over published paragraphs,
 * live inside this MockFrame. The answer is a highlighted source passage
 * in the in-frame document; a miss stays dark. No site-wide ⌘F chrome.
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
  findInSite,
  findJudgeAvailable,
  listFindParagraphs,
  type FindHit,
  type FindResult,
} from "~/lib/find";
import "./Find.css";
import {
  pulseAiVizResponse,
  resetAiVizActivity,
  setAiVizActivity,
} from "~/lib/ai-viz-activity";

const EXISTS_FULL = 0.7;
const EXISTS_PARTIAL = 0.35;
const DEBOUNCE_MS = 400;
const MIN_QUERY = 3;

type Paragraph = { id: string; path: string; title: string; text: string };
type LoadState = "loading" | "ready" | "error";

export default function Find(_props: UiProps) {
  const [paragraphs, setParagraphs] = createSignal<Paragraph[]>([]);
  const [loadState, setLoadState] = createSignal<LoadState>("loading");
  const [query, setQuery] = createSignal("");
  const [result, setResult] = createSignal<FindResult | null>(null);
  const [hitId, setHitId] = createSignal<string | null>(null);
  const [hitScore, setHitScore] = createSignal(1);
  const [judgeOn, setJudgeOn] = createSignal(false);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let docEl: HTMLDivElement | undefined;

  onMount(() => {
    void findJudgeAvailable()
      .then(setJudgeOn)
      .catch(() => setJudgeOn(false));
    void listFindParagraphs()
      .then((entries) => {
        setParagraphs(entries);
        setLoadState(entries.length > 0 ? "ready" : "error");
      })
      .catch(() => {
        setParagraphs([]);
        setLoadState("error");
      });
  });

  onCleanup(() => {
    clearTimeout(timer);
    generation += 1;
    resetAiVizActivity();
  });

  const runSearch = (value: string) => {
    const gen = ++generation;
    setAiVizActivity("thinking");
    void findInSite(value).then((res) => {
      if (gen !== generation) return;
      setResult(res);
      if (res.exists < EXISTS_PARTIAL || res.hits.length === 0) {
        setHitId(null);
        setAiVizActivity("idle");
        return;
      }
      applyHit(res.hits[0]!);
      pulseAiVizResponse();
    });
  };

  const onInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const raw = event.currentTarget.value;
    setQuery(raw);
    clearTimeout(timer);
    const trimmed = raw.trim();
    if (trimmed.length < MIN_QUERY) {
      generation += 1;
      setResult(null);
      setHitId(null);
      setAiVizActivity(trimmed ? "listening" : "idle");
      return;
    }
    setAiVizActivity("listening");
    timer = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
  };

  const dark = () => {
    const r = result();
    return r !== null && r.exists < EXISTS_PARTIAL;
  };

  const partial = () => {
    const r = result();
    return r !== null && r.exists >= EXISTS_PARTIAL && r.exists < EXISTS_FULL;
  };

  const visibleHits = (): FindHit[] => {
    const r = result();
    if (!r || r.exists < EXISTS_PARTIAL) return [];
    return r.hits;
  };

  const applyHit = (hit: FindHit) => {
    const match = paragraphs().find((paragraph) => paragraph.id === hit.id);
    if (!match) {
      setHitId(null);
      return;
    }
    setHitId(hit.id);
    setHitScore(hit.score);
    requestAnimationFrame(() => {
      const el = docEl?.querySelector(`[data-find-id="${hit.id}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const statusNote = () => {
    const r = result();
    if (r?.mode === "literal" && query().trim().length >= MIN_QUERY) {
      return "literal match";
    }
    if (!judgeOn()) return "no judge";
    return null;
  };

  return (
    <MockFrame name="find" class="h-[56svh] w-grids-6">
      <div class="uis-find" classList={{ "is-dark": dark(), "is-partial": partial() }}>
        <div class="uis-find-search">
          <input
            class="uis-find-input"
            type="text"
            autocomplete="off"
            spellcheck={false}
            placeholder="find a passage"
            aria-label="Find a passage"
            value={query()}
            onInput={onInput}
          />
        </div>
        <Show when={visibleHits().length > 0}>
          <ul class="uis-find-hits">
            <For each={visibleHits()}>
              {(hit) => (
                <li>
                  <button
                    type="button"
                    class="uis-find-hit"
                    onClick={() => applyHit(hit)}
                  >
                    <span class="uis-find-hit-title">{hit.title}</span>
                    <span class="uis-find-hit-preview">{hit.preview}</span>
                    <Show when={result()?.mode === "literal"}>
                      <span class="uis-find-hit-badge">literal match</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="uis-find-doc" ref={docEl}>
          <For each={paragraphs()}>
            {(paragraph) => (
              <p
                data-find-id={paragraph.id}
                class="uis-find-p"
                classList={{ "is-hit": hitId() === paragraph.id }}
                style={
                  hitId() === paragraph.id
                    ? { "--find-hit": String(hitScore()) }
                    : undefined
                }
              >
                <span class="uis-find-p-meta">{paragraph.title}</span>
                {paragraph.text}
              </p>
            )}
          </For>
          <Show when={loadState() === "loading"}>
            <p class="uis-find-empty">Loading published paragraphs…</p>
          </Show>
          <Show when={loadState() === "error"}>
            <p class="uis-find-empty">Could not load the paragraph index.</p>
          </Show>
        </div>
        <Show when={statusNote()}>
          <p class="uis-find-status">{statusNote()}</p>
        </Show>
      </div>
    </MockFrame>
  );
}
