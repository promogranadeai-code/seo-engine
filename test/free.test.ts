import { describe, expect, it } from "vitest";
import { FreeProvider, parsePlannerCsv, plannerVolume } from "../src/providers/free.js";

const IN = { locationCode: 2356, languageCode: "en" };

describe("Keyword Planner import", () => {
  it("reads ranges and exact numbers", () => {
    expect(plannerVolume("1K – 10K")).toBe(3162);
    expect(plannerVolume("10 – 100")).toBe(32);
    expect(plannerVolume("1,300")).toBe(1300);
    expect(plannerVolume("")).toBeNull();
  });

  it("parses the UTF-16 tab-separated export with title lines", () => {
    const text = [
      "Keyword Stats 2026-10-30 at 10_00_00",
      "All locations",
      "Keyword\tCurrency\tAvg. monthly searches\tThree month change\tYoY change\tCompetition\tCompetition (indexed value)\tTop of page bid (low range)\tTop of page bid (high range)",
      "website development company\tINR\t1K – 10K\t0%\t0%\tHigh\t78\t40.5\t210.25",
      "promogranade\tINR\t10 – 100\t\t\tLow\t2\t\t",
    ].join("\r\n");
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const rows = parsePlannerCsv(buf);
    expect(rows.get("website development company")).toEqual({ volume: 3162, competition: 0.78, cpc: 125.375 });
    expect(rows.get("promogranade")).toEqual({ volume: 32, competition: 0.02, cpc: null });
  });
});

describe("FreeProvider (Google Autocomplete)", () => {
  it("expands seeds and scores demand by suggestion order", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      const q = new URL(url).searchParams.get("q")!;
      calls.push(q);
      const list = q.startsWith("how") ? ["how to build a website for business"] : ["website development company", "website development cost"];
      return new Response(JSON.stringify([q, list]));
    }) as unknown as typeof fetch;
    const p = new FreeProvider("in", { fetchFn, delayMs: 0, letters: false });
    const ideas = await p.keywordIdeas(["website development"], IN, 50);
    expect(calls).toContain("website development cost");
    expect(calls.every((q) => q.length > 0)).toBe(true);
    const top = ideas.find((k) => k.keyword === "website development company")!;
    const second = ideas.find((k) => k.keyword === "website development cost")!;
    expect(top.volume).toBeNull();
    expect(top.demand!).toBeGreaterThan(second.demand!);
    expect(ideas.some((k) => k.keyword.startsWith("how to"))).toBe(true);
  });
});
