import type { CrawlResult } from "../crawl/crawler.js";
import type { Project } from "../store.js";
import type { GscRow } from "../providers/gsc.js";
import type { Intent, KeywordMetrics, Market, SeoDataProvider } from "../providers/types.js";
import { jaccard, median, ngrams, round, stems, tokens } from "../util/text.js";
import { clusterKeywords } from "./cluster.js";
import { estimatedClicks, guessIntent, kdLabel, keywordDifficulty, opportunity, rankability } from "./metrics.js";

export type Bucket = "quick-win" | "target-now" | "build-up" | "long-term" | "off-topic";

export interface ScoredKeyword {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  intent: Intent;
  /** KD from our Ahrefs-style formula (top-10 RDs) when SERP data exists, else provider KD. */
  kd: number | null;
  kdSource: "serp-rd" | "provider" | "none";
  kdLabel: string;
  /** Median referring domains of the current top-10 — the link bar to clear. */
  serpMedianRd: number | null;
  relevance: number;
  rankability: number;
  rankabilityReasons: string[];
  opportunity: number;
  clicksAtTop3: number;
  currentPosition: number | null;
  rankingUrl: string | null;
  aiOverview: boolean;
  serpFeatures: string[];
  serpUrls: string[];
  bucket: Bucket;
  sources: string[];
}

export interface KeywordCluster {
  head: string;
  keywords: string[];
  totalVolume: number;
  bestBucket: Bucket;
  /** Existing page to optimise, or a suggested new URL. */
  targetPage: string;
  isNewPage: boolean;
  method: "serp-overlap" | "lexical";
}

export interface KeywordReport {
  generatedAt: string;
  provider: string;
  domain: string;
  market: string;
  ourAuthority: number | null;
  ourReferringDomains: number | null;
  seeds: string[];
  keywords: ScoredKeyword[];
  clusters: KeywordCluster[];
  /** "People also ask" questions seen on analysed SERPs — feeds AEO. */
  questions: { question: string; keyword: string }[];
  competitors: string[];
  spentUsd: number;
  notes: string[];
}

export interface ResearchOptions {
  market: Market;
  marketCode: string;
  seeds?: string[];
  /** How many top candidates get a live SERP analysis (costs money). */
  serpTop?: number;
  minVolume?: number;
  useCompetitors?: boolean;
  gscRows?: GscRow[];
  onStep?: (msg: string) => void;
}

/** Site vocabulary: headings and titles weigh more than body text. */
export function siteCorpus(project: Project, crawl: CrawlResult | null) {
  const strong: string[] = [...(project.business?.services ?? []), project.business?.summary ?? ""];
  const pages = (crawl?.pages ?? []).filter((p) => p.status === 200);
  for (const p of pages) strong.push(p.title ?? "", ...p.h1, ...p.h2);
  const strongStems = new Set(strong.flatMap(stems));
  const bodyStems = new Set(pages.flatMap((p) => stems(p.text.slice(0, 5000))));
  const serviceStems = new Set((project.business?.services ?? []).flatMap(stems));
  return { strong, strongStems, bodyStems, serviceStems, pages };
}

/** Seed topics: most frequent 2–3 word phrases from titles/headings + declared services. */
export function extractSeeds(project: Project, crawl: CrawlResult | null, max = 12): string[] {
  const { strong } = siteCorpus(project, crawl);
  const brand = tokens(project.business?.name ?? project.domain.split(".")[0] ?? "");
  const counts = new Map<string, number>();
  for (const s of strong) {
    for (const n of [2, 3]) {
      for (const g of ngrams(s, n)) {
        if (g.split(" ").some((t) => brand.includes(t) || /^\d+$/.test(t))) continue;
        counts.set(g, (counts.get(g) ?? 0) + (n === 3 ? 1.3 : 1));
      }
    }
  }
  const ranked = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  const out: string[] = [...(project.business?.services ?? []).map((s) => s.toLowerCase())];
  for (const g of ranked) {
    if (out.length >= max) break;
    if (!out.some((o) => jaccard(stems(o), stems(g)) >= 0.5)) out.push(g);
  }
  return out.slice(0, max);
}

export function relevanceOf(keyword: string, corpus: ReturnType<typeof siteCorpus>): number {
  const ks = stems(keyword);
  if (!ks.length) return 0;
  let score = 0;
  for (const s of ks) {
    if (corpus.strongStems.has(s)) score += 1;
    else if (corpus.bodyStems.has(s)) score += 0.5;
  }
  let r = score / ks.length;
  if (ks.some((s) => corpus.serviceStems.has(s))) r = Math.min(1, r + 0.15);
  return round(r, 2);
}

function bucketOf(k: Pick<ScoredKeyword, "relevance" | "rankability" | "currentPosition">): Bucket {
  if (k.relevance < 0.2) return "off-topic";
  if (k.currentPosition !== null && k.currentPosition >= 4 && k.currentPosition <= 20 && k.rankability >= 45) return "quick-win";
  if (k.rankability >= 60) return "target-now";
  if (k.rankability >= 40) return "build-up";
  return "long-term";
}

