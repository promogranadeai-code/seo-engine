/**
 * Scoring formulas re-created from Ahrefs/Semrush *published* methodology.
 * Every constant here is sourced in docs/METHODOLOGY.md — change them there too.
 */
import { clamp, mean, median, round } from "../util/text.js";
import type { Intent } from "../providers/types.js";

/** Ahrefs KD → referring domains (RDs) typically needed for a top-10 page (ahrefs.com/keyword-difficulty). */
export const KD_TO_RD: [kd: number, rd: number][] = [
  [0, 0], [10, 10], [20, 22], [30, 36], [40, 56], [50, 84], [60, 129], [70, 202], [80, 353], [90, 756], [100, 1600],
];

/** Interpolate RDs needed for a KD (log-linear between table points). */
export function rdForKd(kd: number): number {
  const k = clamp(kd, 0, 100);
  for (let i = 1; i < KD_TO_RD.length; i++) {
    const [k0, r0] = KD_TO_RD[i - 1]!;
    const [k1, r1] = KD_TO_RD[i]!;
    if (k <= k1) {
      const t = (k - k0) / (k1 - k0);
      if (r0 === 0) return r1 * t;
      return Math.exp(Math.log(r0) + t * (Math.log(r1) - Math.log(r0)));
    }
  }
  return KD_TO_RD.at(-1)![1];
}

/** Inverse of rdForKd: the Ahrefs-style KD for a given RD level. */
export function kdForRd(rd: number): number {
  const r = Math.max(0, rd);
  for (let i = 1; i < KD_TO_RD.length; i++) {
    const [k0, r0] = KD_TO_RD[i - 1]!;
    const [k1, r1] = KD_TO_RD[i]!;
    if (r <= r1) {
      if (r0 === 0) return k0 + (k1 - k0) * (r / r1);
      return k0 + (k1 - k0) * ((Math.log(r) - Math.log(r0)) / (Math.log(r1) - Math.log(r0)));
    }
  }
  return 100;
}

/**
 * Our KD: like Ahrefs, based only on referring domains of the top-10 organic pages.
 * "Weighted average with outliers removed": we drop the top and bottom value (if ≥ 6 results),
 * then weight higher positions more (position 1 counts most).
 */
export function keywordDifficulty(top10ReferringDomains: number[]): number | null {
  const rds = top10ReferringDomains.filter((x) => Number.isFinite(x)).slice(0, 10);
  if (rds.length < 3) return null;
  let indexed = rds.map((rd, i) => ({ rd, w: 1 / Math.sqrt(i + 1) }));
  if (indexed.length >= 6) {
    const sorted = [...indexed].sort((a, b) => a.rd - b.rd);
    const drop = new Set([sorted[0], sorted.at(-1)]);
    indexed = indexed.filter((x) => !drop.has(x));
  }
  const wsum = indexed.reduce((a, x) => a + x.w, 0);
  const wavg = indexed.reduce((a, x) => a + x.rd * x.w, 0) / wsum;
  return round(kdForRd(wavg));
}

/** Semrush KD% bands (semrush.com/kb/1158-what-is-kd). */
export function kdLabel(kd: number | null): string {
  if (kd === null) return "unknown";
  if (kd < 15) return "very easy";
  if (kd < 30) return "easy";
  if (kd < 50) return "possible";
  if (kd < 70) return "difficult";
  if (kd < 85) return "hard";
  return "very hard";
}

/**
 * Organic CTR by position — default curve from Sistrix 2020 (80M keywords) for 1–3 and 10,
 * interpolated for 4–9, AWR 2016 for 11–20. Override per site from Search Console data.
 */
export const DEFAULT_CTR: number[] = [
  0.285, 0.157, 0.11, 0.08, 0.06, 0.047, 0.038, 0.032, 0.028, 0.025,
  0.016, 0.014, 0.012, 0.01, 0.0084, 0.0075, 0.0066, 0.0057, 0.0049, 0.0041,
];

/** Ahrefs (Feb 2026): an AI Overview cut position-1 CTR by ~58%, pos 2 ~51%, pos 3 ~46%, pos 10 ~19%. */
const AIO_CTR_FACTOR = [0.42, 0.49, 0.54, 0.58, 0.62, 0.66, 0.7, 0.74, 0.78, 0.81];

export function ctrAt(position: number, opts: { aiOverview?: boolean; curve?: number[] } = {}): number {
  const curve = opts.curve ?? DEFAULT_CTR;
  const p = Math.round(position);
  if (p < 1 || p > curve.length) return 0;
  const base = curve[p - 1]!;
  return opts.aiOverview && p <= 10 ? base * AIO_CTR_FACTOR[p - 1]! : base;
}

