import { round, wordCount } from "../util/text.js";

/**
 * AEO / GEO checks for a markdown article.
 * - AEO (answer engines, featured snippets, AI Overviews): question-led headings,
 *   each followed by a direct 25–70 word answer.
 * - GEO (getting cited by ChatGPT/Gemini/Perplexity): the GEO paper (Aggarwal et
 *   al., KDD 2024) found adding statistics, quotations and cited sources raised
 *   visibility in generative answers by up to ~40%; keyword stuffing did not help.
 */

export interface QaBlock {
  question: string;
  answerWords: number;
  directAnswer: boolean;
}

export interface AeoResult {
  aeoScore: number;
  geoScore: number;
  questions: QaBlock[];
  statistics: number;
  quotations: number;
  citations: number;
  definitions: number;
  advice: string[];
}

const FILLER_START = /^(great question|when it comes to|in today|there are many|it depends|well,|so,|this is a)/i;

export function checkAeo(markdown: string): AeoResult {
  const body = markdown.replace(/^---[\s\S]*?---\s*/, "");
  const lines = body.split("\n");
  const questions: QaBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^#{2,3}\s+(.+)$/);
    if (!m) continue;
    const heading = m[1]!.trim();
    if (!/\?$|^(how|what|why|when|which|who|can|does|do|is|are|should|will)\b/i.test(heading)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]!.trim()) j++;
    const para: string[] = [];
    while (j < lines.length && lines[j]!.trim() && !lines[j]!.startsWith("#")) para.push(lines[j++]!);
    const answer = para.join(" ").replace(/[*_`]/g, "");
    const n = wordCount(answer);
    questions.push({ question: heading, answerWords: n, directAnswer: n >= 25 && n <= 70 && !FILLER_START.test(answer.trim()) });
  }

  const statistics = (body.match(/\b\d[\d,.]*\s?(%|percent|x\b|times\b)|\$\s?\d[\d,.]*|\b\d+\s?(days|weeks|months|hours|clients|projects)\b/gi) ?? []).length;
  const quotations = (body.match(/^>\s.+/gm) ?? []).length + (body.match(/“[^”]{20,}”/g) ?? []).length;
  const citations = (body.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) ?? []).length;
  const definitions = (body.match(/^\*?\*?[A-Z][\w\s/-]{2,40}\*?\*? (is|are|means|refers to) /gm) ?? []).length;

  const direct = questions.filter((q) => q.directAnswer).length;
  const aeoScore = round(Math.min(100, (questions.length ? (direct / questions.length) * 70 : 0) + Math.min(30, questions.length * 6)));
  const geoScore = round(Math.min(100, Math.min(35, statistics * 7) + Math.min(25, quotations * 12) + Math.min(25, citations * 8) + Math.min(15, definitions * 8)));

  const advice: string[] = [];
  if (questions.length < 3) advice.push("Use 3+ question headings (the questions people actually ask — see `seo questions`).");
  for (const q of questions.filter((q) => !q.directAnswer)) advice.push(`"${q.question}": open with a direct ${q.answerWords < 25 ? "fuller" : "shorter"} answer (25–70 words), then expand.`);
  if (statistics < 3) advice.push("Add 3+ concrete numbers from your own work (timelines, costs, results). AI engines cite statistics.");
  if (quotations < 1) advice.push("Add a short quote from a named team member or client — quotations measurably raise AI citation.");
  if (citations < 1) advice.push("Link to 1–3 authoritative sources where you rely on outside facts.");
  if (definitions < 1) advice.push("Define the main term in one plain sentence (\"X is …\") — answer engines lift definitions verbatim.");
  return { aeoScore, geoScore, questions, statistics, quotations, citations, definitions, advice };
}
