import type { CrawledPage } from "../crawl/crawler.js";
import type { Project } from "../store.js";
import { sentences, stems } from "../util/text.js";

export type PageType = "home" | "service" | "article" | "listing" | "contact" | "about" | "product" | "legal" | "page";

export interface TagRecommendation {
  url: string;
  pageType: PageType;
  primaryKeyword: string | null;
  current: {
    title: string | null;
    description: string | null;
    h1: string[];
    canonical: string | null;
    ogImage: string | null;
    schemaTypes: string[];
  };
  recommended: {
    title: string;
    description: string;
    h1: string;
    canonical: string;
    robots: string;
    openGraph: Record<string, string>;
    twitter: Record<string, string>;
    jsonLd: Record<string, unknown>[];
  };
  /** What changed and why — plain English for the operator. */
  changes: string[];
  /** Ready-to-paste Next.js App Router metadata export. */
  nextMetadata: string;
}

export function detectPageType(url: string, page: Pick<CrawledPage, "jsonLd" | "h1">): PageType {
  const path = new URL(url).pathname.replace(/\/$/, "") || "/";
  const types = page.jsonLd.types.map((t) => t.toLowerCase());
  if (path === "/") return "home";
  if (types.includes("product") || /\/(product|products|shop)\//.test(path)) return "product";
  if (types.some((t) => t.includes("article") || t === "blogposting") || /\/(blog|news|insights|articles?|guides?)\/.+/.test(path)) return "article";
  if (/\/(blog|news|insights|services|products|shop)$/.test(path)) return "listing";
  if (/\/services?\/.+/.test(path) || types.includes("service")) return "service";
  if (/contact/.test(path)) return "contact";
  if (/about|team|story/.test(path)) return "about";
  if (/privacy|terms|cookie|legal/.test(path)) return "legal";
  return "page";
}

const titleCase = (s: string) =>
  s.replace(/\w\S*/g, (w) => (/^(and|or|for|of|the|in|on|to|vs|a|an)$/i.test(w) ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1)));

function fit(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:—–-]\s*$/, "") + "…";
}

/** Build a title: keyword first, brand last, ≤ 60 chars (Google truncates beyond ~600px). */
export function buildTitle(opts: { keyword: string | null; current: string | null; h1: string | null; brand: string; pageType: PageType }): string {
  const { keyword, current, h1, brand, pageType } = opts;
  if (pageType === "home") {
    const tagline = keyword ? titleCase(keyword) : (h1 ?? current?.split(/[|—–-]/)[1]?.trim() ?? "");
    return fit(tagline ? `${brand} — ${tagline}` : brand, 60);
  }
  const base = keyword ? titleCase(keyword) : (h1 ?? current?.split(/\s[|—–-]\s/)[0] ?? brand);
  const withBrand = `${base} | ${brand}`;
  return withBrand.length <= 60 ? withBrand : fit(base, 60);
}

/** Description: lead with the answer/benefit, include the keyword, 140–160 chars. */
export function buildDescription(opts: { keyword: string | null; current: string | null; text: string }): string {
  const { keyword, current, text } = opts;
  const kwStems = keyword ? stems(keyword) : [];
  const hasKw = (s: string) => kwStems.every((k) => stems(s).includes(k));
  if (current && current.length >= 120 && current.length <= 160 && (!keyword || hasKw(current))) return current;
  const pool = [current ?? "", ...sentences(text).slice(0, 12)].filter((s) => s.length > 40 && s.length < 220);
  const pick = pool.find((s) => keyword && hasKw(s)) ?? pool[0] ?? "";
  let out = pick;
  for (const s of pool) {
    if (out.length >= 130) break;
    if (s !== pick && (out + " " + s).length <= 160) out = `${out} ${s}`;
  }
  return fit(out.trim(), 160);
}

function breadcrumb(url: string, siteName: string): Record<string, unknown> {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const items = [{ "@type": "ListItem", position: 1, name: siteName, item: u.origin + "/" }];
  parts.forEach((p, i) =>
    items.push({ "@type": "ListItem", position: i + 2, name: titleCase(p.replace(/-/g, " ")), item: `${u.origin}/${parts.slice(0, i + 1).join("/")}` }),
  );
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items };
}

