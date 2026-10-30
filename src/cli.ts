#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { auditCrawl, type AuditResult } from "./audit/audit.js";
import { loadDotEnv, market, MARKETS } from "./config.js";
import { checkAeo } from "./content/aeo.js";
import { buildInterview, interviewHasAnswers } from "./content/interview.js";
import { lintText } from "./content/lint.js";
import { groupQuestions, mineQuestions, type MinedQuestion } from "./content/questions.js";
import { buildBrief, loadKnowledge, passesBar, QUALITY_BAR, revisionNotes, writeArticle } from "./content/writer.js";
import { crawlSite, type CrawlResult } from "./crawl/crawler.js";
import { researchKeywords, type KeywordReport } from "./keywords/research.js";
import { llmConfigured, requireLlm } from "./llm/claude.js";
import { buildOffpagePlan } from "./offpage/plan.js";
import { DataForSeoProvider } from "./providers/dataforseo.js";
import { FixtureProvider } from "./providers/fixture.js";
import { FreeProvider } from "./providers/free.js";
import { gscConfigured, gscQueryPages } from "./providers/gsc.js";
import type { SeoDataProvider } from "./providers/types.js";
import { visibilityMarkdown, auditMarkdown, keywordsMarkdown, lintMarkdown, offpageMarkdown, questionsMarkdown, tagsMarkdown, timelineMarkdown } from "./report/markdown.js";
import { listProjects, loadProject, projectDir, readJson, saveProject, slugify, writeJson, writeText, type Project } from "./store.js";
import { buildLlmsTxt, detectPageType, recommendTags } from "./tags/recommend.js";
import { buildRoadmap, estimateTimeline, LINK_PACE, type LinkPace } from "./timeline/estimate.js";
import { runVisibility, starterPrompts, summarise, type VisibilitySnapshot } from "./visibility/track.js";
import type { AiEngine } from "./providers/types.js";
import { hostOf } from "./util/http.js";
import { tokens } from "./util/text.js";

loadDotEnv();

const log = (...a: unknown[]) => console.error(...a);
const done = (file: string) => console.log(`→ ${path.relative(process.cwd(), file)}`);

function provider(demo?: string): SeoDataProvider {
  const fixture = demo ?? process.env.SEO_FIXTURE;
  if (fixture) {
    log(`Using DEMO data from ${fixture}`);
    return FixtureProvider.fromFile(fixture);
  }
  return new DataForSeoProvider();
}

function profileFromCrawl(p: Project, crawl: CrawlResult): Project["business"] {
  const home = crawl.pages.find((x) => detectPageType(x.finalUrl.replace(crawl.fetchOrigin, crawl.siteOrigin), x) === "home") ?? crawl.pages[0];
  const name = home?.og.site_name ?? home?.title?.split(/\s[|—–-]\s/)[0]?.trim() ?? p.domain;
  const services = crawl.pages
    .filter((x) => /\/services?\/[^/]+\/?$/.test(new URL(x.finalUrl).pathname) && (x.title || x.h1[0]))
    .map((x) => (x.title?.split(/\s[|—–-]\s/)[0] ?? x.h1[0]!).replace(/\s+/g, " ").trim())
    .slice(0, 12);
  const given = Object.fromEntries(Object.entries(p.business ?? {}).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));
  return { name, summary: home?.metaDescription ?? undefined, services: services.length ? services : undefined, ...given };
}

async function crawlProject(p: Project, opts: { local?: string; max?: string }) {
  let n = 0;
  const crawl = await crawlSite(p.url, {
    maxPages: Number(opts.max ?? 200),
    originOverride: opts.local,
    onProgress: (count, _q, url) => {
      if (++n % 10 === 0) log(`  crawled ${count}… ${url}`);
    },
  });
  writeJson(p.slug, "crawl.json", crawl);
  return crawl;
}

const program = new Command()
  .name("seo")
  .description("Promogranade SEO / AEO / GEO engine")
  .version("0.1.0");

