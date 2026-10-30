import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { checkAeo } from "../src/content/aeo.js";
import { buildInterview, interviewHasAnswers } from "../src/content/interview.js";
import { lintText } from "../src/content/lint.js";
import { groupQuestions, mineQuestions } from "../src/content/questions.js";
import { buildBrief, passesBar, revisionNotes, writeArticle, writerSystemPrompt } from "../src/content/writer.js";
import type { Llm } from "../src/llm/claude.js";
import type { KeywordReport } from "../src/keywords/research.js";
import type { Project } from "../src/store.js";

const project: Project = { slug: "acme", url: "https://acme.test/", domain: "acme.test", market: "us", createdAt: "", business: { name: "Acme", summary: "Next.js studio", services: ["Website Development"] } };

const GENERIC = `In today's fast-paced digital landscape, businesses must navigate the complexities of web development. It's important to note that choosing a platform is crucial. Furthermore, a robust website can unlock the power of your brand. Moreover, it will streamline your operations. Additionally, it will empower your team. Ultimately, this comprehensive guide will help you delve into the topic. Each option has strengths and weaknesses. Each option has costs and benefits. Each option has risks and rewards. In conclusion, the right choice is pivotal.`;

const HUMAN = `We rebuilt a dental clinic's site last March. Bookings went from 41 a month to 97.

Why? Speed, mostly. The old WordPress theme loaded 3.8 MB of scripts. Our Next.js build ships 180 KB.

Not every site needs that. If you publish two blog posts a year and your traffic is flat, keep WordPress and fix the hosting first — it costs maybe $20 a month more and you're done.

One client pushed back on the price, which was $6,500 for twelve pages. Fair. We showed them the booking numbers from the clinic, and they signed the next week. I'd still tell a friend to start smaller.`;

describe("voice linter", () => {
  it("scores stock, monotone copy far below specific first-hand copy", () => {
    const g = lintText(GENERIC);
    const h = lintText(HUMAN);
    expect(g.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["stock-phrases", "repeated-openers"]));
    expect(h.findings.map((f) => f.rule)).not.toContain("stock-phrases");
    expect(h.score).toBeGreaterThan(g.score + 20);
    expect(h.stats.firstHandMarkers).toBeGreaterThan(3);
  });
  it("flags unresolved [NEEDS DATA] markers", () => {
    expect(lintText("We charge [NEEDS DATA: price range] for this.").findings.some((f) => f.rule === "needs-data")).toBe(true);
  });
});

describe("AEO/GEO check", () => {
  it("rewards question headings with direct answers, stats and quotes", () => {
    const good = `# Next.js cost\n\n## How much does a Next.js website cost?\n\nMost small business sites we build cost between $4,000 and $9,000 and take 4 to 6 weeks. The range depends on page count, integrations and whether you need a CMS, which adds about 15% to the build.\n\n> "Clients overspend on design and underspend on content." — Priya, Lead Developer\n\nNext.js is a React framework for building fast websites. See the [docs](https://nextjs.org/docs).\n\n## How long does it take?\n\nTypically 4 to 6 weeks for 10 to 15 pages, assuming content is ready on day one and feedback rounds take under 3 days each. Content delays are the most common reason projects slip.`;
    const bad = `# Cost\n\n## How much does it cost?\n\nIt depends.\n`;
    const g = checkAeo(good);
    const b = checkAeo(bad);
    expect(g.questions.every((q) => q.directAnswer)).toBe(true);
    expect(g.aeoScore).toBeGreaterThan(b.aeoScore);
    expect(g.geoScore).toBeGreaterThan(b.geoScore);
    expect(b.advice.length).toBeGreaterThan(2);
  });
});

/** Fake LLM: returns queued outputs, records prompts. */
class FakeLlm implements Llm {
  prompts: string[] = [];
  constructor(private texts: string[], private jsonOut: unknown = { questions: [] }) {}
  async text(_s: string, user: string) {
    this.prompts.push(user);
    return this.texts.shift() ?? "";
  }
  async json<T>(_s: string, user: string, _schema: z.ZodType<T>) {
    this.prompts.push(user);
    return this.jsonOut as T;
  }
}

