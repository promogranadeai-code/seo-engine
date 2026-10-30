import { describe, expect, it } from "vitest";
import { clusterKeywords } from "../src/keywords/cluster.js";
import { ctrAt, guessIntent, kdForRd, kdLabel, keywordDifficulty, rankability, rdForKd } from "../src/keywords/metrics.js";
import { researchKeywords } from "../src/keywords/research.js";
import { buildOffpagePlan } from "../src/offpage/plan.js";
import { FixtureProvider } from "../src/providers/fixture.js";
import { buildRoadmap, estimateTimeline } from "../src/timeline/estimate.js";
import type { Project } from "../src/store.js";

const fixture = FixtureProvider.fromFile("test/fixtures/demo-promogranade.json");
const project: Project = {
  slug: "promogranade-com",
  url: "https://promogranade.com/",
  domain: "promogranade.com",
  market: "in",
  createdAt: "",
  business: {
    name: "Promogranade",
    summary: "Next.js and WordPress web development, custom applications, AI agents, workflow automation, generative engine optimization (GEO), answer engine optimization and ads.",
    services: ["Website Development", "Custom Applications", "AI Agent Development", "Workflow Automation", "SEO GEO AEO", "Meta & Google Ads", "Custom AI Systems"],
  },
};

describe("metrics (published Ahrefs/Semrush methodology)", () => {
  it("KD ↔ referring domains matches the Ahrefs table and round-trips", () => {
    expect(rdForKd(10)).toBeCloseTo(10);
    expect(rdForKd(50)).toBeCloseTo(84);
    expect(rdForKd(90)).toBeCloseTo(756);
    for (const kd of [5, 25, 45, 65, 85]) expect(kdForRd(rdForKd(kd))).toBeCloseTo(kd, 5);
  });
  it("our KD rises with competitors' links and ignores outliers", () => {
    const easy = keywordDifficulty([3, 2, 5, 1, 0, 4, 2, 3, 1, 2])!;
    const hard = keywordDifficulty([400, 350, 300, 280, 250, 220, 200, 180, 150, 120])!;
    expect(easy).toBeLessThan(15);
    expect(hard).toBeGreaterThan(70);
    expect(keywordDifficulty([10, 10, 10, 10, 10, 10, 10, 10, 10, 5000])!).toBeLessThan(15);
    expect(keywordDifficulty([1, 2])).toBeNull();
  });
  it("uses Semrush KD% bands", () => {
    expect([kdLabel(10), kdLabel(20), kdLabel(40), kdLabel(60), kdLabel(80), kdLabel(90)]).toEqual(["very easy", "easy", "possible", "difficult", "hard", "very hard"]);
  });
  it("CTR curve falls with position and AI Overviews cut clicks", () => {
    expect(ctrAt(1)).toBeGreaterThan(ctrAt(3));
    expect(ctrAt(1, { aiOverview: true })).toBeLessThan(ctrAt(1) * 0.5);
    expect(ctrAt(25)).toBe(0);
  });
  it("rankability: weaker site / harder keyword → lower; already ranking → higher", () => {
    const base = { kd: 40, serpMedianRd: 60, serpMedianAuthority: null, ourAuthority: 20, relevance: 0.8, currentPosition: null };
    const weak = rankability({ ...base, ourReferringDomains: 5 }).score;
    const strong = rankability({ ...base, ourReferringDomains: 200 }).score;
    const ranking = rankability({ ...base, ourReferringDomains: 5, currentPosition: 12 }).score;
    expect(strong).toBeGreaterThan(weak);
    expect(ranking).toBeGreaterThan(weak);
  });
  it("guesses intent from wording", () => {
    expect(guessIntent("nextjs agency pricing")).toBe("transactional");
    expect(guessIntent("best crm vs hubspot")).toBe("commercial");
    expect(guessIntent("what is rag")).toBe("informational");
    expect(guessIntent("promogranade contact", ["promogranade"])).toBe("navigational");
  });
});

