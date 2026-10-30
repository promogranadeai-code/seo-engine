import { z } from "zod";
import type { Llm } from "../llm/claude.js";
import type { Project } from "../store.js";

/**
 * Expert interview: the step that makes content original. Instead of
 * summarising the internet, we ask the people who do the work for specifics —
 * numbers, stories, opinions, mistakes — and write only from their answers.
 */

const TEMPLATE_QUESTIONS = (topic: string) => [
  `In one or two sentences, how would you explain "${topic}" to a client who has never heard of it?`,
  `Tell me about a real project where this mattered. What was the situation, what did you do, and what changed (numbers if you have them)?`,
  `What does it usually cost and how long does it take? Give honest ranges and what moves the number up or down.`,
  `What do most people get wrong about ${topic}? What's your contrarian opinion?`,
  `Walk me through your actual process, step by step, including the tools you use.`,
  `What's a mistake you made early on, and what do you do differently now?`,
  `When should someone NOT do this / not hire us for it?`,
  `If a friend asked you for one piece of advice on ${topic}, what would you say?`,
];

export async function buildInterview(project: Project, topic: string, questions: string[], llm: Llm | null): Promise<string> {
  let asks = TEMPLATE_QUESTIONS(topic);
  if (llm) {
    const res = await llm.json(
      "You prepare interview questions for a subject-matter expert so a writer can produce an original, first-hand article. Ask for specifics: real examples, numbers, timelines, prices, tools, opinions, mistakes. Never ask for things a web search could answer. Short, conversational questions.",
      `Business: ${project.business?.name ?? project.domain} — ${project.business?.summary ?? ""}\nArticle topic: ${topic}\nReader questions the article must answer:\n${questions.map((q) => `- ${q}`).join("\n")}\n\nWrite 8–10 interview questions.`,
      z.object({ questions: z.array(z.string()) }),
    );
    if (res.questions.length) asks = res.questions;
  }
  return [
    `# Expert interview: ${topic}`,
    "",
    "Answer in your own words — bullet points, rough notes or a voice-note transcript are all fine. Real numbers and stories matter more than polish. Leave blank anything you don't know; the writer will not invent it.",
    "",
    "Interviewee (name, role):",
    "",
    "Reader questions this article will answer:",
    ...questions.map((q) => `- ${q}`),
    "",
    ...asks.flatMap((q, i) => [`## Q${i + 1}. ${q}`, "", "Answer:", "", ""]),
  ].join("\n");
}

/** True if the interview file has real answers (not just the template). */
export function interviewHasAnswers(md: string): boolean {
  const answers = md.split(/^## Q\d+\./m).slice(1).map((block) => block.split("Answer:")[1]?.trim() ?? "");
  return answers.filter((a) => a.length > 20).length >= 3;
}
