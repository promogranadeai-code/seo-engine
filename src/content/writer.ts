import fs from "node:fs";
import path from "node:path";
import type { Llm } from "../llm/claude.js";
import { projectDir, type Project } from "../store.js";
import { checkAeo, type AeoResult } from "./aeo.js";
import { lintText, STOCK_PHRASES, type LintResult } from "./lint.js";

export interface WriteInput {
  project: Project;
  topic: string;
  primaryKeyword: string;
  questions: string[];
  /** Filled-in expert interview (markdown). */
  interview: string;
  /** Extra first-party notes: case studies, process docs, pricing, voice guide. */
  knowledge: string;
  wordTarget?: number;
}

export interface WriteResult {
  markdown: string;
  lint: LintResult;
  aeo: AeoResult;
  revisions: number;
}

/** Load data/projects/<slug>/knowledge/*.md — the team's own facts the writer may use. */
export function loadKnowledge(slug: string): string {
  const dir = path.join(projectDir(slug), "knowledge");
  if (!fs.existsSync(dir)) return "";
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(md|txt)$/.test(f))
    .map((f) => `### ${f}\n${fs.readFileSync(path.join(dir, f), "utf8")}`)
    .join("\n\n");
}

export function writerSystemPrompt(project: Project): string {
  const name = project.business?.name ?? project.domain;
  return `You write articles for ${name}'s website, in the voice of the people who do the work there.

Where facts come from
- Every claim about ${name}, its clients, results, prices, timelines, process or opinions must come from the INTERVIEW or KNOWLEDGE provided. Do not invent clients, numbers, quotes, studies or outcomes.
- Basic, widely known definitions are fine. Do not summarise other websites or pad with general advice anyone could write.
- Where a specific fact would make the point stronger but isn't in the notes, write [NEEDS DATA: what is missing] instead of guessing.

How it should read
- Like an experienced practitioner explaining things to a smart client over coffee: direct, specific, a bit opinionated, using "we" and real examples from the notes.
- Vary rhythm: some very short sentences, some longer ones. Paragraphs of different lengths. Plain words.
- Avoid stock phrasing. Never use: ${STOCK_PHRASES.slice(0, 60).join(", ")}.
- Use em dashes sparingly (at most one or two in the whole piece). No "not just X, but Y" set-ups, no "In conclusion", no rhetorical "Ever wondered" openers.
- Keep formatting purposeful: headings for the questions, a short list or table only where it genuinely helps.

Structure (answer engines and AI assistants lift from this)
- Frontmatter: title (≤ 60 chars, keyword near the start), description (140–160 chars), slug, primaryKeyword.
- One H1 containing the primary keyword naturally.
- Opening: 2–3 sentences that answer the main question directly.
- Each reader question becomes an H2 phrased as the question. The first paragraph under it is a direct 30–60 word answer; then go deeper with examples, numbers and caveats from the notes.
- Include at least one short attributed quote from the interviewee, if the interview has quotable lines.
- End with a brief, specific next step (not a generic call to action).

Output only the markdown article.`;
}

function userPrompt(i: WriteInput): string {
  return `PRIMARY KEYWORD: ${i.primaryKeyword}
TOPIC: ${i.topic}
TARGET LENGTH: about ${i.wordTarget ?? 1400} words (quality over length)

READER QUESTIONS TO ANSWER:
${i.questions.map((q) => `- ${q}`).join("\n")}

INTERVIEW (primary source):
${i.interview}

KNOWLEDGE (first-party notes):
${i.knowledge || "(none provided)"}`;
}

export async function writeArticle(llm: Llm, input: WriteInput, opts: { maxRevisions?: number; minScore?: number } = {}): Promise<WriteResult> {
  const system = writerSystemPrompt(input.project);
  let markdown = await llm.text(system, userPrompt(input), { effort: "high" });
  let lint = lintText(markdown);
  let aeo = checkAeo(markdown);
  let revisions = 0;
  const minScore = opts.minScore ?? 85;
  while (revisions < (opts.maxRevisions ?? 2) && (lint.score < minScore || aeo.aeoScore < 70)) {
    const problems = [
      ...lint.findings.filter((f) => f.rule !== "needs-data").map((f) => `- ${f.message}${f.examples.length ? ` (${f.examples.join("; ")})` : ""}`),
      ...aeo.advice.map((a) => `- ${a}`),
    ];
    if (!problems.length) break;
    markdown = await llm.text(
      system,
      `Revise this article. Fix these problems without adding any facts that aren't in the interview/knowledge, and keep every [NEEDS DATA] marker that is still unresolved:\n${problems.join("\n")}\n\n${userPrompt(input)}\n\nCURRENT DRAFT:\n${markdown}`,
      { effort: "high" },
    );
    lint = lintText(markdown);
    aeo = checkAeo(markdown);
    revisions++;
  }
  return { markdown, lint, aeo, revisions };
}