describe("clustering", () => {
  it("groups by SERP overlap when available, lexically otherwise", () => {
    const urls = (n: number, off = 0) => Array.from({ length: 10 }, (_, i) => `u${i + off}`).slice(0, n);
    const c = clusterKeywords([
      { keyword: "nextjs agency", volume: 500, serpUrls: urls(10) },
      { keyword: "next js development company", volume: 300, serpUrls: urls(10, 2) },
      { keyword: "rag pipeline", volume: 200, serpUrls: urls(10, 50) },
    ]);
    expect(c[0]!.members.map((m) => m.keyword)).toEqual(["nextjs agency", "next js development company"]);
    expect(c[0]!.method).toBe("serp-overlap");
    const lex = clusterKeywords([{ keyword: "seo audit tool", volume: 10 }, { keyword: "seo audit tools free", volume: 5 }]);
    expect(lex).toHaveLength(1);
  });
});

describe("researchKeywords (DEMO fixture)", async () => {
  const report = await researchKeywords(project, null, fixture, { market: { locationCode: 2356, languageCode: "en" }, marketCode: "in" });
  const get = (k: string) => report.keywords.find((x) => x.keyword === k)!;
  it("buckets keywords sensibly for a low-authority site", () => {
    expect(get("next.js vs wordpress").bucket).toBe("quick-win"); // ranking #14
    expect(get("n8n automation services").bucket).toBe("target-now"); // easy, relevant
    expect(get("seo agency").bucket).toBe("long-term"); // KD 78 vs 22 referring domains
    expect(get("pizza near me").bucket).toBe("off-topic");
  });
  it("computes KD from SERP links when it has them", () => {
    expect(get("generative engine optimization").kdSource).toBe("serp-rd");
    expect(get("generative engine optimization").aiOverview).toBe(true);
    expect(get("seo agency").kdSource).toBe("provider");
  });
  it("pulls competitor gap keywords, clusters, and People-also-ask questions", () => {
    expect(get("workflow automation agency").sources).toContain("gap:rival-studio.example");
    expect(report.clusters.length).toBeGreaterThan(5);
    expect(report.questions.map((q) => q.question)).toContain("What is generative engine optimization?");
    expect(report.provider).toContain("DEMO");
  });

  it("timeline: already page 1 = 0, harder = longer, faster links = sooner", () => {
    const t = (k: string, pace = 8, goal: "top10" | "top3" = "top10") => estimateTimeline({ keyword: get(k), ourAuthority: report.ourAuthority, linksPerMonth: pace, goal, needsNewPage: true });
    expect(t("what is answer engine optimization").months.expected).toBe(0);
    expect(t("what is answer engine optimization").linkGap).toBe(0);
    expect(t("seo agency").months.expected).toBeGreaterThan(t("n8n automation services").months.expected);
    expect(t("meta ads vs google ads", 15).months.expected).toBeLessThanOrEqual(t("meta ads vs google ads", 4).months.expected);
    expect(t("ai agent development company", 8, "top3").months.expected).toBeGreaterThanOrEqual(t("ai agent development company").months.expected);
    const roadmap = buildRoadmap([t("n8n automation services")]);
    expect(roadmap).toHaveLength(12);
    expect(roadmap.some((m) => m.expectedWins.length)).toBe(true);
  });

  it("off-page: prospects link to 2+ competitors and not to us", async () => {
    const plan = await buildOffpagePlan(project, report, fixture);
    expect(plan.prospects.map((p) => p.domain).sort()).toEqual(["devdirectory.example", "techblog.example"]);
    expect(plan.aiTasks.length).toBeGreaterThan(3);
    expect(plan.humanTasks.some((t) => t.owner === "Human")).toBe(true);
    expect(plan.recommendedLinksPerMonth).toBeGreaterThanOrEqual(4);
  });
});
