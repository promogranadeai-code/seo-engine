import type { KeywordReport } from "../keywords/research.js";
import type { Project } from "../store.js";
import type { ReferringDomain, SeoDataProvider } from "../providers/types.js";
import { round } from "../util/text.js";

/**
 * Off-page plan: split into what the engine/Claude does by itself and what a
 * person must do. Prospecting follows Ahrefs "Link Intersect" / Semrush "Backlink
 * Gap": sites linking to 2+ competitors but not to us are the warmest prospects.
 */

export interface LinkProspect {
  domain: string;
  authority: number | null;
  linksToCompetitors: string[];
  /** Suggested angle for outreach. */
  angle: string;
}

export interface OffpageTask {
  task: string;
  owner: "AI" | "Human" | "AI + Human";
  cadence: string;
  how: string;
}

export interface OffpagePlan {
  generatedAt: string;
  domain: string;
  ourAuthority: number | null;
  ourReferringDomains: number | null;
  competitors: { domain: string; referringDomains: number }[];
  /** New referring domains per month needed to hit the priority keywords in ~6 months. */
  recommendedLinksPerMonth: number;
  prospects: LinkProspect[];
  searchQueries: { purpose: string; query: string }[];
  aiTasks: OffpageTask[];
  humanTasks: OffpageTask[];
  first4Weeks: { week: number; ai: string[]; human: string[] }[];
  notes: string[];
}

function angleFor(domain: string, count: number): string {
  if (/news|times|post|journal|magazine|media|press/.test(domain)) return "Digital PR: offer an original data point or expert quote";
  if (/blog|medium|substack/.test(domain)) return "Guest article or expert contribution";
  if (/directory|list|top|best|clutch|goodfirms|designrush|sortlist/.test(domain)) return "Get listed / reviewed (agency directory)";
  if (/\.edu|\.gov|\.ac\./.test(domain)) return "Resource page: offer a genuinely useful free guide/tool";
  if (count >= 3) return "Links to all competitors — likely a roundup/resource list; ask to be included";
  return "Relationship: comment, share, then pitch a relevant resource";
}

