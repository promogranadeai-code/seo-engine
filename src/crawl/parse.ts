import * as cheerio from "cheerio";
import { wordCount } from "../util/text.js";

export interface ImageInfo {
  src: string;
  alt: string | null;
}

export interface JsonLdInfo {
  types: string[];
  blocks: unknown[];
  errors: string[];
}

export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  viewport: string | null;
  charset: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  hreflang: { lang: string; href: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: JsonLdInfo;
  images: ImageInfo[];
  links: { href: string; text: string; rel: string | null }[];
  wordCount: number;
  /** Visible main text, whitespace-collapsed (capped at 20k chars). */
  text: string;
  /** Questions found in headings — useful for AEO. */
  questionHeadings: string[];
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out));
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
    for (const v of Object.values(obj)) if (v && typeof v === "object") collectTypes(v, out);
  }
}

export function parseHtml(html: string, baseUrl: string): ParsedPage {
  // <br> and block boundaries separate words visually; give them a space so
  // extracted text matches what Google renders ("Solutions<br>that" → "Solutions that").
  const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, " <br/>").replace(/<\/(p|div|li|h[1-6]|section|article|td|th)>/gi, "</$1> "));
  const meta = (sel: string) => $(sel).first().attr("content")?.trim() ?? null;

  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const k = $(el).attr("property");
    const v = $(el).attr("content");
    if (k && v) og[k.slice(3)] = v;
  });
  const twitter: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const k = $(el).attr("name");
    const v = $(el).attr("content");
    if (k && v) twitter[k.slice(8)] = v;
  });

  const jsonLd: JsonLdInfo = { types: [], blocks: [], errors: [] };
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((i, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      jsonLd.blocks.push(parsed);
      collectTypes(parsed, types);
    } catch (e) {
      jsonLd.errors.push(`block ${i + 1}: ${(e as Error).message}`);
    }
  });
  jsonLd.types = [...types];

  const abs = (href: string | undefined) => {
    if (!href) return null;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  };

  const links: ParsedPage["links"] = [];
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") ?? "";
    if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
    const href = abs(raw);
    if (href) links.push({ href, text: $(el).text().replace(/\s+/g, " ").trim(), rel: $(el).attr("rel") ?? null });
  });

  const images: ImageInfo[] = [];
  $("img").each((_, el) => {
    const src = abs($(el).attr("src") ?? $(el).attr("data-src"));
    if (src) images.push({ src, alt: $(el).attr("alt") ?? null });
  });

  const hreflang: ParsedPage["hreflang"] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const href = abs($(el).attr("href"));
    if (href) hreflang.push({ lang: $(el).attr("hreflang") ?? "", href });
  });

  const headings = (tag: string) =>
    $(tag)
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
  const h1 = headings("h1");
  const h2 = headings("h2");
  const h3 = headings("h3");

  // Visible text: drop non-content elements before reading.
  $("script, style, noscript, svg, template, iframe").remove();
  const main = $("main").length ? $("main") : $("body");
  const text = main.text().replace(/\s+/g, " ").trim();

  return {
    title: $("head title").first().text().trim() || null,
    metaDescription: meta('meta[name="description"]'),
    metaRobots: meta('meta[name="robots"]'),
    canonical: abs($('link[rel="canonical"]').first().attr("href")),
    lang: $("html").attr("lang") ?? null,
    viewport: meta('meta[name="viewport"]'),
    charset: $("meta[charset]").attr("charset") ?? null,
    h1,
    h2,
    h3,
    hreflang,
    og,
    twitter,
    jsonLd,
    images,
    links,
    wordCount: wordCount(text),
    text: text.slice(0, 20_000),
    questionHeadings: [...h2, ...h3].filter((h) => /\?$|^(how|what|why|when|which|who|can|does|is|are|should)\b/i.test(h)),
  };
}
