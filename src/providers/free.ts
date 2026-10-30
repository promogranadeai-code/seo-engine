import fs from "node:fs";
import path from "node:path";
import type { Competitor, DomainOverview, KeywordMetrics, Market, RankedKeyword, ReferringDomain, Serp, SeoDataProvider } from "./types.js";

/**
 * Free keyword research, no paid API:
 *  - Ideas and questions from Google Autocomplete (the suggestions people see as they type). Google orders
 *    them by popularity, so a suggestion's position becomes a 0–100 `demand` score when no volume is known.
 *  - Volumes, competition and bids from a Google Keyword Planner CSV export (free with a Google Ads account):
 *    run once without it, upload planner-upload.txt to "Get search volume and forecasts", download the CSV,
 *    then run again with --planner <csv>.
 * No SERP, backlink or competitor data: those need a paid provider (DataForSEO).
 */

const MODIFIERS = ["", "best", "cost", "price", "agency", "company", "services", "for small business", "near me", "vs", "how to", "what is"];
const QUESTION_PREFIXES = ["how", "what", "why", "which", "can", "is", "should", "does"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

type PlannerRow = { volume: number | null; competition: number | null; cpc: number | null };

export class FreeProvider implements SeoDataProvider {
  readonly name: string;
  private planner = new Map<string, PlannerRow>();
  private gl: string;

  constructor(
    marketCode: string,
    opts: { plannerCsv?: string; fetchFn?: typeof fetch; delayMs?: number; letters?: boolean; cacheFile?: string } = {},
  ) {
    this.cacheFile = opts.cacheFile;
    if (this.cacheFile && fs.existsSync(this.cacheFile)) this.cache = JSON.parse(fs.readFileSync(this.cacheFile, "utf8")) as Record<string, string[]>;
    this.gl = marketCode.toLowerCase() === "uk" ? "gb" : marketCode.toLowerCase();
    if (opts.plannerCsv) this.planner = parsePlannerCsv(fs.readFileSync(path.resolve(opts.plannerCsv)));
    this.fetchFn = opts.fetchFn ?? fetch;
    this.delayMs = opts.delayMs ?? 150;
    this.letters = opts.letters ?? true;
    this.name = this.planner.size ? `free (Google Autocomplete + Keyword Planner, ${this.planner.size} volumes)` : "free (Google Autocomplete; no volumes yet)";
  }
  /** query → suggestions, saved as we go so a re-run (or another machine) does not ask Google again. */
  private cache: Record<string, string[]> = {};
  private cacheFile?: string;
  private fetchFn: typeof fetch;
  private delayMs: number;
  private letters: boolean;

  spentUsd() {
    return 0;
  }

  /** Google Autocomplete for one query, in this market. */
  async suggest(q: string, m: Market): Promise<string[]> {
    const key = `${this.gl}|${q}`;
    if (this.cache[key]) return this.cache[key]!;
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${m.languageCode}&gl=${this.gl}&q=${encodeURIComponent(q)}`;
    const res = await this.fetchFn(url, { headers: { "user-agent": "Mozilla/5.0 (seo-engine keyword research)" } });
    if (!res.ok) throw new Error(`Autocomplete ${res.status} for "${q}"`);
    const body = (await res.json()) as [string, string[]];
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const list = (body[1] ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
    this.cache[key] = list;
    if (this.cacheFile) fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache));
    return list;
  }

  async keywordIdeas(seeds: string[], m: Market, limit: number): Promise<KeywordMetrics[]> {
    // demand: best (lowest) suggestion position seen, and how many expansions surfaced the phrase.
    const seen = new Map<string, { best: number; hits: number }>();
    const add = (list: string[]) =>
      list.forEach((s, i) => {
        const cur = seen.get(s);
        seen.set(s, { best: Math.min(cur?.best ?? 99, i), hits: (cur?.hits ?? 0) + 1 });
      });
    for (const seed of seeds) {
      const queries = [
        ...MODIFIERS.map((mod) => (mod === "how to" || mod === "what is" || mod === "best" ? `${mod} ${seed}` : `${seed} ${mod}`).trim()),
        ...QUESTION_PREFIXES.map((q) => `${q} ${seed}`),
        ...(this.letters ? LETTERS.map((l) => `${seed} ${l}`) : []),
      ];
      for (const q of queries) {
        try {
          add(await this.suggest(q, m));
        } catch {
          // One failed expansion is not fatal; carry on with the rest.
        }
      }
    }
    const out = [...seen.entries()]
      .map(([keyword, s]) => this.metricsFor(keyword, Math.round(Math.min(100, (10 - Math.min(s.best, 9)) * 7 + Math.min(s.hits, 6) * 5))))
      .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || (b.demand ?? 0) - (a.demand ?? 0));
    return out.slice(0, limit);
  }

  async keywordMetrics(keywords: string[]): Promise<KeywordMetrics[]> {
    return keywords.filter((k) => this.planner.has(k.toLowerCase())).map((k) => this.metricsFor(k, null));
  }

  private metricsFor(keyword: string, demand: number | null): KeywordMetrics {
    const p = this.planner.get(keyword.toLowerCase());
    return { keyword, volume: p?.volume ?? null, cpc: p?.cpc ?? null, competition: p?.competition ?? null, providerKd: null, intent: null, trend: [], demand };
  }

  async serp(keyword: string): Promise<Serp> {
    return { keyword, organic: [], peopleAlsoAsk: [], relatedSearches: [], features: [] };
  }
  async domainOverview(domain: string): Promise<DomainOverview> {
    return { domain, authority: null, referringDomains: null, backlinks: null, organicKeywords: null, organicTraffic: null };
  }
  async rankedKeywords(): Promise<RankedKeyword[]> {
    return [];
  }
  async competitors(): Promise<Competitor[]> {
    return [];
  }
  async referringDomainCounts(): Promise<Record<string, number>> {
    return {};
  }
  async referringDomains(): Promise<ReferringDomain[]> {
    return [];
  }
}

/** "1K – 10K" → 3162 (geometric middle), "1,300" → 1300, "" → null. */
export function plannerVolume(raw: string): number | null {
  const nums = raw
    .replace(/,/g, "")
    .split(/[–-]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^([\d.]+)\s*([KM]?)$/);
      if (!m) return NaN;
      return Number(m[1]) * (m[2] === "K" ? 1e3 : m[2] === "M" ? 1e6 : 1);
    })
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0]!;
  return Math.round(Math.sqrt(Math.max(nums[0]!, 1) * nums[1]!));
}

/** Keyword Planner CSV (UTF-16 tab-separated, or UTF-8 comma-separated), with a few title lines before the header. */
export function parsePlannerCsv(buf: Buffer): Map<string, PlannerRow> {
  const text = (buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString("utf16le") : buf.toString("utf8")).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  const headerAt = lines.findIndex((l) => /keyword/i.test(l) && /avg\.? monthly searches/i.test(l));
  if (headerAt < 0) throw new Error("Not a Keyword Planner export: no 'Keyword' / 'Avg. monthly searches' header found.");
  const sep = lines[headerAt]!.includes("\t") ? "\t" : ",";
  const split = (l: string) => (sep === "\t" ? l.split("\t") : (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "")));
  const unquote = (c: string) => c.trim().replace(/^"|"$/g, "").replace(/""/g, '"');
  const head = split(lines[headerAt]!).map((h) => unquote(h).toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iKw = col(/^keyword$/);
  const iVol = col(/avg\.? monthly searches/);
  const iComp = col(/competition \(indexed value\)/);
  const iLow = col(/top of page bid \(low/);
  const iHigh = col(/top of page bid \(high/);
  const out = new Map<string, PlannerRow>();
  for (const line of lines.slice(headerAt + 1)) {
    const cells = split(line).map(unquote);
    const kw = cells[iKw]?.toLowerCase().trim();
    if (!kw) continue;
    const num = (i: number) => (i >= 0 && cells[i] ? Number(cells[i]!.replace(/[^\d.]/g, "")) || null : null);
    const low = num(iLow);
    const high = num(iHigh);
    out.set(kw, {
      volume: plannerVolume(cells[iVol] ?? ""),
      competition: iComp >= 0 && num(iComp) !== null ? num(iComp)! / 100 : null,
      cpc: low !== null && high !== null ? (low + high) / 2 : (high ?? low),
    });
  }
  return out;
}
