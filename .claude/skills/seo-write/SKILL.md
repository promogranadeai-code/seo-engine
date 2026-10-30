---
name: seo-write
description: Produce original, human-voiced SEO/AEO/GEO articles with seo-engine — mine questions, run an expert interview, write only from first-party answers and knowledge files, lint for generic/AI-sounding prose, check answer-first structure, then publish via the site's repo. Runs on the team's Claude plan inside Claude Code (no Anthropic API key needed). Use for "write a blog", "answer these questions", "AEO/GEO content".
---

# /seo-write — original content that reads like a person wrote it

**What this skill is:** the content workflow. The rule that makes it work: we never
summarise the internet. Answers come from our own people (interview) and our own
documents (`knowledge/`). **You (Claude, in Claude Code) do the writing under the
team's Claude plan** — the CLI only prepares briefs and grades drafts, so no
Anthropic API key or extra credits are needed. A human edits and approves.

---

## Steps (Claude Code mode — the default when no ANTHROPIC_API_KEY is set)

1. **Questions.** `npm run seo -- questions <slug>`. Then brainstorm 15–25 questions real
   buyers ask before hiring this business (cost, time, process, risks, comparisons) from
   `project.json` + `keywords.md`, and add them:
   `npm run seo -- questions <slug> --add "Q1?|Q2?|…"` (saved to `buyer-questions.txt`).
   Pick a topic group with demand and no existing answer on the site.
2. **Interview.** `npm run seo -- interview <slug> --topic "<topic>"` → `interviews/<topic>.md`.
   You may rewrite the template questions to fit the topic (ask for specifics: real projects,
   numbers, prices, tools, opinions, mistakes). Send it to the person who knows the topic.
   **Do not fill in answers yourself.** At least 3 real answers are required.
3. **Knowledge (optional).** Case studies, process docs, pricing notes, a voice guide go in
   `data/projects/<slug>/knowledge/*.md`.
4. **Brief.** `npm run seo -- write <slug> --topic "<topic>" --keyword "<primary keyword>"`
   → `drafts/<topic>.brief.md`.
5. **Write.** Read the brief and write the article to the path it names, following its Rules
   exactly. Every fact about the business must come from the interview/knowledge; write
   `[NEEDS DATA: …]` where something is missing. Never invent clients, numbers or quotes.
6. **Check and revise.** `npm run seo -- check <slug> --topic "<topic>"`. If it says
   NEEDS REVISION, apply the listed notes and re-run until PASS (max 3 rounds; if it still
   fails, report the remaining notes to the user).
7. **Human edit (mandatory):** a person resolves every `[NEEDS DATA]`, checks every claim,
   adds a real author, reads it aloud once.
8. **Publish** through the site's repo (route/MDX/data entry) with the frontmatter title and
   description, BlogPosting + BreadcrumbList JSON-LD (`seo tags` format), and 2–3 internal
   links to service pages. Open a PR.

API mode (`--via api`, needs ANTHROPIC_API_KEY) does steps 5–6 automatically — use it only
for batch/unattended runs.

## Quality bar before publishing

- Voice ≥ 85, no `stock-phrases` / `no-first-hand` / `needs-data` findings.
- AEO ≥ 70: every question H2 opens with a direct 25–70 word answer.
- GEO: at least 3 concrete numbers from our own work, 1 attributed quote, a one-line definition
  of the main term (GEO paper, KDD 2024: statistics, quotations and cited sources raised
  AI-answer visibility up to ~40%).

## Why this approach (tell clients)

Google's guidance: AI-assisted content is fine; content made *primarily to rank* at scale is
spam ("scaled content abuse"). What ranks and gets cited is people-first content with real
experience. The interview step is how a team without SEO writers produces that consistently.
