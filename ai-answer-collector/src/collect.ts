// Asks every engine in scope every bank question, as both personas, three
// times, US market, and stores each answer, its sources, the raw scraper row
// and the rendered session image. Safe to re-run: answered jobs are skipped,
// failed ones retried.
//
//   npm run collect -- --collection 2026-10 --pairs sony-tv --questions q01,q28,q59

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { COUNTRY } from "./config/brands";
import { askBrightData, askClaude, ENGINES, isBrightData, type Answer, type EngineId } from "./engines";
import type { BrightDataEngineId } from "./engines/brightdata";
import { expandJobs, scopeFrom, type Job } from "./jobs";
import { updateManifest } from "./manifest";
import { closeRenderer, renderScreenshot } from "./screenshot";
import { brightDataKey } from "./secrets";
import { CollectionStore, screenshotPath, type Evidence, type ResponseRecord } from "./store";
import { chunk, mapLimit, today } from "./util";

const { values: args } = parseArgs({
  options: {
    collection: { type: "string" },
    engines: { type: "string" },
    pairs: { type: "string" },
    brands: { type: "string" },
    categories: { type: "string" },
    stages: { type: "string" },
    questions: { type: "string" },
    batch: { type: "string", default: "5" },
    concurrency: { type: "string", default: "8" },
    "claude-concurrency": { type: "string", default: "4" },
    "no-screenshots": { type: "boolean", default: false },
  },
});

const store = new CollectionStore(args.collection || today().slice(0, 7));
const scope = scopeFrom(args);
const BATCH = Number(args.batch);
const CONCURRENCY = Number(args.concurrency);
const CLAUDE_CONCURRENCY = Number(args["claude-concurrency"]);
const SCREENSHOTS = !args["no-screenshots"];

const ASK_LINK: Partial<Record<EngineId, string>> = { chatgpt: "https://chatgpt.com/?q=", perplexity: "https://www.perplexity.ai/search?q=", copilot: "https://copilot.microsoft.com/?q=" };
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function evidenceOf(job: Job, a: Answer, sha256: string, at: string): Evidence {
  const raw = (a.raw ?? {}) as Record<string, unknown>;
  const shopping = raw.shopping_visible ?? (Array.isArray(raw.shopping) ? raw.shopping.length > 0 : undefined);
  return {
    capturedAt: str(raw.timestamp) ?? at,
    sessionUrl: str(raw.answer_url) ?? str(raw.share_url) ?? (ASK_LINK[job.engine] ? ASK_LINK[job.engine] + encodeURIComponent(job.prompt) : null),
    country: COUNTRY,
    appModel: str(raw.model) ?? str(raw.model_name),
    webSearchTriggered: bool(raw.web_search_triggered),
    shoppingVisible: bool(shopping),
    adsPresent: bool(raw.ads_present) ?? (Array.isArray(raw.ads) ? raw.ads.length > 0 : null),
    snapshotId: a.snapshotId,
    sha256,
  };
}

async function save(job: Job, result: Answer | Error, askedAt: number): Promise<boolean> {
  const info = ENGINES[job.engine];
  const answer = !(result instanceof Error) && result.text.trim() ? result : null;
  const now = new Date().toISOString();
  const sha256 = answer ? createHash("sha256").update(answer.text).digest("hex") : "";
  const record: ResponseRecord = {
    id: job.id,
    collection: store.collection,
    engine: job.engine,
    engineLabel: info.label,
    path: info.path,
    model: info.model,
    category: { slug: job.category.slug, name: job.category.name },
    persona: { id: job.persona.id, label: job.persona.label },
    questionText: job.questionText,
    questionHash: job.questionHash,
    refs: job.refs,
    prompt: job.prompt,
    run: job.run,
    country: COUNTRY,
    status: answer ? "ok" : "error",
    error: answer ? null : result instanceof Error ? result.message.slice(0, 500) : "empty answer",
    answer: answer ? { text: answer.text, markdown: answer.markdown, html: answer.html, sha256 } : null,
    sources: answer?.sources ?? [],
    evidence: answer ? evidenceOf(job, answer, sha256, now) : null,
    raw: answer?.raw ?? null,
    snapshotId: answer?.snapshotId ?? null,
    screenshot: null,
    askedAt: new Date(askedAt).toISOString(),
    answeredAt: now,
    durationMs: Date.now() - askedAt,
  };
  if (answer && SCREENSHOTS) {
    try {
      const rel = screenshotPath(job.id);
      await store.write(rel, await renderScreenshot(record), "image/jpeg");
      record.screenshot = rel;
    } catch (e) {
      console.error(`[screenshot] ${job.id}: ${(e as Error).message}`);
    }
  }
  await store.saveResponse(record);
  return !!answer;
}

