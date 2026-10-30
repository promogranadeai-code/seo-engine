/** Provider-neutral data shapes. DataForSEO is the default backend; fixtures are used offline/in tests. */

export type Intent = "informational" | "navigational" | "commercial" | "transactional";

export interface KeywordMetrics {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  /** Paid competition 0–1 (Google Ads). */
  competition: number | null;
  /** Provider keyword difficulty 0–100 (DataForSEO Labs), if available. */
  providerKd: number | null;
  intent: Intent | null;
  /** Last 12 months of volume, oldest first. */
  trend: number[];
  /** 0–100 popularity proxy from Google Autocomplete order, used when no volume is known (free provider). */
  demand?: number | null;
}

export interface SerpItem {
  position: number;
  url: string;
  domain: string;
  title: string;
  /** Referring domains to the ranking URL, when the provider includes it. */
  referringDomains: number | null;
}

export interface Serp {
  keyword: string;
  organic: SerpItem[];
  peopleAlsoAsk: string[];
  relatedSearches: string[];
  /** SERP feature types present (ai_overview, featured_snippet, local_pack, video, ...). */
  features: string[];
}

export interface DomainOverview {
  domain: string;
  /** 0–100 authority (DataForSEO rank on a 100 scale — our DR/Authority Score analogue). */
  authority: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  organicKeywords: number | null;
  organicTraffic: number | null;
}

export interface RankedKeyword {
  keyword: string;
  position: number;
  url: string;
  volume: number | null;
  providerKd: number | null;
  traffic: number | null;
}

export interface ReferringDomain {
  domain: string;
  authority: number | null;
  backlinks: number | null;
}

export interface Competitor {
  domain: string;
  sharedKeywords: number;
  avgPosition: number | null;
}

/** AI answer engines we can query (DataForSEO ai_optimization slugs). */
export type AiEngine = "chat_gpt" | "claude" | "gemini" | "perplexity";

export interface AiAnswer {
  engine: AiEngine;
  model: string;
  prompt: string;
  text: string;
  citations: { url: string; title: string | null }[];
}

export interface Market {
  locationCode: number;
  languageCode: string;
}

export interface SeoDataProvider {
  readonly name: string;
  /** USD spent so far in this process (for cost reporting). */
  spentUsd(): number;
  keywordIdeas(seeds: string[], m: Market, limit: number): Promise<KeywordMetrics[]>;
  keywordMetrics(keywords: string[], m: Market): Promise<KeywordMetrics[]>;
  serp(keyword: string, m: Market, depth?: number): Promise<Serp>;
  domainOverview(domain: string, m: Market): Promise<DomainOverview>;
  rankedKeywords(domain: string, m: Market, limit: number): Promise<RankedKeyword[]>;
  competitors(domain: string, m: Market, limit: number): Promise<Competitor[]>;
  /** Referring-domain counts for many URLs/domains at once. */
  referringDomainCounts(targets: string[]): Promise<Record<string, number>>;
  referringDomains(target: string, limit: number): Promise<ReferringDomain[]>;
  /** Ask an AI engine a question (with web search) and return its answer + cited sources. */
  aiAnswer?(engine: AiEngine, prompt: string, opts?: { countryIso?: string }): Promise<AiAnswer>;
}
