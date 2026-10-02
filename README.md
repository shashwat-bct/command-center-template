# Commercial Command Center — standalone template

A static-only extraction of the Atlas Commercial Command Center dashboard from the
`bravo-platform` repo. One brand = one HTML page + one JSON data payload. The
rendering shell (nav rail, scorecard, driver pages, charts, drawers) is **shared
across every brand** and never needs to be edited to add a new one.

Lives at: `~/Desktop/code/command-center-template/`
Deployed to: **https://shashwat-bct.github.io/command-center-template/**
Based on upstream: `bravo-platform/public/` (Sonos variant for the base; Sony for the full variant).

**Two layers:**
1. **Renderer** (self-contained, static) — what you serve to view a dashboard.
2. **Bridge to bravo-platform's builder** (`npm run build:<brand>`) — the pipeline that produces each brand's data payload. The pipeline itself lives in bravo-platform (not duplicated here, per the "no parallel implementations" rule).

---

## Run it

```bash
cd ~/Desktop/code/command-center-template
npm run dev        # serves at http://localhost:4321
```

Then open:
- `http://localhost:4321/` — brand picker (built-in + your localStorage brands)
- `http://localhost:4321/admin.html` — add a brand through a form
- `http://localhost:4321/sonos-command-center.html` — the Sonos dashboard

No build step. No framework. Any static file server works (`python3 -m http.server`,
`npx serve`, Caddy, nginx, Firebase Hosting). `serve` is only used because it's
zero-install.

---

## What's in the repo

| File | Purpose |
|---|---|
| `cco-dashboard.css` / `cco-dashboard.js` | Shell: nav rail, header, page router, data loader |
| `cco-dashboard-pages.js` | The 14 driver-page renderers (scorecard, traffic, shelf, pricing, …) |
| `cco-charts.js` | Chart primitives (bars, lines, waterfalls, bumps) |
| `cco-card-ask.js` | The "?" affordance on every card (hover for definition; ask-chat optional, see below) |
| `cco-snapshots.js` / `cco-snapshots.css` | "Underlying data" image viewer (optional) |
| `ai-visibility.js` / `ai-visibility.css` | AI Engine Visibility console (optional) |
| `aeo-workbench.css` | AEO Workbench styling (optional) |
| `brand-marks/<slug>.png` | Wordmark shown in the nav rail |
| `sonos-command-center.html` | The Sonos dashboard page |
| `sonos-command-center-data.json` | The Sonos data payload (796 KB) |
| `_template-base.html` | Starting point for a new brand (Sonos-style, one payload) |
| `_template-full.html` | Starting point for a new brand (Sony-style, four payloads) |
| `index.html` | Brand picker landing page |

Nothing imports anything from `bravo-platform/` — this directory is fully self-contained.

---

## Add a brand

There are two paths — pick based on how permanent you need the brand to be.

### Fast path — the admin page (localStorage)

Open `/admin.html`, type a brand name, choose a data source, hit **Create dashboard**.
The brand lives in your browser's localStorage and renders at
`/view.html?slug=<brand>`. No files are written; the dashboard page runs the
shared shell against a Blob URL of the stored JSON.

Three data sources are available in the admin form:
1. **Clone Sonos sample** — fastest shell preview. The dashboard renders with
   Sonos's real captured numbers under the new brand name. **The numbers are
   Sonos's**, so this is for structural previews only — swap in real data before
   showing it to anyone.
2. **Upload JSON file** — provide your own payload matching the Sonos shape.
3. **Paste JSON** — same, but for inline authoring.

Optional: upload a brand mark image (PNG/SVG) — it's stored as a data URL and
shown in the dashboard's top-left.

**Caveats of the localStorage path:** it's per-browser (not shared across
machines), not committed to git, and the whole brand (including a cloned
~800 KB payload) counts against the ~5 MB localStorage quota per origin — so
you can hold a handful of brands this way, not hundreds. For sharing or
long-term use, promote to the file-backed path below.

### Permanent path — build from bravo-platform, commit, serve

For a brand that already has a `config-<slug>.mjs` and the four captured source
files in bravo-platform (as of this writing: `sonos`, `sony`, `shark`):

