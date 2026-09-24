import { For, Index, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { UiProps } from "../types";
import {
  RANGES,
  RANGE_LABELS,
  formatBucket,
  formatDelta,
  formatValue,
  normalizeBoard,
  type Board,
  type Point,
  type Range,
  type Resolved,
  type Widget,
  type WidgetData,
} from "~/lib/dashboard";
import "./TypeAnAnalytic.css";

const STORAGE_KEY = "aiuis:dashboard:v2";
const MAX_NEEDS = 8;

const EXAMPLES = [
  "is anyone out there?",
  "are we broke",
  "what does a reader cost us in AI",
  "vibes",
];

type Phase = "idle" | "composing" | "filling" | "captioning";

type Saved = {
  board: Board;
  needs: string[];
  headline: string;
  captions: Record<string, string>;
};

type Event =
  | { kind: "draft" | "board"; board: Board }
  | { kind: "data"; id: string; resolved: Resolved }
  | { kind: "captions"; headline: string; captions: Record<string, string> }
  | { kind: "error"; message: string }
  | { kind: "done" };

function loadSaved(): Saved | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    const board = normalizeBoard(parsed?.board);
    if (!parsed || !board) return null;
    return {
      board,
      needs: Array.isArray(parsed.needs) ? parsed.needs.filter((n) => typeof n === "string").slice(-MAX_NEEDS) : [],
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      captions: parsed.captions && typeof parsed.captions === "object" ? parsed.captions : {},
    };
  } catch {
    return null;
  }
}

async function stream(body: unknown, signal: AbortSignal, onEvent: (event: Event) => void) {
  const res = await fetch("/api/dashboard", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Stream ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as Event);
      } catch {
        // A malformed event is dropped; the next one carries the full state.
      }
    }
  }
}

// ——— visuals ——————————————————————————————————————————————————