async function runBrightData(engine: BrightDataEngineId, key: string, jobs: Job[], tally: { ok: number; failed: number }): Promise<void> {
  // One pass per run number, so a batch never repeats a prompt and the three
  // runs of a question are asked at different times.
  for (const run of [...new Set(jobs.map((j) => j.run))].sort()) {
    await mapLimit(chunk(jobs.filter((j) => j.run === run), BATCH), CONCURRENCY, async (batch) => {
      const t0 = Date.now();
      let results: Array<Answer | Error>;
      try {
        const res = await askBrightData(engine, key, batch.map((j) => j.prompt));
        await store.write(`snapshots/${engine}/${res.snapshotId}.json`, JSON.stringify(res.rows, null, 2), "application/json");
        results = res.answers;
      } catch (e) {
        results = batch.map(() => e as Error);
      }
      for (const [i, job] of batch.entries()) (await save(job, results[i], t0)) ? tally.ok++ : tally.failed++;
      console.log(`[collect] ${engine} run ${run}: ${tally.ok} ok, ${tally.failed} failed of ${jobs.length}`);
    });
  }
}

async function runClaude(jobs: Job[], tally: { ok: number; failed: number }): Promise<void> {
  await mapLimit(jobs, CLAUDE_CONCURRENCY, async (job) => {
    const t0 = Date.now();
    const result = await askClaude(job.prompt).catch((e: Error) => e);
    (await save(job, result, t0)) ? tally.ok++ : tally.failed++;
    if ((tally.ok + tally.failed) % 20 === 0 || tally.ok + tally.failed === jobs.length) console.log(`[collect] claude: ${tally.ok} ok, ${tally.failed} failed of ${jobs.length}`);
  });
}

async function main(): Promise<void> {
  await updateManifest(store, scope);
  const done = store.index();
  const pending = expandJobs(scope).filter((j) => done.get(j.id)?.status !== "ok");
  const key = scope.engines.some(isBrightData) ? await brightDataKey() : null;
  console.log(`[collect] collection "${store.collection}" in ${store.dir} · ${scope.banks.map((b) => b.key).join(", ")} · ${COUNTRY} · both personas · ${scope.runs} runs`);

  const summary = await Promise.all(
    scope.engines.map(async (engine) => {
      const jobs = pending.filter((j) => j.engine === engine);
      const tally = { ok: 0, failed: 0 };
      console.log(`[collect] ${engine}: ${jobs.length} to ask`);
      if (!jobs.length) return { engine, ...tally, skipped: "" };
      if (isBrightData(engine)) {
        if (!key) return { engine, ...tally, skipped: "no Bright Data key (env or Secret Manager)" };
        await runBrightData(engine, key, jobs, tally);
      } else {
        await runClaude(jobs, tally);
      }
      return { engine, ...tally, skipped: "" };
    }),
  );
  await store.mirror("index.jsonl", "application/x-ndjson");
  await closeRenderer();
  console.log("\n[collect] done");
  for (const s of summary) console.log(`  ${s.engine.padEnd(11)} ${s.skipped ? `skipped: ${s.skipped}` : `${s.ok} ok, ${s.failed} failed`}`);
}

main().catch(async (e) => {
  console.error(e);
  await closeRenderer();
  process.exit(1);
});