```bash
npm run build:sonos        # or build:sony, build:shark
# writes <slug>-command-center-data.json + copies brand mark
```

For any other brand that has a config in bravo-platform:

```bash
npm run build -- --brand <slug>
```

Then add an HTML page (copy `_template-base.html`, swap `{{BRAND}}` and `{{SLUG}}`),
drop it next to the JSON, and link it from `index.html`. The dashboard will serve
at `http://localhost:4321/<slug>-command-center.html`.

The bridge expects bravo-platform at `../bravo-platform`. Override with
`BRAVO_PLATFORM=/path/to/bravo-platform npm run build -- --brand <slug>`.

### Permanent path — the shape the renderer expects

The system has two render variants. Pick the one that matches the data you have.

### Variant A — Base (what Sonos uses)

Single payload. No AI Visibility console, no AEO Workbench, no snapshots viewer.
Everything from Scorecard through Method renders from one JSON.

```bash
cp _template-base.html meta-command-center.html
# Replace {{BRAND}} → Meta  and  {{SLUG}} → meta-command-center  everywhere
# Drop your payload here:
cp /path/to/meta-command-center-data.json .
# Add brand mark:
cp /path/to/meta.png brand-marks/
```

Add a card to `index.html` and you're done.

### Variant B — Full (what Sony uses)

Four payloads. The shell shows the AI Engine Visibility console, the AEO Workbench
and the Underlying-data snapshots in addition to the base driver pages.

```bash
cp _template-full.html sony-command-center.html
# Replace {{BRAND}} → Sony  and  {{SLUG}} → sony-command-center  everywhere
# Drop any payloads you have (the others fail soft — their nav groups just hide):
#   sony-command-center-data.json           ← required (the base)
#   sony-ai-visibility-data.json            ← optional
#   sony-aeo-workbench-data.json            ← optional
#   sony-snapshots.json                     ← optional
```

If a payload is missing, the shell catches the 404 and the matching nav group is
not rendered. The dashboard still loads.

---

## Adding a brand with no config yet (e.g. Meta)

The bridge builds any brand that already has a `config-<slug>.mjs` in bravo-platform.
If the brand is new (no config, no captures), the pipeline needs three things in order:

### 1. Author the config in bravo-platform

Copy `bravo-platform/scripts/insights/cco/config-sonos.mjs` to `config-<slug>.mjs`
and edit:

- `id` / `subject` / `subjectLabel` / `title` / `category` — identity
- `out` — where the builder writes the payload (keep `public/<slug>-command-center-data.json`)
- `brandMark` — path to a wordmark PNG in `bravo-platform/public/brand-marks/`
- `sources.*` — paths to the four captured JSONs you'll produce in step 2
- `BRANDS` / `RETAILERS` / `MODELS` / `CITIES` — the competitive universe
- `PROMO_TYPES` + their cost-to-brand & attach rates
- `EVENTS` — retail calendar (seasonal demand lifts)
- Other category-specific knobs (price biases, lead times, …)

~240 lines. Compare to `config-sony.mjs` and `config-shark.mjs` to see how the
numbers shift across TVs vs vacuums vs speakers.

### 2. Produce the four captured source JSONs

The captures live in bravo-platform's scripts and are run with the secrets in
this template's `.env.local` (via `node --env-file-if-exists` or `export`). What
each capture needs:

| Source | Script in bravo-platform | Secrets needed |
|---|---|---|
| `public/<slug>-launch-data.json` — Keepa price history + reviews | `scripts/insights/research/keepa-stock-graph.mjs` + hand-curated review scrape | `INS_KEEPA_KEY` |
| `public/<slug>-retailers-data.json` — multi-retailer carriage/price matrix | `scripts/insights/research/capture-shelf-multi.mjs` + merges | `APIFY_TOKEN`, `BRIGHTDATA_SERP_KEY` |
| `data/pdp-promo/<slug>-multiretailer.json` — PDP promotion verbatims | `scripts/insights/geo/capture-apify.mjs` (puppeteer-scraper on PDPs) | `APIFY_TOKEN` |
| `data/delivery-cities/<slug>.json` — city delivery probes | Apify checkout-flow run | `APIFY_TOKEN` |