/**
 * JSON-LD per page type. Only markup Google still uses (2026): FAQPage/HowTo rich
 * results are retired, so we don't generate them — Q&A *content* still matters for AEO.
 */
export function buildJsonLd(url: string, pageType: PageType, page: CrawledPage, project: Project, title: string, description: string): Record<string, unknown>[] {
  const origin = new URL(url).origin;
  const name = project.business?.name ?? project.domain;
  const org = {
    "@context": "https://schema.org",
    "@type": project.business?.location ? "ProfessionalService" : "Organization",
    "@id": `${origin}/#organization`,
    name,
    url: origin + "/",
    logo: `${origin}/logo.png`,
    ...(project.business?.summary ? { description: project.business.summary } : {}),
    ...(project.business?.location ? { areaServed: project.business.location } : {}),
    sameAs: [] as string[],
  };
  const out: Record<string, unknown>[] = [];
  switch (pageType) {
    case "home":
      out.push(org, { "@context": "https://schema.org", "@type": "WebSite", "@id": `${origin}/#website`, name, url: origin + "/", publisher: { "@id": `${origin}/#organization` } });
      break;
    case "service":
      out.push({
        "@context": "https://schema.org",
        "@type": "Service",
        name: page.h1[0] ?? title,
        description,
        url,
        provider: { "@id": `${origin}/#organization` },
        ...(project.business?.location ? { areaServed: project.business.location } : {}),
      });
      out.push(breadcrumb(url, name));
      break;
    case "article":
      out.push({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: page.h1[0] ?? title,
        description,
        url,
        mainEntityOfPage: url,
        image: page.og.image ?? `${origin}/og-image.png`,
        author: { "@type": "Person", name: "TODO: real author name", url: `${origin}/about` },
        publisher: { "@id": `${origin}/#organization` },
        datePublished: "TODO: ISO date",
        dateModified: "TODO: ISO date",
      });
      out.push(breadcrumb(url, name));
      break;
    case "product":
      out.push({
        "@context": "https://schema.org",
        "@type": "Product",
        name: page.h1[0] ?? title,
        description,
        image: page.og.image ?? undefined,
        offers: { "@type": "Offer", price: "TODO", priceCurrency: "TODO", availability: "https://schema.org/InStock", url },
      });
      out.push(breadcrumb(url, name));
      break;
    case "contact":
      out.push({ "@context": "https://schema.org", "@type": "ContactPage", url, about: { "@id": `${origin}/#organization` } });
      break;
    case "about":
      out.push({ "@context": "https://schema.org", "@type": "AboutPage", url, about: { "@id": `${origin}/#organization` } });
      break;
    case "listing":
      out.push({ "@context": "https://schema.org", "@type": "CollectionPage", name: page.h1[0] ?? title, url });
      out.push(breadcrumb(url, name));
      break;
    default:
      if (new URL(url).pathname.split("/").filter(Boolean).length > 1) out.push(breadcrumb(url, name));
  }
  return out;
}

function nextMetadataSnippet(r: TagRecommendation["recommended"]): string {
  const og = r.openGraph;
  return `export const metadata: Metadata = {
  title: ${JSON.stringify(r.title)},
  description: ${JSON.stringify(r.description)},
  alternates: { canonical: ${JSON.stringify(new URL(r.canonical).pathname)} },
  openGraph: {
    title: ${JSON.stringify(og.title)},
    description: ${JSON.stringify(og.description)},
    url: ${JSON.stringify(og.url)},
    type: ${JSON.stringify(og.type)},
    // Page-level openGraph REPLACES the layout's — always repeat the image here.
    images: [{ url: ${JSON.stringify(og.image)}, width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: ${JSON.stringify(r.twitter.title)}, description: ${JSON.stringify(r.twitter.description)}, images: [${JSON.stringify(r.twitter.image)}] },
};`;
}

