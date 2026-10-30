import * as cheerio from "cheerio";
import { fetchPage, hostOf, normalizeUrl, pool, type FetchResult } from "../util/http.js";
import { parseHtml, type ParsedPage } from "./parse.js";
import { isAllowed, parseRobots, type Robots } from "./robots.js";

export interface CrawledPage extends ParsedPage {
  url: string;
  finalUrl: string;
  status: number;
  redirects: string[];
  ms: number;
  bytes: number;
  contentType: string | null;
  xRobotsTag: string | null;
  depth: number;
  inSitemap: boolean;
  /** Internal pages linking here (filled after the crawl). */
  inlinks: number;
  error?: string;
}

export interface CrawlResult {
  startUrl: string;
  host: string;
  /** Public origin of the site (canonical/sitemap URLs use this). */
  siteOrigin: string;
  /** Origin actually fetched (differs when auditing a local/staging build). */
  fetchOrigin: string;
  crawledAt: string;
  robots: Robots | null;
  robotsStatus: number;
  sitemapUrls: string[];
  sitemapStatus: { url: string; status: number }[];
  llmsTxt: { status: number; bytes: number };
  pages: CrawledPage[];
  /** Internal URLs that were linked but returned errors (4xx/5xx/network). */
  brokenInternal: { url: string; status: number; from: string[] }[];
}

export interface CrawlOptions {
  maxPages?: number;
  concurrency?: number;
  /** Only crawl URLs from the sitemap (no link discovery). */
  sitemapOnly?: boolean;
  /** Rewrite the site origin, e.g. audit a local build with production URLs in the sitemap. */
  originOverride?: string;
  onProgress?: (done: number, queued: number, url: string) => void;
}

async function readSitemaps(urls: string[], seen = new Set<string>(), status: CrawlResult["sitemapStatus"] = []) {
  const pages: string[] = [];
  for (const u of urls) {
    if (seen.has(u) || seen.size > 50) continue;
    seen.add(u);
    const res = await fetchPage(u);
    status.push({ url: u, status: res.status });
    if (res.status !== 200) continue;
    const $ = cheerio.load(res.body, { xml: true });
    const nested = $("sitemapindex > sitemap > loc").map((_, el) => $(el).text().trim()).get();
    if (nested.length) pages.push(...(await readSitemaps(nested, seen, status)).pages);
    pages.push(...$("urlset > url > loc").map((_, el) => $(el).text().trim()).get());
  }
  return { pages, status };
}

export async function crawlSite(startUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 200;
  const concurrency = opts.concurrency ?? 5;
  const origin = new URL(opts.originOverride ?? startUrl).origin;
  const siteHost = hostOf(startUrl);
  const localize = (u: string) => {
    if (!opts.originOverride) return u;
    const url = new URL(u);
    if (hostOf(u) !== siteHost) return u;
    return origin + url.pathname + url.search;
  };
  const isInternal = (u: string) => {
    try {
      const h = hostOf(u);
      return h === siteHost || h === hostOf(origin);
    } catch {
      return false;
    }
  };

  const robotsRes = await fetchPage(`${origin}/robots.txt`);
  const robots = robotsRes.status === 200 ? parseRobots(robotsRes.body) : null;
  const sitemapCandidates = robots?.sitemaps.length ? robots.sitemaps.map(localize) : [`${origin}/sitemap.xml`];
  const { pages: sitemapRaw, status: sitemapStatus } = await readSitemaps(sitemapCandidates);
  const sitemapUrls = [...new Set(sitemapRaw.map((u) => normalizeUrl(localize(u))))];
  const llms = await fetchPage(`${origin}/llms.txt`);

  const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(localize(startUrl)), depth: 0 }];
  for (const u of sitemapUrls) queue.push({ url: u, depth: 1 });
  const seen = new Set<string>();
  const pages: CrawledPage[] = [];
  const linkSources = new Map<string, Set<string>>();
  const failures = new Map<string, number>();

  const visit = async ({ url, depth }: { url: string; depth: number }) => {
    const res: FetchResult = await fetchPage(url);
    const ct = res.headers["content-type"] ?? null;
    if (res.status === 0 || res.status >= 400) failures.set(url, res.status);
    const isHtml = !!ct && ct.includes("text/html");
    const parsed = isHtml && res.status === 200 ? parseHtml(res.body, res.finalUrl) : parseHtml("", res.finalUrl);
    const page: CrawledPage = {
      ...parsed,
      url,
      finalUrl: res.finalUrl,
      status: res.status,
      redirects: res.redirects,
      ms: res.ms,
      bytes: res.bytes,
      contentType: ct,
      xRobotsTag: res.headers["x-robots-tag"] ?? null,
      depth,
      inSitemap: sitemapUrls.includes(url),
      inlinks: 0,
      error: res.error,
    };
    if (isHtml) pages.push(page);
    else if (res.status >= 400 || res.status === 0) pages.push(page);
    opts.onProgress?.(pages.length, queue.length, url);

    for (const link of parsed.links) {
      if (!isInternal(link.href)) continue;
      const target = normalizeUrl(localize(link.href));
      if (!linkSources.has(target)) linkSources.set(target, new Set());
      linkSources.get(target)!.add(url);
      if (!opts.sitemapOnly && !seen.has(target) && /^https?:/.test(target)) {
        const path = new URL(target).pathname;
        if (!/\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|mp4|webm|css|js|xml|txt|woff2?)$/i.test(path)) {
          queue.push({ url: target, depth: depth + 1 });
        }
      }
    }
  };

  while (queue.length && seen.size < maxPages) {
    const batch: { url: string; depth: number }[] = [];
    while (queue.length && batch.length < concurrency * 2 && seen.size + batch.length < maxPages) {
      const next = queue.shift()!;
      if (seen.has(next.url)) continue;
      if (!isAllowed(robots, "Googlebot", new URL(next.url).pathname)) continue;
      seen.add(next.url);
      batch.push(next);
    }
    await pool(batch, concurrency, visit);
  }

  for (const p of pages) p.inlinks = linkSources.get(p.url)?.size ?? 0;

  const brokenInternal = [...failures.entries()]
    .filter(([u]) => linkSources.has(u))
    .map(([u, status]) => ({ url: u, status, from: [...(linkSources.get(u) ?? [])].slice(0, 10) }));

  return {
    startUrl,
    host: siteHost,
    siteOrigin: new URL(startUrl).origin,
    fetchOrigin: origin,
    crawledAt: new Date().toISOString(),
    robots,
    robotsStatus: robotsRes.status,
    sitemapUrls,
    sitemapStatus,
    llmsTxt: { status: llms.status, bytes: llms.bytes },
    pages,
    brokenInternal,
  };
}