const BUCKET_ORDER: Bucket[] = ["quick-win", "target-now", "build-up", "long-term", "off-topic"];

function pageForCluster(head: string, corpus: ReturnType<typeof siteCorpus>): { url: string; isNew: boolean } {
  const hs = stems(head);
  let best = { url: "", score: 0 };
  for (const p of corpus.pages) {
    const pageStems = stems(`${p.title ?? ""} ${p.h1.join(" ")} ${new URL(p.finalUrl).pathname.replace(/[-/]/g, " ")}`);
    const s = jaccard(hs, pageStems) + (hs.every((x) => pageStems.includes(x)) ? 0.3 : 0);
    if (s > best.score) best = { url: p.finalUrl, score: s };
  }
  if (best.score >= 0.35) return { url: best.url, isNew: false };
  return { url: "/" + tokens(head).join("-"), isNew: true };
}

export async function researchKeywords(project: Project, crawl: CrawlResult | null, provider: SeoDataProvider, opts: ResearchOptions): Promise<KeywordReport> {
  const step = opts.onStep ?? (() => {});
  const notes: string[] = [];
  const m = opts.market;
  const corpus = siteCorpus(project, crawl);
  const seeds = opts.seeds?.length ? opts.seeds : extractSeeds(project, crawl);
  const brandTerms = [project.business?.name ?? "", project.domain.split(".")[0] ?? ""];

  type Cand = { metrics: KeywordMetrics | null; sources: Set<string>; pos: number | null; url: string | null };
  const cands = new Map<string, Cand>();
  const touch = (kw: string, source: string) => {
    const key = kw.toLowerCase().trim();
    if (!cands.has(key)) cands.set(key, { metrics: null, sources: new Set(), pos: null, url: null });
    const c = cands.get(key)!;
    c.sources.add(source);
    return c;
  };

  step(`Expanding ${seeds.length} seed topics`);
  for (const k of await provider.keywordIdeas(seeds, m, 700)) touch(k.keyword, "ideas").metrics = k;

  step("Reading keywords the site already ranks for");
  try {
    for (const r of await provider.rankedKeywords(project.domain, m, 500)) {
      const c = touch(r.keyword, "ranking");
      c.pos = c.pos === null ? r.position : Math.min(c.pos, r.position);
      c.url = r.url;
      c.metrics ??= { keyword: r.keyword, volume: r.volume, cpc: null, competition: null, providerKd: r.providerKd, intent: null, trend: [] };
    }
  } catch (e) {
    notes.push(`Ranked-keywords lookup failed: ${(e as Error).message}`);
  }

  for (const row of opts.gscRows ?? []) {
    const c = touch(row.query, "search-console");
    if (c.pos === null || row.position < c.pos) {
      c.pos = Math.round(row.position);
      c.url = row.page;
    }
  }

  let competitorDomains = project.competitors ?? [];
  if (opts.useCompetitors !== false) {
    try {
      if (!competitorDomains.length) {
        step("Finding organic competitors");
        competitorDomains = (await provider.competitors(project.domain, m, 3)).map((c) => c.domain);
      }
      for (const comp of competitorDomains.slice(0, 3)) {
        step(`Keyword gap vs ${comp}`);
        for (const r of await provider.rankedKeywords(comp, m, 300)) {
          if (r.position > 10) continue;
          const c = touch(r.keyword, `gap:${comp}`);
          c.metrics ??= { keyword: r.keyword, volume: r.volume, cpc: null, competition: null, providerKd: r.providerKd, intent: null, trend: [] };
        }
      }
    } catch (e) {
      notes.push(`Competitor gap skipped: ${(e as Error).message}`);
    }
  }

  const missing = [...cands.entries()].filter(([, c]) => !c.metrics || c.metrics.volume === null).map(([k]) => k);
  if (missing.length) {
    step(`Fetching metrics for ${missing.length} keywords`);
    try {
      for (const k of await provider.keywordMetrics(missing.slice(0, 1400), m)) {
        const c = cands.get(k.keyword.toLowerCase());
        if (c) c.metrics = { ...k, providerKd: k.providerKd ?? c.metrics?.providerKd ?? null };
      }
    } catch (e) {
      notes.push(`Metric fill failed: ${(e as Error).message}`);
    }
  }

  step("Checking site authority");
  let ourAuthority: number | null = null;
  let ourRd: number | null = null;
  try {
    const o = await provider.domainOverview(project.domain, m);
    ourAuthority = o.authority;
    ourRd = o.referringDomains;
  } catch (e) {
    notes.push(`Authority lookup failed: ${(e as Error).message}`);
  }

  const minVolume = opts.minVolume ?? 10;
  const pre = [...cands.entries()]
    .map(([kw, c]) => ({ kw, c, relevance: relevanceOf(kw, corpus) }))
    .filter(({ c }) => (c.metrics?.volume ?? 0) >= minVolume || c.pos !== null);

  // Provisional ranking (provider KD) decides which keywords get a paid SERP analysis.
  const provisional = pre
    .filter((x) => x.relevance >= 0.2)
    .map((x) => {
      const r = rankability({ kd: x.c.metrics?.providerKd ?? null, serpMedianRd: null, serpMedianAuthority: null, ourAuthority, ourReferringDomains: ourRd, relevance: x.relevance, currentPosition: x.c.pos }).score;
      const intent = x.c.metrics?.intent ?? guessIntent(x.kw, brandTerms);
      return { ...x, prov: opportunity({ volume: x.c.metrics?.volume ?? 0, cpc: x.c.metrics?.cpc ?? 0, intent, rankability: r, aiOverview: false }) };
    })
    .sort((a, b) => b.prov - a.prov);

  const serpTop = opts.serpTop ?? 25;
  const serpData = new Map<string, { rds: number[]; urls: string[]; features: string[]; paa: string[] }>();
  const toAnalyse = provisional.slice(0, serpTop);
  if (toAnalyse.length) step(`Analysing live Google results for ${toAnalyse.length} keywords`);
  const needRd: string[] = [];
  for (const x of toAnalyse) {
    try {
      const s = await provider.serp(x.kw, m, 10);
      const top = s.organic.slice(0, 10);
      serpData.set(x.kw, { rds: top.map((o) => o.referringDomains ?? NaN), urls: top.map((o) => o.url), features: s.features, paa: s.peopleAlsoAsk });
      for (const o of top) if (o.referringDomains === null) needRd.push(o.url);
    } catch (e) {
      notes.push(`SERP "${x.kw}" failed: ${(e as Error).message}`);
    }
  }
  if (needRd.length) {
    try {
      const counts = await provider.referringDomainCounts([...new Set(needRd)]);
      for (const d of serpData.values()) d.rds = d.rds.map((rd, i) => (Number.isNaN(rd) ? (counts[d.urls[i]!] ?? NaN) : rd));
    } catch (e) {
      notes.push(`Referring-domain lookup failed (falling back to provider KD): ${(e as Error).message}`);
    }
  }

  const keywords: ScoredKeyword[] = pre.map(({ kw, c, relevance }) => {
    const sd = serpData.get(kw);
    const rds = sd?.rds.filter((x) => Number.isFinite(x)) ?? [];
    const ourKd = rds.length >= 3 ? keywordDifficulty(rds) : null;
    const kd = ourKd ?? c.metrics?.providerKd ?? null;
    const aiOverview = !!sd?.features.some((f) => f.includes("ai_overview"));
    const intent = c.metrics?.intent ?? guessIntent(kw, brandTerms);
    const serpMedianRd = rds.length ? median(rds) : null;
    const r = rankability({ kd, serpMedianRd, serpMedianAuthority: null, ourAuthority, ourReferringDomains: ourRd, relevance, currentPosition: c.pos });
    const k: ScoredKeyword = {
      keyword: kw,
      volume: c.metrics?.volume ?? null,
      cpc: c.metrics?.cpc ?? null,
      intent,
      kd,
      kdSource: ourKd !== null ? "serp-rd" : kd !== null ? "provider" : "none",
      kdLabel: kdLabel(kd),
      serpMedianRd,
      relevance,
      rankability: r.score,
      rankabilityReasons: r.reasons,
      opportunity: opportunity({ volume: c.metrics?.volume ?? 0, cpc: c.metrics?.cpc ?? 0, intent, rankability: r.score, aiOverview }),
      clicksAtTop3: estimatedClicks(c.metrics?.volume ?? 0, 3, aiOverview),
      currentPosition: c.pos,
      rankingUrl: c.url,
      aiOverview,
      serpFeatures: sd?.features ?? [],
      serpUrls: sd?.urls ?? [],
      bucket: "long-term",
      sources: [...c.sources],
    };
    k.bucket = bucketOf(k);
    return k;
  });
  keywords.sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || b.opportunity - a.opportunity);

  const relevant = keywords.filter((k) => k.bucket !== "off-topic");
  const clusters: KeywordCluster[] = clusterKeywords(relevant).map((cl) => {
    const page = cl.head.rankingUrl && cl.head.currentPosition !== null && cl.head.currentPosition <= 30 ? { url: cl.head.rankingUrl, isNew: false } : pageForCluster(cl.head.keyword, corpus);
    const best = cl.members.map((k) => k.bucket).sort((a, b) => BUCKET_ORDER.indexOf(a) - BUCKET_ORDER.indexOf(b))[0]!;
    return { head: cl.head.keyword, keywords: cl.members.map((k) => k.keyword), totalVolume: cl.totalVolume, bestBucket: best, targetPage: page.url, isNewPage: page.isNew, method: cl.method };
  });

  const questions = [...serpData.entries()].flatMap(([keyword, d]) => d.paa.map((question) => ({ question, keyword })));

  return {
    generatedAt: new Date().toISOString(),
    provider: provider.name,
    domain: project.domain,
    market: opts.marketCode,
    ourAuthority,
    ourReferringDomains: ourRd,
    seeds,
    keywords,
    clusters,
    questions,
    competitors: competitorDomains,
    spentUsd: provider.spentUsd(),
    notes,
  };
}
