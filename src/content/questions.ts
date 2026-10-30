import { z } from "zod";
import type { CrawlResult } from "../crawl/crawler.js";
import type { KeywordReport } from "../keywords/research.js";
import type { Llm } from "../llm/claude.js";
import type { Project } from "../store.js";
import { jaccard, stems } from "../util/text.js";

export interface MinedQuestion {
  question: string;
  sources: string[];
  /** Search volume when the question itself is a tracked keyword. */
  volume: number | null;
  relatedKeyword: string | null;
  /** Already answered by a heading on the site. */
  answeredOn: string | null;
  priority: number;
}

const QUESTION_RE = /^(how|what|why|when|which|who|where|can|does|do|is|are|should|will|much|cost)\b|\?$/i;

const toQuestion = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return (t[0]?.toUpperCase() ?? "") + t.slice(1) + (t.endsWith("?") ? "" : "?");
};

/**
 * Collect the questions real people ask: Google "People also ask", question-type
 * keywords, and (optionally) buyer questions Claude infers from the business profile.
 */
export async function mineQuestions(project: Project, keywords: KeywordReport | null, crawl: CrawlResult | null, llm: Llm | null): Promise<MinedQuestion[]> {
  const raw: { q: string; source: string; volume: number | null; kw: string | null }[] = [];
  for (const p of keywords?.questions ?? []) raw.push({ q: p.question, source: "people-also-ask", volume: null, kw: p.keyword });
  for (const k of keywords?.keywords ?? []) {
    if (k.bucket !== "off-topic" && QUESTION_RE.test(k.keyword)) raw.push({ q: k.keyword, source: "keyword", volume: k.volume, kw: k.keyword });
  }
  if (llm) {
    const schema = z.object({ questions: z.array(z.string()) });
    const res = await llm.json(
      "You are an experienced account manager. List the real questions prospective customers ask before hiring this business — about cost, time, process, risks, comparisons and results. Plain wording, as a customer would type or say it.",
      `Business: ${project.business?.name ?? project.domain}\nWhat they do: ${project.business?.summary ?? ""}\nServices: ${(project.business?.services ?? []).join(", ")}\nAudience: ${project.business?.audience ?? "unknown"}\nReturn 25 questions.`,
      schema,
    );
    for (const q of res.questions) raw.push({ q, source: "buyer-questions (Claude)", volume: null, kw: null });
  }

  const siteHeadings = (crawl?.pages ?? []).flatMap((p) => p.questionHeadings.map((h) => ({ h, url: p.finalUrl })));
  const out: MinedQuestion[] = [];
  for (const r of raw) {
    const q = toQuestion(r.q);
    const s = stems(q);
    const existing = out.find((o) => jaccard(stems(o.question), s) >= 0.6);
    if (existing) {
      if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
      existing.volume ??= r.volume;
      continue;
    }
    const answered = siteHeadings.find((x) => jaccard(stems(x.h), s) >= 0.5);
    out.push({ question: q, sources: [r.source], volume: r.volume, relatedKeyword: r.kw, answeredOn: answered?.url ?? null, priority: 0 });
  }
  for (const q of out) {
    q.priority = Math.round((q.volume ? Math.log10(q.volume + 1) * 20 : 10) + q.sources.length * 15 + (q.answeredOn ? -25 : 0) + (/cost|price|how long|vs|best|which/i.test(q.question) ? 10 : 0));
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** Group questions under topics so one article answers a family of questions. */
export function groupQuestions(questions: MinedQuestion[], minOverlap = 0.25): { topic: string; questions: MinedQuestion[] }[] {
  const groups: { topic: string; questions: MinedQuestion[] }[] = [];
  for (const q of questions) {
    const s = stems(q.question);
    const g = groups.find((g) => jaccard(stems(g.topic), s) >= minOverlap);
    if (g) g.questions.push(q);
    else groups.push({ topic: q.relatedKeyword ?? q.question.replace(/\?$/, ""), questions: [q] });
  }
  return groups;
}
