import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { UiProps } from "../types";
import {
  SEED_FAQS,
  askFaq,
  formatQuestion,
  indexFaqs,
  loadRememberedFaqs,
  saveRememberedFaqs,
  type FaqItem,
} from "~/lib/faq";
import "./Faqs.css";

function pad(n: number) {
  return String(n + 1).padStart(2, "0");
}

export default function FaqsDirected(_props: UiProps) {
  const [items, setItems] = createSignal<FaqItem[]>(SEED_FAQS);
  const [openId, setOpenId] = createSignal<string>(SEED_FAQS[0]?.id ?? "");
  const [pendingId, setPendingId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);
  let input: HTMLInputElement | undefined;

  onMount(() => {
    const remembered = loadRememberedFaqs();
    if (remembered.length > 0) {
      setItems([...SEED_FAQS, ...remembered]);
      setOpenId(remembered[remembered.length - 1].id);
    }
    setReady(true);
    void indexFaqs().then((grounded) => {
      setItems((list) => {
        const byId = new Map(grounded.map((item) => [item.id, item]));
        return list.map((item) => byId.get(item.id) ?? item);
      });
    });
  });

  onCleanup(() => {
    setPendingId(null);
  });

  createEffect(() => {
    if (!ready()) return;
    saveRememberedFaqs(items());
  });

  const toggle = (id: string) => {
    setOpenId((current) => (current === id ? "" : id));
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
      requestAnimationFrame(() => setOpenId(id));
    });

    const result = await askFaq({ question, existing });

    if (result.kind === "match") {
      setItems((list) => list.filter((item) => item.id !== id));
      setOpenId(result.id);
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
    <div class="faq-page">
      <ol class="faq-page-list">
        <For each={items()}>
          {(item, index) => (
            <li
              class="faq-page-item"
              classList={{
                "is-open": openId() === item.id,
                "is-pending": pendingId() === item.id && !item.answer,
              }}
            >
              <span class="faq-page-n" aria-hidden="true">
                {pad(index())}
              </span>
              <button
                type="button"
                class="faq-page-q"
                aria-expanded={openId() === item.id}
                onClick={() => toggle(item.id)}
              >
                {item.question}
              </button>
              <div class="faq-page-body" aria-hidden={openId() !== item.id}>
                <div class="faq-page-body-inner">
                  <p class="faq-page-a">
                    {item.answer || (pendingId() === item.id ? "Listening to the index…" : "")}
                  </p>
                </div>
              </div>
            </li>
          )}
        </For>
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
