import fs from "node:fs";
import path from "node:path";
import type { Competitor, DomainOverview, KeywordMetrics, RankedKeyword, ReferringDomain, Serp, SeoDataProvider } from "./types.js";

/**
 * Offline provider backed by a JSON file. Used by tests and `--demo` runs.
 * Output produced with it is labelled DEMO DATA everywhere — never present it as real.
 */
export interface FixtureData {
  keywords: KeywordMetrics[];
  serps: Record<string, Serp>;
  domains: Record<string, DomainOverview>;
  ranked: Record<string, RankedKeyword[]>;
  competitors: Record<string, Competitor[]>;
  referringDomainCounts: Record<string, number>;
  referringDomains: Record<string, ReferringDomain[]>;
}

export class FixtureProvider implements SeoDataProvider {
  readonly name = "fixture (DEMO DATA)";
  constructor(private data: FixtureData) {}

  static fromFile(file: string): FixtureProvider {
    return new FixtureProvider(JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as FixtureData);
  }

  spentUsd() {
    return 0;
  }
  async keywordIdeas(_seeds: string[], _m: unknown, limit: number) {
    return this.data.keywords.slice(0, limit);
  }
  async keywordMetrics(keywords: string[]) {
    const set = new Set(keywords.map((k) => k.toLowerCase()));
    return this.data.keywords.filter((k) => set.has(k.keyword.toLowerCase()));
  }
  async serp(keyword: string): Promise<Serp> {
    return this.data.serps[keyword] ?? { keyword, organic: [], peopleAlsoAsk: [], relatedSearches: [], features: [] };
  }
  async domainOverview(domain: string): Promise<DomainOverview> {
    return this.data.domains[domain] ?? { domain, authority: null, referringDomains: null, backlinks: null, organicKeywords: null, organicTraffic: null };
  }
  async rankedKeywords(domain: string) {
    return this.data.ranked[domain] ?? [];
  }
  async competitors(domain: string, _m: unknown, limit: number) {
    return (this.data.competitors[domain] ?? []).slice(0, limit);
  }
  async referringDomainCounts(targets: string[]) {
    return Object.fromEntries(targets.map((t) => [t, this.data.referringDomainCounts[t] ?? 0]));
  }
  async referringDomains(target: string, limit: number) {
    return (this.data.referringDomains[target] ?? []).slice(0, limit);
  }
}
