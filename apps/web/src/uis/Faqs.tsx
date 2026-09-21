import { For, createEffect, createSignal, onMount } from "solid-js";
import { MockFrame } from "./Mock";
import type { UiProps } from "./types";
import {
  SEED_FAQS,
  askFaq,
  loadRememberedFaqs,
  saveRememberedFaqs,
  type FaqItem,
} from "~/lib/faq";
import "./Faqs.css";

export default function Faqs(_props: UiProps) {
  const [items, setItems] = createSignal<FaqItem[]>(SEED_FAQS);
  const [openId, setOpenId] = createSignal<string>(SEED_FAQS[1]?.id ?? SEED_FAQS[0].id);
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
    const question = String(new FormData(form).get("ask") ?? "")
      .replace(/\s+/g, " ")
      .trim();
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
    <MockFrame name="faqs" class="h-[56svh] w-grids-5">
      <div class="uis-faq">
        <ul class="uis-faq-list">
          <For each={items()}>
            {(item) => (
              <li
                class="uis-faq-row"
                classList={{ "is-open": openId() === item.id }}
              >
                <button
                  type="button"
                  class="uis-faq-q"
                  aria-expanded={openId() === item.id}
                  onClick={() => toggle(item.id)}
                >
                  {item.question}
                </button>
                <div class="uis-faq-body" aria-hidden={openId() !== item.id}>
                  <div class="uis-faq-body-inner">
                    <p
                      class="uis-faq-a"
                      classList={{
                        "is-pending": pendingId() === item.id && !item.answer,
                      }}
                    >
                      {item.answer || (pendingId() === item.id ? "…" : "")}
                    </p>
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
        <form class="uis-faq-ask" onSubmit={submit}>
          <input
            ref={input}
            class="uis-faq-ask-input"
            type="text"
            name="ask"
            autocomplete="off"
            maxlength={240}
            placeholder={error() ?? "Ask"}
            aria-invalid={error() ? true : undefined}
            disabled={pendingId() !== null}
          />
          <button type="submit" class="sr-only">
            Ask
          </button>
        </form>
      </div>
    </MockFrame>
  );
}