Each capture is a multi-step affair; follow `docs/insights/EVENT-REPORT-PLAYBOOK.md`
in bravo-platform for the exact sequence and the sampling biases to check before
shipping. Commit each raw capture (`git add -f data/event-<brand>/`) because
"a deployed file not in git is already lost" (hard rule in bravo-platform/CLAUDE.md).

### 3. Build + render here

Once config and captures exist in bravo-platform:

```bash
npm run build -- --brand <slug>
cp _template-base.html <slug>-command-center.html
# edit the two placeholders
# add a card to index.html
```

### Reality check

For Meta specifically — what category? VR headsets? Ray-Ban Meta smart glasses?
That answer drives everything in the config (retailers, models, promo mechanics).
Confirm with Aashish first (playbook §0.9) before capturing. The capture work for
one brand is typically a day or two of real effort; the config + build is minutes.

## The data payload shape

The payload is what makes a brand real. Everything else is scaffolding. The shape
is non-trivial — 15 top-level keys on the Sonos file — so the fastest way to
understand it is to open `sonos-command-center-data.json` next to the Sonos
dashboard page and watch which key each panel is reading.

Top-level keys (Sonos, base variant):

```
meta         window, snapshotDates, disclosure, anchors, brandMark, subject…
dims         brands, retailers, cities, models, metrics, periods, events, dates, weeks
traffic      daily sessions, per retailer × day
ai           share-of-voice placeholders (empty in base)
shelf        retail-shelf visibility
pdpScores    landing-page visibility
distribution carriage × model × retailer
availability in-stock state × day
delivery     promise windows × city × model
pricing      daily price ladder × model × retailer
promotions   mechanic mix, offer counts, verbatims
tco          cost-of-ownership calc
voice        rating + review count × day
scorecard    the top-of-page numbers per cadence (MBR / Qtr / Annual)
trend        13-week lines per metric
reads        pre-computed superlatives + findings text
```

The Sony full variant adds three more payload files on the body's `data-*` attrs:
- `data-payload-ai` → an AI visibility capture (58 questions × 4 engines × multiple
  weeks, with evidence references, scope config, live-endpoint hints)
- `data-payload-wb` → a 12-week forward programme (week-by-week simulated outcomes
  anchored to week 0 = measured)
- `data-snapshots` → an index of captured retailer-page screenshots with marks

**You do not generate these JSONs here.** The upstream `bravo-platform` repo has
build scripts for them (`scripts/insights/build-cco-dataset.mjs` using
`scripts/insights/cco/config-<brand>.mjs`, `scripts/insights/geo/assemble-ai-visibility.mjs`,
`scripts/insights/geo/build-aeo-workbench.mjs`). This template renders whatever
you give it; sourcing or regenerating payloads is a separate workflow.

---

## What's live vs. mock in the rendered dashboard

Every number on the dashboard comes from the data payload. **The dashboard
simulates nothing at render time.** The simulation happens upstream in the build
scripts, and the output is baked into the JSON.

In the production bravo-platform deploy, the payload mixes:

- **Measured anchors** — real captures (Keepa price history, retailer PDP scrapes,
  AI engine answers, delivery probes). These show up on the method page's anchor
  ledger.
- **Extrapolated figures** — the 13-week daily panel modelled around the anchors
  with seasonality + promotional events. Every chart in the dashboard says
  "Simulated forward view" at the top.

The Sonos payload shipped with this template is the production one as of its
snapshot date — real brand, real anchors, real simulation. Nothing in it is
hand-faked.

---

## Env & external services

### To render the dashboard — **none**

Just static files. No API keys, no backend. See the breakdown below.

### To build or capture — secrets in `.env.local`

This repo keeps `/.env.local` (gitignored, 600 perms) that the npm scripts load
via Node's `--env-file-if-exists` flag. When `npm run build` spawns the
bravo-platform builder, env vars inherit from this process — so the capture
scripts over there see your keys without you duplicating them.

Variables and where each one is used:

