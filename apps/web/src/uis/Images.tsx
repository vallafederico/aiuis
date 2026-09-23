/**
 * Contained Images experiment — caption, prompt, and provenance search over
 * a seed grid, live inside this MockFrame (not site chrome).
 *
 * Search ranks tiles in place. Soft chips cut by provenance rules. A miss is
 * silence. Chips stay hidden without a TypeSafe key.
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
  IMAGE_CATALOG,
  IMAGE_CHIP_RULES,
  imagesJudgeAvailable,
  judgeImageChip,
  searchImages,
  type ImageChipKey,
  type ImageItem,
  type ImageSearchResult,
} from "~/lib/images";
import "./Images.css";
import {
  pulseAiVizResponse,
  resetAiVizActivity,
  setAiVizActivity,
} from "~/lib/ai-viz-activity";

const DEBOUNCE_MS = 350;
const EXISTS_THRESHOLD = 0.35;
const CHIP_PASS = 0.5;
const RECEDE_MIN = 0.3;
const FLOOR_MAX = 0.5;

const PRESET_CHIPS: ImageChipKey[] = [
  "generated",
  "documented",
  "prompt-gap",
  "off-brief",
];

export default function Images(_props: UiProps) {
  const catalog = () => IMAGE_CATALOG;

  const [query, setQuery] = createSignal("");
  const [result, setResult] = createSignal<ImageSearchResult | null>(null);
  const [floor, setFloor] = createSignal(0);
  const [judgeOn, setJudgeOn] = createSignal(false);
  const [activeChips, setActiveChips] = createSignal<ImageChipKey[]>([]);
  const [chipScores, setChipScores] = createSignal<
    Record<ImageChipKey, Record<string, number>>
  >({} as Record<ImageChipKey, Record<string, number>>);
  const [chipFailed, setChipFailed] = createSignal<ImageChipKey[]>([]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchToken = 0;

  onMount(() => {
    void imagesJudgeAvailable()
      .then(setJudgeOn)
      .catch(() => setJudgeOn(false));
  });

  onCleanup(() => {
    clearTimeout(timer);
    searchToken += 1;
    resetAiVizActivity();
  });

  const runSearch = (q: string) => {
    const token = ++searchToken;
    if (!q) {
      setResult(null);
      setAiVizActivity("idle");
      return;
    }
    setAiVizActivity("thinking");
    void searchImages(q)
      .then((next) => {
        if (token !== searchToken) return;
        setResult(next);
        pulseAiVizResponse();
      })
      .catch(() => {
        if (token !== searchToken) return;
        setResult(null);
        setAiVizActivity("idle");
      });
  };

  const onInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const raw = event.currentTarget.value;
    setQuery(raw);
    clearTimeout(timer);
    const trimmed = raw.replace(/\s+/g, " ").trim();
    setAiVizActivity(trimmed ? "listening" : "idle");
    timer = setTimeout(() => {
      runSearch(trimmed);
    }, DEBOUNCE_MS);
  };

  const scoresActive = () => {
    const r = result();
    return r !== null && r.exists >= EXISTS_THRESHOLD;
  };

  const isMiss = () => {
    const r = result();
    return r !== null && r.exists < EXISTS_THRESHOLD;
  };

  const ordered = createMemo(() => {
    const items = catalog();
    const r = result();
    if (!r || r.mode !== "judge" || r.exists < EXISTS_THRESHOLD) return items;
    return [...items].sort(
      (a, b) => (r.scores[b.id] ?? 0) - (r.scores[a.id] ?? 0),
    );
  });

  const treatment = (item: ImageItem) => {
    for (const rule of activeChips()) {
      const score = chipScores()[rule]?.[item.id];
      if (score !== undefined && score < CHIP_PASS) {
        return { hidden: true, alpha: null as number | null, match: null as number | null };
      }
    }
    const r = result();
    if (!r || r.exists < EXISTS_THRESHOLD) {
      return { hidden: false, alpha: null as number | null, match: null as number | null };
    }
    const score = r.scores[item.id] ?? 0;
    if (score < floor()) {
      return { hidden: true, alpha: null as number | null, match: null as number | null };
    }
    const match = r.promptMatch[item.id];
    if (r.mode === "judge") {
      return {
        hidden: false,
        alpha: Math.max(RECEDE_MIN, Math.min(1, score * 3)),
        match: match ?? null,
      };
    }
    return {
      hidden: false,
      alpha: score > 0 ? 1 : RECEDE_MIN,
      match: null,
    };
  };

  const toggleChip = (rule: ImageChipKey) => {
    if (chipFailed().includes(rule)) return;
    if (activeChips().includes(rule)) {
      setActiveChips((list) => list.filter((entry) => entry !== rule));
      return;
    }
    setActiveChips((list) => [...list, rule]);
    if (!chipScores()[rule]) {
      setAiVizActivity("acting");
      void judgeImageChip(rule).then((res) => {
        if (res) {
          setChipScores((map) => ({ ...map, [rule]: res.scores }));
          pulseAiVizResponse();
          return;
        }
        setChipFailed((list) => [...list, rule]);
        setActiveChips((list) => list.filter((entry) => entry !== rule));
        setAiVizActivity("idle");
      });
    }
  };

  const statusNote = () => {
    const r = result();
    if (r?.mode === "literal" && query().trim()) return "literal fallback";
    if (!judgeOn()) return "no judge";
    return null;
  };

  const formatMatch = (value: number) => value.toFixed(2);

  return (
    <MockFrame name="images" class="h-[58svh] w-grids-6">
      <div class="uis-images" classList={{ "is-miss": isMiss() }}>
        <div class="uis-images-search">
          <div class="uis-images-search-row">
            <input
              class="uis-images-input"
              type="text"
              autocomplete="off"
              spellcheck={false}
              placeholder="filter by caption, prompt, tags"
              aria-label="Filter images"
              value={query()}
              onInput={onInput}
            />
          </div>
          <Show when={scoresActive()}>
            <input
              class="uis-images-floor"
              type="range"
              min="0"
              max={FLOOR_MAX}
              step="0.01"
              value={floor()}
              aria-label="Relevance floor"
              onInput={(event) => {
                const next = Number.parseFloat(event.currentTarget.value);
                setFloor(
                  Math.min(
                    FLOOR_MAX,
                    Math.max(0, Number.isFinite(next) ? next : 0),
                  ),
                );
              }}
            />
          </Show>
          <Show when={judgeOn()}>
            <div class="uis-images-chips">
              <For each={PRESET_CHIPS}>
                {(rule) => (
                  <button
                    type="button"
                    class="uis-images-chip"
                    classList={{
                      "is-active": activeChips().includes(rule),
                      "is-failed": chipFailed().includes(rule),
                    }}
                    aria-pressed={activeChips().includes(rule)}
                    disabled={chipFailed().includes(rule)}
                    title={
                      chipFailed().includes(rule)
                        ? "Judge unavailable for this chip"
                        : IMAGE_CHIP_RULES[rule]
                    }
                    onClick={() => toggleChip(rule)}
                  >
                    {rule}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <div class="uis-images-grid">
          <For each={ordered()}>
            {(item, index) => {
              const treat = () => treatment(item);
              return (
                <div
                  class="uis-images-tile-wrap"
                  classList={{ "is-top": index() === 0 && scoresActive() }}
                  style={{
                    display: treat().hidden ? "none" : undefined,
                    opacity:
                      treat().alpha == null ? undefined : String(treat().alpha),
                  }}
                >
                  <Show when={index() === 0 && scoresActive()}>
                    <span class="uis-images-mark" aria-hidden="true" />
                  </Show>
                  <article class="uis-images-tile">
                    <div
                      class="uis-images-thumb"
                      style={{ background: item.tint }}
                      role="img"
                      aria-label={item.title}
                    />
                    <div class="uis-images-body">
                      <div class="uis-images-title-row">
                        <span class="uis-images-title">{item.title}</span>
                        <Show when={treat().match != null}>
                          <span class="uis-images-match" title="Text estimate — not pixel-grounded">
                            est. {formatMatch(treat().match!)}
                          </span>
                        </Show>
                      </div>
                      <span class="uis-images-caption">{item.caption}</span>
                      <span class="uis-images-prompt">{item.prompt}</span>
                      <div class="uis-images-meta">
                        <span class="uis-images-tag">{item.model}</span>
                        <span class="uis-images-tag">{item.provenance.origin}</span>
                        <span class="uis-images-tag">{item.provenance.promptFit}</span>
                        <span class="uis-images-tag">{item.provenance.brief}</span>
                      </div>
                    </div>
                  </article>
                </div>
              );
            }}
          </For>
        </div>
        <Show when={statusNote()}>
          <p class="uis-images-status">{statusNote()}</p>
        </Show>
      </div>
    </MockFrame>
  );
}