program
  .command("add")
  .argument("<url>", "website URL, e.g. https://example.com")
  .description("Add a website: crawl it, profile the business, create the project")
  .option("-m, --market <code>", `Google market (${Object.keys(MARKETS).join(", ")})`, "us")
  .option("--name <name>", "business name")
  .option("--services <list>", "comma-separated services/products")
  .option("--competitors <list>", "comma-separated competitor domains")
  .option("--location <place>", "city/region served (enables local SEO bits)")
  .option("--repo <path>", "path to the site's source code (for /seo-fix)")
  .option("--local <origin>", "crawl a local/staging build instead, e.g. http://localhost:3000")
  .option("--max <n>", "max pages to crawl", "60")
  .action(async (url: string, o) => {
    market(o.market);
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const domain = hostOf(u.toString());
    const project: Project = {
      slug: slugify(domain),
      url: u.origin + "/",
      domain,
      market: o.market,
      createdAt: new Date().toISOString(),
      repoPath: o.repo ? path.resolve(o.repo) : undefined,
      business: {
        name: o.name,
        services: o.services?.split(",").map((s: string) => s.trim()).filter(Boolean),
        location: o.location,
      },
      competitors: o.competitors?.split(",").map((s: string) => s.trim()).filter(Boolean),
    };
    log(`Crawling ${o.local ?? project.url} …`);
    const crawl = await crawlProject(project, o);
    project.business = profileFromCrawl(project, crawl);
    saveProject(project);
    console.log(`Added ${project.slug}: ${crawl.pages.length} pages, business "${project.business?.name}".`);
    console.log(`Services detected: ${project.business?.services?.join(", ") ?? "none — pass --services"}`);
    console.log(`Edit ${path.relative(process.cwd(), path.join(projectDir(project.slug), "project.json"))} to correct anything. Next: seo audit ${project.slug}`);
  });

program
  .command("list")
  .description("List projects")
  .action(() => console.log(listProjects().join("\n") || "No projects yet. Run: seo add <url>"));

program
  .command("audit")
  .argument("<project>")
  .description("Technical SEO audit (crawl + 40+ checks + health score)")
  .option("--local <origin>", "audit a local/staging build, e.g. http://localhost:3000")
  .option("--max <n>", "max pages", "200")
  .action(async (slug: string, o) => {
    const p = loadProject(slug);
    log(`Crawling ${o.local ?? p.url} …`);
    const crawl = await crawlProject(p, o);
    const audit = auditCrawl(crawl);
    writeJson(slug, "audit.json", audit);
    done(writeText(slug, "audit.md", auditMarkdown(audit)));
    console.log(`Health ${audit.healthScore}/100 — ${audit.counts.error} errors, ${audit.counts.warning} warnings, ${audit.counts.notice} notices across ${audit.pagesCrawled} pages.`);
  });

program
  .command("keywords")
  .argument("<project>")
  .description("Find the keywords this site can rank for, scored and mapped to pages")
  .option("--seeds <list>", "comma-separated seed topics (default: from the site)")
  .option("--serp <n>", "how many top candidates get a live SERP analysis", "25")
  .option("--min-volume <n>", "ignore keywords below this monthly volume", "10")
  .option("--no-competitors", "skip competitor keyword gap")
  .option("--demo <fixture>", "use a fixture JSON instead of DataForSEO (demo/testing)")
  .option("--free", "no paid API: ideas from Google Autocomplete, volumes from a Keyword Planner CSV (--planner)")
  .option("--planner <csv>", "Google Keyword Planner export with search volumes (implies --free)")
  .action(async (slug: string, o) => {
    const p = loadProject(slug);
    const crawl = readJson<CrawlResult>(slug, "crawl.json");
    const free = o.free || o.planner ? new FreeProvider(p.market, { plannerCsv: o.planner, cacheFile: path.join(projectDir(slug), "autocomplete-cache.json") }) : null;
    if (free) log(`Using ${free.name}`);
    let gscRows;
    if (gscConfigured()) {
      try {
        gscRows = await gscQueryPages(`sc-domain:${p.domain}`);
        log(`Search Console: ${gscRows.length} query/page rows`);
      } catch (e) {
        log(`Search Console skipped: ${(e as Error).message}`);
      }
    }
    const report = await researchKeywords(p, crawl, free ?? provider(o.demo), {
      market: market(p.market),
      marketCode: p.market,
      seeds: o.seeds?.split(",").map((s: string) => s.trim()),
      serpTop: Number(o.serp),
      minVolume: Number(o.minVolume),
      useCompetitors: o.competitors,
      gscRows,
      onStep: (s) => log(`  ${s}`),
    });
    writeJson(slug, "keywords.json", report);
    done(writeText(slug, "keywords.md", keywordsMarkdown(report)));
    if (free && !o.planner) {
      // Keyword Planner's "Get search volume and forecasts" takes this file as an upload.
      const upload = report.keywords.filter((k) => k.bucket !== "off-topic").map((k) => k.keyword);
      done(writeText(slug, "planner-upload.txt", upload.join("\n") + "\n"));
      log(`Next (free volumes): upload planner-upload.txt in Google Keyword Planner → "Get search volume and forecasts", download the CSV, then run: seo keywords ${slug} --planner <file.csv>`);
    }
    const by = (b: string) => report.keywords.filter((k) => k.bucket === b).length;
    console.log(`${report.keywords.length} keywords: ${by("quick-win")} quick wins, ${by("target-now")} target-now, ${by("build-up")} build-up, ${by("long-term")} long-term. ${report.clusters.length} page clusters. Data cost $${report.spentUsd}.`);
  });

