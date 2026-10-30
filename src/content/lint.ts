import { mean, round, sentences, stddev, wordCount } from "../util/text.js";

/**
 * Voice & quality linter. Flags the patterns that make copy read as generic,
 * machine-made filler: stock phrases, monotonous rhythm, uniform paragraphs,
 * vague claims and unresolved placeholders. Goal: writing that sounds like a
 * specific person who has done the work — which is also what Google's
 * people-first guidance and E-E-A-T reward.
 */

export interface LintFinding {
  rule: string;
  severity: "high" | "medium" | "low";
  message: string;
  examples: string[];
}

export interface LintResult {
  score: number;
  words: number;
  stats: {
    sentenceLengthCv: number;
    paragraphLengthCv: number;
    emDashesPer100Words: number;
    specificsPer100Words: number;
    firstHandMarkers: number;
    fleschReadingEase: number;
  };
  findings: LintFinding[];
}

/** Stock phrases that mark text as generic. Matched case-insensitively on word boundaries. */
export const STOCK_PHRASES = [
  "delve", "delves", "delving", "in today's fast-paced", "in today's digital", "in today's world", "ever-evolving", "ever-changing",
  "navigate the complexities", "navigating the complexities", "tapestry", "a testament to", "it's important to note", "it is important to note",
  "it's worth noting", "it is worth noting", "in conclusion", "in summary", "unlock the power", "unlock the potential", "harness the power",
  "elevate your", "game-changer", "game changer", "seamless", "seamlessly", "cutting-edge", "realm", "embark", "furthermore", "moreover",
  "crucial", "pivotal", "paramount", "vibrant", "meticulous", "meticulously", "look no further", "whether you're a", "let's dive in",
  "dive into", "deep dive", "at the end of the day", "a myriad of", "plethora", "foster", "holistic", "synergy", "revolutionize",
  "revolutionise", "transformative", "empower", "streamline", "boasts", "nestled", "underscores", "showcasing", "intricate", "stands as",
  "robust", "leverage", "leveraging", "landscape", "in the world of", "when it comes to", "the power of", "not only", "rest assured",
  "ultimately", "comprehensive guide", "everything you need to know", "unleash", "supercharge", "next level", "take it to the next level",
];

const FIRST_HAND = /\b(we|we've|we're|our team|our clients?|i|i've|i'm|in our experience|last (?:month|year|quarter)|one client|a client|we found|we saw|we tested|we built|we shipped)\b/gi;
const SPECIFIC = /(\b\d[\d,.]*\s?(%|percent|x|k|m|days?|weeks?|months?|hours?|ms|seconds?|clients?|pages?|leads?|\$|usd|inr|aed|€|£)?)|(\$\s?\d)/gi;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function fleschReadingEase(text: string): number {
  const sents = sentences(text);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!sents.length || !words.length) return 0;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return round(206.835 - 1.015 * (words.length / sents.length) - 84.6 * (syl / words.length));
}

