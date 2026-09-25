import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import type { UiProps } from "../types";
import type { ArticleBlock, ArticlePath, ReadingTrace } from "~/lib/article-stream";
import { nestedScroll } from "~/lib/utils/nested-scroll";
import "./InfiniteArticle.css";

const OPENING: ArticleBlock[] = [
  {
    form: "heading",
    path: "advance",
    heading: "An article that is still being written",
    paragraphs: [
      "An article normally ends where its author stopped. This one ends where the reader does: each time you reach the bottom, the next section is written from what you have just read.",
      "Buttons assumed a system that was fast, deterministic, and silent about its own uncertainty. Most language model interfaces invert all three: they speak before they know, hide their confidence, and treat every pause as failure.",
      "The text below keeps that problem in view. It is generated, it says so, and the next piece starts on its own. After that, a new piece begins when the place it will be written comes into view.",
    ],
  },
];

/** Pointer farther than this from every passage picks nothing. */
const NEAR_PX = 140;
/** A second passage joins the pick when it is almost as close as the first. */
const CLUSTER_PX = 40;
/** A long session stops here instead of generating forever. */
const MAX_SECTIONS = 40;

const PATH_KICKER: Partial<Record<ArticlePath, string>> = {
  unpack: "More carefully",
  instance: "For instance",
  objection: "The objection",
  define: "What that means",
};

