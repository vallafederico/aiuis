import { For, Index, Show, createMemo, createSignal, onMount } from "solid-js";
import { createAsync } from "@acme/router";
import type { UiProps } from "../types";
import { KEEP_AT, getFilterRows, judgeFilterRule, type FilterRow } from "~/lib/filters";
import { nestedScroll } from "~/lib/utils/nested-scroll";
import "./Filters.css";

type Chip = {
  id: string;
  rule: string;
  /** slug -> probability the row passes; absent while the judgment is out. */
  scores?: Record<string, number>;
};

type RowState = { row: FilterRow; score: number | null; hidden: boolean; alpha: number };

const MAX_CHIPS = 4;
const FLOOR_MAX = KEEP_AT;
/** A receding row never fades below this, so it stays readable until it hides. */
const RECEDE_ALPHA = 0.28;

function pad(n: number) {
  return String(n + 1).padStart(2, "0");
}

export default function FiltersDirected(_props: UiProps) {
  const rows = createAsync(() => getFilterRows(), { deferStream: true });
  const [tags, setTags] = createSignal<string[]>([]);
  const [chips, setChips] = createSignal<Chip[]>([]);
  const [floor, setFloor] = createSignal(0.2);
  const [quiet, setQuiet] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;

  const allTags = createMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows() ?? []) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  });

  const judged = () => chips().filter((chip) => chip.scores);
  const pending = () => chips().some((chip) => !chip.scores);

  // Every chip must hold, so a row scores as its weakest chip. Tags cut exactly.
  const states = createMemo<RowState[]>(() => {
    const active = tags();
    const live = judged();
    const cut = floor();
    return (rows() ?? []).map((row) => {
      const tagged = active.every((tag) => row.tags.includes(tag));
      const score = live.length
        ? Math.min(...live.map((chip) => chip.scores![row.slug] ?? 0))
        : null;
      const hidden = !tagged || (score !== null && score < cut);
      const alpha =
        score === null || score >= KEEP_AT
          ? 1
          : RECEDE_ALPHA + (1 - RECEDE_ALPHA) * ((score - cut) / Math.max(KEEP_AT - cut, 0.01));
      return { row, score, hidden, alpha: Math.max(RECEDE_ALPHA, Math.min(1, alpha)) };
    });
  });

  const shown = () => states().filter((state) => !state.hidden).length;

  const toggleTag = (tag: string) =>
    setTags((list) => (list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]));

  const removeChip = (id: string) => setChips((list) => list.filter((chip) => chip.id !== id));

  const submit = async (event: Event) => {
    event.preventDefault();
    const rule = (input?.value ?? "").replace(/\s+/g, " ").trim();
    if (!rule || pending() || chips().length >= MAX_CHIPS) return;
    if (chips().some((chip) => chip.rule.toLowerCase() === rule.toLowerCase())) {
      if (input) input.value = "";
      return;
    }
    const id = `chip-${Date.now()}`;
    setQuiet(null);
    if (input) input.value = "";
    setChips((list) => [...list, { id, rule }]);

    const result = await judgeFilterRule(rule);
    if (!result) {
      // Silence: a weak match is not a confident wrong filter.
      removeChip(id);
      setQuiet(rule);
    } else {
      setChips((list) =>
        list.map((chip) => (chip.id === id ? { ...chip, scores: result.scores } : chip)),
      );
    }
    input?.focus();
  };

  const placeholder = () => {
    const miss = quiet();
    if (miss) return `Nothing here is “${miss}”`;
    if (chips().length >= MAX_CHIPS) return "Remove a rule to add another";
    return "Add a rule, like “has a prototype”";
  };

  return (
    <div class="flt-page" data-own-intro>
      <form class="flt-ask" onSubmit={submit}>
        <span class="flt-n" aria-hidden="true">
          +
        </span>
        <input
          ref={input}
          class="flt-ask-input"
          type="text"
          name="rule"
          autocomplete="off"
          maxlength={120}
          placeholder={placeholder()}
          aria-label="Add a rule"
          disabled={pending() || chips().length >= MAX_CHIPS}
          onInput={() => quiet() && setQuiet(null)}
        />
      </form>

      <div class="flt-controls">
        <Show when={chips().length > 0}>
          <ul class="flt-chips" aria-label="Rules">
            <For each={chips()}>
              {(chip) => (
                <li class="flt-chip" classList={{ "is-pending": !chip.scores }}>
                  <span>{chip.rule}</span>
                  <Show
                    when={chip.scores}
                    fallback={<i class="flt-cursor" role="status" aria-label="Judging" />}
                  >
                    <button
                      type="button"
                      class="flt-chip-x"
                      aria-label={`Remove “${chip.rule}”`}
                      onClick={() => removeChip(chip.id)}
                    >
                      ×
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <ul class="flt-tags" aria-label="Tags">
          <For each={allTags()}>
            {(tag) => (
              <li>
                <button
                  type="button"
                  class="flt-tag"
                  aria-pressed={tags().includes(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              </li>
            )}
          </For>
        </ul>

        <div class="flt-meta">
          <label class="flt-floor">
            <span>Floor</span>
            <input
              type="range"
              min={0}
              max={FLOOR_MAX}
              step={0.01}
              value={floor()}
              disabled={judged().length === 0}
              onInput={(event) => setFloor(Number(event.currentTarget.value))}
            />
            <span class="flt-mono">{floor().toFixed(2)}</span>
          </label>
          <p class="flt-mono flt-count" aria-live="polite">
            {shown()} of {states().length}
          </p>
        </div>
      </div>

      <ol class="flt-list" ref={(el) => onMount(() => nestedScroll(el))}>
        <Index each={states()}>
          {(state, index) => (
            <li
              class="flt-row"
              classList={{ "is-hidden": state().hidden }}
              style={{ "--i": String(index), "--alpha": String(state().alpha) }}
              aria-hidden={state().hidden}
            >
              <div class="flt-row-inner">
                <span class="flt-n" aria-hidden="true">
                  {pad(index)}
                </span>
                <a class="flt-title" href={state().row.href} tabIndex={state().hidden ? -1 : 0}>
                  {state().row.title}
                </a>
                <span class="flt-mono flt-score">
                  {state().score === null ? "" : state().score!.toFixed(2)}
                </span>
                <p class="flt-mono flt-row-meta">
                  {[state().row.section, ...state().row.tags].join(" · ")}
                </p>
              </div>
            </li>
          )}
        </Index>
      </ol>
    </div>
  );
}