/** Monthly clicks if we rank at `position`. Ahrefs' Traffic Potential uses the #1 page's total traffic; we approximate with volume × CTR. */
export function estimatedClicks(volume: number | null, position: number, aiOverview = false): number {
  if (!volume) return 0;
  return Math.round(volume * ctrAt(position, { aiOverview }));
}

/** Intent from the keyword text when the provider has none (Semrush-style I/N/C/T indicators). */
export function guessIntent(keyword: string, brandTerms: string[] = []): Intent {
  const k = keyword.toLowerCase();
  if (brandTerms.some((b) => b && k.includes(b.toLowerCase()))) return "navigational";
  if (/\b(buy|price|pricing|cost|quote|hire|near me|agency|company|companies|services?|order|book|discount|deal|cheap)\b/.test(k)) return "transactional";
  if (/\b(best|top|vs|versus|review|reviews|compare|comparison|alternative|alternatives)\b/.test(k)) return "commercial";
  return "informational";
}

/** How much a visitor from this intent is worth to a services business (0–1). */
export const INTENT_VALUE: Record<Intent, number> = {
  transactional: 1,
  commercial: 0.85,
  informational: 0.45,
  navigational: 0.25,
};

export interface RankabilityInput {
  kd: number | null;
  /** Median referring domains of the top-10 pages. */
  serpMedianRd: number | null;
  /** Median authority (0–100) of the top-10 domains, if known. */
  serpMedianAuthority: number | null;
  ourAuthority: number | null;
  ourReferringDomains: number | null;
  /** 0–1 topical relevance of the keyword to the site. */
  relevance: number;
  /** Our current position for the keyword, if we already rank (1–100). */
  currentPosition: number | null;
}

/**
 * Rankability 0–100 — our "Personal Keyword Difficulty" (Semrush PKD idea):
 * how realistic top-10 is *for this site*, from authority gap, link gap, topical
 * relevance and existing rankings. Higher = easier for us.
 */
export function rankability(i: RankabilityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const kd = i.kd ?? 50;
  let score = 100 - kd;
  if (i.kd === null) reasons.push("difficulty unknown — assumed medium");

  if (i.ourAuthority !== null && i.serpMedianAuthority !== null) {
    const gap = i.ourAuthority - i.serpMedianAuthority;
    score += clamp(gap * 0.6, -30, 15);
    reasons.push(gap >= 0 ? `site authority ${i.ourAuthority} ≥ page-1 median ${i.serpMedianAuthority}` : `site authority ${i.ourAuthority} vs page-1 median ${i.serpMedianAuthority}`);
  }
  // Link gap: our referring domains vs what page 1 has (measured, or implied by KD via the Ahrefs table).
  if (i.ourReferringDomains !== null) {
    const need = i.serpMedianRd ?? rdForKd(kd);
    const ratio = (i.ourReferringDomains + 1) / (need + 1);
    score += clamp(Math.log2(ratio) * 8, -30, 10);
    if (ratio < 0.5) reasons.push(`page 1 has ~${Math.round(need)} referring domains; the whole site has ${i.ourReferringDomains}`);
  }
  score += (i.relevance - 0.6) * 25;
  if (i.relevance < 0.25) reasons.push("weak topical fit with the site");
  if (i.currentPosition !== null) {
    if (i.currentPosition <= 10) {
      score += 25;
      reasons.push(`already on page 1 (#${i.currentPosition})`);
    } else if (i.currentPosition <= 20) {
      score += 15;
      reasons.push(`already on page 2 (#${i.currentPosition})`);
    } else if (i.currentPosition <= 50) {
      score += 6;
      reasons.push(`ranking #${i.currentPosition}`);
    }
  }
  return { score: round(clamp(score, 0, 100)), reasons };
}

/** Opportunity = expected clicks at a realistic position × business value × chance of getting there. */
export function opportunity(o: { volume: number | null; cpc: number | null; intent: Intent; rankability: number; aiOverview: boolean }): number {
  const targetPos = o.rankability >= 70 ? 3 : o.rankability >= 45 ? 6 : 10;
  const clicks = estimatedClicks(o.volume, targetPos, o.aiOverview);
  const cpcFactor = 1 + Math.log1p(o.cpc ?? 0) / 2;
  return round(clicks * INTENT_VALUE[o.intent] * cpcFactor * (o.rankability / 100), 1);
}

export const summarizeRds = (rds: number[]) => ({ median: median(rds), mean: round(mean(rds)) });
