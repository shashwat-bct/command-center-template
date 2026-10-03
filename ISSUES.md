# Data accuracy issues

Tracks every known gap between what the dashboard shows and what was actually measured.
Source: audit of `lib/` + the vendored builder, and the production builds in `gs://bct-cco-payloads-bravo-platform-bc` (2026-10-03).

Status: `open` · `fixed` · `blocked` (needs a decision, a key, or new infrastructure) · `won't fix`

Regression test: `npm run test:relabel` (77 checks) runs the real builder with injected measurements and fails if any of them don't reach the dashboard, if anything unmeasured is shown, or if a label is wrong.

## Where it stands

Every brand, including `sonos`, `sony` and `shark`, is built **measured-only**: every figure is read from Keepa, Apify or Claude on that build, and anything without a source is blank and marked "not measured". Nothing is simulated. Amazon is the only retailer covered.

Only measured-only builds are served. A brand whose latest build predates this (simulated or relabelled Sonos data) answers 409 and the dashboard says to rebuild it; the bundled simulated payloads in `vendor/` are no longer served as a fallback (the vendored builder and its config are still used as the skeleton the measured series are written into).

| Lane | Source | Status on the dashboard |
|---|---|---|
| AI visibility | Claude, 12 questions × 2 runs, subject + 4 competitors | measured (single reading, drawn flat) |
| Pricing, Promotions, Promo calendar, Promo strategy | Keepa daily Amazon price + list price; price cuts detected from it | measured |
| Availability | Keepa daily buyable state | measured |
| Carriage & buy box | Keepa listing dates, offer counts, buy-box seller history | measured |
| Voice of customer | Keepa daily rating and review count | measured (aspects not measured, hidden) |
| Landing pages | Apify product page (images, video, A+, bullets, specs, reviews, title fit) | measured (single reading) |
| Delivery | Apify delivery promise on the build date | measured (single reading, last week only) |
| Amazon demand (replaces Website traffic) | Keepa "bought in past month" history and daily sales rank in the category the listings share | measured; website visits still not measured |
| Retail shelf | Apify: first 48 organic Amazon results for the category, attributed by title | measured (single reading); sponsored placements not identified |
| Effective price (replaces Cost of ownership) | Keepa daily price, lightning-deal price, clip-coupon history | measured; protection plans and attach rates not measured |

