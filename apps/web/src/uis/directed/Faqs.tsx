import {
  Index,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import type { UiProps } from "../types";
import {
  SEED_FAQS,
  askFaq,
  formatQuestion,
  indexFaqs,
  loadRememberedFaqs,
  saveRememberedFaqs,
  splitFaqCite,
  stripFaqSelfCite,
  type FaqItem,
} from "~/lib/faq";
import { createAsync } from "@acme/router";
import gsap, { A } from "~/lib/gsap";
import { SplitText } from "~/lib/split-text";
import { getNavCatalog, navPieces } from "~/lib/sections";
import "./Faqs.css";

const LINE_STAGGER = 0.16;
/** Matches --faq-intro-delay in Faqs.css. */
const FAQ_INTRO_DELAY = 0.1;
const LINE_TRAVEL = "0.8em";
const LINE_FADE_EASE = "power2.out";
const ANSWER_LINE_STAGGER = 0.08;

function pad(n: number) {
  return String(n + 1).padStart(2, "0");
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Travel rides expo.out; opacity eases slower so a line does not pop to full
 * strength in its first frames while it is still far from home.
 */
function lineIn(targets: HTMLElement | ArrayLike<HTMLElement>, stagger = 0) {
  gsap.killTweensOf(targets);
  if (reducedMotion()) {
    gsap.set(targets, { opacity: 1, y: 0 });
    return;
  }
  gsap.set(targets, { opacity: 0, y: LINE_TRAVEL });
  gsap.to(targets, {
    y: 0,
    duration: A.page.in.duration,
    ease: A.page.in.ease,
    stagger,
    overwrite: "auto",
  });
  gsap.to(targets, {
    opacity: 1,
    duration: A.page.in.duration,
    ease: LINE_FADE_EASE,
    stagger,
    overwrite: "auto",
  });
}

/** Lines that arrive after the first-paint CSS intro. */
function fadeLine(el: HTMLElement) {
  lineIn(el);
}

function fadeAnswer(el: HTMLElement, opacity: number) {
  if (reducedMotion()) {
    gsap.set(el, { opacity });
    return;
  }
  gsap.to(el, {
    opacity,
    duration: A.page.in.duration,
    ease: A.page.in.ease,
    overwrite: "auto",
  });
}

type AnswerCopy = { text: string; href?: string };

/** Answer text, with the trailing "From <Title>." as a link when the page is known. */
function fillAnswer(el: HTMLElement, { text, href }: AnswerCopy) {
  const { body, source } = splitFaqCite(text);
  if (!source || !href) {
    el.textContent = text;
    return;
  }
  const link = document.createElement("a");
  link.className = "faq-page-cite";
  link.href = href;
  link.textContent = source;
  el.replaceChildren(`${body} From `, link, ".");
}

/** Masked line reveal. Reverts once in, so the copy reflows on resize. */
function revealAnswer(el: HTMLElement, copy: AnswerCopy, opacity: number, prev?: SplitText) {
  const { text } = copy;
  prev?.revert();
  gsap.killTweensOf(el);
  fillAnswer(el, copy);
  gsap.set(el, { opacity });
  if (reducedMotion() || !text) return undefined;
  const split = SplitText.create(el, { type: "lines", mask: "lines" });
  gsap.set(split.lines, { yPercent: 100, opacity: 0 });
  gsap.to(split.lines, {
    opacity: 1,
    duration: A.page.in.duration,
    ease: LINE_FADE_EASE,
    stagger: ANSWER_LINE_STAGGER,
  });
  gsap.to(split.lines, {
    yPercent: 0,
    duration: A.page.in.duration,
    ease: A.page.in.ease,
    stagger: ANSWER_LINE_STAGGER,
    onComplete: () => split.revert(),
  });
  return split;
}

function FaqLine(props: {
  item: () => FaqItem;
  index: number;
  open: boolean;
  pending: boolean;
  introDone: boolean;
  sourceHref: (title: string) => string | undefined;
  onToggle: () => void;
}) {
  let el!: HTMLLIElement;
  let answer!: HTMLParagraphElement;
  let split: SplitText | undefined;

  const text = () => stripFaqSelfCite(props.item().answer);
  const copy = (): AnswerCopy => {
    const value = text();
    const source = splitFaqCite(value).source;
    return { text: value, href: source ? props.sourceHref(source) : undefined };
  };

  // Lines in the first paint stagger via CSS (--i); later ones via GSAP.
  const order = untrack(() => (props.introDone ? 0 : props.index));

  onMount(() => {
    if (props.introDone) fadeLine(el);
  });

  // SplitText rewrites the paragraph, so its content is set here, not rendered by Solid.
  createEffect((prev?: { open: boolean; copy: AnswerCopy; pending: boolean }) => {
    const next = { open: props.open, copy: copy(), pending: props.pending };
    const changed =
      prev?.copy.text !== next.copy.text || prev?.copy.href !== next.copy.href;
    if (next.open) {
      // Pending hides the paragraph behind the block; split once it can be measured.
      if (next.pending) return next;
      if (!prev) {
        // Open in the server HTML: the CSS intro fades it; no split, so first paint stays the LCP.
        fillAnswer(answer, next.copy);
        gsap.set(answer, { opacity: 1 });
      } else if (!prev.open || prev.copy.text !== next.copy.text || prev.pending) {
        split = revealAnswer(answer, next.copy, 1, split);
      } else if (changed) {
        split?.revert();
        split = undefined;
        fillAnswer(answer, next.copy);
      }
    } else if (prev?.open) {
      fadeAnswer(answer, 0);
    } else if (changed) {
      split?.revert();
      split = undefined;
      fillAnswer(answer, next.copy);
    }
    return next;
  });

  onCleanup(() => {
    split?.revert();
    gsap.killTweensOf(answer);
  });

  return (
    <li
      ref={el}
      class="faq-page-item"
      classList={{
        "is-open": props.open,
        "is-pending": props.pending,
      }}
      style={{ "--i": String(order) }}
    >
      <span class="faq-page-n" aria-hidden="true">
        {pad(props.index)}
      </span>
      <button
        type="button"
        class="faq-page-q"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        {props.item().question}
      </button>
      <div class="faq-page-body" aria-hidden={!props.open}>
        <div class="faq-page-body-inner">
          <span class="faq-page-dots" role="status" aria-label="Looking it up">
            <i />
          </span>
          <p ref={answer} class="faq-page-a">
            {untrack(text)}
          </p>
        </div>
      </div>
    </li>
  );
}

export default function FaqsDirected(_props: UiProps) {
  const [items, setItems] = createSignal<FaqItem[]>(SEED_FAQS);
  // Open in the server HTML so the largest element paints with the page.
  const [openId, setOpenId] = createSignal(SEED_FAQS[0]?.id ?? "");
  const [pendingId, setPendingId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);
  const [introDone, setIntroDone] = createSignal(false);
  const [introCss, setIntroCss] = createSignal(true);
  /** Grounded answers that landed while their item was open; applied on close. */
  const deferred = new Map<string, Pick<FaqItem, "question" | "answer">>();
  const catalog = createAsync(() => getNavCatalog());
  const sourceHref = (title: string) => {
    const wanted = title.trim().toLowerCase();
    return navPieces(catalog() ?? []).find((item) => item.title.trim().toLowerCase() === wanted)
      ?.href;
  };
  let input: HTMLInputElement | undefined;
  let page!: HTMLDivElement;

  onMount(() => {
    const remembered = loadRememberedFaqs();
    if (remembered.length > 0) setItems([...SEED_FAQS, ...remembered]);
    setReady(true);
    // Remembered lines mount in this pass and join the CSS stagger; anything later uses GSAP.
    const intro = requestAnimationFrame(() => setIntroDone(true));
    const introEnd = window.setTimeout(
      () => setIntroCss(false),
      (FAQ_INTRO_DELAY + (items().length + 1) * LINE_STAGGER + A.page.in.duration) * 1000,
    );
    onCleanup(() => {
      cancelAnimationFrame(intro);
      window.clearTimeout(introEnd);
      gsap.killTweensOf(page.querySelectorAll(".faq-page-item, .faq-page-ask"));
    });
    void indexFaqs().then((grounded) => {
      setItems((list) => {
        const byId = new Map(grounded.map((item) => [item.id, item]));
        return list.map((item) => {
          const next = byId.get(item.id);
          if (!next) return item;
          if (next.question === item.question && next.answer === item.answer) {
            return item;
          }
          // Swapping the open answer in place would paint a new, later LCP candidate.
          if (item.id === openId()) {
            deferred.set(item.id, { question: next.question, answer: next.answer });
            return item;
          }
          return { ...item, question: next.question, answer: next.answer };
        });
      });
    });
  });

  const applyDeferred = (id: string) => {
    const next = deferred.get(id);
    if (!next) return;
    deferred.delete(id);
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...next } : item)));
  };

  onCleanup(() => {
    setPendingId(null);
  });

  createEffect(() => {
    if (!ready()) return;
    saveRememberedFaqs(items());
  });

  const open = (id: string) => {
    const current = openId();
    setOpenId(id);
    if (current && current !== id) applyDeferred(current);
  };

  const toggle = (id: string) => {
    const current = openId();
    setOpenId(current === id ? "" : id);
    if (current) applyDeferred(current);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (pendingId()) return;
    const form = event.currentTarget as HTMLFormElement;
    const question = formatQuestion(String(new FormData(form).get("ask") ?? ""));
    if (!question) return;

    const id = `faq-${Date.now()}`;
    const existing = items().map((item) => ({
      id: item.id,
      question: item.question,
    }));
    setError(null);
    if (input) input.value = "";
    setItems((list) => [...list, { id, question, answer: "" }]);
    setPendingId(id);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => open(id));
    });

    const result = await askFaq({ question, existing });

    if (result.kind === "match") {
      setItems((list) => list.filter((item) => item.id !== id));
      open(result.id);
      setPendingId(null);
      input?.focus();
      return;
    }

    if (result.kind === "error") {
      setError(result.message);
      setItems((list) => list.filter((item) => item.id !== id));
      setPendingId(null);
      input?.focus();
      return;
    }

    setItems((list) =>
      list.map((item) =>
        item.id === id
          ? { id, question: result.question, answer: result.answer }
          : item,
      ),
    );
    setPendingId(null);
    input?.focus();
  };

  return (
    <div
      ref={page}
      class="faq-page"
      data-own-intro
      data-intro={introCss() ? "" : undefined}
      style={{ "--n": String(items().length) }}
    >
      <ol class="faq-page-list">
        <Index each={items()}>
          {(item, index) => (
            <FaqLine
              item={item}
              index={index}
              open={openId() === item().id}
              pending={pendingId() === item().id && !item().answer}
              introDone={introDone()}
              sourceHref={sourceHref}
              onToggle={() => toggle(item().id)}
            />
          )}
        </Index>
      </ol>
      <form class="faq-page-ask" onSubmit={submit}>
        <span class="faq-page-n" aria-hidden="true">
          +
        </span>
        <input
          ref={input}
          class="faq-page-ask-input"
          type="text"
          name="ask"
          autocomplete="off"
          maxlength={240}
          placeholder={error() ?? "Ask another"}
          aria-invalid={error() ? true : undefined}
          disabled={pendingId() !== null}
          onInput={(event) => {
            const el = event.currentTarget;
            const next = el.value.replace(
              /^(\s*)(\p{Ll})/u,
              (_, space: string, ch: string) => space + ch.toLocaleUpperCase(),
            );
            if (next === el.value) return;
            const start = el.selectionStart;
            const end = el.selectionEnd;
            el.value = next;
            if (start != null && end != null) el.setSelectionRange(start, end);
          }}
        />
      </form>
    </div>
  );
}
