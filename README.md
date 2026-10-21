# Commercial Command Center

Next.js app that builds and serves per-brand command-center dashboards.

## Run locally

```bash
npm ci
gcloud auth application-default login   # needs access to bravo-platform-bc (BigQuery + GCS)
npm run dev
```

Dashboards are served from Cloud Storage, so GCP access is required; there is no local fallback.

`.env.local`:

| Variable | Needed for |
|---|---|
| `INS_KEEPA_KEY` | Creating a brand (listing discovery, rating, discount, in-stock) |
| `MAGIC_LINK_SECRET` | Share links (≥ 32 chars) |
| `ADMIN_SHARED_SECRET` | Locks dashboards and admin APIs; unset = open (local dev) |
| `APIFY_TOKEN` | Product pages and delivery promise (optional; those lanes are blank without it) |

Run `npm run test:relabel` after touching `lib/` — it runs the real builder with injected measurements and checks they reach the dashboard with the right labels. Known data gaps are tracked in `ISSUES.md`.

## Routes

| Route | What |
|---|---|
| `/` | Brand list |
| `/admin` | Create a brand; lists every brand with View · Edit · Rebuild |
| `/admin?from=<slug>` | The form pre-filled with what that brand was last built with |
| `/admin/building/<build_id>` | Build progress |
| `/<id>` | Dashboard, at the brand's fixed share id (a UUID derived from the slug with `MAGIC_LINK_SECRET`); this is the link you share, no sign-in needed |
| `/<slug>` | Redirects an admin to `/<id>` |
| `/share#<token>` | Older signed magic links, still honoured |
| `/api/magic-links` | Create a share link — see below |
| `/api/admin/session` | Sign in (`POST {token}`) / out (`DELETE`) |
| `/api/brands` | List / create brands (BigQuery `cco_mgmt.brands`). `POST` takes the form's fields plus optional `asins` (the subject's Amazon listings, in place of product discovery) and `competitorAsins` (`{"<competitor name>": ["<ASIN>", …]}`, in place of the Keepa search for that competitor); both are saved and reused by Rebuild |
| `/api/brands/<slug>` | The inputs the brand was last built with |
| `/api/brands/<slug>/rebuild` | Rebuild with those inputs (`POST`) |
| `/api/builds/<build_id>` | Build status (BigQuery `cco_mgmt.builds`) |
| `/api/payloads/<slug>` | Dashboard data: latest build for admins, or the pinned build for `Authorization: Bearer <magic token>` (202 while it builds) |
| `/api/health` | Health check |

## Magic links

Full reference: [`docs/magic-link-api.md`](docs/magic-link-api.md).

`POST /api/magic-links` (admin: `Authorization: Bearer <admin token>` or `x-admin-token`)

```json
{
  "brand_name": "Ninja",
  "brand_category": "air fryer",
  "brand_product": ["Foodi DualZone", "Crispi"],
  "brand_link": "https://www.ninjakitchen.com",
  "competitors": ["Cosori", "Instant Pot"],
  "rebuild": false
}
```

