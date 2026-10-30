# Methodology — where every number comes from

seo-engine re-creates the **publicly documented** methods of Ahrefs and Semrush
and the open-source workflows of [OpenSEO](https://github.com/every-app/open-seo)
(MIT). Nothing here is scraped or decompiled from a commercial product. Research
compiled 2026-10-30. **Labels:** Q = quoted from the primary source; A = approximate
or from a secondary source restating it; U = unverified. Re-verify A/U items
before quoting them to clients.

## Data sources

| Data | Source | Notes |
|---|---|---|
| Keyword volume, CPC, intent, provider KD | DataForSEO Labs `keyword_ideas`, `keyword_overview`, `ranked_keywords` | Paths and payloads follow OpenSEO's production client |
| Live Google results, People-also-ask, SERP features | DataForSEO SERP `google/organic/live/advanced` | `backlinks_info.referring_domains` per result when present |
| Site authority, referring domains | DataForSEO Backlinks `summary` (`rank_scale: one_hundred`), `referring_domains` | Our DR / Authority Score analogue |
| Competitors, bulk referring-domain counts | `competitors_domain`, `bulk_referring_domains` | **U** — written without access to live docs; the engine tolerates failures |
| First-party clicks/positions | Google Search Console API (service account) | Free; best data for sites we own |
| Writing / analysis | Claude (default `claude-opus-5-5`) | Structured output for lists; adaptive thinking for writing |

## Keyword difficulty (KD)

Ahrefs: KD is "based on the number of referring domains the top-10 ranking pages
have" (Q), a weighted average with outliers removed (Q), no on-page factors (Q),
0–100 (Q). Published mapping (Q/A, ahrefs.com/keyword-difficulty):

| KD | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 |
|---|---|---|---|---|---|---|---|---|---|---|
| ~RDs for top 10 | 0 | 10 | 22 | 36 | 56 | 84 | 129 | 202 | 353 | 756 |

**Ours** (`src/keywords/metrics.ts`): take the top-10 RDs, drop the min and max
when ≥ 6 results, weight position *i* by 1/√i, then map the weighted RD to KD by
log-linear interpolation of this table. Weights are ours (Ahrefs doesn't publish
theirs). When SERP RDs are unavailable we fall back to DataForSEO's KD.

**Labels** use Semrush KD% bands (Q/A, semrush.com/kb/1158): 0–14 very easy,
15–29 easy, 30–49 possible, 50–69 difficult, 70–84 hard, 85–100 very hard.

## Rankability (personal difficulty)

Semrush's Personal KD weighs a domain's topical relevance and its metrics against
the ranking domains (A; formula not public). Ours, 0–100 (higher = easier):

- Start at `100 − KD`.
- **Link gap:** `log2((ourRD+1)/(needRD+1)) × 8`, clamped −30…+10. `needRD` is the
  page-1 median RD, or implied by KD via the table above.
- **Authority gap:** `(ourAuthority − SERP median authority) × 0.6`, clamped −30…+15, when known.
- **Relevance:** `(relevance − 0.6) × 25`. Relevance is the share of keyword stems
  found in the site's titles/headings/services (1.0) or body (0.5).
- **Existing rankings:** +25 on page 1, +15 on page 2, +6 for positions 21–50.

**Buckets:**

| Bucket | Rule |
|---|---|
| off-topic | relevance < 0.2 |
| quick-win | ranking 4–20 and rankability ≥ 45 |
| target-now | rankability ≥ 60 |
| build-up | rankability ≥ 40 |
| long-term | everything else |

## Traffic and opportunity

- **CTR curve:**
  - Positions 1–3 and 10 from Sistrix 2020, 80M keywords (A): 28.5%, 15.7%, 11.0%, 2.5%.
  - Positions 4–9 are interpolated.
  - Positions 11–20 from AWR 2016 desktop (A).
  - Studies differ about 5× by method, so calibrate per site from Search Console when available.
- **AI Overviews:** Ahrefs (Feb 2026) measured CTR drops of −58% at #1, −50.8% at #2,
  −46.4% at #3 and −19.4% at #10 when an AI Overview is present (A). We apply
  these factors and interpolate positions 4–9.
- **Ahrefs Traffic Potential** = total traffic of the #1 page across all its keywords
  (Q/A). We approximate it with volume × CTR; true TP needs the #1 page's ranked keywords.
- **Opportunity:**
  `clicks(realistic position) × intent value × (1 + ln(1+CPC)/2) × rankability/100`.
  - The realistic position is #3, #6 or #10, by rankability.
  - Intent values: transactional 1.0, commercial 0.85, informational 0.45,
    navigational 0.25.
  - Intent labels follow Semrush's I/N/C/T scheme.

## Clustering

Semrush says it clusters by search intent and SERP similarity, without publishing
a threshold (A/U). We cluster when the top 10 results share ≥ 4 URLs; industry
tools use roughly 3–4 of 10. Without SERP data we fall back to stemmed-token
Jaccard ≥ 0.5.

## Ranking timeline

Anchors:

- **Ahrefs 2017** (A): 5.7% of new pages reached the top 10 within a year. Those
  that did mostly took 61–182 days. The average top-10 page was over 2 years old.
- **Ahrefs 2025** (A): 1.74% of new pages reached the top 10 within a year. 72.9%
  of top-10 pages are over 3 years old.
- **Backlinko × Ahrefs** (A): the #1 result has about 3.8× the backlinks of
  positions 2–10. We use roughly 2× the page-1 median for a top-3 goal.

**Baseline maturation by KD band** (our calibration of those anchors):

| KD | < 15 | < 30 | < 50 | < 70 | < 85 | ≥ 85 |
|---|---|---|---|---|---|---|
| Months | 2 | 4 | 7 | 11 | 16 | 24 |

**Expected time:**

- **New or unranked page:** `max(baseline, content time + link gap ÷ link pace + 1.5)`.
  - Content time is 1 month for a new page.
  - Link gap = `needRD × (1 − authority credit)`, where authority credit =
    `min(authority, 80)/100 × 0.6`.
- **Ranking #11–20:** `max(1.5, 0.4 × baseline, …)`.
- **Already at the goal:** 0.

**Range and chance:**

- Optimistic = 0.6× expected. Conservative = max(1.7×, +2 months).
- Chance in 12 months = `rankability × min(1, 12 ÷ expected)`, clamped to 2–90%.

These are heuristics calibrated to the studies above, not a trained model. Once
we have our own client history, refit the baselines.

## Technical audit

The checks combine Semrush Site Audit, Ahrefs Site Audit and OpenSEO's audit, plus
AEO/GEO checks: llms.txt, AI-crawler access, question-led sections, and joined
heading words.

**Health score:** the Ahrefs-style share of crawled pages with no error-level
issue. Semrush's Site Health weights errors over warnings but doesn't publish the
formula (A).

## Tags and structured data

- **Titles:** at most 60 characters, keyword first, brand last.
- **Descriptions:** 140–160 characters. Google may rewrite either (Q, developers.google.com).
- **Markup we never generate:**
  - FAQPage: rich results limited to government/health sites in 2023, removed from
    Search in 2026 (A).
  - HowTo: deprecated September 2023 (A).
  - Sitelinks search box: removed November 2024 (A).
- **Breadcrumbs:** now shown on desktop only (Q/A, January 2025).
- Treat Google's [Search Gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery)
  as the source of truth.

## AEO / GEO

- **GEO paper:** Aggarwal et al., *GEO: Generative Engine Optimization*, KDD 2024
  ([arXiv 2311.09735](https://arxiv.org/abs/2311.09735)).
  - Up to **40%** visibility gain in generative answers (Q).
  - The per-method figures below are from secondary sources (A/U). Verify them
    against the paper's Table 1:

    | Method | Reported gain |
    |---|---|
    | Quotation addition | ~+41% |
    | Statistics addition | ~+33% |
    | Citing sources | ~+27–30% |
    | Keyword stuffing | no gain |

- **Ahrefs, 75k brands** (A): branded web mentions correlate with AI Overview
  visibility at ρ = 0.664, versus 0.218 for backlinks. This is why the off-page
  plan includes unlinked mentions and digital PR.
- **Google** (Q): there are "no additional requirements to appear in AI Overviews
  or AI Mode"; normal SEO fundamentals apply. AI-generated content is allowed, but
  scaled, ranking-first content is spam (A). Hence the interview-first writer and
  the human edit step.

## Not done (yet)

- Our own web-scale backlink index. That needs a crawler fleet; we rent DataForSEO's.
- A true Traffic Potential / Parent Topic, which needs the #1 page's full keyword
  set. Feasible with one extra `ranked_keywords` call per keyword.
- Rank tracking over time. Planned: store dated SERP checks per project.
