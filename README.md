# seo-engine

Promogranade's own SEO / AEO / GEO tool. It takes the best ideas from Ahrefs and
Semrush (their published methods) and OpenSEO (open source). Add a website and it:

1. **Finds the right keywords.** It lists what the site can realistically rank for,
   in buckets: quick wins, target now, build up, and long term. Each keyword gets
   difficulty, rankability, opportunity, and the page it belongs on.
2. **Recommends tags for every page.** Title, description, H1, canonical, Open Graph,
   JSON-LD, plus an `llms.txt`.
3. **Runs a technical SEO audit.** It checks 40+ things and gives a health score.
   The `seo-fix` Claude Code skill then fixes the issues in the site's code and opens a PR.
4. **Handles AEO and GEO.** It mines the questions people ask and interviews your
   expert. It writes answer-first articles only from first-party answers, never
   copied from the web. A voice linter catches generic, AI-sounding prose.
5. **Plans off-page work.** It finds backlink-gap prospects and splits the plan
   into what AI does by itself and what a person must do, with a 4-week start.
6. **Tracks AI visibility.** It asks ChatGPT, Perplexity, Gemini and Claude your
   buyers' questions every month and shows whether you're mentioned or cited,
   which competitors are, and which sites the AI engines rely on.
7. **Estimates the ranking timeline.** It gives optimistic, expected and
   conservative months per keyword, plus a month-by-month roadmap.

## Quick start

```bash
npm ci
cp .env.example .env          # DataForSEO login/password (Anthropic API key optional)
npm test                      # offline test suite

npm run seo -- add https://example.com --market us --competitors rival.com
npm run seo -- audit example-com
npm run seo -- keywords example-com
npm run seo -- tags example-com
npm run seo -- timeline example-com --pace growth
npm run seo -- offpage example-com
npm run seo -- questions example-com
npm run seo -- interview example-com --topic "how much does a website cost"
npm run seo -- write example-com --topic "how much does a website cost" --keyword "website cost"   # brief → Claude Code writes it
npm run seo -- check example-com --topic "how much does a website cost"
npm run seo -- visibility example-com --init   # review visibility-prompts.txt, then:
npm run seo -- visibility example-com --dry-run
npm run seo -- visibility example-com
npm run seo -- report example-com
```

The results go in `data/projects/<slug>/`: a readable `.md` file and a `.json`
file for each step. That folder is git-ignored because it holds client data.

To try it with no API keys, add `--demo test/fixtures/demo-promogranade.json` to
`keywords` and `offpage`. That output is marked **DEMO DATA**.

## Claude Code

Open this repo in Claude Code and ask in plain words, e.g. "do SEO for
client.com", "fix the SEO on our site", or "write an article answering these
questions". Three skills guide it:

- `.claude/skills/seo-engine`: runs the commands and explains the numbers.
- `.claude/skills/seo-fix`: applies the audit in the site's repo, re-audits, and opens a PR.
- `.claude/skills/seo-write`: interview-first, human-voiced content.

## Costs

- **DataForSEO:** pay as you go, about $0.5–3 per full keyword run on one site.
  The minimum top-up is $50. This is the only key the core needs.
- **Claude:** no extra cost when you work inside Claude Code. `seo write` makes a
  brief, Claude writes the article under your existing Claude plan, and `seo check`
  grades it. An Anthropic API key is only for unattended runs (`--via api`).
- **Google Search Console:** free.

## How it works

`docs/METHODOLOGY.md` has every formula, threshold and source.

```
src/
  crawl/      crawler, HTML parser, robots.txt
  audit/      technical checks + health score
  tags/       title/description/H1/OG/JSON-LD/llms.txt recommendations
  providers/  DataForSEO, Google Search Console, offline fixtures
  keywords/   difficulty, rankability, opportunity, clustering, research pipeline
  timeline/   time-to-rank model + roadmap
  visibility/ AI answer tracking: mentions, citations, share of voice
  offpage/    backlink gap + AI/human plan
  content/    questions, expert interview, writer, voice linter, AEO/GEO checks
  llm/        Claude client
  report/     Markdown renderers
```
