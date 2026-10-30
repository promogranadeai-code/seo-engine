---
name: seo-engine
description: How to run Promogranade's SEO/AEO/GEO engine (this repo) for a website — add a site, technical audit, keywords it can rank for, tags per page, ranking timeline, off-page plan, questions for AEO/GEO, and client report. Use for any request to do SEO for a site, find keywords, estimate time to rank, or plan backlinks.
---

# seo-engine — operating guide

**What this skill is:** the command-by-command workflow for this repo's CLI
(`npm run seo -- <command>` or `node dist/cli.js <command>`). It takes a website
from "just added" to a full plan: audit → keywords → tags → timeline → off-page →
content. For fixing a site's code use the `seo-fix` skill; for writing articles
use `seo-write`. Formulas and sources: `docs/METHODOLOGY.md`.

---

## Setup (once)

```bash
npm ci && cp .env.example .env   # add DATAFORSEO_LOGIN/PASSWORD (ANTHROPIC_API_KEY optional)
npm run build                     # or use `npm run seo -- …` (tsx) without building
npm test                          # 26 tests, all offline
```

Without DataForSEO keys, `keywords`/`offpage` can run on demo data with
`--demo test/fixtures/demo-promogranade.json` — outputs are labelled DEMO DATA;
never show them to a client as real.

## The workflow for a new website

| Step | Command | Output (in `data/projects/<slug>/`) | Cost |
|---|---|---|---|
| 1 | `seo add https://site.com --market in --competitors a.com,b.com [--repo ../site]` | `project.json` (edit business name/services/location here) | free |
| 2 | `seo audit <slug>` (add `--local http://localhost:3000` for a local build) | `audit.md/json`, `crawl.json` | free |
| 3 | `seo keywords <slug>` | `keywords.md/json` — buckets: quick-win, target-now, build-up, long-term | DataForSEO, ~$0.5–3 |
| 3 (free) | `seo keywords <slug> --free --seeds "a,b"`, then `--planner <csv>` | same, ranked by Google Autocomplete demand until Keyword Planner volumes are imported; also `planner-upload.txt` | free |
| 4 | `seo tags <slug>` | `tags.md/json` + `llms.txt` | free |
| 5 | `seo timeline <slug> [--keywords "a,b"] [--goal top3] [--pace growth]` | `timeline.md` | free |
| 6 | `seo offpage <slug>` | `offpage.md` — AI tasks vs human tasks, prospects | DataForSEO |
| 7 | `seo questions <slug> [--add "Q1?\|Q2?"]` | `questions.md` — AEO/GEO questions | free |
| 8 | `seo visibility <slug> --init`, then `seo visibility <slug>` | `visibility.md` + dated snapshots — mentioned / cited / share of voice per AI engine, gaps, most-cited domains | DataForSEO AI calls (prompts × engines; `--dry-run` first) |
| 9 | `seo report <slug>` | `report.md` — one-page client summary | free |

Markets: us, uk, in, ae, au, ca, sg (`src/config.ts`). Slug = domain with dots → dashes.

## Keys: what needs what

- **DataForSEO** — needed for `offpage` prospects and for SERP difficulty (page-1 results,
  backlinks). ~$0.5–3 per full keyword run. Keyword *ideas and volumes* no longer need it: see below.

## Search Console setup from the command line

`scripts/gsc-setup.sh` sets up a Search Console property through Google's APIs using gcloud. It must run where
gcloud is signed in, which is the owner's computer: Claude's cloud workspace has no Google login. The steps:

1. `login`: sign in with the webmasters and siteverification scopes, then enable both APIs.
2. `token <site>`: prints the meta-tag value. For promogranade.com it goes in Vercel env
   `GOOGLE_SITE_VERIFICATION`; the layout already reads it. Redeploy.
3. `finish <site>`: verifies ownership, adds the URL-prefix property and submits `sitemap.xml`.
4. `status <site>`: sitemap state and the URL Inspection verdict for the key pages.

No API can request indexing. That stays a button in Search Console.

## Free keyword research (no paid tool)