program
  .command("tags")
  .argument("<project>")
  .description("Recommended title/description/H1/canonical/Open Graph/JSON-LD per page (+ llms.txt)")
  .action(async (slug: string) => {
    const p = loadProject(slug);
    const crawl = readJson<CrawlResult>(slug, "crawl.json");
    if (!crawl) throw new Error(`Run "seo audit ${slug}" first.`);
    const kw = readJson<KeywordReport>(slug, "keywords.json");
    const keywordFor = new Map<string, string>();
    for (const c of kw?.clusters ?? []) if (!c.isNewPage) keywordFor.set(c.targetPage.replace(crawl.siteOrigin, crawl.fetchOrigin).replace(/\/$/, ""), c.head);
    const pages = crawl.pages.filter((x) => x.status === 200);
    const recs = pages.map((page) => recommendTags(page, p, { keyword: keywordFor.get(page.finalUrl.replace(/\/$/, "")) ?? null, siteOrigin: crawl.siteOrigin }));
    writeJson(slug, "tags.json", recs);
    done(writeText(slug, "tags.md", tagsMarkdown(recs)));
    done(writeText(slug, "llms.txt", buildLlmsTxt(p, pages, crawl.siteOrigin)));
    console.log(`${recs.filter((r) => r.changes.length).length}/${recs.length} pages have recommended changes${kw ? "" : " (run `seo keywords` first to target keywords per page)"}.`);
  });

program
  .command("timeline")
  .argument("<project>")
  .description("Estimate how long it takes to rank for the target keywords, with a monthly roadmap")
  .option("--keywords <list>", "comma-separated target keywords (default: top opportunities)")
  .option("--goal <goal>", "top10 or top3", "top10")
  .option("--pace <pace>", `link-building pace: ${Object.entries(LINK_PACE).map(([k, v]) => `${k}=${v}/mo`).join(", ")}, or a number`, "growth")
  .action((slug: string, o) => {
    const p = loadProject(slug);
    const kw = readJson<KeywordReport>(slug, "keywords.json");
    if (!kw) throw new Error(`Run "seo keywords ${slug}" first.`);
    const pace = Number.isFinite(Number(o.pace)) ? Number(o.pace) : LINK_PACE[o.pace as LinkPace];
    if (!pace) throw new Error(`Unknown pace "${o.pace}"`);
    const wanted: string[] = o.keywords?.split(",").map((s: string) => s.trim().toLowerCase()) ?? [];
    const targets = wanted.length
      ? kw.keywords.filter((k) => wanted.includes(k.keyword.toLowerCase()))
      : kw.keywords.filter((k) => k.bucket !== "off-topic").sort((a, b) => b.opportunity - a.opportunity).slice(0, 12);
    const missing = wanted.filter((w) => !kw.keywords.some((k) => k.keyword.toLowerCase() === w));
    if (missing.length) log(`Not in keywords.json (add them with --seeds and re-run seo keywords): ${missing.join(", ")}`);
    const newPage = (keyword: string) => kw.clusters.find((c) => c.keywords.includes(keyword))?.isNewPage ?? true;
    const estimates = targets.map((k) => estimateTimeline({ keyword: k, ourAuthority: kw.ourAuthority, linksPerMonth: pace, goal: o.goal, needsNewPage: newPage(k.keyword) }));
    const roadmap = buildRoadmap(estimates);
    writeJson(slug, "timeline.json", { estimates, roadmap, linksPerMonth: pace });
    done(writeText(slug, "timeline.md", timelineMarkdown(p.domain, estimates, roadmap, pace)));
    for (const e of estimates) console.log(`${e.keyword.padEnd(40)} ${e.months.expected} mo (range ${e.months.optimistic}–${e.months.conservative})`);
  });