`brand_name` and `brand_category` are required. If the brand has a current (hybrid) build it is reused (`201`, with `built_with` showing that build's inputs; `rebuild: true` forces a new one). Otherwise a build starts and the link is returned at once (`202`); the recipient sees "being built" until it is ready. Without `competitors`, Claude names four. `{ "slug": "anker" }` still works for an existing brand. The link is the brand's fixed `/<id>` and always shows its latest ready build; `partner_id`, `label` and `expires_in_hours` are accepted and ignored.

Response: `url` (`https://<host>/<id>`), `id`, `slug`, `build { id, status, poll_url }`, `brand`, `competitors`, `competitors_source`, `built_with`.

## Build pipeline (`lib/capture.ts`)

Every build is **hybrid**: lanes with a live source are measured on that build, and the rest of the market (other retailers, cities, website traffic, review themes, promotion mechanics, cost of ownership) is modelled around those measurements by the vendored builder, seeded per brand so each brand gets its own figures and the same figures on every rebuild. The dashboard shows no per-card markings; the header chip ("Measured + modelled") and the Method page list which lanes are which. See `ISSUES.md`.

1. Find Amazon listings with Keepa search (category or product names); keep only listings whose brand/title names the brand, then ask Claude which of those are actually in the category (`lib/listing-relevance.ts`), so a brand's other products (Scott toilet paper next to wipes) are dropped. Same for each competitor.
2. Keepa: 13 weeks of daily price, list price, buyable state, offer count, buy-box seller, rating and reviews per listing (`lib/keepa.ts`, `lib/amazon-series.ts`).
3. Apify: product-page content and delivery promise per listing, and the first 48 organic Amazon results for the category (`lib/apify.ts`, `lib/amazon-shelf.ts`). Keepa also supplies monthly purchases, sales rank, lightning deals and coupons for the Amazon demand and effective-price pages.
4. AI visibility (`lib/ai-visibility.ts`, `lib/ai-engines.ts`): the same 12 shopper questions × 2 runs go to ChatGPT and Gemini through their consumer apps (chatgpt.com, gemini.google.com) via Bright Data's AI scrapers (`lib/brightdata.ts`, snapshots of 3 questions run in parallel, about 3 minutes per engine; Perplexity and Copilot scrapers are defined there but switched off because their snapshots did not complete, `BRIGHTDATA_API_KEY` or `BRIGHTDATA_SERP_KEY`), and Claude through the Atlas LLM proxy (an API path: Bright Data has no Claude scraper). Each engine's path, consumer UI or API, is recorded in the payload and shown on the dashboard. A Claude extraction pass lists every brand each answer names, mapping product lines and parent companies to the tracked brands (name matching is the fallback). A brand counts once per answer, and untracked brands count in the total, so share = this brand's answers ÷ all brand mentions. Reported per engine, per stage and averaged across engines. Claude also names the category's review themes.
5. Market profile (`lib/market-profile.ts`, `lib/market-mechanics.ts`): Claude drafts the category's real market (4–5 retailers that sell it in the region with their share, which brands each one stocks, the promotion mechanics each runs from a fixed library, each brand site's monthly visits, how much each retail event lifts the category, and whether the goods are durable); a second Claude pass audits the draft and corrects anything untrue; code then clamps every value, keeps Amazon, and drops protection plans, financing and trade-ins for consumables. The profile is saved as `meta.marketProfile` and reused on rebuilds with the same category, region and brands. Without Claude it falls back to Amazon, Walmart and Target. The Method page lists it as a modelled input.
6. Other retailers (`lib/retail-offers.ts`, `lib/retail-sites.ts`): each tracked listing's name is searched on the retailer's own site — Walmart's search page through Bright Data's Web Unlocker (zone `web_unlocker1`, override with `BRIGHTDATA_UNLOCKER_ZONE`), Target's product search API directly (its public web key is read from target.com; Bright Data is the fallback). Only offers the retailer sells itself are kept (Walmart's `sellerName` is `Walmart.com`), so marketplace resellers never stand in for the retailer's price. Retailers without a reader (Costco, CVS, …) stay modelled and the build log says so. Claude then keeps the results that are the same product — same named line ("Fresh Feel" is not "Fresh Care"), scent or formula, format (pocket packs and singles are not standard packs) and model — and reads each one's unit count. A different pack size is priced per unit and restated for the Amazon listing's quantity (Target's 5×48 Mint Chill at $17.99 reads $21.59 for a 288-ct Amazon listing); the closest pack size wins per retailer. A listing whose count can't be read is kept as the same quantity only when its price is within 0.6–1.6× the Amazon price. Each reading keeps the product's URL, and when nothing matches the build log lists the offers found and how each was judged. Readings are appended to `gs://<payload bucket>/retail-offers/v1/<slug>.json` (120 days kept; the latest run of a day replaces that day), and the builder lays every reading in the window over the modelled series. From a retailer's first reading on, its price, discount and price cuts are real and the last reading carries forward; days before that, and products a retailer doesn't sell, stay modelled. A reading taken after the window closes stands for its last day. Google Shopping was tried first and dropped: it mixes marketplace resellers in with the retailer, lags on price, often leaves the pack size out and misses products the retailer sells.
7. Run the vendored builder with a per-build config overlay (`lib/launch-override.ts`, `lib/simulated-world.ts` → `config-relabel.mjs`): the real listings and series, the US retail calendar for the window, category search terms and review themes, and every behavioural parameter varied by a generator seeded with the slug. The reference brand's captures are replaced with empty ones so nothing it measured anchors another brand.
8. Lay the measurements over the modelled market and stamp per-lane provenance (`lib/payload-merge.ts`, `lib/provenance.ts`, `lib/relabel-pipeline.ts`); rename slots (`lib/rebrand.ts`).
9. Apply `brand-data/<slug>.json` if present (`lib/brand-overrides.ts`): a deep merge into the payload, keyed by the final brand and listing ids. It can replace any modelled value but not measured AI share or Amazon series. See `brand-data/_example.json`.
10. Upload to GCS, record in BigQuery. The request (name, category, competitors, products, region, link) is saved on the build row and in the payload's `meta.request`, so a brand can be rebuilt without re-entering it; builds from before that are read back from their payload and build log.

