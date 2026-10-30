import { createHash } from "node:crypto";
import type { CrawlResult, CrawledPage } from "../crawl/crawler.js";
import { AI_CRAWLERS, isAllowed } from "../crawl/robots.js";
import { jaccard, round, tokens } from "../util/text.js";

export type Severity = "error" | "warning" | "notice";
export type Category =
  | "crawlability"
  | "indexability"
  | "on-page"
  | "content"
  | "links"
  | "structured-data"
  | "performance"
  | "mobile"
  | "security"
  | "international"
  | "geo-aeo";

export interface Issue {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  why: string;
  fix: string;
  /** Machine-readable fix recipe the auto-fixer (Claude Code /seo-fix) understands. */
  recipe: string;
  urls: string[];
}

export interface AuditResult {
  site: string;
  auditedAt: string;
  pagesCrawled: number;
  /** Ahrefs-style Health Score: % of crawled HTML pages with no error-level issue. */
  healthScore: number;
  counts: Record<Severity, number>;
  issues: Issue[];
}

interface Def {
  severity: Severity;
  category: Category;
  title: string;
  why: string;
  fix: string;
  recipe: string;
}

/** Issue catalogue — the "Site Audit" checks from Semrush/Ahrefs/OpenSEO combined. */
const DEFS: Record<string, Def> = {
  "http-4xx": { severity: "error", category: "crawlability", title: "Pages return 4xx errors", why: "Users and Google hit dead ends; link equity pointing here is wasted.", fix: "Restore the page, or 301-redirect it to the closest live page and update internal links.", recipe: "redirect-or-restore" },
  "http-5xx": { severity: "error", category: "crawlability", title: "Pages return 5xx server errors", why: "Google slows crawling and can drop pages that keep erroring.", fix: "Fix the server/runtime error (check hosting logs).", recipe: "fix-server-error" },
  "fetch-failed": { severity: "error", category: "crawlability", title: "Pages could not be fetched", why: "Timeouts or connection errors stop Google from reading the page.", fix: "Check hosting, DNS and firewall/bot protection for these URLs.", recipe: "fix-server-error" },
  "broken-internal-link": { severity: "error", category: "links", title: "Broken internal links", why: "Wastes crawl budget and frustrates visitors.", fix: "Update or remove links that point to the broken URLs (list shows broken targets).", recipe: "fix-internal-links" },
  "redirect-chain": { severity: "warning", category: "crawlability", title: "Redirect chains (2+ hops)", why: "Each hop slows users and loses a little link equity.", fix: "Point the first URL straight at the final destination.", recipe: "collapse-redirects" },
  "noindex-in-sitemap": { severity: "error", category: "indexability", title: "Sitemap lists noindex pages", why: "Mixed signals: you ask Google to index a page that tells it not to.", fix: "Remove noindex if the page should rank, otherwise drop it from the sitemap.", recipe: "align-sitemap-noindex" },
  noindex: { severity: "notice", category: "indexability", title: "Pages blocked by noindex", why: "These pages cannot rank. Fine for thank-you/admin pages, bad for money pages.", fix: "Confirm each is intentional.", recipe: "review-noindex" },
  "canonical-missing": { severity: "warning", category: "indexability", title: "Missing canonical tag", why: "Without it, URL variants (?utm, trailing slash) can split ranking signals.", fix: "Add a self-referencing <link rel=\"canonical\">.", recipe: "add-canonical" },
  "canonical-elsewhere-in-sitemap": { severity: "warning", category: "indexability", title: "Sitemap URLs canonicalise to another URL", why: "Sitemaps should list only canonical URLs.", fix: "List the canonical URL in the sitemap, or fix the canonical tag.", recipe: "align-sitemap-canonical" },
  "title-missing": { severity: "error", category: "on-page", title: "Missing <title>", why: "The title is the single strongest on-page ranking and click signal.", fix: "Add a unique title (50–60 characters) with the main keyword near the start.", recipe: "set-title" },
  "title-too-long": { severity: "warning", category: "on-page", title: "Title too long (> 60 characters)", why: "Google truncates it in results, hiding the end of your message.", fix: "Trim to ≤ 60 characters; keep the keyword first and brand last.", recipe: "set-title" },
  "title-too-short": { severity: "notice", category: "on-page", title: "Title too short (< 30 characters)", why: "Leaves ranking and click-through opportunity unused.", fix: "Expand with the primary keyword and a benefit.", recipe: "set-title" },
  "title-duplicate": { severity: "warning", category: "on-page", title: "Duplicate titles", why: "Pages compete with each other (cannibalisation) and look identical in results.", fix: "Give each page a unique title that matches its own keyword.", recipe: "set-title" },
  "meta-description-missing": { severity: "warning", category: "on-page", title: "Missing meta description", why: "Google writes its own snippet, often a poor one, lowering click-through.", fix: "Write a 140–160 character description that answers the search and invites the click.", recipe: "set-meta-description" },
  "meta-description-long": { severity: "notice", category: "on-page", title: "Meta description too long (> 160 characters)", why: "Gets cut off in results.", fix: "Trim to 140–160 characters.", recipe: "set-meta-description" },
  "meta-description-short": { severity: "notice", category: "on-page", title: "Meta description too short (< 70 characters)", why: "Wastes snippet space that could sell the click.", fix: "Expand to 140–160 characters.", recipe: "set-meta-description" },
  "meta-description-duplicate": { severity: "warning", category: "on-page", title: "Duplicate meta descriptions", why: "Signals duplicate pages and weakens click-through.", fix: "Write a unique description per page.", recipe: "set-meta-description" },
  "h1-missing": { severity: "warning", category: "on-page", title: "Missing H1", why: "The H1 tells users and Google what the page is about.", fix: "Add exactly one H1 containing the page's main topic.", recipe: "set-h1" },
  "heading-words-joined": { severity: "warning", category: "on-page", title: "Headings whose words run together in the HTML", why: "Words split into styled spans without real spaces read as one word (\"WebsiteDevelopment\") to crawlers, screen readers and AI engines — the heading loses its keywords.", fix: "Render a real space between word elements (e.g. add {\" \"} after each word span in animated-text components).", recipe: "fix-joined-heading-words" },
  "h1-multiple": { severity: "notice", category: "on-page", title: "Multiple H1s", why: "Dilutes the page's main topic signal.", fix: "Keep one H1; demote others to H2.", recipe: "set-h1" },
  "lang-missing": { severity: "warning", category: "international", title: "Missing <html lang>", why: "Helps Google and screen readers serve the right language audience.", fix: "Set <html lang=\"en\"> (or the right locale).", recipe: "set-lang" },
  "hreflang-no-self": { severity: "warning", category: "international", title: "hreflang set without a self-reference", why: "Google ignores hreflang clusters that lack a self-referencing entry.", fix: "Include the page's own URL in its hreflang set.", recipe: "fix-hreflang" },
  "viewport-missing": { severity: "error", category: "mobile", title: "Missing mobile viewport", why: "Google indexes the mobile version; without a viewport the page renders as desktop.", fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.", recipe: "add-viewport" },
  "img-alt-missing": { severity: "warning", category: "on-page", title: "Images without alt text", why: "Lost image-search traffic and accessibility; alt text also helps topical relevance.", fix: "Describe each meaningful image in plain words; use alt=\"\" only for decoration.", recipe: "add-alt-text" },
  "thin-content": { severity: "notice", category: "content", title: "Thin content (< 300 words)", why: "Pages with little unique text rarely rank for anything competitive.", fix: "Expand with genuinely useful, first-hand detail — or merge into a stronger page.", recipe: "expand-content" },
  "near-duplicate": { severity: "warning", category: "content", title: "Near-duplicate pages", why: "Google picks one and filters the rest; they also cannibalise each other.", fix: "Differentiate the content or canonicalise/merge the weaker page.", recipe: "dedupe-content" },
  orphan: { severity: "warning", category: "links", title: "Orphan pages (in sitemap, no internal links)", why: "Pages nobody links to get little authority and are crawled rarely.", fix: "Link to them from relevant pages and navigation.", recipe: "add-internal-links" },
  "deep-page": { severity: "notice", category: "links", title: "Pages more than 3 clicks from the homepage", why: "Deep pages get crawled less and receive less internal authority.", fix: "Add links from hub pages or the homepage.", recipe: "add-internal-links" },
  "og-missing": { severity: "notice", category: "on-page", title: "Missing Open Graph tags", why: "Shares on LinkedIn/WhatsApp/X show no image or a wrong title — fewer clicks and mentions.", fix: "Add og:title, og:description, og:image (1200×630) and og:url.", recipe: "add-open-graph" },
  "schema-invalid": { severity: "error", category: "structured-data", title: "Invalid JSON-LD", why: "Broken structured data is ignored entirely.", fix: "Fix the JSON syntax (list shows parser errors).", recipe: "fix-json-ld" },
  "schema-missing": { severity: "notice", category: "structured-data", title: "No structured data", why: "Schema helps Google and AI engines understand entities (organisation, service, article, breadcrumbs).", fix: "Add JSON-LD for the page type (see `seo tags`).", recipe: "add-json-ld" },
  "slow-response": { severity: "warning", category: "performance", title: "Slow server response (> 1.5 s)", why: "Slow pages hurt Core Web Vitals and crawl rate.", fix: "Cache/static-render the page, use a CDN, reduce server work.", recipe: "improve-ttfb" },
  "heavy-html": { severity: "notice", category: "performance", title: "Heavy HTML (> 1 MB)", why: "Large documents slow rendering, especially on mobile.", fix: "Move inline data/scripts out of the HTML; paginate long lists.", recipe: "reduce-html" },
  "mixed-content": { severity: "warning", category: "security", title: "HTTP resources on HTTPS pages", why: "Browsers block or warn on mixed content.", fix: "Load every image/script over https.", recipe: "fix-mixed-content" },
  "not-https": { severity: "error", category: "security", title: "Site not served over HTTPS", why: "HTTPS is a ranking signal and browsers flag HTTP as insecure.", fix: "Serve all pages over HTTPS and 301 HTTP → HTTPS.", recipe: "enable-https" },
  "robots-missing": { severity: "warning", category: "crawlability", title: "No robots.txt", why: "Crawlers can't find your sitemap or crawl rules.", fix: "Add /robots.txt with a Sitemap: line.", recipe: "add-robots" },
  "sitemap-missing": { severity: "error", category: "crawlability", title: "No XML sitemap found", why: "Google discovers new pages slower without one.", fix: "Publish /sitemap.xml and reference it in robots.txt.", recipe: "add-sitemap" },
  "sitemap-bad-urls": { severity: "warning", category: "crawlability", title: "Sitemap contains non-200 URLs", why: "Wastes crawl budget and lowers Google's trust in your sitemap.", fix: "List only live, indexable, canonical URLs.", recipe: "clean-sitemap" },
  "llms-missing": { severity: "notice", category: "geo-aeo", title: "No /llms.txt", why: "An llms.txt gives AI assistants a clean summary of who you are and your key pages.", fix: "Publish /llms.txt (see `seo tags --llms`).", recipe: "add-llms-txt" },
  "ai-crawlers-blocked": { severity: "warning", category: "geo-aeo", title: "AI crawlers blocked in robots.txt", why: "Blocked AI crawlers can't read you, so ChatGPT/Claude/Perplexity/Gemini can't cite you.", fix: "Allow the search/answer bots (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot) unless there's a legal reason not to.", recipe: "allow-ai-crawlers" },
  "no-question-content": { severity: "notice", category: "geo-aeo", title: "Few question-led sections", why: "AI answers and featured snippets pull from clear question → direct answer blocks.", fix: "Add FAQ / question H2s with a 40–60 word direct answer under each (see `seo questions`).", recipe: "add-qa-sections" },
};

function shingles(text: string, k = 5): Set<string> {
  const t = tokens(text, { keepStopwords: true });
  const out = new Set<string>();
  for (let i = 0; i + k <= t.length; i += 2) {
    out.add(createHash("md5").update(t.slice(i, i + k).join(" ")).digest("hex").slice(0, 12));
  }
  return out;
}

export function auditCrawl(crawl: CrawlResult): AuditResult {
  const found = new Map<string, Set<string>>();
  const add = (id: string, url: string) => {
    if (!DEFS[id]) throw new Error(`unknown issue ${id}`);
    if (!found.has(id)) found.set(id, new Set());
    found.get(id)!.add(url);
  };
  // Canonicals and sitemap entries use public URLs; map them onto what we fetched.
  const toFetched = (u: string | null) => (u ? u.replace(crawl.siteOrigin, crawl.fetchOrigin) : u);
  const sameUrl = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

  const html = crawl.pages.filter((p) => p.status === 200 && p.contentType?.includes("text/html"));

  for (const p of crawl.pages) {
    if (p.status >= 500) add("http-5xx", p.url);
    else if (p.status >= 400) add("http-4xx", p.url);
    else if (p.status === 0) add("fetch-failed", p.url);
    if (p.redirects.length >= 2) add("redirect-chain", p.url);
  }

  for (const p of html) {
    const robots = `${p.metaRobots ?? ""} ${p.xRobotsTag ?? ""}`.toLowerCase();
    const noindex = robots.includes("noindex");
    if (noindex) add(p.inSitemap ? "noindex-in-sitemap" : "noindex", p.url);

    if (!p.canonical) add("canonical-missing", p.url);
    else if (p.inSitemap && !sameUrl(toFetched(p.canonical)!, p.finalUrl)) add("canonical-elsewhere-in-sitemap", p.url);

    const title = p.title?.trim() ?? "";
    if (!title) add("title-missing", p.url);
    else if (title.length > 60) add("title-too-long", p.url);
    else if (title.length < 30) add("title-too-short", p.url);

    const desc = p.metaDescription?.trim() ?? "";
    if (!desc) add("meta-description-missing", p.url);
    else if (desc.length > 160) add("meta-description-long", p.url);
    else if (desc.length < 70) add("meta-description-short", p.url);

    if ([...p.h1, ...p.h2].some(wordsJoined)) add("heading-words-joined", p.url);
    if (p.h1.length === 0) add("h1-missing", p.url);
    else if (p.h1.length > 1) add("h1-multiple", p.url);

    if (!p.lang) add("lang-missing", p.url);
    if (!p.viewport) add("viewport-missing", p.url);
    if (p.hreflang.length && !p.hreflang.some((h) => sameUrl(toFetched(h.href)!, p.finalUrl))) add("hreflang-no-self", p.url);
    if (p.images.some((i) => i.alt === null)) add("img-alt-missing", p.url);
    if (!noindex && p.wordCount < 300) add("thin-content", p.url);
    if (p.inSitemap && p.inlinks === 0 && p.depth > 0) add("orphan", p.url);
    if (p.depth > 3) add("deep-page", p.url);
    if (!p.og.title || !p.og.image) add("og-missing", p.url);
    if (p.jsonLd.errors.length) add("schema-invalid", p.url);
    else if (p.jsonLd.types.length === 0) add("schema-missing", p.url);
    if (p.ms > 1500) add("slow-response", p.url);
    if (p.bytes > 1_000_000) add("heavy-html", p.url);
    if (p.finalUrl.startsWith("https:") && p.images.some((i) => i.src.startsWith("http:"))) add("mixed-content", p.url);
  }

  // Duplicates
  const byTitle = new Map<string, string[]>();
  const byDesc = new Map<string, string[]>();
  for (const p of html) {
    if (p.title) byTitle.set(p.title.trim().toLowerCase(), [...(byTitle.get(p.title.trim().toLowerCase()) ?? []), p.url]);
    if (p.metaDescription) byDesc.set(p.metaDescription.trim().toLowerCase(), [...(byDesc.get(p.metaDescription.trim().toLowerCase()) ?? []), p.url]);
  }
  for (const urls of byTitle.values()) if (urls.length > 1) urls.forEach((u) => add("title-duplicate", u));
  for (const urls of byDesc.values()) if (urls.length > 1) urls.forEach((u) => add("meta-description-duplicate", u));

  // Near-duplicate content (shingle Jaccard ≥ 0.8), skipping very short pages.
  const sh = html.filter((p) => p.wordCount >= 150).map((p) => ({ url: p.url, s: shingles(p.text) }));
  for (let i = 0; i < sh.length; i++)
    for (let j = i + 1; j < sh.length; j++)
      if (jaccard(sh[i]!.s, sh[j]!.s) >= 0.8) {
        add("near-duplicate", sh[i]!.url);
        add("near-duplicate", sh[j]!.url);
      }

  // Site-level
  const site = crawl.fetchOrigin + "/";
  if (!crawl.startUrl.startsWith("https:")) add("not-https", crawl.startUrl);
  if (crawl.robotsStatus !== 200) add("robots-missing", site + "robots.txt");
  if (!crawl.sitemapUrls.length) add("sitemap-missing", site + "sitemap.xml");
  for (const p of crawl.pages) if (p.inSitemap && p.status !== 200) add("sitemap-bad-urls", p.url);
  for (const b of crawl.brokenInternal) for (const from of b.from) add("broken-internal-link", `${from} → ${b.url} (${b.status || "failed"})`);
  if (crawl.llmsTxt.status !== 200) add("llms-missing", site + "llms.txt");
  const blocked = AI_CRAWLERS.filter((c) => !isAllowed(crawl.robots, c.agent, "/"));
  for (const c of blocked) add("ai-crawlers-blocked", `${c.agent} (${c.owner})`);
  const withQuestions = html.filter((p) => p.questionHeadings.length > 0).length;
  if (html.length >= 3 && withQuestions / html.length < 0.2) add("no-question-content", site);

  const issues: Issue[] = [...found.entries()]
    .map(([id, urls]) => ({ id, ...DEFS[id]!, urls: [...urls] }))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.urls.length - a.urls.length);

  const pagesWithErrors = new Set<string>();
  for (const i of issues) if (i.severity === "error") for (const u of i.urls) if (html.some((p) => p.url === u)) pagesWithErrors.add(u);
  const total = Math.max(1, crawl.pages.length);
  const errorPages = pagesWithErrors.size + crawl.pages.filter((p) => p.status !== 200).length;

  const counts = { error: 0, warning: 0, notice: 0 } as Record<Severity, number>;
  for (const i of issues) counts[i.severity] += i.urls.length;

  return {
    site: crawl.siteOrigin,
    auditedAt: new Date().toISOString(),
    pagesCrawled: crawl.pages.length,
    healthScore: round(100 * Math.max(0, total - errorPages) / total),
    counts,
    issues,
  };
}

