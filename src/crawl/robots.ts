/** robots.txt parsing — enough for crawl politeness and AI-crawler (GEO) checks. */

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

export interface Robots {
  raw: string;
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(raw: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow") current.allow.push(value);
    if (key === "disallow") current.disallow.push(value);
  }
  return { raw, groups, sitemaps };
}

function groupFor(robots: Robots, agent: string): RobotsGroup | null {
  const a = agent.toLowerCase();
  return (
    robots.groups.find((g) => g.agents.includes(a)) ??
    robots.groups.find((g) => g.agents.some((x) => x !== "*" && a.startsWith(x))) ??
    robots.groups.find((g) => g.agents.includes("*")) ??
    null
  );
}

function ruleMatches(rule: string, path: string): boolean {
  if (!rule) return false;
  const anchored = rule.endsWith("$");
  const pattern = rule
    .replace(/\$$/, "")
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + pattern + (anchored ? "$" : "")).test(path);
}

/** Longest-match-wins, allow beats disallow on ties (Google's behaviour). */
export function isAllowed(robots: Robots | null, agent: string, path: string): boolean {
  if (!robots) return true;
  const g = groupFor(robots, agent);
  if (!g) return true;
  let best = { len: -1, allow: true };
  for (const r of g.allow) if (ruleMatches(r, path) && r.length >= best.len) best = { len: r.length, allow: true };
  for (const r of g.disallow) if (ruleMatches(r, path) && r.length > best.len) best = { len: r.length, allow: false };
  return best.allow;
}

/** Crawlers that feed AI answers. Blocking them hurts GEO/AEO visibility. */
export const AI_CRAWLERS = [
  { agent: "GPTBot", owner: "OpenAI (training)" },
  { agent: "OAI-SearchBot", owner: "OpenAI (ChatGPT search)" },
  { agent: "ChatGPT-User", owner: "OpenAI (live browsing)" },
  { agent: "ClaudeBot", owner: "Anthropic" },
  { agent: "Claude-SearchBot", owner: "Anthropic (search)" },
  { agent: "PerplexityBot", owner: "Perplexity" },
  { agent: "Google-Extended", owner: "Google Gemini / AI" },
  { agent: "Applebot-Extended", owner: "Apple Intelligence" },
  { agent: "Bingbot", owner: "Microsoft Bing / Copilot" },
];
