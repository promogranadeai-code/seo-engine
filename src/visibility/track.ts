import type { AiAnswer, AiEngine, SeoDataProvider } from "../providers/types.js";
import type { Project } from "../store.js";
import { round } from "../util/text.js";

/**
 * AI visibility tracking (GEO/AEO measurement): ask AI assistants the questions
 * buyers ask, then record whether the brand is mentioned, whether our site is
 * cited as a source, which competitors appear, and which sites get cited.
 * Answers vary by user and session, so treat results as trends over time.
 */

export const ENGINE_LABEL: Record<AiEngine, string> = {
  chat_gpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
};

export interface Entity {
  name: string;
  /** Words/phrases that count as a mention (case-insensitive, whole word). */
  aliases: string[];
  /** Domains whose citation counts as being cited. */
  domains: string[];
}

export interface PromptResult {
  prompt: string;
  engine: AiEngine;
  model: string;
  mentioned: boolean;
  cited: boolean;
  /** 1 = our brand is the first brand named in the answer. */
  mentionRank: number | null;
  competitorsMentioned: string[];
  citedDomains: string[];
  excerpt: string | null;
  error?: string;
}

export interface VisibilitySnapshot {
  takenAt: string;
  provider: string;
  brand: string;
  engines: AiEngine[];
  prompts: string[];
  results: PromptResult[];
  spentUsd: number;
}