program
  .command("offpage")
  .argument("<project>")
  .description("Backlink plan: what AI does by itself, what a person must do, prospects")
  .option("--demo <fixture>", "use a fixture JSON instead of DataForSEO")
  .option("--offline", "skip data calls (plan + queries only)")
  .action(async (slug: string, o) => {
    const p = loadProject(slug);
    const kw = readJson<KeywordReport>(slug, "keywords.json");
    const plan = await buildOffpagePlan(p, kw, o.offline ? null : provider(o.demo), { onStep: (s) => log(`  ${s}`) });
    writeJson(slug, "offpage.json", plan);
    done(writeText(slug, "offpage.md", offpageMarkdown(plan)));
    console.log(`${plan.prospects.length} prospects · target ${plan.recommendedLinksPerMonth} referring domains/month.`);
  });

program
  .command("questions")
  .argument("<project>")
  .description("AEO/GEO: the questions people ask (People-also-ask, keywords, buyer questions)")
  .option("--add <list>", "pipe-separated buyer questions to add (saved in buyer-questions.txt; this is how Claude Code adds them)")
  .option("--no-ai", "don't call the Anthropic API for buyer questions")
  .action(async (slug: string, o) => {
    const p = loadProject(slug);
    const savedFile = path.join(projectDir(slug), "buyer-questions.txt");
    const saved = fs.existsSync(savedFile) ? fs.readFileSync(savedFile, "utf8").split("\n").filter(Boolean) : [];
    const added: string[] = o.add?.split("|").map((q: string) => q.trim()).filter(Boolean) ?? [];
    const extra = [...new Set([...saved, ...added])];
    if (added.length) writeText(slug, "buyer-questions.txt", extra.join("\n") + "\n");
    const llm = o.ai && llmConfigured() ? requireLlm() : null;
    const qs = await mineQuestions(p, readJson<KeywordReport>(slug, "keywords.json"), readJson<CrawlResult>(slug, "crawl.json"), llm, extra);
    writeJson(slug, "questions.json", { questions: qs, groups: groupQuestions(qs) });
    done(writeText(slug, "questions.md", questionsMarkdown(p.domain, qs)));
    console.log(`${qs.length} questions (${qs.filter((q) => !q.answeredOn).length} not yet answered on the site).`);
    if (!llm && !extra.length) console.log("Tip: in Claude Code, ask Claude to suggest buyer questions and add them with --add \"q1|q2|…\" (uses your Claude plan, no API key).");
  });

const topicSlug = (t: string) => tokens(t).slice(0, 8).join("-");

program
  .command("interview")
  .argument("<project>")
  .requiredOption("--topic <topic>", "article topic, e.g. \"how much does a Next.js website cost\"")
  .option("--questions <list>", "pipe-separated reader questions (default: matching mined questions)")
  .description("Create the expert-interview sheet a team member fills in (source of original answers)")
  .action(async (slug: string, o) => {
    const p = loadProject(slug);
    const mined = readJson<{ questions: MinedQuestion[] }>(slug, "questions.json")?.questions ?? [];
    const topicTokens = new Set(tokens(o.topic));
    const qs: string[] = o.questions?.split("|").map((s: string) => s.trim()) ?? mined.filter((q) => tokens(q.question).some((t) => topicTokens.has(t))).slice(0, 8).map((q) => q.question);
    const md = await buildInterview(p, o.topic, qs, llmConfigured() ? requireLlm() : null);
    done(writeText(slug, path.join("interviews", `${topicSlug(o.topic)}.md`), md));
    console.log("Give this file to the person who knows the topic best. Then: seo write " + slug + ` --topic "${o.topic}" --keyword "<primary keyword>"`);
  });