| Env var | Who reads it | Required for |
|---|---|---|
| `APIFY_TOKEN` | `scripts/insights/geo/capture-apify.mjs` + friends | retailer PDP + AI engine UI scrapes |
| `INS_KEEPA_KEY` | `scripts/insights/research/keepa-stock-graph.mjs` | Amazon price + review history |
| `BRIGHTDATA_SERP_KEY` | `scripts/insights/proxy-bootstrap.mjs` | SERP backing / unlocker for Apify |
| `INS_SCRAPING_BROWSER` | Playwright-based captures | Bright Data WSS endpoint |
| `GOOGLE_APPLICATION_CREDENTIALS_B64` | safe-deploy, saveArtifacts, bq | GCP service-account JSON (base64) |
| `ELEVENLABS_API_KEY` | tour-audio builders | walkthrough TTS (not dashboard data) |
| `INS_API_BASE` | `scripts/insights/lib-llm.mjs` | Firebase proxy host for `/api/llm` |

Rotate any key that's ever been seen in a chat, shared screen, or committed by
accident. `GOOGLE_APPLICATION_CREDENTIALS_B64` in particular is deploy-level
access to bravo-platform-bc — treat it as the most sensitive one in this file.

### To render the dashboard — more detail

Static files. The dashboard page is 100% client-side. Fonts come from Google
Fonts over HTTPS. No API keys, no auth, no backend.

### Features that need a backend (and are not wired here)

Three features in the shared JS reach out to backends. All of them **fail soft**
— if the backend isn't there, the feature degrades to the equivalent of a
disabled button, and nothing else on the dashboard is affected.

| Feature | File | Depends on | Behaviour without it |
|---|---|---|---|
| Card-level "Ask" chat | `cco-card-ask.js` | Firebase anonymous auth + `POST /api/llm` (Claude proxy) | Hover definition still works. Clicking "Ask me any question" fails silently. |
| AI Visibility "run live" button | `ai-visibility.js` | `POST /api/geo-live` Cloud Function (hits ChatGPT/Gemini/Perplexity/Claude APIs) | Captured answers still render in full. The "run live" button shows an error toast. |
| Page-level usage analytics | *(stripped)* | Firestore `pageAnalytics` collection | Not wired. See below if you want it back. |

Analytics (`atlas-track.js`) is intentionally removed from the HTML in this
template because wiring Firestore to a fresh project is a separate setup. The
dashboard logs no telemetry. If you want it back, copy
`bravo-platform/public/atlas-track.js` to this directory, add the module import
at the bottom of your brand HTML (see the Sony example in `bravo-platform`), and
provide a Firebase project configured to accept writes to the `pageAnalytics`
collection.

### What was in the production code and was ripped out here

- `?v=<hash>` cache-buster query strings on every asset URL — not needed for
  local serving.
- The `atlas-track.js` module import block at the end of every brand HTML.
- All of `scripts/insights/` and `scripts/studio/` — those live upstream in
  `bravo-platform` and build the payloads. They are not needed to **render** the
  dashboard; they produce the input to it.
- Firebase hosting rewrites, deploy pipelines, lane checks, no-rollback checks.
  All of that governs how the production site publishes. Irrelevant for a
  local-served copy.

---

## Deploy

This repo deploys to any static host. Three paths that are known to work:

1. **Firebase Hosting** — `firebase init hosting`, point `public` at this
   directory, `firebase deploy --only hosting`.
2. **Cloud Run with a static image** — `FROM nginx:alpine`, `COPY . /usr/share/nginx/html`.
3. **GitHub Pages / Vercel / Netlify** — drop the directory in; no build step.

If you're publishing to the production atlas.brandcontext.ai site, do not use
this template — follow the hard rules in `bravo-platform/CLAUDE.md` and the
`docs/insights/NEW-BRAND-RUNBOOK.md`. This template is for standalone and
derivative work.

---

## What this template deliberately does not do

- **It does not generate payloads.** Capture + build pipelines live in
  `bravo-platform/scripts/insights/`. Giving this template a new brand is 50%
  "write the payload JSON", and the payload is where the brand knowledge is.
- **It does not sync with upstream.** If `cco-dashboard.js` is updated in
  `bravo-platform`, copy the new version in. There is no version pinning or
  dependency link.
- **It does not include the 1.6 GB of Sony evidence snapshots.** They live in
  `bravo-platform/public/evidence/` and only the Sony "full" variant references
  them. If you build a full-variant brand page with snapshots, provide the
  images at the paths the snapshots JSON points to.
