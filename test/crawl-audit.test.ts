import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditCrawl, wordsJoined } from "../src/audit/audit.js";
import { crawlSite } from "../src/crawl/crawler.js";
import { parseHtml } from "../src/crawl/parse.js";
import { isAllowed, parseRobots } from "../src/crawl/robots.js";
import { buildLlmsTxt, recommendTags } from "../src/tags/recommend.js";

const page = (title: string, body: string, head = "") =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(" ");

const SITE: Record<string, { status?: number; type?: string; body: string; location?: string }> = {
  "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: {ORIGIN}/sitemap.xml" },
  "/sitemap.xml": {
    type: "application/xml",
    body: `<?xml version="1.0"?><urlset><url><loc>{ORIGIN}/</loc></url><url><loc>{ORIGIN}/services/web</loc></url><url><loc>{ORIGIN}/orphan</loc></url><url><loc>{ORIGIN}/gone</loc></url><url><loc>{ORIGIN}/hidden</loc></url></urlset>`,
  },
  "/": {
    body: page(
      "Acme — Web Studio",
      `<h1>Solutions<br/>that scale</h1><a href="/services/web">Web</a><a href="/old">Old</a><a href="/broken">Broken</a><img src="/a.png"><p>${words(400)}</p>`,
      `<meta name="description" content="Short."><link rel="canonical" href="{ORIGIN}/"><script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>`,
    ),
  },
  "/services/web": {
    body: page(
      "Web Development Services for Growing Businesses and Startups Worldwide | Acme",
      `<h1><span>Website</span><span>Development</span></h1><h2>How much does a website cost?</h2><p>${words(350)}</p>`,
      `<script type="application/ld+json">{ broken json</script>`,
    ),
  },
  "/orphan": { body: page("Orphan page about something useful", `<h1>Orphan</h1><p>${words(50)}</p>`) },
  "/hidden": { body: page("Hidden page", `<h1>Hidden</h1>`, `<meta name="robots" content="noindex">`) },
  "/old": { status: 301, body: "", location: "/older" },
  "/older": { status: 301, body: "", location: "/services/web" },
  "/private": { body: page("Private", "<h1>Private</h1>") },
};

let server: http.Server;
let origin = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const route = SITE[req.url ?? "/"];
    if (!route) {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>404</h1>");
      return;
    }
    const headers: Record<string, string> = { "content-type": route.type ?? "text/html; charset=utf-8" };
    if (route.location) headers.location = route.location;
    res.writeHead(route.status ?? 200, headers).end(route.body.replaceAll("{ORIGIN}", origin));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("robots", () => {
  const r = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public\n\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://x.com/s.xml");
  it("applies longest match and agent groups", () => {
    expect(isAllowed(r, "Googlebot", "/admin/x")).toBe(false);
    expect(isAllowed(r, "Googlebot", "/admin/public/x")).toBe(true);
    expect(isAllowed(r, "GPTBot", "/")).toBe(false);
    expect(isAllowed(r, "ClaudeBot", "/blog")).toBe(true);
    expect(r.sitemaps).toEqual(["https://x.com/s.xml"]);
  });
});

describe("parseHtml", () => {
  it("treats <br> as a word break and finds question headings + schema", () => {
    const p = parseHtml(page("T", `<h1>Solutions<br/>that scale</h1><h2>What is GEO?</h2><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Organization"}]}</script>`), "https://x.com/");
    expect(p.h1[0]).toBe("Solutions that scale");
    expect(p.questionHeadings).toEqual(["What is GEO?"]);
    expect(p.jsonLd.types.sort()).toEqual(["Organization", "WebSite"]);
  });
});

describe("wordsJoined", () => {
  it("flags span-glued headings only", () => {
    expect(wordsJoined("WebsiteDevelopment")).toBe(true);
    expect(wordsJoined("Meta&GoogleAds")).toBe(true);
    expect(wordsJoined("Notesfromthebuildlog.")).toBe(true);
    expect(wordsJoined("Website Development")).toBe(false);
    expect(wordsJoined("SEO/GEO/AEO services")).toBe(false);
    expect(wordsJoined("Next.js vs WordPress")).toBe(false);
  });
});

describe("crawl + audit (local test site)", () => {
  it("finds the planted issues", async () => {
    const crawl = await crawlSite(origin + "/", { maxPages: 50, concurrency: 3 });
    expect(crawl.robotsStatus).toBe(200);
    expect(crawl.sitemapUrls.length).toBe(5);
    expect(crawl.pages.some((p) => p.url.endsWith("/private"))).toBe(false); // robots-disallowed
    const a = auditCrawl(crawl);
    const ids = new Set(a.issues.map((i) => i.id));
    for (const id of [
      "http-4xx", "broken-internal-link", "redirect-chain", "noindex-in-sitemap", "orphan", "title-too-long",
      "meta-description-short", "img-alt-missing", "schema-invalid", "heading-words-joined", "ai-crawlers-blocked",
      "llms-missing", "canonical-missing", "thin-content", "not-https",
    ]) expect(ids, id).toContain(id);
    expect(ids).not.toContain("sitemap-missing");
    expect(a.healthScore).toBeLessThan(100);
    expect(a.issues[0]!.severity).toBe("error");
  });

  it("recommends tags and llms.txt", async () => {
    const crawl = await crawlSite(origin + "/", { maxPages: 20 });
    const project = { slug: "acme", url: origin + "/", domain: "acme.test", market: "us", createdAt: "", business: { name: "Acme", summary: "Web studio." } };
    const svc = crawl.pages.find((p) => p.url.endsWith("/services/web"))!;
    const rec = recommendTags(svc, project, { keyword: "web development services" });
    expect(rec.pageType).toBe("service");
    expect(rec.recommended.title.length).toBeLessThanOrEqual(60);
    expect(rec.recommended.title.toLowerCase()).toContain("web development services");
    expect(rec.recommended.jsonLd.map((j) => j["@type"])).toEqual(["Service", "BreadcrumbList"]);
    expect(rec.nextMetadata).toContain("images:");
    const llms = buildLlmsTxt(project, crawl.pages, origin);
    expect(llms).toMatch(/^# Acme/);
    expect(llms).toContain("## Services");
  });
});