program
  .command("write")
  .argument("<project>")
  .requiredOption("--topic <topic>")
  .requiredOption("--keyword <keyword>", "primary keyword")
  .option("--words <n>", "target length", "1400")
  .option("--via <engine>", "claude-code (brief for Claude Code, uses your Claude plan) | api (Anthropic API key) | auto", "auto")
  .description("Write an original, human-voiced article from the expert interview + knowledge files")
  .action(async (slug: string, o) => {
    const p = loadProject(slug);
    const file = path.join(projectDir(slug), "interviews", `${topicSlug(o.topic)}.md`);
    if (!fs.existsSync(file)) throw new Error(`No interview yet. Run: seo interview ${slug} --topic "${o.topic}"`);
    const interview = fs.readFileSync(file, "utf8");
    if (!interviewHasAnswers(interview)) throw new Error(`${path.relative(process.cwd(), file)} has fewer than 3 real answers. Fill it in first — the article is written only from these answers.`);
    const questions = [...interview.matchAll(/^- (.+\?)$/gm)].map((m) => m[1]!);
    const input = { project: p, topic: o.topic, primaryKeyword: o.keyword, questions, interview, knowledge: loadKnowledge(slug), wordTarget: Number(o.words) };
    const base = path.join("drafts", topicSlug(o.topic));
    const via = o.via === "auto" ? (llmConfigured() ? "api" : "claude-code") : o.via;
    if (via === "claude-code") {
      const draftPath = path.relative(process.cwd(), path.join(projectDir(slug), `${base}.md`));
      done(writeText(slug, `${base}.brief.md`, buildBrief(input, draftPath)));
      console.log(`Brief ready. In Claude Code (your Claude plan, no API key) say:\n  "Write the draft from ${path.relative(process.cwd(), path.join(projectDir(slug), `${base}.brief.md`))}"\nThen check it: npm run seo -- check ${slug} --topic "${o.topic}"`);
      return;
    }
    if (via !== "api") throw new Error(`Unknown --via "${o.via}" (use claude-code, api or auto)`);
    log("Writing (Anthropic API) …");
    const res = await writeArticle(requireLlm(), input);
    done(writeText(slug, `${base}.md`, res.markdown));
    done(writeText(slug, `${base}.check.md`, lintMarkdown(`${base}.md`, res.lint, res.aeo)));
    console.log(`Voice ${res.lint.score}/100 · AEO ${res.aeo.aeoScore} · GEO ${res.aeo.geoScore} · ${res.revisions} revision(s). A person must review and fill any [NEEDS DATA] before publishing.`);
  });

program
  .command("check")
  .argument("<project>")
  .requiredOption("--topic <topic>")
  .description("Grade a draft (voice, AEO, GEO); prints PASS or the exact revision notes")
  .action((slug: string, o) => {
    const base = path.join("drafts", topicSlug(o.topic));
    const file = path.join(projectDir(slug), `${base}.md`);
    if (!fs.existsSync(file)) throw new Error(`No draft at ${path.relative(process.cwd(), file)} yet.`);
    const md = fs.readFileSync(file, "utf8");
    const lint = lintText(md);
    const aeo = checkAeo(md);
    done(writeText(slug, `${base}.check.md`, lintMarkdown(`${base}.md`, lint, aeo)));
    const todos = (md.match(/\[NEEDS DATA[^\]]*\]/g) ?? []).length;
    console.log(`Voice ${lint.score}/100 · AEO ${aeo.aeoScore} · GEO ${aeo.geoScore} · ${todos} [NEEDS DATA] left for a person`);
    if (passesBar(lint, aeo)) console.log("PASS — ready for human review.");
    else console.log(`NEEDS REVISION (voice ≥ ${QUALITY_BAR.voice}, AEO ≥ ${QUALITY_BAR.aeo}):\n${revisionNotes(lint, aeo).join("\n")}`);
  });