export async function buildOffpagePlan(project: Project, keywords: KeywordReport | null, provider: SeoDataProvider | null, opts: { months?: number; onStep?: (s: string) => void } = {}): Promise<OffpagePlan> {
  const step = opts.onStep ?? (() => {});
  const notes: string[] = [];
  const competitors = (keywords?.competitors.length ? keywords.competitors : project.competitors ?? []).slice(0, 4);
  const compRd: { domain: string; referringDomains: number }[] = [];
  const prospects: LinkProspect[] = [];

  if (provider) {
    try {
      step("Reading our referring domains");
      const ours = new Set((await provider.referringDomains(project.domain, 1000)).map((r) => r.domain));
      const byDomain = new Map<string, { rd: ReferringDomain; comps: string[] }>();
      for (const c of competitors) {
        step(`Reading backlinks of ${c}`);
        const list = await provider.referringDomains(c, 500);
        compRd.push({ domain: c, referringDomains: list.length });
        for (const r of list) {
          if (ours.has(r.domain) || r.domain === project.domain || competitors.includes(r.domain)) continue;
          const e = byDomain.get(r.domain) ?? { rd: r, comps: [] };
          e.comps.push(c);
          byDomain.set(r.domain, e);
        }
      }
      const minOverlap = competitors.length >= 2 ? 2 : 1;
      for (const [domain, e] of byDomain) {
        if (e.comps.length < minOverlap) continue;
        prospects.push({ domain, authority: e.rd.authority, linksToCompetitors: e.comps, angle: angleFor(domain, e.comps.length) });
      }
      prospects.sort((a, b) => b.linksToCompetitors.length - a.linksToCompetitors.length || (b.authority ?? 0) - (a.authority ?? 0));
    } catch (e) {
      notes.push(`Backlink gap unavailable: ${(e as Error).message}`);
    }
  } else {
    notes.push("No data provider configured — prospect list empty. Add DataForSEO credentials to compute the backlink gap.");
  }

  // Links/month: enough to close the median page-1 link gap of priority keywords within `months`.
  const months = opts.months ?? 6;
  const priority = (keywords?.keywords ?? []).filter((k) => k.bucket === "target-now" || k.bucket === "build-up").slice(0, 10);
  const gaps = priority.map((k) => k.serpMedianRd ?? 0).filter((x) => x > 0).sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 30;
  const recommendedLinksPerMonth = Math.max(4, Math.min(25, Math.ceil(medianGap / months)));

  const brand = project.business?.name ?? project.domain.split(".")[0]!;
  const topics = (keywords?.clusters ?? []).slice(0, 3).map((c) => c.head);
  const searchQueries = [
    { purpose: "Unlinked brand mentions (ask them to add a link)", query: `"${brand}" -site:${project.domain}` },
    ...topics.flatMap((t) => [
      { purpose: `Resource pages for "${t}"`, query: `intitle:resources "${t}"` },
      { purpose: `Roundups/listicles for "${t}"`, query: `"best ${t}" OR "top ${t}" 2026` },
      { purpose: `Guest-post openings for "${t}"`, query: `"${t}" "write for us" OR "guest post"` },
    ]),
    { purpose: "Journalist requests (answer with an expert quote)", query: "Qwoted / Featured.com / Help a B2B Writer requests in your niche" },
  ];

  const aiTasks: OffpageTask[] = [
    { task: "Backlink-gap prospect list", owner: "AI", cadence: "Monthly", how: "`seo offpage` — sites linking to 2+ competitors but not to you, scored by authority" },
    { task: "Find unlinked brand mentions", owner: "AI", cadence: "Weekly", how: "Claude runs the search queries above and lists pages mentioning the brand without a link" },
    { task: "Broken-link opportunities", owner: "AI", cadence: "Monthly", how: "`seo audit <prospect-url>` on prospects' resource pages; dead outbound links you can replace with your page" },
    { task: "Personalised outreach drafts", owner: "AI", cadence: "Per prospect", how: "Claude reads the prospect page and drafts a short, specific email (never sent automatically)" },
    { task: "Data-story / digital PR ideas", owner: "AI", cadence: "Quarterly", how: "Turn your own project data into 1–2 original stats journalists can cite (GEO bonus: statistics get cited by AI)" },
    { task: "Internal links from strong pages", owner: "AI", cadence: "Monthly", how: "`seo fix` adds contextual links from high-authority pages to pages you're pushing" },
    { task: "Track new/lost links", owner: "AI", cadence: "Monthly", how: "Re-run `seo offpage`; lost links from good domains get a recovery email draft" },
  ];
  const humanTasks: OffpageTask[] = [
    { task: "Approve the prospect list", owner: "Human", cadence: "Monthly, 20 min", how: "Remove spammy or irrelevant sites; never buy links" },
    { task: "Send outreach from a real mailbox", owner: "Human", cadence: `${Math.ceil((recommendedLinksPerMonth * 4) / 4)} emails/week`, how: "Edit each AI draft, send personally, follow up once after 5–7 days (expect ~10–25% reply rate)" },
    { task: "Expert quotes for journalists", owner: "AI + Human", cadence: "2–3/week", how: "AI finds requests and drafts; a named expert approves and sends under their own name" },
    { task: "Guest articles and podcasts", owner: "AI + Human", cadence: "1–2/month", how: "AI drafts from your interview notes; the named author edits and builds the relationship" },
    { task: "Directories & reviews", owner: "Human", cadence: "Once, then ongoing", how: "Clutch/GoodFirms/Google Business Profile listings need account verification and real client reviews" },
    { task: "Partnerships", owner: "Human", cadence: "Quarterly", how: "Tools you use, clients, and partners often link to case studies — ask them" },
  ];

  const first4Weeks = [
    { week: 1, ai: ["Build prospect list + unlinked-mention list", "Draft 10 outreach emails"], human: ["Approve prospects", "Create/claim directory profiles (Clutch, GoodFirms, GBP)"] },
    { week: 2, ai: ["Draft data-story outline from your project data", "Find 10 journalist requests"], human: ["Send 10 personalised emails", "Ask 3 happy clients for reviews"] },
    { week: 3, ai: ["Draft 10 more emails + follow-ups", "Draft 1 guest article from interview notes"], human: ["Follow up week-2 emails", "Answer 3 journalist requests"] },
    { week: 4, ai: ["Report: links won, replies, next targets"], human: ["Pitch the guest article", "Review results with the founder"] },
  ];

  return {
    generatedAt: new Date().toISOString(),
    domain: project.domain,
    ourAuthority: keywords?.ourAuthority ?? null,
    ourReferringDomains: keywords?.ourReferringDomains ?? null,
    competitors: compRd,
    recommendedLinksPerMonth: round(recommendedLinksPerMonth),
    prospects: prospects.slice(0, 100),
    searchQueries,
    aiTasks,
    humanTasks,
    first4Weeks,
    notes,
  };
}