export function recommendTags(page: CrawledPage, project: Project, opts: { keyword?: string | null; siteOrigin?: string } = {}): TagRecommendation {
  const publicUrl = opts.siteOrigin ? page.finalUrl.replace(new URL(page.finalUrl).origin, opts.siteOrigin) : page.finalUrl;
  const pageType = detectPageType(publicUrl, page);
  const brand = project.business?.name ?? project.domain;
  const keyword = opts.keyword ?? null;
  const title = buildTitle({ keyword, current: page.title, h1: page.h1[0] ?? null, brand, pageType });
  const description = buildDescription({ keyword, current: page.metaDescription, text: page.text });
  const h1 = page.h1[0] ?? (keyword ? titleCase(keyword) : title.split(" | ")[0]!);
  const canonical = publicUrl.replace(/\/$/, "") || publicUrl;
  const ogImage = page.og.image ?? page.twitter.image ?? `${new URL(publicUrl).origin}/og-image.png`;
  const robots = pageType === "legal" ? "index, follow" : "index, follow, max-image-preview:large, max-snippet:-1";

  const recommended = {
    title,
    description,
    h1,
    canonical,
    robots,
    openGraph: { title, description, url: canonical, type: pageType === "article" ? "article" : "website", image: ogImage, site_name: brand },
    twitter: { card: "summary_large_image", title, description, image: ogImage },
    jsonLd: buildJsonLd(publicUrl, pageType, page, project, title, description),
  };

  const changes: string[] = [];
  if (page.title !== title) changes.push(`Title: "${page.title ?? "(none)"}" → "${title}" (${title.length} chars)`);
  if (page.metaDescription !== description) changes.push(`Description → ${description.length} chars${keyword ? ", contains the keyword" : ""}`);
  if (page.h1.length === 0) changes.push(`Add one H1: "${h1}"`);
  if (page.h1.length > 1) changes.push(`Keep one H1 ("${page.h1[0]}"), turn the other ${page.h1.length - 1} into H2s`);
  if (!page.canonical) changes.push("Add self-referencing canonical");
  if (!page.og.image) changes.push("Add og:image (page-level openGraph overrides the site default in Next.js)");
  const missingTypes = recommended.jsonLd.map((j) => j["@type"] as string).filter((t) => !page.jsonLd.types.includes(t));
  if (missingTypes.length) changes.push(`Add JSON-LD: ${missingTypes.join(", ")}`);
  if (page.jsonLd.types.includes("FAQPage")) changes.push("FAQPage markup no longer earns Google rich results (2026); keep the on-page Q&A, the markup is optional");
  const noAlt = page.images.filter((i) => i.alt === null).length;
  if (noAlt) changes.push(`Write alt text for ${noAlt} image(s)`);
  if (keyword && !stems(page.h1.join(" ")).some((s) => stems(keyword).includes(s))) changes.push(`H1 doesn't mention "${keyword}" — work it in naturally`);

  const rec: TagRecommendation = {
    url: publicUrl,
    pageType,
    primaryKeyword: keyword,
    current: {
      title: page.title,
      description: page.metaDescription,
      h1: page.h1,
      canonical: page.canonical,
      ogImage: page.og.image ?? null,
      schemaTypes: page.jsonLd.types,
    },
    recommended,
    changes,
    nextMetadata: "",
  };
  rec.nextMetadata = nextMetadataSnippet(recommended);
  return rec;
}

/** /llms.txt — a plain summary AI assistants can read (llmstxt.org format). */
export function buildLlmsTxt(project: Project, pages: CrawledPage[], siteOrigin: string): string {
  const name = project.business?.name ?? project.domain;
  const pub = (u: string) => u.replace(new URL(u).origin, siteOrigin);
  const groups = new Map<string, CrawledPage[]>();
  for (const p of pages.filter((p) => p.status === 200 && p.title)) {
    const type = detectPageType(pub(p.finalUrl), p);
    if (type === "legal") continue;
    const key = type === "service" ? "Services" : type === "article" ? "Articles" : "Key pages";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const lines = [`# ${name}`, "", `> ${project.business?.summary ?? pages.find((p) => detectPageType(pub(p.finalUrl), p) === "home")?.metaDescription ?? ""}`, ""];
  if (project.business?.services?.length) lines.push(`Services: ${project.business.services.join(", ")}.`, "");
  for (const key of ["Key pages", "Services", "Articles"]) {
    const list = groups.get(key);
    if (!list?.length) continue;
    lines.push(`## ${key}`, "");
    for (const p of list) lines.push(`- [${(p.h1[0] ?? p.title)!.trim()}](${pub(p.finalUrl)}): ${(p.metaDescription ?? "").trim()}`);
    lines.push("");
  }
  return lines.join("\n");
}
