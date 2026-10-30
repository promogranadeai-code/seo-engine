import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../src/providers/fixture.js";
import type { Project } from "../src/store.js";
import { analyseAnswer, brandEntity, competitorEntities, firstMention, runVisibility, starterPrompts, summarise } from "../src/visibility/track.js";

const project: Project = {
  slug: "promogranade-com",
  url: "https://promogranade.com/",
  domain: "promogranade.com",
  market: "in",
  createdAt: "",
  business: { name: "Promogranade", aliases: ["Pomogranade"], services: ["AI Agent Development", "Workflow Automation"], location: "India" },
  competitors: ["rival-studio.example", "other-agency.example"],
};

const Q1 = "Which agency should I hire for ai agent development in India?";
const Q2 = "Which agency should I hire for workflow automation in India?";

const fixture = new FixtureProvider({
  keywords: [], serps: {}, domains: {}, ranked: {}, competitors: {}, referringDomainCounts: {}, referringDomains: {},
  aiAnswers: {
    [`chat_gpt|${Q1}`]: {
      text: "Good options include Rival Studio, known for agents, and Promogranade, which built an AI outreach system for ETRL.",
      citations: [{ url: "https://www.promogranade.com/services/ai-agents", title: "AI agents" }, { url: "https://clutch.co/agencies/ai", title: "Clutch" }],
    },
    [`perplexity|${Q1}`]: { text: "Pomogranade is a studio that builds AI agents.", citations: [{ url: "https://clutch.co/x", title: null }] },
    [`chat_gpt|${Q2}`]: { text: "Consider Other Agency or rival-studio.example for automation work.", citations: [{ url: "https://rival-studio.example/automation", title: null }] },
    [`perplexity|${Q2}`]: { text: "Many freelancers on Upwork do this.", citations: [] },
  },
});

describe("mention detection", () => {
  it("matches whole words and domains only", () => {
    expect(firstMention("We like Promogranade.", ["Promogranade"])).toBe(8);
    expect(firstMention("see promogranade.com", ["promogranade.com"])).toBe(4);
    expect(firstMention("Promogranadex is different", ["Promogranade"])).toBe(-1);
    expect(firstMention("nothing here", ["Promogranade"])).toBe(-1);
  });

  it("finds brand, competitors, citation and rank", () => {
    const r = analyseAnswer(
      { engine: "chat_gpt", model: "m", prompt: Q1, text: "Rival Studio first, then Promogranade.", citations: [{ url: "https://promogranade.com/x", title: null }] },
      brandEntity(project),
      competitorEntities(project),
    );
    expect(r.mentioned).toBe(true);
    expect(r.cited).toBe(true);
    expect(r.mentionRank).toBe(2);
    expect(r.competitorsMentioned).toEqual(["rival-studio.example"]);
    expect(r.excerpt).toContain("Promogranade");
  });
});

describe("runVisibility + summarise (DEMO fixture)", () => {
  it("computes mention/citation rates, share of voice, gaps and cited domains", async () => {
    const snap = await runVisibility(project, fixture, { prompts: [Q1, Q2], engines: ["chat_gpt", "perplexity"], maxCalls: 10 });
    expect(snap.results).toHaveLength(4);
    const s = summarise(snap);
    expect(s.overall.mentionRate).toBe(50); // Q1 on both engines (incl. the "Pomogranade" alias)
    expect(s.overall.citationRate).toBe(25); // only ChatGPT Q1 cited our site
    expect(s.byEngine.find((e) => e.engine === "chat_gpt")!.mentionRate).toBe(50);
    expect(s.gaps).toEqual([{ prompt: Q2, engine: "chat_gpt", competitors: ["rival-studio.example", "other-agency.example"] }]);
    expect(s.topCitedDomains[0]).toEqual({ domain: "clutch.co", citations: 2 });
    expect(s.overall.shareOfVoice).toBe(40); // 2 of 5 brand mentions are ours
  });

  it("refuses to exceed the paid-call cap", async () => {
    await expect(runVisibility(project, fixture, { prompts: [Q1, Q2], engines: ["chat_gpt", "perplexity"], maxCalls: 3 })).rejects.toThrow(/max-calls/);
  });

  it("builds starter prompts from services, location and mined questions", () => {
    const p = starterPrompts(project, ["How much does an AI agent cost?"]);
    expect(p).toContain(Q1);
    expect(p).toContain("How much does an AI agent cost?");
  });
});
