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
npm ci && cp .env.example .env   # add DATAFORSEO_LOGIN/PASSWORD + ANTHROPIC_API_KEY
npm run build                     # or use `npm run seo -- …` (tsx) without building
npm test                          # 23 tests, all offline
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
| 4 | `seo tags <slug>` | `tags.md/json` + `llms.txt` | free |
| 5 | `seo timeline <slug> [--keywords "a,b"] [--goal top3] [--pace growth]` | `timeline.md` | free |
| 6 | `seo offpage <slug>` | `offpage.md` — AI tasks vs human tasks, prospects | DataForSEO |
| 7 | `seo questions <slug>` | `questions.md` — AEO/GEO questions | Claude (small) |
| 8 | `seo report <slug>` | `report.md` — one-page client summary | free |

Markets: us, uk, in, ae, au, ca, sg (`src/config.ts`). Slug = domain with dots → dashes.

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