function blockText(block: ArticleBlock): string {
  return [
    block.heading,
    ...block.paragraphs,
    ...(block.items ?? []),
    block.left,
    block.right,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function blockFocus(block: ArticleBlock): string {
  return block.heading || block.paragraphs[0] || block.items?.[0] || block.left || "";
}

function showKicker(block: ArticleBlock): string | undefined {
  if (block.form === "heading" || block.form === "question" || block.form === "contrast") {
    return;
  }
  return PATH_KICKER[block.path];
}

type MarginNote = { quote: string; text: string; writing: boolean; side: "left" | "right" };
/** A plate is shown as the canvas it was cleaned on, or as the raw src if that failed. */
type Plate = { src: string; alt: string; canvas?: HTMLCanvasElement };

/**
 * Snap every pixel that is not blue ink to the page paper, so the field cannot
 * drift. The cleaned canvas is shown as is: re-encoding it to a PNG data URL
 * was a long main-thread task, and a late <img> became the page LCP.
 */
function matchPlatePaper(src: string): Promise<HTMLCanvasElement | null> {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw);
  const paper = hex
    ? [
        Number.parseInt(hex[1]!.slice(0, 2), 16),
        Number.parseInt(hex[1]!.slice(2, 4), 16),
        Number.parseInt(hex[1]!.slice(4, 6), 16),
      ]
    : [233, 233, 234];
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || !canvas.width || !canvas.height) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const blueness = b - Math.max(r, g);
        if (blueness > 18 || (blueness > 6 && (r + g + b) / 3 < 210)) continue;
        data[i] = paper[0]!;
        data[i + 1] = paper[1]!;
        data[i + 2] = paper[2]!;
      }
      ctx.putImageData(frame, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function plateSubject(block: ArticleBlock): string {
  const line = block.heading || block.paragraphs[0] || block.items?.[0] || block.left || "";
  const sentence = line.split(/(?<=\.)\s/)[0] ?? line;
  return sentence.replace(/\s+/g, " ").trim().slice(0, 180);
}

function noteCopy(block: ArticleBlock): string {
  return block.paragraphs.find((item) => item.trim()) || block.items?.[0] || block.heading || "";
}

function Line(props: { note?: MarginNote; children: JSX.Element }) {
  return (
    <div
      class="inf-line"
      classList={{
        "has-note": !!props.note,
        "is-note-left": props.note?.side === "left",
      }}
    >
      {props.children}
      <Show when={props.note}>
        {(note) => (
          <aside
            class="inf-sel-note"
            classList={{ "is-writing": note().writing }}
            aria-live="polite"
          >
            <p>{note().text}</p>
          </aside>
        )}
      </Show>
    </div>
  );
}

function ArticlePiece(props: {
  block: ArticleBlock;
  index: number;
  streaming?: boolean;
  notes: Record<string, MarginNote>;
  plate?: Plate;
}) {
  const area = (part: string) => `${props.index}:${part}`;
  return (
    <section
      class="inf-block"
      classList={{
        "is-continuation": props.block.form === "continuation",
        "is-note": props.block.form === "note",
        "is-question": props.block.form === "question",
        "is-contrast": props.block.form === "contrast",
        "is-list": props.block.form === "list",
        "is-streaming": !!props.streaming,
      }}
      data-inf-block
      data-focus={blockFocus(props.block)}
    >
      <Show when={showKicker(props.block)}>
        {(kicker) => <p class="inf-kicker">{kicker()}</p>}
      </Show>
      <Show when={props.block.heading}>
        {(heading) => (
          <Line note={props.notes[area("h")]}>
            <h2 class="inf-heading" data-inf-area data-area={area("h")} data-block={props.index}>
              {heading()}
            </h2>
          </Line>
        )}
      </Show>
      <Show when={props.block.form === "contrast" && (props.block.left || props.block.right)}>
        <div class="inf-contrast">
          <Show when={props.block.left}>
            <Line note={props.notes[area("left")]}>
              <p class="inf-p" data-inf-area data-area={area("left")} data-block={props.index}>
                <Show when={props.block.leftLabel}>
                  <span class="inf-kicker">{props.block.leftLabel}</span>
                </Show>
                {props.block.left}
              </p>
            </Line>
          </Show>
          <Show when={props.block.right}>
            <Line note={props.notes[area("right")]}>
              <p class="inf-p" data-inf-area data-area={area("right")} data-block={props.index}>
                <Show when={props.block.rightLabel}>
                  <span class="inf-kicker">{props.block.rightLabel}</span>
                </Show>
                {props.block.right}
              </p>
            </Line>
          </Show>
        </div>
      </Show>
      <Show when={props.block.form === "list" && props.block.items?.length}>
        <ul class="inf-list">
          <For each={props.block.items}>
            {(item, i) => (
              <li>
                <Line note={props.notes[area(`li:${i()}`)]}>
                  <span data-inf-area data-area={area(`li:${i()}`)} data-block={props.index}>
                    {item}
                  </span>
                </Line>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <For each={props.block.paragraphs}>
        {(text, i) => (
          <Line note={props.notes[area(`p:${i()}`)]}>
            <p class="inf-p" data-inf-area data-area={area(`p:${i()}`)} data-block={props.index}>
              {text}
            </p>
          </Line>
        )}
      </For>
      <Show when={props.plate}>
        {(plate) => (
          <figure class="inf-plate">
            <Show
              when={plate().canvas}
              fallback={
                <Show when={plate().src}>
                  <img src={plate().src} alt={plate().alt} />
                </Show>
              }
            >
              {(canvas) => canvas()}
            </Show>
          </figure>
        )}
      </Show>
    </section>
  );
}

/**
 * The first continuation starts on its own. Later pieces start when the place
 * they will be written is in view, from the tail of the essay and from how
 * that tail was read. The shape changes with the path.
 */
export default function InfiniteArticleDirected(props: UiProps) {
  const [blocks, setBlocks] = createSignal<ArticleBlock[]>(OPENING);
  const [draft, setDraft] = createSignal<ArticleBlock | null>(null);
  const [writing, setWriting] = createSignal(false);
  const [stopped, setStopped] = createSignal<string | null>(null);
  const [notes, setNotes] = createSignal<Record<string, MarginNote>>({});
  const [plates, setPlates] = createSignal<Record<number, Plate>>({});

  let scroller!: HTMLDivElement;
  let sentinel!: HTMLDivElement;
  let observer: IntersectionObserver | undefined;
  let disposed = false;
  let spotInView = false;
  let spotKnown = false;
  /** After the first piece, the next write waits for the insertion point to enter view. */
  let armed = false;
  let hasGenerated = false;
  let failures = 0;
  let shownAt = 0;
  let returned = false;
  let lastScroll = 0;
  let abort: AbortController | undefined;
  const noteAborts = new Map<string, AbortController>();
  let figureBusy = false;
  let figureAbort: AbortController | undefined;
  let selecting = false;
  let selectTimer = 0;
  let pointerFrame = 0;
  let nearTexts: string[] = [];
  let aimed = false;

  const distanceTo = (x: number, y: number, rect: DOMRect) => {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.hypot(dx, dy);
  };

  const pickNear = (x: number, y: number) => {
    const nodes = [...scroller.querySelectorAll<HTMLElement>("[data-inf-area]")];
    const ranked = nodes
      .map((node) => ({
        node,
        dist: distanceTo(x, y, node.getBoundingClientRect()),
        index: Number(node.dataset.block ?? "-1"),
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
      }))
      .filter((item) => item.text.length > 0)
      .sort((a, b) => a.dist - b.dist);
    const closest = ranked[0];
    nodes.forEach((node) => node.classList.remove("is-near"));
    if (!closest || closest.dist > NEAR_PX) {
      nearTexts = [];
      aimed = false;
      return;
    }
    const picked = ranked
      .filter((item, index) => index === 0 || item.dist <= closest.dist + CLUSTER_PX)
      .slice(0, 3);
    picked.forEach((item) => item.node.classList.add("is-near"));
    nearTexts = picked.map((item) => item.text);
    const lastIndex = blocks().length - 1;
    aimed = picked.some((item) => item.index >= 0 && item.index < lastIndex);
  };

  const onPointer = (event: PointerEvent) => {
    window.cancelAnimationFrame(pointerFrame);
    const x = event.clientX;
    const y = event.clientY;
    pointerFrame = window.requestAnimationFrame(() => {
      if (!disposed) pickNear(x, y);
    });
  };

  const clearNear = () => {
    window.cancelAnimationFrame(pointerFrame);
    scroller.querySelectorAll<HTMLElement>("[data-inf-area].is-near").forEach((node) => {
      node.classList.remove("is-near");
    });
    nearTexts = [];
    aimed = false;
  };

  const reading = (): ReadingTrace => {
    const all = blocks();
    const dwellMs = Math.max(0, performance.now() - shownAt);
    let focus = nearTexts[0] || blockFocus(all[all.length - 1]!);
    if (!nearTexts[0] && returned) {
      const edge = scroller.getBoundingClientRect().top + 80;
      const nodes = scroller.querySelectorAll<HTMLElement>("[data-inf-block]");
      nodes.forEach((node) => {
        if (node.getBoundingClientRect().top <= edge && node.dataset.focus) {
          focus = node.dataset.focus;
        }
      });
    }
    return {
      dwellMs,
      returned,
      aimed,
      near: nearTexts.slice(0, 3),
      focus,
      recentForms: all.slice(-3).map((block) => block.form),
      recentPaths: all.slice(-3).map((block) => block.path),
    };
  };

  const fail = (message: string) => {
    console.error("[infinite article]", message);
    setDraft(null);
    setWriting(false);
    failures += 1;
    if (failures >= 3) setStopped("The next section did not arrive.");
    else if (!hasGenerated) void writeNext(true);
    else if (armed && spotInView) void writeNext();
  };

  const writeNext = async (force = false) => {
    if (writing() || stopped() || disposed) return;
    if (!force && (!armed || !spotInView)) return;
    armed = false;
    if (blocks().length >= MAX_SECTIONS) {
      setStopped("That is where this one stops.");
      return;
    }
    setWriting(true);
    setDraft(null);
    const all = blocks();
    const trace = reading();
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    try {
      const res = await fetch("/api/article-stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          title: props.title,
          headings: all
            .map((block) => block.heading)
            .filter((heading): heading is string => !!heading),
          tail: all.slice(-2).map(blockText).join("\n\n"),
          reading: trace,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        fail(`Stream ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final: ArticleBlock | null = null;
      let failed: string | null = null;
      while (!disposed) {
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
          let event: { kind?: string; block?: ArticleBlock; message?: string };
          try {
            event = JSON.parse(data) as typeof event;
          } catch {
            continue;
          }
          if (event.kind === "draft" && event.block) {
            setDraft(event.block);
          } else if (event.kind === "done" && event.block) {
            final = event.block;
          } else if (event.kind === "error") {
            failed = event.message ?? "Empty section";
          }
        }
      }
      if (disposed) return;
      setDraft(null);
      setWriting(false);
      if (!final) {
        fail(failed ?? "Empty section");
        return;
      }
      failures = 0;
      returned = false;
      hasGenerated = true;
      shownAt = performance.now();
      const index = blocks().length;
      setBlocks((prev) => [...prev, final]);
      considerFigure(index, final);
      // Already on screen does not count as arriving. Arm once the spot leaves.
      armed = spotKnown && !spotInView;
    } catch (cause) {
      if (disposed || controller.signal.aborted) return;
      fail(cause instanceof Error ? cause.message : "Stream failed");
    }
  };

  const considerFigure = (index: number, block: ArticleBlock) => {
    if (disposed || figureBusy || index < 1 || index % 3 !== 1) return;
    const alt = plateSubject(block);
    if (alt.length < 8) return;
    figureBusy = true;
    const controller = new AbortController();
    figureAbort = controller;
    setPlates((prev) => ({ ...prev, [index]: { src: "", alt } }));
    void (async () => {
      try {
        const res = await fetch("/api/article-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject: alt }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Plate ${res.status}`);
        const body = (await res.json()) as { src?: string };
        if (!body.src || disposed) throw new Error("Empty plate");
        const canvas = await matchPlatePaper(body.src);
        if (disposed) return;
        canvas?.setAttribute("role", "img");
        canvas?.setAttribute("aria-label", alt);
        setPlates((prev) => ({ ...prev, [index]: { src: body.src!, alt, canvas: canvas ?? undefined } }));
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        console.error("[infinite article]", cause);
        setPlates((prev) => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
      } finally {
        figureBusy = false;
        if (figureAbort === controller) figureAbort = undefined;
      }
    })();
  };

  const writeNote = async (area: string, quote: string, around: string) => {
    const current = notes()[area];
    if (current && current.quote === quote && (current.writing || current.text)) return;
    noteAborts.get(area)?.abort();
    const controller = new AbortController();
    noteAborts.set(area, controller);
    const side: MarginNote["side"] = Math.random() < 0.5 ? "left" : "right";
    const put = (text: string, writing: boolean) => {
      setNotes((prev) => ({ ...prev, [area]: { quote, text, writing, side } }));
    };
    put("", true);
    try {
      const res = await fetch("/api/article-stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          title: props.title,
          headings: [],
          tail: around,
          reading: {
            dwellMs: 0,
            returned: false,
            aimed: false,
            near: [],
            focus: quote,
            recentForms: [],
            recentPaths: [],
          },
          aside: { quote, around },
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Stream ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final = "";
      while (!disposed) {
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
          let event: { kind?: string; block?: ArticleBlock };
          try {
            event = JSON.parse(data) as typeof event;
          } catch {
            continue;
          }
          if ((event.kind === "draft" || event.kind === "done") && event.block) {
            const text = noteCopy(event.block);
            if (text) {
              final = text;
              put(text, event.kind !== "done");
            }
          }
        }
      }
      if (disposed || controller.signal.aborted) return;
      put(final || "The note did not arrive.", false);
    } catch (cause) {
      if (disposed || controller.signal.aborted) return;
      console.error("[infinite article]", cause);
      put("The note did not arrive.", false);
    } finally {
      if (noteAborts.get(area) === controller) noteAborts.delete(area);
    }
  };

  const commitSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (quote.length < 2) return;
    const node = sel.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    const area = el?.closest<HTMLElement>("[data-inf-area]");
    if (!area || !scroller.contains(area) || area.closest(".inf-sel-note")) return;
    const id = area.dataset.area;
    if (!id) return;
    const around = (area.textContent ?? "").replace(/\s+/g, " ").trim();
    void writeNote(id, quote, around);
  };

  const onSpot = (inView: boolean) => {
    const entered = spotKnown && inView && !spotInView;
    spotKnown = true;
    spotInView = inView;
    if (!hasGenerated || writing()) return;
    if (!inView) {
      armed = true;
      return;
    }
    if (entered && armed) void writeNext();
  };

  const onScroll = () => {
    const y = scroller.scrollTop;
    if (y < lastScroll - 40) returned = true;
    lastScroll = y;
  };

  const onPointerDown = () => {
    selecting = true;
  };
  const onPointerUp = () => {
    selecting = false;
    window.clearTimeout(selectTimer);
    selectTimer = window.setTimeout(commitSelection, 30);
  };
  const onSelectionChange = () => {
    if (selecting) return;
    window.clearTimeout(selectTimer);
    selectTimer = window.setTimeout(commitSelection, 180);
  };

  onMount(() => {
    shownAt = performance.now();
    nestedScroll(scroller);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("pointermove", onPointer);
    scroller.addEventListener("pointerleave", clearNear);
    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    observer = new IntersectionObserver(
      ([entry]) => {
        onSpot(!!entry?.isIntersecting);
      },
      { root: scroller, rootMargin: "0px" },
    );
    observer.observe(sentinel);
    void writeNext(true);
  });

  onCleanup(() => {
    disposed = true;
    // Also runs when SSR re-renders a resolved Suspense; a throw there hangs the stream.
    if (isServer) return;
    abort?.abort();
    figureAbort?.abort();
    for (const controller of noteAborts.values()) controller.abort();
    window.cancelAnimationFrame(pointerFrame);
    window.clearTimeout(selectTimer);
    scroller.removeEventListener("scroll", onScroll);
    scroller.removeEventListener("pointermove", onPointer);
    scroller.removeEventListener("pointerleave", clearNear);
    scroller.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("selectionchange", onSelectionChange);
    observer?.disconnect();
  });

  return (
    <div ref={scroller} class="inf-page">
      <article class="inf-article">
        <Line note={notes().title}>
          <h1 class="inf-title" data-inf-area data-area="title" data-block="-1">
            {props.title}
          </h1>
        </Line>
        <For each={blocks()}>
          {(block, index) => (
            <ArticlePiece
              block={block}
              index={index()}
              notes={notes()}
              plate={plates()[index()]}
            />
          )}
        </For>
        <Show when={draft()}>
          {(block) => (
            <ArticlePiece block={block()} index={blocks().length} notes={notes()} streaming />
          )}
        </Show>
        <div class="inf-status" role="status" aria-live="polite">
          <Show when={writing() && !draft()}>
            <span class="inf-cursor" aria-label="Writing the next section">
              <i />
            </span>
          </Show>
          <Show when={stopped()}>{(message) => <p class="inf-stop">{message()}</p>}</Show>
        </div>
        <div ref={sentinel} class="inf-sentinel" aria-hidden="true" />
      </article>
    </div>
  );
}
