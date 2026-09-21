export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

export const SEED_FAQS: FaqItem[] = [
  {
    id: "seed-what",
    question: "What is a FAQ for?",
    answer:
      "A FAQ is for getting an answer and getting out. The list is the product, not a conversation. You scan, you open one, you leave.",
  },
  {
    id: "seed-last",
    question: "Why is the last row empty?",
    answer:
      "That’s the ask. If we already have the answer, we open that row. If we don’t, we write one and it joins the list. The empty row comes back.",
  },
  {
    id: "seed-keep",
    question: "Does this remember later?",
    answer:
      "In this browser, yes. What you ask stays on the list after a reload. Another machine, or a cleared store, starts over.",
  },
];

const FAQ_STORAGE_KEY = "aiuis:faqs";
const FAQ_MEMORY_LIMIT = 32;

function normQuestion(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function loadRememberedFaqs(): FaqItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(FAQ_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seedQuestions = new Set(SEED_FAQS.map((item) => normQuestion(item.question)));
    const out: FaqItem[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      const question =
        typeof rec.question === "string" ? rec.question.replace(/\s+/g, " ").trim() : "";
      const answer = typeof rec.answer === "string" ? rec.answer.trim() : "";
      if (!id || !question || !answer) continue;
      if (SEED_FAQS.some((item) => item.id === id)) continue;
      if (seedQuestions.has(normQuestion(question))) continue;
      if (out.some((item) => item.id === id || normQuestion(item.question) === normQuestion(question))) {
        continue;
      }
      out.push({ id, question, answer });
    }
    return out.slice(-FAQ_MEMORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveRememberedFaqs(items: FaqItem[]) {
  if (typeof localStorage === "undefined") return;
  const seedIds = new Set(SEED_FAQS.map((item) => item.id));
  const extras = items
    .filter(
      (item) =>
        !seedIds.has(item.id) && item.question.trim() && item.answer.trim(),
    )
    .slice(-FAQ_MEMORY_LIMIT);
  localStorage.setItem(FAQ_STORAGE_KEY, JSON.stringify(extras));
}

export type AskFaqResult =
  | { kind: "match"; id: string }
  | { kind: "new"; question: string; answer: string }
  | { kind: "error"; message: string };

const MODEL = "@cf/meta/llama-3.2-3b-instruct";

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    if (typeof rec.response === "string") return rec.response;
    const choices = rec.choices;
    if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
      const message = (choices[0] as { message?: { content?: unknown } }).message;
      if (typeof message?.content === "string") return message.content;
    }
  }
  return "";
}

export async function askFaq(input: {
  question: string;
  existing: Pick<FaqItem, "id" | "question">[];
}): Promise<AskFaqResult> {
  "use server";

  const question = input.question.replace(/\s+/g, " ").trim();
  if (!question) return { kind: "error", message: "Ask something." };
  if (question.length > 240) return { kind: "error", message: "Shorter, please." };

  const { getAi } = await import("~/lib/cf-ai");
  const ai = await getAi();
  if (!ai) {
    return {
      kind: "error",
      message: "No model on this server yet.",
    };
  }

  const catalog = input.existing
    .slice(0, 16)
    .map((item) => `- ${item.id}: ${item.question}`)
    .join("\n");

  try {
    const raw = await ai.run(MODEL, {
      max_tokens: 280,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You write FAQ entries for aiuis, a research site about interfaces for systems that think back. Be brief. No greeting, no chatbot voice. Reply with JSON only.",
        },
        {
          role: "user",
          content: `Existing FAQs:\n${catalog || "(none)"}\n\nUser ask: ${question}\n\nIf an existing FAQ already answers this, return {"matchId":"<id>"}. Otherwise return {"matchId":null,"question":"<concise FAQ title>","answer":"<2 to 4 short sentences>"}.`,
        },
      ],
    });

    const parsed = extractJsonObject(runText(raw));
    const matchId = parsed && typeof parsed.matchId === "string" ? parsed.matchId : null;
    if (matchId && input.existing.some((item) => item.id === matchId)) {
      return { kind: "match", id: matchId };
    }

    const nextQuestion =
      parsed && typeof parsed.question === "string" && parsed.question.trim()
        ? parsed.question.trim()
        : question;
    const nextAnswer =
      parsed && typeof parsed.answer === "string" && parsed.answer.trim()
        ? parsed.answer.trim()
        : runText(raw).trim();

    if (!nextAnswer) {
      return { kind: "error", message: "No answer came back." };
    }

    return { kind: "new", question: nextQuestion, answer: nextAnswer };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ask failed.";
    return { kind: "error", message };
  }
}
