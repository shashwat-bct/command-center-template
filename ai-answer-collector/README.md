# AI answer collector

Measures how AI engines answer US shoppers about **Sony** and **Samsung** across the retail-audit categories, and serves the results as the command-center **AI Engine Visibility** dashboard (Executive Summary, Funnel & Engines, Sources & Access, Brand Attributes, Picks & Products, Change Over Time).

Everything follows `command-center-template` (`feat/measured-only-dashboards`): ChatGPT and Gemini are read from their consumer apps through Bright Data's AI scrapers, Claude through the Atlas LLM proxy; a Claude reader pass extracts brands, positions, top picks, attributes and claims; the payload and the dashboard are the template's own (`lib/ai-console.ts`, `public/ai-visibility.js`).

## What is asked

| | |
|---|---|
| Categories | Toggled in `src/config/brands.ts` (`enabled`). Now: **TV** (Sony, Samsung, LG, TCL, Hisense) and **Phones** (Apple, Samsung, Google) |
| Question bank | The template's Sony TV bank, **58 questions as they are**, plus 4 promotion questions (q59–q62) — `src/config/questions.ts` |
| Stages | Attention (awareness), Consideration, Evaluation & Trust, Decision |
| Personas | Value Seeker and Feature Enthusiast, **both on every run** — `src/config/personas.ts` |
| Runs | **3** per question, per persona, per engine |
| Market | **US only** (Bright Data sessions in the US) |

Every brand in a category is measured as the subject in turn, with the others as its competitors, and gets its own dashboard.

**Generic questions are shared, brand-specific ones repeat.** The 62 questions split into 40 brand-neutral ("What are the best TVs to buy in 2026?") and 22 brand-specific ("Is a Sony Bravia worth the money?", "Sony vs LG OLED — which should I buy?"). `npm run banks` writes:

- `banks/<category>.category.json` — the category's 40 neutral questions, attributes and noun. TV keeps the reference wording; Phones has them adapted once.
- `banks/<brand>-<category>.json` — one brand's full bank: the shared neutral questions word for word plus its own 22 brand-specific ones. Sony TV keeps the reference wording; every other brand's are rewritten from it (Sony → LG, Bravia 9 II → G5, and so on), same id, stage and focus.

So a neutral question is asked once per engine, persona and run and read once for the whole category; only the brand-specific questions are asked per brand. Review the bank files before collecting: model names are Claude's and may need correcting.

Consumer AI apps take no system prompt, so a persona is a first-person preamble before the question; every engine gets the same text.

## Setup

```bash
npm install
npm run setup:browser                       # Chromium, for session images
gcloud auth application-default login       # Secret Manager (BRIGHTDATA_SERP_KEY in bravo-platform-bc)
```

`BRIGHTDATA_API_KEY` / `BRIGHTDATA_SERP_KEY` in the environment override Secret Manager. Without a key, ChatGPT and Gemini are skipped and Claude still runs.

## Run

```bash
npm run banks                                         # write / review question banks (once)
npm run plan                                          # counts and sample prompts, asks nothing
npm run collect -- --collection 2026-10               # every brand of every enabled category, together
npm run enrich -- --collection 2026-10                # reader pass, once per answer per category
npm run payload -- --collection 2026-10               # dashboard payloads (+ robots.txt read)
npm run dashboard                                     # http://localhost:4600
```

Without filters, `plan` and `collect` cover every brand of every enabled category. Filters: `--categories` (also reaches a disabled one), `--pairs` (e.g. `lg-tv`), `--brands`, `--stages`, `--questions` (ids), `--engines` (default `chatgpt,gemini,claude`; `perplexity,copilot` exist but their snapshots did not complete in the template). Personas, runs and market are fixed. Tuning: `--batch` (prompts per Bright Data snapshot, 5), `--concurrency` (snapshots in flight per engine, 8), `--claude-concurrency` (4).

`collect`, `enrich` and `payload` are resumable: re-running skips what is done and retries failures. A **collection** is one measurement round (name it by month); Change Over Time compares a collection with the previous one that asked the same bank.

## Storage

```
data/<collection>/
  manifest.json
  index.jsonl                                            one line per attempt
  responses/<engine>/<category>/<persona>/<hash>-r<run>.json   full record: prompt, answer, page source, sources, evidence, raw scraper row
  screenshots/<engine>/<category>/<persona>/<hash>-r<run>.jpg  the session image
  snapshots/<engine>/<snapshot_id>.json                 raw Bright Data rows
  enriched/<brand>-<category>.json                      reader output per answer
  crawler/<brand>-<category>.json                       robots.txt / llms.txt read
  payloads/<brand>-<category>.json                      dashboard payload
```

`AI_ANSWERS_BUCKET` mirrors every file to `gs://<bucket>/<collection>/…`. `npm run export` writes `responses.jsonl` and `responses.csv`.

**Session images.** As in the template, Bright Data returns the page source of each consumer-app session (`answer_html`). It is rendered offline in headless Chromium with scripts and network disabled, and shown behind "show the real session" on every answer, with capture time, country, web-search and shopping-module flags, the snapshot id and a SHA-256 of the answer. API answers are drawn from their markdown.

## Dashboard

`dashboard/public/ai-visibility.js` is generated from the template's console (`dashboard/vendor/ai-visibility.reference.js`, an unchanged copy) by `npm run patch:dashboard`. The patches:

- only the six pages above;
- a persona filter (both / Value Seeker / Feature Enthusiast) and a run filter (all / 1 / 2 / 3) in the top bar — the template read run 1 only;
- volatility from the three runs, per persona;
- receipts labelled engine · persona · run.

Styles (`cco-dashboard.css`, `ai-visibility.css`) and charts (`cco-charts.js`) are the template's.

## Scale

TV (5 brands) and Phones (3 brands): 8 banks × 62 questions × 2 personas × 3 runs = 2,976 answers per engine if every brand were asked separately; with the neutral questions shared it is **1,536 distinct prompts per engine** (48% fewer), so about 1,536 Bright Data records each for ChatGPT and Gemini and 1,536 Claude calls, plus about 260 reader calls. Pilot first and measure throughput and failure rate.