function Spark(props: { points: Point[] }) {
  const max = () => Math.max(1e-9, ...props.points.map((p) => p.v));
  const path = () =>
    props.points
      .map((p, i) => `${i === 0 ? "M" : "L"}${i} ${100 - (p.v / max()) * 100}`)
      .join(" ");
  return (
    <svg
      class="need-spark"
      viewBox={`0 0 ${Math.max(1, props.points.length - 1)} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path()} />
    </svg>
  );
}

function Delta(props: { value: number; prev?: number }) {
  const text = () => formatDelta(props.value, props.prev);
  return (
    <Show when={text()}>
      {(t) => (
        <span class="need-delta" classList={{ "is-down": t().startsWith("−") }}>
          {t()} <small>vs period before</small>
        </span>
      )}
    </Show>
  );
}

function Trend(props: { data: Extract<WidgetData, { kind: "trend" }> }) {
  const n = () => props.data.series[0]?.points.length ?? 0;
  const stacked = () =>
    Array.from({ length: n() }, (_, i) =>
      props.data.series.reduce((acc, s) => acc + (s.points[i]?.v ?? 0), 0),
    );
  const max = () => Math.max(1e-9, ...stacked(), props.data.mark?.v ?? 0);
  const y = (v: number) => 100 - (v / max()) * 100;
  const first = () => props.data.series[0]?.points[0]?.t;
  const last = () => props.data.series[0]?.points[n() - 1]?.t;

  return (
    <div class="need-chart">
      <svg class="need-chart-svg" viewBox={`0 0 ${Math.max(1, n())} 100`} preserveAspectRatio="none" aria-hidden="true">
        <Index each={stacked()}>
          {(_, i) => {
            const segments = () => {
              let base = 0;
              return props.data.series.map((s, si) => {
                const v = s.points[i]?.v ?? 0;
                const seg = { si, top: y(base + v), height: (v / max()) * 100 };
                base += v;
                return seg;
              });
            };
            return (
              <For each={segments()}>
                {(seg) => (
                  <rect
                    class="need-chart-bar"
                    data-series={seg.si}
                    x={i + 0.14}
                    width={0.72}
                    y={seg.top}
                    height={Math.max(seg.height, 0)}
                    style={{ "--i": String(i) }}
                  />
                )}
              </For>
            );
          }}
        </Index>
        <Show when={props.data.mark}>
          {(mark) => <line class="need-chart-mark" x1="0" x2={n()} y1={y(mark().v)} y2={y(mark().v)} />}
        </Show>
      </svg>
      <div class="need-chart-axis">
        <span>{first() ? formatBucket(first()!) : ""}</span>
        <Show when={props.data.series.length > 1 || props.data.mark}>
          <span class="need-chart-legend">
            <For each={props.data.series}>
              {(s, si) => (
                <span>
                  <i data-series={si()} />
                  {s.name}
                </span>
              )}
            </For>
            <Show when={props.data.mark}>
              {(mark) => (
                <span>
                  <i class="is-mark" />
                  {mark().label}
                </span>
              )}
            </Show>
          </span>
        </Show>
        <span>{last() ? formatBucket(last()!) : ""}</span>
      </div>
    </div>
  );
}

function Ranking(props: { data: Extract<WidgetData, { kind: "ranking" }> }) {
  const max = () => Math.max(1e-9, ...props.data.rows.map((r) => r.v));
  return (
    <Show when={props.data.rows.length > 0} fallback={<p class="need-quiet">Nothing in this window.</p>}>
      <ol class="need-bars">
        <For each={props.data.rows}>
          {(row, i) => (
            <li style={{ "--i": String(i()) }}>
              <span class="need-bars-label" title={row.label}>
                {row.label}
              </span>
              <span class="need-bars-track">
                <i style={{ width: `${(row.v / max()) * 100}%` }} />
              </span>
              <span class="need-bars-v">{formatValue(row.v, props.data.unit)}</span>
            </li>
          )}
        </For>
      </ol>
    </Show>
  );
}

function Body(props: { data: WidgetData }) {
  const d = () => props.data;
  return (
    <Switch>
      <Match when={d().kind === "number" && (d() as Extract<WidgetData, { kind: "number" }>)}>
        {(n) => (
          <div class="need-number">
            <p class="need-big">{formatValue(n().value, n().unit)}</p>
            <Delta value={n().value} prev={n().prev} />
            <Show when={n().spark && n().spark!.length > 1}>
              <Spark points={n().spark!} />
            </Show>
          </div>
        )}
      </Match>
      <Match when={d().kind === "trend" && (d() as Extract<WidgetData, { kind: "trend" }>)}>
        {(t) => (
          <>
            <div class="need-number is-inline">
              <p class="need-big">{formatValue(t().total, t().unit)}</p>
              <Delta value={t().total} prev={t().prev} />
            </div>
            <Trend data={t()} />
          </>
        )}
      </Match>
      <Match when={d().kind === "ranking" && (d() as Extract<WidgetData, { kind: "ranking" }>)}>
        {(r) => <Ranking data={r()} />}
      </Match>
      <Match when={d().kind === "ratio" && (d() as Extract<WidgetData, { kind: "ratio" }>)}>
        {(r) => (
          <div class="need-number">
            <p class="need-big">{formatValue(r().value, r().unit)}</p>
            <p class="need-per">{r().per}</p>
          </div>
        )}
      </Match>
      <Match when={d().kind === "list" && (d() as Extract<WidgetData, { kind: "list" }>)}>
        {(l) => (
          <ol class="need-list">
            <For each={l().items}>
              {(item, i) => (
                <li style={{ "--i": String(i()) }}>
                  <span>{item.label}</span>
                  <small>{item.sub}</small>
                </li>
              )}
            </For>
          </ol>
        )}
      </Match>
      <Match when={d().kind === "unavailable" && (d() as Extract<WidgetData, { kind: "unavailable" }>)}>
        {(u) => <p class="need-quiet">{u().reason}</p>}
      </Match>
    </Switch>
  );
}

function Tile(props: { widget: Widget; resolved?: Resolved; caption?: string; forming: boolean }) {
  const isNote = () => props.widget.kind === "note";
  return (
    <article
      class="need-w"
      data-size={props.widget.size}
      data-kind={props.widget.kind}
      classList={{
        "is-forming": props.forming,
        "is-missing": props.resolved?.data.kind === "unavailable",
      }}
      aria-busy={!props.resolved && !isNote()}
    >
      <Show when={props.widget.title}>
        <h3 class="need-w-title">{props.widget.title}</h3>
      </Show>
      <div class="need-w-body">
        <Show
          when={!isNote()}
          fallback={<p class="need-note">{props.widget.text}</p>}
        >
          <Show
            when={props.resolved}
            fallback={
              <span class="need-cursor" role="status" aria-label="Fetching">
                <i />
              </span>
            }
          >
            {(r) => <Body data={r().data} />}
          </Show>
        </Show>
      </div>
      <Show when={!isNote()}>
        <footer class="need-w-foot">
          <Show when={props.caption && props.resolved?.data.kind !== "unavailable"}>
            <p class="need-caption">{props.caption}</p>
          </Show>
          <p class="need-w-meta">
            <span>{props.widget.metrics.map((m) => m.replaceAll("_", " ")).join(" / ")}</span>
            <Show when={props.resolved}>
              {(r) => (
                <>
                  <span>{r().source}</span>
                  <Show when={r().note}>{(note) => <span>{note()}</span>}</Show>
                </>
              )}
            </Show>
          </p>
        </footer>
      </Show>
    </article>
  );
}

// ——— the page ——————————————————————————————————————————————————

export default function TypeAnAnalyticDirected(_props: UiProps) {
  const [board, setBoard] = createSignal<Board | null>(null);
  const [needs, setNeeds] = createSignal<string[]>([]);
  const [resolved, setResolved] = createSignal<Record<string, Resolved>>({});
  const [captions, setCaptions] = createSignal<Record<string, string>>({});
  const [headline, setHeadline] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [placeholder, setPlaceholder] = createSignal("Type an analytic");
  const [ready, setReady] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let abort: AbortController | undefined;

  const busy = () => phase() !== "idle";

  const run = async (body: unknown, fresh: boolean) => {
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    let drafted = false;
    let failed: string | null = null;
    setPhase(fresh ? "composing" : "filling");
    try {
      await stream(body, controller.signal, (event) => {
        switch (event.kind) {
          case "draft":
          case "board":
            if (!drafted) {
              drafted = true;
              setResolved({});
              setCaptions({});
              setHeadline("");
            }
            setBoard(event.board);
            if (event.kind === "board") setPhase("filling");
            break;
          case "data":
            setResolved((prev) => ({ ...prev, [event.id]: event.resolved }));
            break;
          case "captions":
            setPhase("captioning");
            setHeadline(event.headline);
            setCaptions(event.captions);
            break;
          case "error":
            failed = event.message;
            break;
        }
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      failed = error instanceof Error ? error.message : "The composer is not reachable.";
    }
    if (abort !== controller) return;
    setPhase("idle");
    if (failed) setPlaceholder(failed);
    return !failed;
  };

  const submit = async (need: string) => {
    need = need.replace(/\s+/g, " ").trim();
    if (!need || busy()) return;
    if (input) input.value = "";
    setPlaceholder("Change it, or ask for something else");
    const current = board();
    const ok = await run({ need, current: current ?? undefined }, true);
    if (ok) setNeeds((list) => [...(current ? list : []), need].slice(-MAX_NEEDS));
    input?.focus();
  };

  const setRange = (range: Range) => {
    const b = board();
    if (!b || busy() || b.range === range) return;
    const next = { ...b, range };
    setBoard(next);
    setResolved({});
    setCaptions({});
    setHeadline("");
    void run({ refresh: next, need: needs().at(-1) }, false);
  };

  const clear = () => {
    abort?.abort();
    setPhase("idle");
    setBoard(null);
    setNeeds([]);
    setResolved({});
    setCaptions({});
    setHeadline("");
    setPlaceholder("Type an analytic");
    input?.focus();
  };

  onMount(() => {
    const saved = loadSaved();
    if (saved) {
      setBoard(saved.board);
      setNeeds(saved.needs);
      setHeadline(saved.headline);
      setCaptions(saved.captions);
      setPlaceholder("Change it, or ask for something else");
      void run({ refresh: saved.board }, false);
    }
    setReady(true);
  });

  onCleanup(() => abort?.abort());

  createEffect(() => {
    if (!ready() || phase() !== "idle") return;
    const b = board();
    if (!b) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const saved: Saved = { board: b, needs: needs(), headline: headline(), captions: captions() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  });

  return (
    <div class="need-page" data-lenis-prevent classList={{ "is-empty": !board(), "is-busy": busy() }} data-phase={phase()}>
      <div class="need-top">
        <form
          class="need-ask"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(input?.value ?? "");
          }}
        >
          <span class="need-n" aria-hidden="true">
            {busy() ? "·" : "+"}
          </span>
          <input
            ref={input}
            class="need-ask-input"
            type="text"
            name="need"
            autocomplete="off"
            maxlength={240}
            placeholder={placeholder()}
            aria-label="Type an analytic"
            disabled={busy()}
          />
        </form>

        <Show when={!board()}>
          <ul class="need-examples" aria-label="Try">
            <For each={EXAMPLES}>
              {(example) => (
                <li>
                  <button type="button" onClick={() => void submit(example)}>
                    {example}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <Show when={board()}>
        {(b) => (
          <header class="need-head">
            <div class="need-head-top">
              <h2 class="need-title">{b().title || "…"}</h2>
              <div class="need-ranges" role="group" aria-label="Range">
                <For each={RANGES}>
                  {(range) => (
                    <button
                      type="button"
                      aria-pressed={b().range === range}
                      disabled={busy()}
                      onClick={() => setRange(range)}
                    >
                      {RANGE_LABELS[range]}
                    </button>
                  )}
                </For>
                <button type="button" class="need-clear" onClick={clear}>
                  new
                </button>
              </div>
            </div>
            <p class="need-headline" classList={{ "is-waiting": !headline() }}>
              {headline() || (phase() === "composing" ? "Composing…" : phase() === "filling" ? "Fetching…" : "")}
            </p>
            <ol class="need-thread">
              <For each={needs()}>{(need) => <li>“{need}”</li>}</For>
              <Show when={b().reading}>
                <li class="need-reading">{b().reading}</li>
              </Show>
            </ol>
          </header>
        )}
      </Show>

      <div class="need-board">
        <For each={board()?.widgets ?? []}>
          {(widget) => (
            <Tile
              widget={widget}
              resolved={resolved()[widget.id]}
              caption={captions()[widget.id]}
              forming={phase() === "composing"}
            />
          )}
        </For>
      </div>

    </div>
  );
}
