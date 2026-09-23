/**
 * Contained Navigation experiment — catalog search, relevance floor, and
 * soft rule chips, all live inside this MockFrame (not site chrome).
 *
 * Search ranks the mini index in place. A miss is silence. Chips are
 * model-only and stay hidden without a TypeSafe key.
 */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createAsync } from "@solidjs/router";
import { MockFrame } from "./Mock";
import type { UiProps } from "./types";
import {
  catalogJudgeAvailable,
  judgeChip,
  searchCatalog,
  type CatalogSearchResult,
} from "~/lib/catalog-search";
import { getNavCatalog, navPieces } from "~/lib/sections";
import {
  pulseAiVizResponse,
  resetAiVizActivity,
  setAiVizActivity,
} from "~/lib/ai-viz-activity";
import "./Navigation.css";

const DEBOUNCE_MS = 350;
const EXISTS_THRESHOLD = 0.35;
const CHIP_PASS = 0.5;
const RECEDE_MIN = 0.3;
const FLOOR_MAX = 0.5;

function slugFromHref(href: string) {
  const clean = href.split(/[?#]/)[0] ?? "";
  return clean.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
}

export default function Navigation(_props: UiProps) {
  const catalog = createAsync(() => getNavCatalog(), { deferStream: true });
  const pieces = createMemo(() => navPieces(catalog() ?? []));

  const [query, setQuery] = createSignal("");
  const [result, setResult] = createSignal<CatalogSearchResult | null>(null);
  const [floor, setFloor] = createSignal(0);
  const [judgeOn, setJudgeOn] = createSignal(false);
  const [chips, setChips] = createSignal<string[]>([]);
  const [activeChips, setActiveChips] = createSignal<string[]>([]);
  const [chipScores, setChipScores] = createSignal<
    Record<string, Record<string, number>>
  >({});
  const [chipFailed, setChipFailed] = createSignal<string[]>([]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchToken = 0;

  onMount(() => {
    void catalogJudgeAvailable()
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
    void searchCatalog(q)
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
    const items = pieces();
    const r = result();
    if (!r || r.mode !== "judge" || r.exists < EXISTS_THRESHOLD) return items;
    return [...items].sort(
      (a, b) =>
        (r.scores[slugFromHref(b.href)] ?? 0) -
        (r.scores[slugFromHref(a.href)] ?? 0),
    );
  });

  const treatment = (href: string) => {
    const slug = slugFromHref(href);
    for (const rule of activeChips()) {
      const score = chipScores()[rule]?.[slug];
      if (score !== undefined && score < CHIP_PASS) {
        return { hidden: true, alpha: null as number | null };
      }
    }
    const r = result();
    if (!r || r.exists < EXISTS_THRESHOLD) {
      return { hidden: false, alpha: null as number | null };
    }
    const score = r.scores[slug] ?? 0;
    if (score < floor()) return { hidden: true, alpha: null as number | null };
    if (r.mode === "judge") {
      return {
        hidden: false,
        alpha: Math.max(RECEDE_MIN, Math.min(1, score * 3)),
      };
    }
    return { hidden: false, alpha: score > 0 ? 1 : RECEDE_MIN };
  };

  const canPin = () => {
    const rule = query().replace(/\s+/g, " ").trim();
    return judgeOn() && rule.length > 0 && !chips().includes(rule);
  };

  const pinCurrent = () => {
    const rule = query().replace(/\s+/g, " ").trim().replaceAll("|", " ");
    if (!rule) return;
    setChips((list) => (list.includes(rule) ? list : [...list, rule]));
    if (!activeChips().includes(rule)) {
      setActiveChips((list) => [...list, rule]);
    }
    setAiVizActivity("acting");
    void judgeChip(rule).then((res) => {
      if (res) {
        setChipScores((map) => ({ ...map, [rule]: res.scores }));
        pulseAiVizResponse();
        return;
      }
      setChipFailed((list) => [...list, rule]);
      setActiveChips((list) => list.filter((entry) => entry !== rule));
      setChips((list) => list.filter((entry) => entry !== rule));
      setAiVizActivity("idle");
    });
  };

  const toggleChip = (rule: string) => {
    if (chipFailed().includes(rule)) return;
    if (activeChips().includes(rule)) {
      setActiveChips((list) => list.filter((entry) => entry !== rule));
    } else {
      setActiveChips((list) => [...list, rule]);
      if (!chipScores()[rule]) {
        setAiVizActivity("acting");
        void judgeChip(rule).then((res) => {
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
    }
  };

  const statusNote = () => {
    const r = result();
    if (r?.mode === "literal" && query().trim()) return "literal fallback";
    if (!judgeOn()) return "no judge";
    return null;
  };

  return (
    <MockFrame name="navigation" class="h-[56svh] w-grids-5">
      <div class="uis-nav" classList={{ "is-miss": isMiss() }}>
        <div class="uis-nav-search">
          <div class="uis-nav-search-row">
            <input
              class="uis-nav-input"
              type="text"
              autocomplete="off"
              spellcheck={false}
              placeholder="search the index"
              aria-label="Search the catalog"
              value={query()}
              onInput={onInput}
            />
            <Show when={canPin()}>
              <button
                type="button"
                class="uis-nav-pin"
                title="Pin as a soft rule chip"
                onClick={pinCurrent}
              >
                pin
              </button>
            </Show>
          </div>
          <Show when={scoresActive()}>
            <input
              class="uis-nav-floor"
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
          <Show when={judgeOn() && chips().length > 0}>
            <div class="uis-nav-chips">
              <For each={chips()}>
                {(rule) => (
                  <button
                    type="button"
                    class="uis-nav-chip"
                    classList={{
                      "is-active": activeChips().includes(rule),
                      "is-failed": chipFailed().includes(rule),
                    }}
                    aria-pressed={activeChips().includes(rule)}
                    disabled={chipFailed().includes(rule)}
                    title={
                      chipFailed().includes(rule)
                        ? "Judge unavailable for this chip"
                        : undefined
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
        <ul class="uis-nav-list">
          <For each={ordered()}>
            {(item, index) => {
              const treat = () => treatment(item.href);
              return (
                <li
                  class="uis-nav-row"
                  style={{
                    display: treat().hidden ? "none" : undefined,
                    opacity:
                      treat().alpha == null
                        ? undefined
                        : String(treat().alpha),
                  }}
                >
                  <span class="uis-nav-num">
                    {String(pieces().indexOf(item) + 1).padStart(2, "0")}
                  </span>
                  <span class="uis-nav-title">{item.title}</span>
                  <Show when={index() === 0 && scoresActive()}>
                    <span class="uis-nav-mark" aria-hidden="true" />
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={statusNote()}>
          <p class="uis-nav-status">{statusNote()}</p>
        </Show>
      </div>
    </MockFrame>
  );
}
