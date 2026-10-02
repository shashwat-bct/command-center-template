# Phase 2 — Backend architecture

The goal: turn the admin page's **"Create dashboard"** button into a trigger that captures real data for a new brand (Keepa + Apify + SimilarWeb + optional AI engine probes), stores it in BigQuery + Cloud Storage, and returns a shareable dashboard URL.

Phase 1 (static site, localStorage) stays alive as the preview path. Phase 2 adds a backend that handles the real-data path.

## Components

```
┌──────────────────────────────────────┐
│  Static Site                         │
│  shashwat-bct.github.io/             │
│    command-center-template/          │
│  - renderer (what we have)           │
│  - admin.html → calls API below      │
└───────────────┬──────────────────────┘
                │ HTTPS, CORS-allowed
                ↓
┌──────────────────────────────────────┐
│  Cloud Run service                   │
│  <service>.a.run.app                 │
│  - Node 20 + Fastify                 │
│  - routes under /api/*               │
│  - secrets from Secret Manager       │
└──────┬──────────┬──────────┬─────────┘
       │          │          │
       │          │          │  invokes
       │          │          ↓
       │          │   ┌──────────────────────────────┐
       │          │   │  Capture job (same instance  │
       │          │   │  or Cloud Tasks worker)      │
       │          │   │  - clones bravo-platform     │
       │          │   │  - writes config-<slug>.mjs  │
       │          │   │  - runs capture scripts      │
       │          │   │    (Apify, Keepa, SimilarWeb)│
       │          │   │  - runs build-cco-dataset    │
       │          │   │  - updates job status in BQ  │
       │          │   └──────────┬───────────────────┘
       │          │              │
       ↓          ↓              ↓
┌───────────┐  ┌───────────────────────┐
│ BigQuery  │  │ Cloud Storage         │
│ Dataset:  │  │ Bucket:               │
│  cco_mgmt │  │  bct-cco-payloads     │
│           │  │                       │
│ Tables:   │  │ Objects:              │
│ - brands  │  │  <slug>/<build>.json  │
│ - builds  │  │  <slug>/<build>.log   │
└───────────┘  └───────────────────────┘
```

## API contract

### `GET /api/health`
Returns `{ status: "ok", uptime, version }`. Cloud Run readiness probe.

### `GET /api/brands`
Returns all brands with their latest build:
```json
{
  "brands": [
    { "slug": "sonos", "name": "Sonos", "category": "wireless speakers",
      "latest": { "build_id": "b_abc", "payload_url": "...", "status": "ready",
                  "built_at": "..." } }
  ]
}
```

### `POST /api/brands`
Creates a brand + enqueues a capture job. Request:
```json
{
  "name": "Meta",
  "slug": "meta",
  "category": "VR headsets",
  "retailers": ["amazon", "bestbuy", "target", "walmart"],
  "models": [{ "id": "quest-3", "asin": "B0CDC8HQNM", "msrp": 499.99 }],
  "cities": ["new-york", "los-angeles", "chicago"],
  "options": {
    "run_apify": true,
    "run_keepa": true,
    "run_similarweb": false,
    "run_ai_visibility": false
  }
}
```
Response:
```json
{ "brand_slug": "meta", "build_id": "b_xyz", "status": "queued",
  "poll_url": "/api/builds/b_xyz" }
```

### `GET /api/builds/:build_id`
Returns build status for polling (every ~10s from the UI):
```json
{ "build_id": "b_xyz", "brand_slug": "meta", "status": "running",
  "steps": [
    { "name": "config", "status": "done", "duration_ms": 50 },
    { "name": "apify-pdp", "status": "running", "started_at": "...", "pct": 30 },
    { "name": "keepa", "status": "pending" },
    { "name": "builder", "status": "pending" }
  ],
  "payload_url": null,
  "logs_url": "https://storage.googleapis.com/bct-cco-payloads/meta/b_xyz.log",
  "error": null }
```

Terminal statuses: `ready`, `failed`, `cancelled`.

### `GET /api/payloads/:slug` or `GET /api/payloads/:slug/:build_id`
Streams the payload JSON for the dashboard to fetch. Latest if build_id omitted.

## BigQuery schema