Live verification: `theragun-verify` / `b_FsYpKPp6h-` (2026-10-03) — 13 listings across 4 brands, 17 product pages, 48 search results, 24/24 Claude answers, 10 of 12 measures for the subject (website traffic share and sessions remain unmeasured), all 15 pages render. Real findings: Theragun holds 4 of the first 48 organic "massage gun" results (best #16) and ≥7,000 purchases/month (66% of tracked); no coupons or lightning deals ran on any tracked listing in the window.

Older builds are retired, not shown: rebuild them from `/admin` to get measured-only dashboards.

Cost per build: ~100 Keepa tokens (buy-box history is 4 tokens per listing), ~$0.07 Apify (product pages + one search), 24 LLM proxy calls.

## 1 · Real data that never reached the dashboard

| ID | Issue | Fix | Status |
|---|---|---|---|
| D1 | Claude AI share was overwritten by Sonos's per-engine/per-stage values (every brand showed 37.95%). | Claude is the only engine; shares and per-stage splits written directly; scorecard value is the exact reading. | fixed |
| D2 | In-stock was 0/1 and meant "ever in stock" (every Keepa build showed 98.18%). | Daily buyable state from Keepa history. | fixed |
| D3 | Seven overridden fields were never read but claimed as "real data merged". | Removed; disclosure built from what reached the payload. | fixed |
| D4 | Full-price listings dropped out of the discount average. | Counted as 0%. | fixed |

## 2 · Captured data about the wrong products, or empty

| ID | Issue | Fix | Status |
|---|---|---|---|
| Q1 | ASIN discovery didn't check the brand (GoPro → Levoit, Yeti → Titan, GoPro → AKASO, Theragun → TOLOCO). | Listings whose brand/title doesn't name the brand are excluded and logged. | fixed |
| Q2 | Apify returned nothing usable but was labelled real. | Parser fixed (Q5); only used where its fields reach the dashboard. | fixed |
| Q3 | Claude step reported 0% when every call failed. | Step fails on all-failed or zero mentions. | fixed |
| Q4 | Claude share noisy at 8 questions. | 12 questions × 2 runs; per-run shares in the ledger. | fixed |
| Q5 | Apify mapping wrong (`price` is an object). | Parser rewritten against a real dataset item (fixture tested); reads brand, seller id, delivery, product-page content. | fixed |

## 3 · Sonos data presented under the new brand

| ID | Issue | Fix | Status |
|---|---|---|---|
| R1 | Traffic anchored to sonos.com etc. | Traffic not measured; lane blank. | fixed |
| R2 | Sonos speaker review aspects on every brand. | Aspects withheld; aspect cards hidden when no brand has them. | fixed |
| R3 | Category stayed "wireless and smart speakers". | From the request; stage questions and terms from the category. | fixed |
| R4 | Competitor columns were Sonos's rivals' numbers. | Competitors measured the same way as the subject; a competitor with no listings is blank except AI share. | fixed |
| R5 | Method ledger described Sonos captures as this brand's. | Ledger lists only this build's sources, plus each unmeasured lane. | fixed |
| R6 | AI prompt tiles simulated from Sonos's speaker prompts. | Prompt table, presence, leader and stage split from Claude's answers. | fixed |
| R7 | Sonos launch effects lifted the relabelled brand. | Removed. | fixed |
| R8 | Model names were Claude guesses on Sonos MSRPs. | Only real listings appear as models (title + Amazon list price); Claude product-name calls removed. | fixed |
| R9 | Page intros and text stated Sonos's conclusions for every brand. | Intros fixed; builder narrative replaced by factual statements from measured values; assumed price-floor (MAP) policy removed; Method copy mode-aware. | fixed |
| R10 | Withheld aspect table still showed Sonos aspect names. | Hidden when no brand has aspects. | fixed |
| R11 | Keepa review counts jump when Amazon regroups variants (Lifepro ~1,349 reviews/day). | Day-to-day changes over 2% (min 50) treated as reindexing. | fixed |
| R12 | Claude share moved between runs (34.9% → 38.0%). | Two runs per build, pooled; live runs agreed within 0.7 pts. | fixed |

## 4 · Labelling

| ID | Issue | Fix | Status |
|---|---|---|---|
| P1 | No per-number provenance. | `meta.provenance` per metric per brand; badges on tiles; unmeasured cells shown as "—". | fixed |
| P2 | Hard-coded banner text. | Banner, header chip and page notes rendered from provenance; legacy builds get a fallback banner. | fixed |
| P3 | Disclosure built from what was attempted. | Built from what was applied. | fixed |

## 5 · Replacing simulation with real data

| ID | Lane | Status |
|---|---|---|
| L0 | Pricing, Stock, Voice, Carriage (Amazon) from Keepa daily history | fixed |
| L1 | Landing pages and delivery from Apify | fixed (single reading per build) |
| L2 | Best Buy / Target / Walmart / Newegg — shelf, carriage, price, promotions, delivery | blocked — needs a scraper per retailer and a scheduled weekly capture so history accumulates; until then these retailers are not shown |
| L3 | Website traffic (visits) | blocked — needs a SimilarWeb key, or SimilarWeb pages via Bright Data (monthly levels only). Amazon demand is shown in its place. |
| L5 | Retail shelf (Amazon) | fixed — Apify search, single reading per build |
| L6 | Effective price (real part of cost of ownership) | fixed — Keepa deals + coupons; attach-rate costs not measured |
| L7 | Amazon demand | fixed — Keepa monthly-sold history + category sales rank |
| L8 | Sponsored share on the shelf | open — the Apify crawler doesn't flag sponsored results; needs a different capture (Bright Data scraping browser) |
| L9 | History for single-reading lanes (shelf, AI, product pages, delivery) | open — weekly scheduled rebuilds |
| L10 | Review aspects | open — Amazon reviews (Apify) scored by Claude |
| L11 | ChatGPT / Gemini / Perplexity | open — check the `geolive` Cloud Run service |
| L4 | Show "not measured" instead of simulating | fixed |

## 6 · Builder, process and access

| ID | Issue | Fix | Status |
|---|---|---|---|
| T1 | No test caught real data being dropped. | `npm run test:relabel`. | fixed |
| T2 | Builds stuck in `running`. | Marked failed after 30 minutes on read. | fixed |
| T3 | Not verified live. | `b_YfqbPGs-8E`, see above. | fixed |
| B1 | Simulator produced `NaN` event lengths once the window moved. | Anchors only to events inside the window. | fixed |
| B2 | No Shark logo in `public/brand-marks/` (the old payload pointed at a missing `shark.svg`). | Measured builds use `/brand-marks/<slug>.png` when present and the brand name otherwise; add `shark.png` to show a logo. | open — needs the asset |
| B3 | The committed `vendor/.../sonos-command-center-data.json` was not reproducible from the vendored inputs. | Moot: vendored payloads are no longer served; Sonos is built measured-only like every brand. | fixed |
| B5 | Simulated builds were still served (vendored fallback, and old GCS builds). | Vendored fallback removed; payload, share and magic-link endpoints serve only `measured-only` builds (409 otherwise). | fixed |
| B6 | Claude step failed after the server had run for an hour (proxy token cached forever → 401), and a failed AI step left simulated AI data in the payload. | Token refreshed per call with one forced retry on 401; AI data blanked when not measured. | fixed |
| B4 | All builder edits must leave vendored brands unchanged. | Verified: Sonos, Sony and Shark outputs are byte-identical before and after every edit. | fixed |
| A1 | Dashboards were public, so magic-link expiry restricted nothing. | Admin session or share link required (open when `ADMIN_SHARED_SECRET` is unset). | fixed |
| A2 | `MAGIC_LINK_SECRET` not in Secret Manager / Cloud Run. | At deploy: `openssl rand -hex 32 \| gcloud secrets create MAGIC_LINK_SECRET --data-file=- --project bravo-platform-bc`, grant the runtime SA `secretAccessor`, then `--update-secrets MAGIC_LINK_SECRET=MAGIC_LINK_SECRET:latest` on `command-center-next`. | open — run at deploy (creates a Cloud Run revision) |
| A3 | `BRIGHTDATA_SERP_KEY` unused on Cloud Run. | Kept for L2. | won't fix |
