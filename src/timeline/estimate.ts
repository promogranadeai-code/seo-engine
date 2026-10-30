import type { ScoredKeyword } from "../keywords/research.js";
import { rdForKd } from "../keywords/metrics.js";
import { clamp, round } from "../util/text.js";

/**
 * Time-to-rank model. Transparent heuristics anchored on published studies
 * (docs/METHODOLOGY.md §Timeline): Ahrefs 2017 (pages that reach the top 10 in
 * year one mostly take ~2–6 months; average top-10 page > 2 years old) and
 * Ahrefs 2025 (only 1.74% of new pages reach the top 10 within a year; 72.9% of
 * top-10 pages are > 3 years old). Estimates assume the plan is executed.
 */

export type LinkPace = "starter" | "growth" | "aggressive";
/** New referring domains per month the off-page plan delivers. */
export const LINK_PACE: Record<LinkPace, number> = { starter: 4, growth: 8, aggressive: 15 };

export interface TimelineInput {
  keyword: ScoredKeyword;
  ourAuthority: number | null;
  linksPerMonth: number;
  goal: "top10" | "top3";
  /** True if a new page must be written for this keyword. */
  needsNewPage: boolean;
}

export interface TimelineEstimate {
  keyword: string;
  goal: "top10" | "top3";
  months: { optimistic: number; expected: number; conservative: number };
  /** Rough probability of reaching the goal within 12 months if the plan is executed. */
  chanceIn12Months: number;
  confidence: "high" | "medium" | "low";
  linkGap: number;
  drivers: string[];
}

/** Baseline months for a page to mature to page 1, by difficulty band. */
function baselineMonths(kd: number): number {
  if (kd < 15) return 2;
  if (kd < 30) return 4;
  if (kd < 50) return 7;
  if (kd < 70) return 11;
  if (kd < 85) return 16;
  return 24;
}

export function estimateTimeline(i: TimelineInput): TimelineEstimate {
  const k = i.keyword;
  const kd = k.kd ?? 40;
  const drivers: string[] = [];
  // Backlinko × Ahrefs: #1 has ~3.8× the backlinks of #2–10 → top 3 needs roughly 2× the page-1 median.
  const rdTarget = (k.serpMedianRd ?? rdForKd(kd)) * (i.goal === "top3" ? 2 : 1);
  // A strong domain passes authority through internal links, so a new page needs fewer links of its own.
  const authorityCredit = i.ourAuthority !== null ? clamp(i.ourAuthority / 100, 0, 0.8) * 0.6 : 0.15;
  const linkGap = Math.max(0, Math.round(rdTarget * (1 - authorityCredit)));
  const linkMonths = i.linksPerMonth > 0 ? linkGap / i.linksPerMonth : 24;
  const contentMonths = i.needsNewPage ? 1 : k.currentPosition !== null ? 0.25 : 0.5;
  const base = baselineMonths(kd);

  let expected: number;
  const pos = k.currentPosition;
  if (pos !== null && pos <= 3) {
    expected = 0;
    drivers.push(`already #${pos}`);
  } else if (pos !== null && pos <= 10 && i.goal === "top10") {
    expected = 0;
    drivers.push(`already on page 1 (#${pos})`);
  } else if (pos !== null && pos <= 20) {
    expected = Math.max(1.5, base * 0.4, contentMonths + linkMonths * 0.5 + 0.75);
    drivers.push(`starts on ${pos <= 10 ? "page 1" : "page 2"} (#${pos}) — on-page work + a few links`);
  } else {
    expected = Math.max(base, contentMonths + linkMonths + 1.5);
    drivers.push(i.needsNewPage ? "needs a new page (≈1 month to write, publish and get indexed)" : "existing page needs reworking");
  }
  if (linkGap > 0 && expected > 0) drivers.push(`~${linkGap} referring domains to earn at ${i.linksPerMonth}/month ≈ ${round(linkMonths, 1)} months of link building`);
  drivers.push(`difficulty ${kd} (${k.kdLabel}) → typical maturation ${base} months`);
  if (k.aiOverview) drivers.push("Google shows an AI Overview — expect fewer clicks even at #1; aim to be cited in it too");

  const conservative = expected === 0 ? 0 : Math.max(expected * 1.7, expected + 2);
  const optimistic = expected * 0.6;
  const confidence: TimelineEstimate["confidence"] = k.kdSource === "serp-rd" && i.ourAuthority !== null ? "high" : k.kdSource === "none" ? "low" : "medium";
  const chance = expected === 0 ? 0.95 : clamp((k.rankability / 100) * Math.min(1, 12 / expected) * (confidence === "low" ? 0.8 : 1), 0.02, 0.9);

  return {
    keyword: k.keyword,
    goal: i.goal,
    months: { optimistic: round(optimistic, 1), expected: round(expected, 1), conservative: round(conservative, 1) },
    chanceIn12Months: round(chance, 2),
    confidence,
    linkGap: expected === 0 ? 0 : linkGap,
    drivers,
  };
}

export interface RoadmapMonth {
  month: number;
  focus: string[];
  expectedWins: string[];
}

/** Month-by-month roadmap for a set of estimates (what to do, what should start ranking). */
export function buildRoadmap(estimates: TimelineEstimate[], months = 12): RoadmapMonth[] {
  const out: RoadmapMonth[] = [];
  for (let m = 1; m <= months; m++) {
    const focus: string[] = [];
    if (m === 1) focus.push("Fix technical issues from `seo audit` (errors first)", "Rewrite titles/descriptions/H1s from `seo tags` for quick-win pages", "Publish /llms.txt, allow AI search crawlers");
    if (m <= 2) focus.push("Write the new pages for 'target-now' clusters (expert interview → draft → human edit)");
    if (m >= 2) focus.push("Link building at the planned pace (see `seo offpage`)", "Publish 2–4 question-led articles per month (AEO/GEO)");
    if (m % 3 === 0) focus.push("Quarterly: re-run `seo keywords` and `seo timeline`, prune or merge pages that aren't moving");
    const wins = estimates.filter((e) => e.months.expected > 0 && Math.ceil(e.months.expected) === m).map((e) => `${e.keyword} → ${e.goal === "top3" ? "top 3" : "page 1"} (expected)`);
    out.push({ month: m, focus, expectedWins: wins });
  }
  return out;
}
