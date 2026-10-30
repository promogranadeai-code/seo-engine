---
name: seo-write
description: Produce original, human-voiced SEO/AEO/GEO articles with seo-engine — mine questions, run an expert interview, write only from first-party answers and knowledge files, lint for generic/AI-sounding prose, check answer-first structure, then publish via the site's repo. Use for "write a blog", "answer these questions", "AEO/GEO content".
---

# /seo-write — original content that reads like a person wrote it

**What this skill is:** the content workflow. The rule that makes it work: we never
summarise the internet. Answers come from our own people (interview) and our own
documents (`knowledge/`). Claude shapes them into an answer-first article; a linter
catches stock phrasing and flat rhythm; a human edits and approves.

---

## Steps

1. `seo questions <slug>` → `questions.md`. Pick a topic group with real demand and no existing answer on the site.
2. `seo interview <slug> --topic "<topic>"` → `interviews/<topic>.md`. Send it to the person who
   knows the topic. Voice-note transcripts and rough bullets are fine. **At least 3 real answers are required.**
3. Optional: drop case studies, process docs, pricing notes, a voice guide into
   `data/projects/<slug>/knowledge/*.md`.
4. `seo write <slug> --topic "<topic>" --keyword "<primary keyword>"` → `drafts/<topic>.md` +
   `drafts/<topic>.check.md` (voice score, AEO, GEO). The writer revises up to twice.
5. **Human edit (mandatory):** resolve every `[NEEDS DATA: …]`, check every number and claim,
   add a real author name, read it aloud once. `seo lint <file>` re-checks after edits.
6. Publish through the site's repo (new route/MDX/data entry), with the frontmatter title/description,
   BlogPosting + BreadcrumbList JSON-LD (`seo tags` format), and 2–3 internal links to service pages. Open a PR.

## Quality bar before publishing

- Voice score ≥ 85, no `stock-phrases` / `no-first-hand` / `needs-data` findings.
- AEO ≥ 70: every question H2 opens with a direct 25–70 word answer.
- GEO: at least 3 concrete numbers from our own work, 1 attributed quote, a one-line definition of the main term
  (GEO paper, KDD 2024: statistics, quotations and cited sources raised AI-answer visibility up to ~40%).

## Why this approach (tell clients)

Google's guidance: AI-assisted content is fine; content made *primarily to rank* at scale is spam
("scaled content abuse"). What ranks and gets cited is people-first content with real experience.
The interview step is how a team without SEO writers produces that consistently.
