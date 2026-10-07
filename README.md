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
| `/api/brands` | List / create brands (BigQuery `cco_mgmt.brands`) |
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

1. Find Amazon listings with Keepa search (category or product names); keep only listings whose brand/title names the brand. Same for each competitor.
2. Keepa: 13 weeks of daily price, list price, buyable state, offer count, buy-box seller, rating and reviews per listing (`lib/keepa.ts`, `lib/amazon-series.ts`).
3. Apify: product-page content and delivery promise per listing, and the first 48 organic Amazon results for the category (`lib/apify.ts`, `lib/amazon-shelf.ts`). Keepa also supplies monthly purchases, sales rank, lightning deals and coupons for the Amazon demand and effective-price pages.
4. AI visibility (`lib/ai-visibility.ts`, `lib/ai-engines.ts`): the same 12 shopper questions × 2 runs go to ChatGPT and Gemini through their consumer apps (chatgpt.com, gemini.google.com) via Bright Data's AI scrapers (`lib/brightdata.ts`, snapshots of 3 questions run in parallel, about 3 minutes per engine; Perplexity and Copilot scrapers are defined there but switched off because their snapshots did not complete, `BRIGHTDATA_API_KEY` or `BRIGHTDATA_SERP_KEY`), and Claude through the Atlas LLM proxy (an API path: Bright Data has no Claude scraper). Each engine's path, consumer UI or API, is recorded in the payload and shown on the dashboard. A Claude extraction pass lists every brand each answer names, mapping product lines and parent companies to the tracked brands (name matching is the fallback). A brand counts once per answer, and untracked brands count in the total, so share = this brand's answers ÷ all brand mentions. Reported per engine, per stage and averaged across engines. Claude also names the category's review themes.
5. Run the vendored builder with a per-build config overlay (`lib/launch-override.ts`, `lib/simulated-world.ts` → `config-relabel.mjs`): the real listings and series, the US retail calendar for the window, category search terms and review themes, and every behavioural parameter varied by a generator seeded with the slug. The reference brand's captures are replaced with empty ones so nothing it measured anchors another brand.
6. Lay the measurements over the modelled market and stamp per-lane provenance (`lib/payload-merge.ts`, `lib/provenance.ts`, `lib/relabel-pipeline.ts`); rename slots (`lib/rebrand.ts`).
7. Apply `brand-data/<slug>.json` if present (`lib/brand-overrides.ts`): a deep merge into the payload, keyed by the final brand and listing ids. It can replace any modelled value but not measured AI share or Amazon series. See `brand-data/_example.json`.
8. Upload to GCS, record in BigQuery. The request (name, category, competitors, products, region, link) is saved on the build row and in the payload's `meta.request`, so a brand can be rebuilt without re-entering it; builds from before that are read back from their payload and build log.

Hybrid and measured-only builds are served; builds from before per-lane provenance answer 409 until rebuilt. Only hybrid builds are reused for new links.

Cost per build: ~100 Keepa tokens, ~$0.07 Apify, 24 Bright Data records each for ChatGPT and Gemini, ~33 LLM proxy calls (Claude answers, brand extraction, review themes). Production needs `BRIGHTDATA_API_KEY` (or the existing `BRIGHTDATA_SERP_KEY`) as a Cloud Run secret; without it only Claude runs. A Bright Data snapshot takes a few minutes, so a build's AI step and a live console run are slower than the old API path. An engine that fails is left out of the build and listed as failed on the Method page.

## Deploy

Cloud Run, from the repo root (see `Dockerfile`, standalone output).