/** Strip markdown so stats measure prose, not syntax. */
function prose(md: string): { text: string; paragraphs: string[] } {
  const body = md.replace(/^---[\s\S]*?---\s*/, "");
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^(#|```|\||!\[|<)/.test(p) && !/^[-*]\s/.test(p) && !/^\d+\.\s/.test(p))
    .map((p) => p.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`>]/g, "").replace(/\s+/g, " "));
  return { text: paragraphs.join(" "), paragraphs };
}

export function lintText(markdown: string): LintResult {
  const findings: LintFinding[] = [];
  const { text, paragraphs } = prose(markdown);
  const words = wordCount(text);
  const sents = sentences(text);

  // 1. Stock phrases
  const hits = new Map<string, number>();
  for (const p of STOCK_PHRASES) {
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const n = (text.match(re) ?? []).length;
    if (n) hits.set(p, n);
  }
  const stockCount = [...hits.values()].reduce((a, b) => a + b, 0);
  if (stockCount) {
    findings.push({
      rule: "stock-phrases",
      severity: stockCount >= 3 ? "high" : "medium",
      message: `${stockCount} stock phrase(s). Replace each with the plain, specific thing you mean.`,
      examples: [...hits.entries()].map(([p, n]) => `${p}${n > 1 ? ` ×${n}` : ""}`),
    });
  }

  // 2. Rhythm: humans mix very short and long sentences.
  const lens = sents.map((s) => wordCount(s));
  const cv = lens.length > 3 ? stddev(lens) / mean(lens) : 1;
  if (lens.length > 5 && cv < 0.4) {
    findings.push({ rule: "monotone-rhythm", severity: cv < 0.3 ? "high" : "medium", message: `Sentence lengths are too even (variation ${round(cv, 2)}; aim > 0.45). Mix in some 3–6 word sentences and the odd long one.`, examples: [] });
  }

  // 3. Paragraph uniformity
  const plens = paragraphs.map(wordCount).filter((n) => n > 0);
  const pcv = plens.length > 3 ? stddev(plens) / mean(plens) : 1;
  if (plens.length > 4 && pcv < 0.3) {
    findings.push({ rule: "uniform-paragraphs", severity: "low", message: `Paragraphs are all about the same size (variation ${round(pcv, 2)}). Real writing has one-line paragraphs and longer ones.`, examples: [] });
  }

  // 4. Em-dash overuse
  const dashes = (markdown.match(/—/g) ?? []).length;
  const dashRate = words ? (dashes / words) * 100 : 0;
  if (dashRate > 0.6) {
    findings.push({ rule: "em-dash-overuse", severity: dashRate > 1.2 ? "medium" : "low", message: `${dashes} em dashes (${round(dashRate, 2)} per 100 words). Use commas, full stops or brackets for most of them.`, examples: [] });
  }

  // 5. Repeated openers
  const openers = sents.map((s) => s.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") ?? "");
  let run = 1;
  const repeated = new Set<string>();
  for (let i = 1; i < openers.length; i++) {
    run = openers[i] && openers[i] === openers[i - 1] ? run + 1 : 1;
    if (run >= 3) repeated.add(openers[i]!);
  }
  if (repeated.size) findings.push({ rule: "repeated-openers", severity: "medium", message: "Three or more sentences in a row start with the same word.", examples: [...repeated] });

  // 6. Formulaic constructions
  const formulaic = [
    ...(text.match(/\bnot (?:just|only) [^.]{3,60}, but (?:also )?/gi) ?? []),
    ...(text.match(/\bit'?s not (?:about )?[^.]{3,40}[,;—] it'?s\b/gi) ?? []),
    ...(text.match(/\b(?:ever wondered|have you ever|imagine a world)\b/gi) ?? []),
  ];
  if (formulaic.length) findings.push({ rule: "formulaic-constructions", severity: "medium", message: "Formulaic set-ups (\"not just X, but Y\", \"it's not X, it's Y\", \"ever wondered\").", examples: formulaic.slice(0, 5) });

  const tricolons = (text.match(/\b\w+(?: \w+)?, \w+(?: \w+)?,? and \w+/g) ?? []).length;
  if (words > 300 && (tricolons / words) * 1000 > 6) {
    findings.push({ rule: "list-of-three", severity: "low", message: `${tricolons} "X, Y and Z" triplets. Break the habit: sometimes say two things, sometimes four.`, examples: [] });
  }

  // 7. Specificity and first-hand experience (E-E-A-T)
  const specifics = (text.match(SPECIFIC) ?? []).length;
  const specRate = words ? (specifics / words) * 100 : 0;
  const firstHand = (text.match(FIRST_HAND) ?? []).length;
  if (words > 300 && specRate < 0.8) findings.push({ rule: "vague", severity: "medium", message: `Few concrete numbers or details (${round(specRate, 2)} per 100 words). Add timelines, prices, results, tools, examples from your notes.`, examples: [] });
  if (words > 300 && firstHand < 3) findings.push({ rule: "no-first-hand", severity: "high", message: "Almost no first-hand experience (\"we built\", \"one client\", \"we found\"). This is what makes content original and trustworthy.", examples: [] });

  // 8. Placeholders the writer left for missing facts
  const todos = markdown.match(/\[NEEDS DATA[^\]]*\]/g) ?? [];
  if (todos.length) findings.push({ rule: "needs-data", severity: "high", message: `${todos.length} fact(s) missing — fill these from real data before publishing.`, examples: todos.slice(0, 8) });

  const fre = fleschReadingEase(text);
  if (words > 200 && fre < 40) findings.push({ rule: "hard-to-read", severity: "low", message: `Reading ease ${fre} (aim 50–70). Shorter sentences, plainer words.`, examples: [] });

  const penalty = { high: 15, medium: 8, low: 3 };
  let score = 100 - findings.reduce((a, f) => a + penalty[f.severity], 0) - Math.max(0, stockCount - 3) * 2;
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    words,
    stats: {
      sentenceLengthCv: round(cv, 2),
      paragraphLengthCv: round(pcv, 2),
      emDashesPer100Words: round(dashRate, 2),
      specificsPer100Words: round(specRate, 2),
      firstHandMarkers: firstHand,
      fleschReadingEase: fre,
    },
    findings,
  };
}