### `cco_mgmt.brands`
| Column | Type | Notes |
|---|---|---|
| slug | STRING | PRIMARY KEY (soft, enforced by app) |
| name | STRING | Display label |
| category | STRING | e.g. "VR headsets" |
| retailers | JSON | Array of retailer slugs |
| models | JSON | Array of {id, asin, msrp} |
| cities | JSON | Array of city slugs |
| latest_build_id | STRING | FK into builds |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### `cco_mgmt.builds`
| Column | Type | Notes |
|---|---|---|
| build_id | STRING | PRIMARY KEY, generated like `b_<nanoid>` |
| brand_slug | STRING | FK into brands |
| status | STRING | queued / running / ready / failed / cancelled |
| options | JSON | Snapshot of {run_apify, run_keepa, …} at build time |
| steps | JSON | Array of {name, status, duration_ms, error} |
| started_at | TIMESTAMP | |
| finished_at | TIMESTAMP | |
| payload_url | STRING | gs://... URL of final payload |
| logs_url | STRING | gs://... URL of combined logs |
| error | STRING | null unless failed |
| cost_cents | INT64 | Billed Apify/Keepa/etc. cost estimate |

## Cloud Storage

`gs://bct-cco-payloads/`
- `<slug>/<build_id>.json` — the final payload JSON (what the dashboard fetches)
- `<slug>/<build_id>.log` — combined logs from all capture steps
- `<slug>/<build_id>/captures/*.json` — raw captures (Keepa output, Apify output, etc.) for debugging

Public read for payloads only? Or require signed URLs? For MVP: public read on `/payloads/<slug>/<build_id>.json` since the dashboard needs to fetch it, and the content isn't sensitive (per CLAUDE.md "command centre is a SIMULATED FORWARD VIEW").

## Capture pipeline execution

**Design decision: in-process vs. worker.** Each capture takes 5–30 min. Cloud Run has a request timeout (60 min max on second-gen, so technically fits). But a crashed request leaves no trace.

**Recommended approach**: in-process for MVP (single Cloud Run instance, long-running request), move to Cloud Tasks + separate worker service once we have > 1 concurrent capture.

**Each build step**:
1. **config** (~1s): write `config-<slug>.mjs` into a cached bravo-platform clone
2. **apify-pdp** (~15 min for 20 products × 5 retailers): capture retailer PDPs
3. **keepa** (~30s): pull 6 months of Amazon price + review history
4. **similarweb** (~1 min, optional): weekly traffic for brand/competitor sites
5. **ai-visibility** (~30 min, optional): 58 questions × 4 engines captures
6. **builder** (~1s): deterministic simulation producing the final payload
7. **publish** (~5s): upload payload + logs to GCS, update BigQuery

## Auth model

**MVP**: single shared secret in an `X-Admin-Token` header. Secret set at deploy time via Secret Manager. Admin UI prompts for it on first visit, stores in localStorage.

**Later**: Firebase Google OAuth (restrict to `@brandcontext.ai` domain).

**Never**: open endpoints — every POST /api/brands costs real money (Apify ~$1-5 per capture + Keepa tokens).

## Secrets

All loaded from GCP Secret Manager at Cloud Run startup:

- `APIFY_TOKEN`
- `INS_KEEPA_KEY`
- `BRIGHTDATA_SERP_KEY`
- `SIMILARWEB_API_KEY` (if available)
- `ADMIN_SHARED_SECRET` (for the X-Admin-Token header)

**Never**: shipped to the browser. **Never**: in environment variables set on the Cloud Run service config (visible to any viewer of the project). Always via Secret Manager with the Cloud Run SA having `secretmanager.secretAccessor` on each secret.

## Deployment stages

**Stage 2.1** (this session): Backend scaffold, boots locally with stub endpoints.

**Stage 2.2** (next session): BigQuery schema created, brands + builds endpoints wired to it. Capture-less — just DB CRUD.

**Stage 2.3** (next session): Capture orchestration. Clone bravo-platform at container-build time (cached), spawn its scripts, update build status.

**Stage 2.4** (next session): Admin UI changes — expanded form (category, retailers, models), polling UI with step status, redirect to view on completion.

**Stage 2.5** (next session): First deploy to Cloud Run, CORS enabled, end-to-end test with a known brand (Sony — has config + captured data in bravo-platform).

## Cost estimate per capture

Rough per-brand per-capture:
- Apify PDP: ~$1–3 (depends on retailer count × product count)
- Keepa: ~1 token = $0.001 (6 months × 1 ASIN); negligible unless many ASINs
- Bright Data SERP (if used): ~$0.10
- SimilarWeb: free tier covers low volume
- AI engine captures (if used): Apify UI scrape ~$2–5 + API costs ~$1
- Cloud Run compute during the run: ~$0.05 (15 min × ~$0.20/hr for 2 vCPU)

**Typical capture-run**: $3–10 of billed external API costs.

**Monthly fixed**: Cloud Run idle (~$0 if min-instances=0), BigQuery storage ($0 at < 10 GB), GCS storage ($0 at < 5 GB), Secret Manager ($0 at < 10 secrets).