1. `seo keywords <slug> --free --seeds "website development,seo services,..."`. This expands each seed
   through Google Autocomplete (modifiers, question words, a–z; about 46 calls per seed, cached in
   `autocomplete-cache.json`). Keywords are ranked by a 0–100 *demand* score: Google lists more-searched
   suggestions first. It writes `planner-upload.txt`.
2. In Google Ads, open Keyword Planner. It is free; an account without running ads is enough. Choose
   "Get search volume and forecasts", upload `planner-upload.txt`, pick the country, and download the CSV.
3. `seo keywords <slug> --planner <file.csv> --seeds "<same seeds>"` adds real volume ranges (for example
   "1K – 10K", read as about 3.2K), competition and bids.

Search Console queries (free) are merged automatically once `GSC_*` is configured.

If the machine cannot reach Google (as in Claude's cloud workspace), fill the cache elsewhere with
`npx tsx scripts/suggest-cache.ts <market> "<seeds>" > autocomplete-cache.json` (on your laptop, or in a
Vercel Sandbox with `suggestqueries.google.com` allowed), copy the file into `data/projects/<slug>/`, and run
step 1 with the same seeds.

Free mode has no SERP, backlink or competitor data, so KD shows "?" and rankability rests on relevance.
- **Anthropic API key — optional.** Writing, buyer questions and interview tailoring run inside
  Claude Code under the team's Claude plan (`seo write` makes a brief, Claude writes it, `seo check`
  grades it — see `seo-write`). The key only enables unattended `--via api` runs. Never wire a
  Claude plan login into the CLI; plan logins are for Claude's own apps.
- Free with no keys: `add`, `audit`, `tags`, `lint`, `check`, `interview`, `offpage --offline`.

## AI visibility (GEO/AEO measurement)

- Asks ChatGPT, Perplexity, Gemini and Claude (via DataForSEO `ai_optimization`, web search on) the
  questions in `visibility-prompts.txt`; records *mentioned*, *cited* (our domain in the sources),
  *mention rank*, competitors named, and every cited domain. Snapshots in `visibility/`, trend vs last run.
- Add competitors to `project.json` (`competitors`) and other spellings to `business.aliases`, or
  share of voice is meaningless. Keep the prompt list stable month to month. `--max-calls` caps spend.
- Gaps (competitor named, we're not) → `seo write` topics. Most-cited domains → `seo offpage` targets.
- Example prompt list: `examples/visibility-prompts.promogranade.txt`.

## Reading the numbers (explain these to clients)

- **KD** — overall difficulty 0–100, Ahrefs-style: driven by how many sites link to
  the current top-10 pages. Labels use Semrush bands (very easy … very hard).
- **Rankability** — how realistic page 1 is *for this site* (our version of Semrush's
  Personal KD): link gap vs page 1, topical relevance, current rankings.
- **Opportunity** — expected monthly value: clicks at a realistic position × intent value × CPC × rankability.
  AI Overviews on a SERP cut the click estimate (~58% at #1, Ahrefs 2026).
- **Timeline** — optimistic / expected / conservative months *if the plan is executed*.
  Always quote the range, never a guarantee. Context: only 1.74% of new pages hit the top 10 within a year (Ahrefs 2025).

## Gotchas

- `--local` audits a local build but keeps production URLs in reports (canonical/sitemap are mapped).
- Page-level `openGraph` in Next.js **replaces** the layout's — the most common reason for "Missing Open Graph tags".
- "Headings whose words run together": span-per-word animation components without real spaces
  (`WebsiteDevelopment`). Fix in the component, not page by page.
- FAQPage/HowTo markup no longer earns Google rich results (2026); the engine doesn't generate it. Q&A *content* still matters for AEO.
- Two DataForSEO endpoints (competitors_domain, bulk_referring_domains) were written without access to live docs; if they error, the engine continues (notes appear in keywords.md) — check the error message and fix the payload in `src/providers/dataforseo.ts`.
- `data/` is git-ignored (client data). Back up or commit deliberately.