Hybrid and measured-only builds are served; builds from before per-lane provenance answer 409 until rebuilt. Only hybrid builds are reused for new links.

Cost per build: ~100 Keepa tokens, ~$0.07 Apify, 24 Bright Data records each for ChatGPT and Gemini, one Bright Data Web Unlocker request per tracked listing for Walmart, ~33 LLM proxy calls (Claude answers, brand extraction, review themes) plus one per tracked listing for offer matching. Production needs `BRIGHTDATA_API_KEY` (or the existing `BRIGHTDATA_SERP_KEY`) as a Cloud Run secret; without it only Claude runs. A Bright Data snapshot takes a few minutes, so a build's AI step and a live console run are slower than the old API path. An engine that fails is left out of the build and listed as failed on the Method page.

### Retailer feed (any retailer's data)

`brand-data/<slug>.feed.json` is one retailer-agnostic file of everything collected about a brand's products at other retailers (`lib/retail-feed.ts`). A scraper for any retailer writes the same shape:

- `products`: one per retailer item (`walmart:<item>`), with brand, title, URL, UPC, unit count, and the tracked Amazon listing it matches (`asin`, `listingUnits`, `match`: `upc` for the same item, `line` for the same line and scent in another pack).
- `daily`: per item and day, the buy-box price (the retailer's own offer price when no buy-box reading exists), crossed-out price, in-stock state, stock count, offer count, buy-box seller, rating and review count, and the sources read.
- `reviewSummary` and `reviews`: the retailer's rating totals, star breakdown, review highlights and individual reviews.

On a build (`lib/capture.ts`) the feed does three things:

1. Its prices join the live website readings, restated for the listing's pack size. A live reading wins on its day.
2. Every tracked listing it covers becomes measured at that retailer. The builder's measured path, which used to serve only Amazon (`measuredFor` in the vendored builder), now takes any retailer's daily price, list, stock, offer count and buy box, so carriage, stock-outs, seller count, buy-box share, price cuts and price index come from the data. A day without a reading counts as in stock. A price, offer count or buy-box holder older than 45 days is not carried.
3. Its weekly view from January 2025 and its reviews are attached as `payload.retailFeed`. They feed Voice of Customer: the retailer's reviews are counted into each aspect, with their quotes and products in the aspect drawers.

Provenance keeps the feed apart from website reads (`record.retail.imported`, `record.retail.measured`), and the lane notes, ledger and analyst view name it as its own source.

`scripts/import-retailer-csv.ts` writes a feed from the cleaned Walmart CSVs and a match table (`brand-data/<slug>.matches.json`):

```
npx tsx scripts/import-retailer-csv.ts --clean <dir with all_data_clean.csv, review_summary_clean.csv, reviews_clean.csv> \
  --matches brand-data/dude-wipes.matches.json --out brand-data/dude-wipes.feed.json \
  --retailer walmart --label "Walmart data (Histomart, Kompy, RetailerAPI)" --on 2026-10-21
```

`dude-wipes` pins its tracked listings to the products in that feed: `asins` for the subject and `competitorAsins` for Charmin, Cottonelle and Goodwipes. Pinned listings are never merged as colour variants, and a brand may track up to eight listings. There are 18 of 20 Walmart items: 9 are the same item by UPC (through Keepa), and 9 are the same line and scent in Amazon's own pack size. Cottonelle Ultra Fresh has no Amazon line, so it appears only in the reviews.

### Daily retailer prices

`POST /api/retail-offers` (admin token) takes one more retailer-site reading for every product on each brand's latest dashboard and adds it to the stored history, without rebuilding. Body `{ "slugs": ["anker"] }` limits it to some brands; without it every brand is read. It answers `202` and works in the background. The next build of a brand picks up every reading in its window. Run it daily from Cloud Scheduler:

```
gcloud scheduler jobs create http cc-retail-offers --schedule "0 6 * * *" --time-zone UTC \
  --uri https://<host>/api/retail-offers --http-method POST \
  --headers "Authorization=Bearer <ADMIN_SHARED_SECRET>,Content-Type=application/json" --message-body '{}'
```

## Deploy

Cloud Run, from the repo root (see `Dockerfile`, standalone output).
