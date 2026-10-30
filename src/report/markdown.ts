import type { AuditResult } from "../audit/audit.js";
import type { KeywordReport } from "../keywords/research.js";
import type { OffpagePlan } from "../offpage/plan.js";
import type { TagRecommendation } from "../tags/recommend.js";
import type { RoadmapMonth, TimelineEstimate } from "../timeline/estimate.js";
import type { MinedQuestion } from "../content/questions.js";
import type { LintResult } from "../content/lint.js";
import type { AeoResult } from "../content/aeo.js";

const esc = (s: string | number | null | undefined) => String(s ?? "—").replace(/\|/g, "\\|");
const table = (head: string[], rows: (string | number | null | undefined)[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");

export function auditMarkdown(a: AuditResult): string {
  const out = [
    `# Technical SEO audit — ${a.site}`,
    "",
    `Crawled ${a.pagesCrawled} pages on ${a.auditedAt.slice(0, 10)}. **Health score: ${a.healthScore}/100** (share of pages with no errors).`,
    "",
    `Errors: ${a.counts.error} · Warnings: ${a.counts.warning} · Notices: ${a.counts.notice}`,
    "",
    "## Issues (most important first)",
    "",
  ];
  for (const i of a.issues) {
    out.push(`### ${i.severity === "error" ? "🔴" : i.severity === "warning" ? "🟠" : "🔵"} ${i.title} — ${i.urls.length}`, "");
    out.push(`- **Why it matters:** ${i.why}`, `- **Fix:** ${i.fix}`, `- **Auto-fix recipe:** \`${i.recipe}\``, "");
    for (const u of i.urls.slice(0, 15)) out.push(`  - ${u}`);
    if (i.urls.length > 15) out.push(`  - …and ${i.urls.length - 15} more (see audit.json)`);
    out.push("");
  }
  return out.join("\n");
}

export function tagsMarkdown(recs: TagRecommendation[]): string {
  const out = ["# Recommended tags per page", "", "Apply with `/seo-fix` in Claude Code, or copy the snippets. Only pages with changes are listed.", ""];
  for (const r of recs.filter((r) => r.changes.length)) {
    out.push(`## ${new URL(r.url).pathname} (${r.pageType}${r.primaryKeyword ? `, keyword: "${r.primaryKeyword}"` : ""})`, "");
    for (const c of r.changes) out.push(`- ${c}`);
    out.push("", "<details><summary>Next.js metadata + JSON-LD</summary>", "", "```ts", r.nextMetadata, "```", "", "```json", JSON.stringify(r.recommended.jsonLd, null, 2), "```", "", "</details>", "");
  }
  return out.join("\n");
}

const BUCKET_TITLE: Record<string, string> = {
  "quick-win": "Quick wins — already ranking 4–20, push to the top",
  "target-now": "Target now — realistic for this site today",
  "build-up": "Build up — reachable in 3–9 months with content + links",
  "long-term": "Long-term — needs serious authority first",
  "off-topic": "Off-topic — not worth it for this business",
};

export function keywordsMarkdown(r: KeywordReport): string {
  const demo = r.provider.includes("DEMO") ? "\n> ⚠️ **DEMO DATA** — generated from a fixture file, not live Google data.\n" : "";
  const out = [
    `# Keyword opportunities — ${r.domain} (${r.market.toUpperCase()})`,
    demo,
    `Site authority: **${r.ourAuthority ?? "?"}**/100 · referring domains: **${r.ourReferringDomains ?? "?"}** · data: ${r.provider} · cost: $${r.spentUsd}`,
    "",
    `Seeds: ${r.seeds.join(", ")}${r.competitors.length ? ` · Competitors: ${r.competitors.join(", ")}` : ""}`,
    "",
    "**How to read this:** *KD* = how hard the keyword is overall (0–100). *Rankability* = how realistic page 1 is **for this site** (higher is easier). *Opportunity* = expected monthly value if you get there.",
    "",
  ];
  for (const b of ["quick-win", "target-now", "build-up", "long-term"]) {
    const ks = r.keywords.filter((k) => k.bucket === b).slice(0, 25);
    if (!ks.length) continue;
    out.push(`## ${BUCKET_TITLE[b]}`, "");
    out.push(
      table(
        ["Keyword", "Volume", "KD", "Rankability", "Intent", "Now", "Clicks @#3", "Opportunity"],
        ks.map((k) => [k.keyword, k.volume, k.kd !== null ? `${k.kd} (${k.kdLabel})` : "?", k.rankability, k.intent, k.currentPosition ? `#${k.currentPosition}` : "—", k.clicksAtTop3 + (k.aiOverview ? " (AI Overview)" : ""), k.opportunity]),
      ),
      "",
    );
  }
  out.push("## Keyword → page plan", "", "One page per cluster. Optimise the existing page, or create the new one.", "");
  out.push(table(["Cluster (head term)", "Keywords", "Volume", "Best bucket", "Page"], r.clusters.slice(0, 30).map((c) => [c.head, c.keywords.length, c.totalVolume, c.bestBucket, c.isNewPage ? `NEW: ${c.targetPage}` : c.targetPage])));
  if (r.notes.length) out.push("", "## Notes", "", ...r.notes.map((n) => `- ${n}`));
  return out.join("\n");
}

export function timelineMarkdown(domain: string, estimates: TimelineEstimate[], roadmap: RoadmapMonth[], linksPerMonth: number): string {
  const out = [
    `# How long until ${domain} ranks?`,
    "",
    `Assumes the plan is executed: technical fixes, the pages from the keyword plan, and **${linksPerMonth} new referring domains per month**.`,
    "",
    "> Context: Ahrefs found only 1.74% of new pages reach Google's top 10 within a year (2025), and most top-10 pages are over 3 years old. Pages that do make it usually take 2–6 months. These ranges are estimates, not guarantees.",
    "",
    table(
      ["Keyword", "Goal", "Optimistic", "Expected", "Conservative", "Chance in 12 mo", "Links to earn", "Confidence"],
      estimates.map((e) => [e.keyword, e.goal === "top3" ? "Top 3" : "Page 1", `${e.months.optimistic} mo`, `**${e.months.expected} mo**`, `${e.months.conservative} mo`, `${Math.round(e.chanceIn12Months * 100)}%`, e.linkGap, e.confidence]),
    ),
    "",
    "## Why",
    "",
    ...estimates.flatMap((e) => [`**${e.keyword}** — ${e.drivers.join("; ")}`, ""]),
    "## Month-by-month roadmap",
    "",
  ];
  for (const m of roadmap) {
    out.push(`**Month ${m.month}** — ${m.focus.join("; ")}${m.expectedWins.length ? `\n  - 🎯 Expected: ${m.expectedWins.join(", ")}` : ""}`, "");
  }
  return out.join("\n");
}

export function offpageMarkdown(p: OffpagePlan): string {
  const out = [
    `# Off-page / backlink plan — ${p.domain}`,
    "",
    "**Backlinks in one paragraph:** when another reputable website links to yours, Google treats it as a vote of trust. The number of *different* sites linking to a page (referring domains) is the strongest predictor of how hard a keyword is. You earn links by being worth citing — useful pages, original data, expert quotes — and by asking the right sites. Never buy links; Google penalises it.",
    "",
    `Authority now: ${p.ourAuthority ?? "?"}/100, ${p.ourReferringDomains ?? "?"} referring domains. **Target pace: ${p.recommendedLinksPerMonth} new referring domains per month.**`,
    "",
    "## What the AI does by itself",
    "",
    table(["Task", "Cadence", "How"], p.aiTasks.map((t) => [t.task, t.cadence, t.how])),
    "",
    "## What a person must do",
    "",
    table(["Task", "Who", "Cadence", "How"], p.humanTasks.map((t) => [t.task, t.owner, t.cadence, t.how])),
    "",
    "## First four weeks",
    "",
    ...p.first4Weeks.flatMap((w) => [`**Week ${w.week}** — AI: ${w.ai.join("; ")} · Human: ${w.human.join("; ")}`, ""]),
    "## Prospects (sites linking to competitors, not to you)",
    "",
  ];
  if (p.prospects.length) out.push(table(["Domain", "Authority", "Links to", "Angle"], p.prospects.slice(0, 50).map((x) => [x.domain, x.authority, x.linksToCompetitors.join(", "), x.angle])));
  else out.push("_No prospects yet — needs a data provider and at least one competitor._");
  out.push("", "## Search queries to run (AI or human)", "", ...p.searchQueries.map((q) => `- **${q.purpose}:** \`${q.query}\``));
  if (p.notes.length) out.push("", "## Notes", "", ...p.notes.map((n) => `- ${n}`));
  return out.join("\n");
}

export function questionsMarkdown(domain: string, qs: MinedQuestion[]): string {
  return [
    `# Questions to answer — ${domain} (AEO/GEO)`,
    "",
    "Answer these in your own words (`seo interview`), then `seo write`. Questions already answered on the site are marked.",
    "",
    table(["#", "Question", "Volume", "Sources", "Already answered"], qs.slice(0, 80).map((q, i) => [i + 1, q.question, q.volume, q.sources.join(", "), q.answeredOn ? new URL(q.answeredOn).pathname : "—"])),
  ].join("\n");
}

export function lintMarkdown(file: string, lint: LintResult, aeo: AeoResult): string {
  return [
    `# Content check — ${file}`,
    "",
    `**Voice & quality: ${lint.score}/100** · **AEO: ${aeo.aeoScore}/100** · **GEO: ${aeo.geoScore}/100** · ${lint.words} words`,
    "",
    `Sentence-length variation ${lint.stats.sentenceLengthCv} (aim > 0.45) · first-hand markers ${lint.stats.firstHandMarkers} · specifics ${lint.stats.specificsPer100Words}/100 words · reading ease ${lint.stats.fleschReadingEase}`,
    "",
    "## Fix",
    "",
    ...(lint.findings.length ? lint.findings.map((f) => `- **${f.severity}** ${f.message}${f.examples.length ? ` — ${f.examples.slice(0, 8).join(", ")}` : ""}`) : ["- Nothing flagged."]),
    ...aeo.advice.map((a) => `- **aeo/geo** ${a}`),
  ].join("\n");
}