program
  .command("visibility")
  .argument("<project>")
  .description("AI visibility: does ChatGPT / Perplexity / Gemini / Claude mention or cite this brand for buyer questions?")
  .option("--init", "create visibility-prompts.txt (one question per line) to review before the first run")
  .option("--engines <list>", "chat_gpt,perplexity,gemini,claude", "chat_gpt,perplexity,gemini,claude")
  .option("--max-calls <n>", "safety cap on paid AI calls per run", "60")
  .option("--dry-run", "show what would run and how many paid calls, without calling anything")
  .option("--demo <fixture>", "use a fixture JSON instead of DataForSEO")
  .action(async (slug: string, o) => {
    const p = loadProject(slug);
    const promptsFile = path.join(projectDir(slug), "visibility-prompts.txt");
    if (o.init || !fs.existsSync(promptsFile)) {
      const mined = readJson<{ questions: MinedQuestion[] }>(slug, "questions.json")?.questions.map((q) => q.question) ?? [];
      const prompts = starterPrompts(p, mined);
      done(writeText(slug, "visibility-prompts.txt", ["# One question per line. These are asked to each AI engine. Keep the list stable so trends are comparable.", ...prompts].join("\n") + "\n"));
      console.log(`${prompts.length} starter questions written. Review/edit them, then run: npm run seo -- visibility ${slug}`);
      return;
    }
    const prompts = fs.readFileSync(promptsFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const valid: AiEngine[] = ["chat_gpt", "perplexity", "gemini", "claude"];
    const engines = o.engines.split(",").map((e: string) => e.trim()).filter(Boolean) as AiEngine[];
    const bad = engines.filter((e) => !valid.includes(e));
    if (bad.length) throw new Error(`Unknown engine(s): ${bad.join(", ")}. Use: ${valid.join(", ")}`);
    const calls = prompts.length * engines.length;
    if (o.dryRun) {
      console.log(`Would ask ${prompts.length} questions × ${engines.length} engines = ${calls} paid DataForSEO AI calls (cap ${o.maxCalls}). Brand aliases: ${[p.business?.name, p.domain, ...(p.business?.aliases ?? [])].filter(Boolean).join(", ")}. Competitors: ${(p.competitors ?? []).join(", ") || "none — add them to project.json"}.`);
      return;
    }
    const prevFiles = fs.existsSync(path.join(projectDir(slug), "visibility")) ? fs.readdirSync(path.join(projectDir(slug), "visibility")).filter((f) => f.endsWith(".json")).sort() : [];
    const snap = await runVisibility(p, provider(o.demo), { prompts, engines, maxCalls: Number(o.maxCalls), countryIso: p.market === "uk" ? "GB" : p.market.toUpperCase(), onStep: (s) => log(`  ${s}`) });
    const sum = summarise(snap);
    const prevSnap = prevFiles.length ? readJson<VisibilitySnapshot>(slug, path.join("visibility", prevFiles.at(-1)!)) : null;
    done(writeJson(slug, path.join("visibility", `${snap.takenAt.slice(0, 19).replace(/:/g, "-")}.json`), snap));
    done(writeText(slug, "visibility.md", visibilityMarkdown(snap, sum, prevSnap ? summarise(prevSnap) : null)));
    console.log(`Mentioned in ${sum.overall.mentionRate}% of answers, cited in ${sum.overall.citationRate}%, share of voice ${sum.overall.shareOfVoice}%. ${sum.gaps.length} gaps. Cost $${snap.spentUsd}.`);
  });

program
  .command("lint")
  .argument("<file>", "markdown file to check")
  .description("Check any draft for generic/AI-sounding writing + AEO/GEO structure (no API needed)")
  .action((file: string) => {
    const md = fs.readFileSync(file, "utf8");
    console.log(lintMarkdown(file, lintText(md), checkAeo(md)));
  });

program
  .command("report")
  .argument("<project>")
  .description("One client-ready summary of everything run so far")
  .action((slug: string) => {
    const p = loadProject(slug);
    const audit = readJson<AuditResult>(slug, "audit.json");
    const kw = readJson<KeywordReport>(slug, "keywords.json");
    const tl = readJson<{ estimates: { keyword: string; months: { expected: number } }[] }>(slug, "timeline.json");
    const off = readJson<{ recommendedLinksPerMonth: number; prospects: unknown[] }>(slug, "offpage.json");
    const lines = [
      `# SEO summary — ${p.business?.name ?? p.domain}`,
      "",
      `Generated ${new Date().toISOString().slice(0, 10)} · market ${p.market.toUpperCase()}`,
      "",
      "## Technical health",
      audit ? `Health score **${audit.healthScore}/100**; top issues: ${audit.issues.slice(0, 5).map((i) => `${i.title} (${i.urls.length})`).join("; ")}. Details: audit.md` : "_Run `seo audit`._",
      "",
      "## Keywords",
      kw ? `${kw.keywords.filter((k) => k.bucket === "quick-win").length} quick wins, ${kw.keywords.filter((k) => k.bucket === "target-now").length} realistic now. Top 5: ${kw.keywords.slice(0, 5).map((k) => k.keyword).join(", ")}. Details: keywords.md` : "_Run `seo keywords`._",
      "",
      "## Timeline",
      tl ? tl.estimates.slice(0, 8).map((e) => `- ${e.keyword}: ~${e.months.expected} months`).join("\n") + "\n\nDetails: timeline.md" : "_Run `seo timeline`._",
      "",
      "## Off-page",
      off ? `Target ${off.recommendedLinksPerMonth} new referring domains/month; ${off.prospects.length} prospects. Details: offpage.md` : "_Run `seo offpage`._",
    ];
    done(writeText(slug, "report.md", lines.join("\n")));
  });

program.parseAsync().catch((e: Error) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
