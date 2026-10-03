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
| `/<slug>` | Dashboard (admin session required when `ADMIN_SHARED_SECRET` is set) |
| `/share/<token>` | Dashboard via a magic link |
| `/api/magic-links` | Create a share link (`POST {slug, build_id?, expires_in_hours?, label?}`) |
| `/api/admin/session` | Sign in (`POST {token}`) / out (`DELETE`) |
| `/api/brands` | List / create brands (BigQuery `cco_mgmt.brands`) |
| `/api/brands/<slug>` | The inputs the brand was last built with |
| `/api/brands/<slug>/rebuild` | Rebuild with those inputs (`POST`) |
| `/api/builds/<build_id>` | Build status (BigQuery `cco_mgmt.builds`) |
| `/api/payloads/<slug>` | Latest ready payload from GCS, else the vendored one |
| `/api/health` | Health check |

## Build pipeline (`lib/capture.ts`)

Brands without a vendored config are **measured-only**: every figure comes from a source on that build, and anything without one is blank. Amazon is the only retailer covered. See `ISSUES.md` for what is and isn't measured.

1. Find Amazon listings with Keepa search (category or product names); keep only listings whose brand/title names the brand. Same for each competitor.
2. Keepa: 13 weeks of daily price, list price, buyable state, offer count, buy-box seller, rating and reviews per listing (`lib/keepa.ts`, `lib/amazon-series.ts`).
3. Apify: product-page content and delivery promise per listing, and the first 48 organic Amazon results for the category (`lib/apify.ts`, `lib/amazon-shelf.ts`). Keepa also supplies monthly purchases, sales rank, lightning deals and coupons for the Amazon demand and effective-price pages.
4. Claude: 12 shopper questions × 2 runs → AI share of answer, per stage and per prompt (`lib/ai-visibility.ts`).
5. Run the vendored builder with a per-build config overlay (`lib/launch-override.ts` → `config-relabel.mjs`) that supplies the window, the real listings and their series.
6. Keep only what was measured: blank and re-rank unmeasured cells, empty unmeasured lanes, replace generated text with factual statements (`lib/measured-only.ts`, `lib/provenance.ts`, `lib/relabel-pipeline.ts`); rename slots (`lib/rebrand.ts`).
7. Upload to GCS, record in BigQuery. The request (name, category, competitors, products, region, link) is saved on the build row and in the payload's `meta.request`, so a brand can be rebuilt without re-entering it; builds from before that are read back from their payload and build log.

Every brand, including Sonos, Sony and Shark, is built this way; the vendored bravo-platform builder and Sonos config are only the skeleton the measured series are written into. Only measured-only builds are served (older ones answer 409 until rebuilt).

Cost per build: ~100 Keepa tokens, ~$0.07 Apify, 24 LLM proxy calls.

## Deploy

Cloud Run, from the repo root (see `Dockerfile`, standalone output).
