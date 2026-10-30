import { dataForSeoAuth } from "../config.js";
import type {
  Competitor,
  DomainOverview,
  Intent,
  KeywordMetrics,
  Market,
  RankedKeyword,
  ReferringDomain,
  Serp,
  SeoDataProvider,
} from "./types.js";

/**
 * DataForSEO v3 client. Endpoint paths and payload shapes follow OpenSEO's
 * production client (github.com/every-app/open-seo, MIT) — see docs/METHODOLOGY.md.
 */
const API = "https://api.dataforseo.com";

interface Task {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: Array<Record<string, unknown>> | null;
}

type Item = Record<string, any>;

/** Platforms that rank for everything — never useful as "competitors". */
const BIG_PLATFORMS = /(^|\.)(wikipedia\.org|youtube\.com|reddit\.com|quora\.com|linkedin\.com|facebook\.com|instagram\.com|amazon\.[a-z.]+|medium\.com|pinterest\.com|x\.com|twitter\.com|google\.com|forbes\.com)$/;

export class DataForSeoProvider implements SeoDataProvider {
  readonly name = "dataforseo";
  private spent = 0;
  constructor(private auth = dataForSeoAuth()) {
    if (!this.auth) throw new Error("DataForSEO credentials missing: set DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (or DATAFORSEO_API_KEY) in .env");
  }

  spentUsd() {
    return Math.round(this.spent * 10000) / 10000;
  }

