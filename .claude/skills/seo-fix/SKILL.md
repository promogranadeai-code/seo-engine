---
name: seo-fix
description: Automatically fix a website's technical and on-page SEO in its source code using seo-engine's audit.json and tags.json — titles, descriptions, H1s, canonicals, Open Graph, JSON-LD, sitemap/robots/llms.txt, alt text, joined heading words, internal links — then re-audit and open a PR. Use when asked to "fix the SEO", "apply the audit", or "do the technical SEO" for a site whose repo we have.
---

# /seo-fix — apply technical SEO fixes in a site's code

**What this skill is:** the procedure Claude follows to turn the engine's audit
into code changes in the client's repo, verify them with a re-audit, and hand a
PR to a human. Nothing goes live without a person merging the PR.

---

## Procedure

1. **Inputs.** `data/projects/<slug>/project.json` (`repoPath`), `audit.json`, `tags.json`,
   `keywords.json` (optional). If `audit.json` is older than the last commit to the site, re-run `seo audit`.
2. **Branch.** In `repoPath`: `git checkout -b seo/fixes-<date>`. Never commit to main.
3. **Detect the stack** (`package.json` → `next`, `wp-content/` → WordPress, `config/settings_data.json` → Shopify theme)
   and read its conventions first. For Next.js read `node_modules/next/dist/docs/` if the repo's AGENTS.md says APIs changed.
4. **Fix by recipe**, errors first, then warnings, then notices. Group commits by recipe.
5. **Verify.** Build and serve locally, then `seo audit <slug> --local http://localhost:3000`.
   The fixed issue IDs must be gone and no new errors may appear. Run the site's own lint/tests/build.
6. **PR.** Push the branch and open a PR listing: issues fixed (before → after counts),
   health score before/after, anything left for a human (copy decisions, real author names, prices).

## Recipes (audit `recipe` → what to change)

| Recipe | Next.js App Router | WordPress | Shopify |
|---|---|---|---|
| `set-title`, `set-meta-description` | `export const metadata` / `generateMetadata` in the route's `page.tsx`; use text from `tags.json` | Yoast/RankMath fields or `wp_head` filter | `{% section 'seo' %}` / product SEO fields |
| `add-open-graph` | Page `openGraph` **must repeat `images`** (it replaces the layout's) | SEO plugin social tab | theme `social-meta-tags.liquid` |
| `add-canonical` | `alternates: { canonical }` (relative path + `metadataBase` in layout) | SEO plugin | `canonical_url` in theme.liquid |
| `set-h1`, `fix-joined-heading-words` | Exactly one `<h1>`; in span-per-word components render `{" "}` between words | theme template | section liquid |
| `add-json-ld` | `<script type="application/ld+json">` in the page/server component, JSON from `tags.json` | plugin schema | `structured_data` filter |
| `add-sitemap`, `clean-sitemap` | `app/sitemap.ts` from the content source | SEO plugin sitemap | built-in |
| `add-robots`, `allow-ai-crawlers` | `app/robots.ts`; allow OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot | robots.txt editor | `robots.txt.liquid` |
| `add-llms-txt` | `public/llms.txt` from `data/projects/<slug>/llms.txt` (or a route handler) | upload to root | not supported natively; skip |
| `add-alt-text` | `alt` on `<Image>`/`<img>`; describe content, `alt=""` for decoration | media library | image alt fields |
| `fix-internal-links`, `add-internal-links` | update hrefs; add contextual links from strong pages to pushed pages | editor | editor |
| `redirect-or-restore`, `collapse-redirects` | `redirects()` in `next.config` | Redirection plugin | URL redirects admin |
| `set-lang`, `add-viewport` | root `layout.tsx` (`<html lang>`, `viewport` export) | theme header | theme.liquid |
| `expand-content`, `dedupe-content`, `add-qa-sections` | **Not automatic** — create a `seo-write` task instead | — | — |
| `improve-ttfb`, `reduce-html`, Core Web Vitals | Static rendering, `next/image`, defer heavy client components/WebGL | caching plugin | theme optimisation |

## Rules

- Change only what the audit asks; keep the site's style and copy voice. Copy changes
  (titles/descriptions) come from `tags.json`, adjusted to sound like the site.
- Never invent facts in JSON-LD: leave `TODO` fields (author, dates, prices) for a human and list them in the PR.
- Never weaken robots rules for private areas; never add `noindex` without asking.
- If a fix needs a product decision (merging pages, deleting content), propose it in the PR instead of doing it.
