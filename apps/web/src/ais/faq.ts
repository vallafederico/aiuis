"use server";
import { openai } from "./";

// https://platform.openai.com/docs/api-reference/run-steps/step-object

export async function queryFaqAi(
  question: string = "How does AI work? Explain it in simple terms.",
) {
  let assistant = await openai.beta.assistants.create({
    instructions:
      "You are an FAQ component on a website. Please answer the following questions about how you work as an experimental website component, why you exist, and how you are used.",
    name: "Faq",
    model: "gpt-3.5-turbo",
  });

  const thread = await openai.beta.threads.create();

  const message = await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: question,
  });

  let run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: assistant.id,
    instructions:
      "Please address the user as Jane Doe. The user has a premium account.",
  });

  console.log("run: ", run);

  if (run.status === "completed") {
    const messages = await openai.beta.threads.messages.list(run.thread_id);
    for (const message of messages.data.reverse()) {
      console.log(`${message.role} > ${message.content[0].text.value}`);
    }

    return messages.data.reverse()[0];
  } else {
    console.log(run.status);
  }
}