describe("questions + interview", () => {
  it("dedupes questions across sources and marks ones the site answers", async () => {
    const kw = { questions: [{ question: "How much does a website cost?", keyword: "website cost" }], keywords: [{ keyword: "how much does a website cost", volume: 900, bucket: "target-now" }] } as unknown as KeywordReport;
    const crawl = { pages: [{ finalUrl: "https://acme.test/pricing", questionHeadings: ["How much does a website cost?"] }] } as never;
    const llm = new FakeLlm([], { questions: ["Can you work with our existing WordPress site?", "How much does a website cost"] });
    const qs = await mineQuestions(project, kw, crawl, llm);
    const cost = qs.find((q) => /cost/i.test(q.question))!;
    expect(qs.filter((q) => /cost/i.test(q.question))).toHaveLength(1);
    expect(cost.sources.length).toBeGreaterThanOrEqual(2);
    expect(cost.answeredOn).toBe("https://acme.test/pricing");
    expect(groupQuestions(qs).length).toBeGreaterThan(0);
  });
  it("interview template only counts as answered once filled in", async () => {
    const md = await buildInterview(project, "website cost", ["How much does a website cost?"], null);
    expect(md).toContain("## Q1.");
    expect(interviewHasAnswers(md)).toBe(false);
    const filled = md.replace(/Answer:\n\n/g, "Answer:\nWe usually quote between four and nine thousand dollars for this kind of work.\n\n");
    expect(interviewHasAnswers(filled)).toBe(true);
  });
});

describe("writer", () => {
  it("forbids invented facts and revises until the draft passes", async () => {
    expect(writerSystemPrompt(project)).toContain("[NEEDS DATA");
    const goodDraft = `---\ntitle: Next.js website cost\n---\n# How much a Next.js website costs\n\n${HUMAN}\n\n## How much does a Next.js website cost?\n\nFor a twelve-page business site we usually quote between $4,000 and $9,000, and the build takes 4 to 6 weeks once content is ready. A CMS adds roughly 15% because of the extra setup and training time.\n\n## How long does a build take?\n\nAbout 4 to 6 weeks for most of our builds, depending mainly on how quickly content and feedback arrive from the client side each round.`;
    const llm = new FakeLlm([GENERIC, goodDraft]);
    const res = await writeArticle(llm, { project, topic: "website cost", primaryKeyword: "next.js website cost", questions: ["How much does a Next.js website cost?"], interview: "Q: cost? A: $4k–$9k", knowledge: "" });
    expect(res.revisions).toBe(1);
    expect(llm.prompts[1]).toContain("stock phrase");
    expect(res.lint.score).toBeGreaterThan(70);
    expect(res.aeo.questions.length).toBe(2);
  });
});

describe("Claude Code mode (no API key)", () => {
  const input = { project, topic: "website cost", primaryKeyword: "next.js website cost", questions: ["How much does a Next.js website cost?"], interview: "Q: cost? A: $4k–$9k", knowledge: "Pricing sheet 2026" };
  it("brief is self-contained: rules, inputs, save path and check command", () => {
    const brief = buildBrief(input, "data/projects/acme/drafts/website-cost.md");
    expect(brief).toContain("data/projects/acme/drafts/website-cost.md");
    expect(brief).toContain("npm run seo -- check acme --topic \"website cost\"");
    expect(brief).toContain("[NEEDS DATA");
    expect(brief).toContain("Q: cost? A: $4k–$9k");
    expect(brief).toContain("Pricing sheet 2026");
  });
  it("check gives actionable notes until the draft passes", () => {
    const weak = `# Cost\n\n## How much does it cost?\n\nIt depends.\n`;
    expect(passesBar(lintText(weak), checkAeo(weak))).toBe(false);
    expect(revisionNotes(lintText(weak), checkAeo(weak)).join("\n")).toMatch(/direct|question/i);
  });
  it("hand-added buyer questions are merged with mined ones", async () => {
    const qs = await mineQuestions(project, null, null, null, ["Can you migrate our WordPress site?", "can you migrate our wordpress site"]);
    expect(qs).toHaveLength(1);
    expect(qs[0]!.sources).toEqual(["buyer-questions"]);
  });
});