/** Real words that are legitimately CamelCase — never flag these. */
const CAMEL_OK = new Set(
  ("wordpress woocommerce hubspot linkedin youtube javascript typescript github gitlab paypal iphone ipad macos ios ecommerce devops chatgpt openai " +
    "postgresql mysql mongodb nextjs nodejs tiktok whatsapp sharepoint powerpoint quickbooks fedex saas deepseek semrush adwords bigcommerce clickup " +
    "mailchimp sendgrid cloudflare digitalocean fastapi graphql nosql phd iot airbnb dropbox salesforce shopify mcdonalds playstation photoshop " +
    "webflow netlify vercel supabase firebase").split(" "),
);

/** "WebsiteDevelopment", "Meta&GoogleAds", "Notesfromthebuild" — words glued by span-per-word markup. */
export function wordsJoined(heading: string): boolean {
  return heading.split(/[\s/,()]+/).some((raw) => {
    const w = raw.replace(/[.!?:;]+$/, "");
    if (CAMEL_OK.has(w.toLowerCase().replace(/[^a-z]/g, ""))) return false;
    return /[a-z][A-Z][a-z]/.test(w) || /[a-z]&[A-Z]/.test(w) || (/^[a-z]+$/i.test(w) && w.length >= 16);
  });
}

const rank = (s: Severity) => (s === "error" ? 0 : s === "warning" ? 1 : 2);

export { DEFS as ISSUE_CATALOGUE };
export type { CrawledPage };