  private async post(path: string, body: unknown[]): Promise<Task> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(API + path, {
        method: "POST",
        headers: { authorization: `Basic ${this.auth}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as { status_code?: number; status_message?: string; tasks?: Task[] };
      if (!res.ok || (json.status_code && json.status_code >= 40000)) {
        throw new Error(`DataForSEO ${path}: HTTP ${res.status} ${json.status_message ?? ""}`.trim());
      }
      const task = json.tasks?.[0];
      if (!task) throw new Error(`DataForSEO ${path}: empty response`);
      this.spent += task.cost ?? 0;
      // 40102 = "No Search Results" — a valid empty answer.
      if (task.status_code && task.status_code >= 40000 && task.status_code !== 40102) {
        throw new Error(`DataForSEO ${path}: ${task.status_code} ${task.status_message}`);
      }
      return task;
    }
  }

  private items(task: Task): Item[] {
    return ((task.result?.[0]?.items as Item[] | null) ?? []).filter(Boolean);
  }

  private static toMetrics(it: Item): KeywordMetrics {
    const info = it.keyword_info ?? {};
    const monthly: Item[] = Array.isArray(info.monthly_searches) ? info.monthly_searches : [];
    const intent = it.search_intent_info?.main_intent as Intent | undefined;
    return {
      keyword: String(it.keyword ?? ""),
      volume: info.search_volume ?? null,
      cpc: info.cpc ?? null,
      competition: info.competition ?? null,
      providerKd: it.keyword_properties?.keyword_difficulty ?? null,
      intent: intent ?? null,
      trend: monthly
        .slice()
        .sort((a, b) => a.year - b.year || a.month - b.month)
        .slice(-12)
        .map((m) => m.search_volume ?? 0),
    };
  }

  async keywordIdeas(seeds: string[], m: Market, limit: number): Promise<KeywordMetrics[]> {
    const task = await this.post("/v3/dataforseo_labs/google/keyword_ideas/live", [
      {
        keywords: seeds.slice(0, 200),
        location_code: m.locationCode,
        language_code: m.languageCode,
        limit,
        include_serp_info: false,
        include_clickstream_data: false,
        closely_variants: false,
      },
    ]);
    return this.items(task).map(DataForSeoProvider.toMetrics).filter((k) => k.keyword);
  }

  async keywordMetrics(keywords: string[], m: Market): Promise<KeywordMetrics[]> {
    const out: KeywordMetrics[] = [];
    for (let i = 0; i < keywords.length; i += 700) {
      const task = await this.post("/v3/dataforseo_labs/google/keyword_overview/live", [
        { keywords: keywords.slice(i, i + 700), location_code: m.locationCode, language_code: m.languageCode, include_clickstream_data: false },
      ]);
      out.push(...this.items(task).map(DataForSeoProvider.toMetrics));
    }
    return out;
  }

  async serp(keyword: string, m: Market, depth = 10): Promise<Serp> {
    const task = await this.post("/v3/serp/google/organic/live/advanced", [
      { keyword, location_code: m.locationCode, language_code: m.languageCode, device: "desktop", os: "windows", depth: Math.min(100, Math.max(10, depth)) },
    ]);
    const items = this.items(task);
    const features = new Set<string>();
    const paa: string[] = [];
    const related: string[] = [];
    const organic = [];
    for (const it of items) {
      if (it.type !== "organic") features.add(String(it.type));
      if (it.type === "organic") {
        organic.push({
          position: it.rank_group ?? it.rank_absolute ?? organic.length + 1,
          url: it.url ?? "",
          domain: String(it.domain ?? "").replace(/^www\./, ""),
          title: it.title ?? "",
          referringDomains: it.backlinks_info?.referring_domains ?? null,
        });
      } else if (it.type === "people_also_ask") {
        for (const q of it.items ?? []) if (q?.title) paa.push(String(q.title));
      } else if (it.type === "related_searches") {
        for (const q of it.items ?? []) if (typeof q === "string") related.push(q);
      }
    }
    return { keyword, organic, peopleAlsoAsk: paa, relatedSearches: related, features: [...features] };
  }

  async domainOverview(domain: string, m: Market): Promise<DomainOverview> {
    const [bl, labs] = await Promise.all([
      this.post("/v3/backlinks/summary/live", [
        { target: domain, include_subdomains: true, include_indirect_links: true, exclude_internal_backlinks: true, backlinks_status_type: "live", rank_scale: "one_hundred" },
      ]),
      this.post("/v3/dataforseo_labs/google/domain_rank_overview/live", [{ target: domain, location_code: m.locationCode, language_code: m.languageCode, limit: 1 }]).catch(() => null),
    ]);
    const s = (bl.result?.[0] ?? {}) as Item;
    const organic = labs ? this.items(labs)[0]?.metrics?.organic : undefined;
    return {
      domain,
      authority: s.rank ?? null,
      referringDomains: s.referring_domains ?? null,
      backlinks: s.backlinks ?? null,
      organicKeywords: organic?.count ?? null,
      organicTraffic: organic?.etv ?? null,
    };
  }

  async rankedKeywords(domain: string, m: Market, limit: number): Promise<RankedKeyword[]> {
    const task = await this.post("/v3/dataforseo_labs/google/ranked_keywords/live", [
      { target: domain, location_code: m.locationCode, language_code: m.languageCode, limit, item_types: ["organic"], order_by: ["keyword_data.keyword_info.search_volume,desc"] },
    ]);
    return this.items(task).map((it) => {
      const kd = it.keyword_data ?? {};
      const el = it.ranked_serp_element ?? {};
      const si = el.serp_item ?? {};
      return {
        keyword: String(kd.keyword ?? it.keyword ?? ""),
        position: si.rank_group ?? si.rank_absolute ?? el.rank_absolute ?? 0,
        url: si.url ?? el.url ?? "",
        volume: kd.keyword_info?.search_volume ?? null,
        providerKd: kd.keyword_properties?.keyword_difficulty ?? null,
        traffic: si.etv ?? el.etv ?? null,
      };
    });
  }

  // UNVERIFIED against live docs (docs.dataforseo.com unreachable from the build sandbox).
  // Callers treat failures as "no data" — see keywords/research.ts.
  async competitors(domain: string, m: Market, limit: number): Promise<Competitor[]> {
    const task = await this.post("/v3/dataforseo_labs/google/competitors_domain/live", [
      { target: domain, location_code: m.locationCode, language_code: m.languageCode, limit: limit + 20 },
    ]);
    return this.items(task)
      .filter((it) => it.domain && it.domain !== domain && !BIG_PLATFORMS.test(String(it.domain)))
      .slice(0, limit)
      .map((it) => ({ domain: String(it.domain), sharedKeywords: it.intersections ?? 0, avgPosition: it.avg_position ?? null }));
  }

  // UNVERIFIED against live docs — callers fall back to SERP backlinks_info / provider KD on failure.
  async referringDomainCounts(targets: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (let i = 0; i < targets.length; i += 1000) {
      const task = await this.post("/v3/backlinks/bulk_referring_domains/live", [{ targets: targets.slice(i, i + 1000) }]);
      for (const it of this.items(task)) if (it.target) out[it.target] = it.referring_domains ?? 0;
    }
    return out;
  }

  async referringDomains(target: string, limit: number): Promise<ReferringDomain[]> {
    const task = await this.post("/v3/backlinks/referring_domains/live", [
      { target, include_subdomains: true, backlinks_status_type: "live", rank_scale: "one_hundred", limit, order_by: ["rank,desc"], exclude_internal_backlinks: true },
    ]);
    return this.items(task).map((it) => ({ domain: String(it.domain), authority: it.rank ?? null, backlinks: it.backlinks ?? null }));
  }
}