export interface VisibilitySummary {
  byEngine: { engine: AiEngine; answers: number; mentionRate: number; citationRate: number; shareOfVoice: number }[];
  overall: { mentionRate: number; citationRate: number; shareOfVoice: number };
  competitorMentions: { name: string; mentions: number }[];
  /** Domains AI engines cite most — where to get mentioned (off-page targets). */
  topCitedDomains: { domain: string; citations: number }[];
  /** Prompts where a competitor showed up and we didn't — content/PR gaps. */
  gaps: { prompt: string; engine: AiEngine; competitors: string[] }[];
  wins: { prompt: string; engine: AiEngine; cited: boolean }[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** First index where any alias appears as a whole word (or -1). */
export function firstMention(text: string, aliases: string[]): number {
  let best = -1;
  for (const a of aliases) {
    if (!a.trim()) continue;
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(a)}(?=$|[^\\p{L}\\p{N}])`, "iu").exec(text);
    const at = m ? m.index + m[1]!.length : -1; // skip the boundary character
    if (at >= 0 && (best === -1 || at < best)) best = at;
  }
  return best;
}

export function brandEntity(project: Project): Entity {
  const name = project.business?.name ?? project.domain.split(".")[0]!;
  return { name, aliases: [...new Set([name, project.domain, ...(project.business?.aliases ?? [])])], domains: [project.domain] };
}

export function competitorEntities(project: Project): Entity[] {
  return (project.competitors ?? []).map((d) => {
    const domain = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const base = domain.split(".")[0]!;
    return { name: domain, aliases: [domain, base.replace(/-/g, " ")], domains: [domain] };
  });
}

export function analyseAnswer(answer: AiAnswer, brand: Entity, competitors: Entity[]): PromptResult {
  const citedDomains = [...new Set(answer.citations.map((c) => hostOf(c.url)).filter(Boolean))];
  const isCited = (e: Entity) => citedDomains.some((d) => e.domains.some((ed) => d === ed || d.endsWith(`.${ed}`)));
  const positions = [brand, ...competitors]
    .map((e) => ({ e, at: firstMention(answer.text, e.aliases) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  const ourAt = positions.findIndex((p) => p.e === brand);
  const mentioned = ourAt >= 0;
  const where = mentioned ? positions[ourAt]!.at : -1;
  return {
    prompt: answer.prompt,
    engine: answer.engine,
    model: answer.model,
    mentioned,
    cited: isCited(brand),
    mentionRank: mentioned ? ourAt + 1 : null,
    competitorsMentioned: competitors.filter((c) => firstMention(answer.text, c.aliases) >= 0 || isCited(c)).map((c) => c.name),
    citedDomains,
    excerpt: mentioned ? answer.text.slice(Math.max(0, where - 120), where + 220).replace(/\s+/g, " ").trim() : null,
  };
}

export async function runVisibility(
  project: Project,
  provider: SeoDataProvider,
  opts: { prompts: string[]; engines: AiEngine[]; countryIso?: string; maxCalls: number; onStep?: (s: string) => void },
): Promise<VisibilitySnapshot> {
  if (!provider.aiAnswer) throw new Error(`Provider "${provider.name}" can't query AI engines.`);
  const calls = opts.prompts.length * opts.engines.length;
  if (calls > opts.maxCalls) throw new Error(`${calls} calls planned (${opts.prompts.length} prompts × ${opts.engines.length} engines) exceeds --max-calls ${opts.maxCalls}. Raise it or trim the prompt list.`);
  const brand = brandEntity(project);
  const competitors = competitorEntities(project);
  const results: PromptResult[] = [];
  for (const prompt of opts.prompts) {
    for (const engine of opts.engines) {
      opts.onStep?.(`${ENGINE_LABEL[engine]}: ${prompt}`);
      try {
        const answer = await provider.aiAnswer(engine, prompt, { countryIso: opts.countryIso });
        results.push(analyseAnswer(answer, brand, competitors));
      } catch (e) {
        results.push({ prompt, engine, model: "", mentioned: false, cited: false, mentionRank: null, competitorsMentioned: [], citedDomains: [], excerpt: null, error: (e as Error).message });
      }
    }
  }
  return { takenAt: new Date().toISOString(), provider: provider.name, brand: brand.name, engines: opts.engines, prompts: opts.prompts, results, spentUsd: provider.spentUsd() };
}

export function summarise(snap: VisibilitySnapshot): VisibilitySummary {
  const ok = snap.results.filter((r) => !r.error);
  const rate = (rs: PromptResult[], f: (r: PromptResult) => boolean) => (rs.length ? round((100 * rs.filter(f).length) / rs.length) : 0);
  const sov = (rs: PromptResult[]) => {
    const ours = rs.filter((r) => r.mentioned).length;
    const theirs = rs.reduce((a, r) => a + r.competitorsMentioned.length, 0);
    return ours + theirs ? round((100 * ours) / (ours + theirs)) : 0;
  };
  const byEngine = snap.engines.map((engine) => {
    const rs = ok.filter((r) => r.engine === engine);
    return { engine, answers: rs.length, mentionRate: rate(rs, (r) => r.mentioned), citationRate: rate(rs, (r) => r.cited), shareOfVoice: sov(rs) };
  });
  const comp = new Map<string, number>();
  for (const r of ok) for (const c of r.competitorsMentioned) comp.set(c, (comp.get(c) ?? 0) + 1);
  const cited = new Map<string, number>();
  for (const r of ok) for (const d of r.citedDomains) cited.set(d, (cited.get(d) ?? 0) + 1);
  return {
    byEngine,
    overall: { mentionRate: rate(ok, (r) => r.mentioned), citationRate: rate(ok, (r) => r.cited), shareOfVoice: sov(ok) },
    competitorMentions: [...comp.entries()].map(([name, mentions]) => ({ name, mentions })).sort((a, b) => b.mentions - a.mentions),
    topCitedDomains: [...cited.entries()].map(([domain, citations]) => ({ domain, citations })).sort((a, b) => b.citations - a.citations).slice(0, 25),
    gaps: ok.filter((r) => !r.mentioned && r.competitorsMentioned.length).map((r) => ({ prompt: r.prompt, engine: r.engine, competitors: r.competitorsMentioned })),
    wins: ok.filter((r) => r.mentioned).map((r) => ({ prompt: r.prompt, engine: r.engine, cited: r.cited })),
  };
}

/** Starter prompt list: real buyer questions + "who should I hire" style prompts per service. */
export function starterPrompts(project: Project, minedQuestions: string[] = [], max = 15): string[] {
  const where = project.business?.location ? ` in ${project.business.location}` : "";
  const services = (project.business?.services ?? []).slice(0, 6);
  const hire = services.map((s) => `Which agency should I hire for ${s.toLowerCase()}${where}?`);
  const best = services.slice(0, 3).map((s) => `What are the best ${s.toLowerCase()} companies${where}?`);
  const out = [...new Set([...hire, ...best, ...minedQuestions])];
  return out.slice(0, max);
}
