// Build orchestration. Spawns the vendored bravo-platform CCO builder for a
// given slug, streams its output as build steps, uploads the result to GCS,
// and updates the build row in BigQuery throughout. Returns immediately with
// a build_id; the actual work runs in the background.

import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, cpSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { getBrand, insertBuild, updateBuild, upsertBrand, type BuildStep, type BuildOptions } from "./bq";
import { uploadLog, uploadPayload } from "./gcs";
import { fetchKeepaBrand, fetchKeepaSearch, type KeepaBrandAggregate } from "./keepa";
import { fetchAiShareOfMind, type AiSoMResult } from "./ai-visibility";
import { fetchAmazonSearch, fetchApifyAmazon, type AmazonProduct, type SearchResult } from "./apify";
import { buildRelabelInputs, type RelabelInputs } from "./launch-override";
import { measuredCount } from "./provenance";
import { RELABEL_CONFIG_ID, applyProvenance, prepareRelabelWorkDir } from "./relabel-pipeline";
import { rebrandPayload } from "./rebrand";

const REFERENCE_BRAND = "sonos";

export type CreateBuildInput = {
  slug: string;
  name: string;
  // Where this brand lives on the web — e.g. "https://dyson.com". Used to
  // scope SimilarWeb (when wired) and as context for Claude's shopper
  // questions. Optional.
  brandLink?: string | null;
  // Market the dashboard reports on. Drives Keepa domain, Apify proxy country,
  // and the competitor set Claude sees. Default US.
  region?: string | null;
  category?: string | null;
  // Alternative to ASINs — specific product names. The backend resolves each
  // to its top-ranked ASIN via Keepa search ({brand} {product}), then feeds
  // the union through the rest of the pipeline. Easier than hunting ASINs.
  products?: string[];
  // Optional category + competitor seeds that drive the AI Share of Mind step
  // (the backend asks Claude a battery of shopper questions and counts brand
  // mentions). If omitted, the AI step is skipped.
  aiCategory?: string | null;
  aiCompetitors?: string[];
  options?: BuildOptions;
  // Internal — advanced override, still supported by the API for callers
  // that know specific ASINs. Not exposed in the admin UI.
  asins?: string[];
  retailers?: string[];
  models?: unknown[];
  cities?: string[];
};

// Map a region code to Keepa's domain id. See Keepa docs:
// https://keepa.com/#!discuss/t/retrieve-product-object/116
export const KEEPA_DOMAINS: Record<string, number> = {
  US: 1, UK: 2, DE: 3, FR: 4, JP: 5, CA: 6, IT: 8, ES: 9, IN: 10, MX: 11,
};

export const APIFY_COUNTRY: Record<string, string> = {
  US: "US", UK: "GB", DE: "DE", FR: "FR", JP: "JP", CA: "CA", IT: "IT", ES: "ES", IN: "IN", MX: "MX",
};

export type CreateBuildResult = {
  build_id: string;
  brand_slug: string;
  status: "queued";
  poll_url: string;
};

/**
 * Entry point. Validates the input, writes a `queued` build row to BQ, kicks
 * off the orchestration in the background, and returns the build_id so the
 * HTTP response can resolve immediately. The caller polls GET /api/builds/<id>.
 */
export async function createBuild(input: CreateBuildInput): Promise<CreateBuildResult> {
  const { slug, name } = input;
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("slug must be lowercase letters, digits, hyphens only");
  if (!name) throw new Error("name is required");

  const hasCategory = !!(input.aiCategory && input.aiCategory.trim().length > 0);
  const hasAsins = !!(input.asins && input.asins.length > 0);
  const hasProducts = !!(input.products && input.products.length > 0);
  const allowRefPreview = input.options && (input.options as { allowReferencePreview?: boolean }).allowReferencePreview === true;
  if (!hasCategory && !hasAsins && !hasProducts && !allowRefPreview) {
    throw new Error(`brand "${slug}" has no inputs. Supply a Category, specific Product names, or specific ASINs.`);
  }

  const build_id = "b_" + nanoid(10);
  const request = {
    name,
    brandLink: input.brandLink ?? null,
    region: (input.region ?? "US").toUpperCase(),
    aiCategory: input.aiCategory ?? "",
    aiCompetitors: input.aiCompetitors ?? [],
    products: input.products ?? [],
  };
  const options: BuildOptions = { simulation_only: true, ...input.options, inputs: request };

  await upsertBrand({
    slug,
    name,
    category: input.category ?? null,
    retailers: input.retailers ?? null,
    models: input.models ?? null,
    cities: input.cities ?? null,
    latest_build_id: null,
  });

  await insertBuild({
    build_id,
    brand_slug: slug,
    status: "queued",
    options,
    steps: [{ name: "config", status: "pending" }, { name: "builder", status: "pending" }, { name: "upload", status: "pending" }],
    started_at: null,
    finished_at: null,
    payload_url: null,
    logs_url: null,
    error: null,
  });

  // Fire-and-forget. Cloud Run keeps the container alive during the request;
  // scale-down happens after an idle period, which is long enough for a 1-2 min
  // simulation. For real captures (15-30 min), this needs Cloud Run Jobs.
  runBuild(build_id, slug, name, options, {
    asins: input.asins ?? [],
    products: input.products ?? [],
    aiCategory: input.aiCategory ?? null,
    aiCompetitors: input.aiCompetitors ?? [],
    brandLink: input.brandLink ?? null,
    region: (input.region ?? "US").toUpperCase(),
  }).catch((e: unknown) => {
    const err = e as { errors?: unknown; response?: unknown; message?: string };
    console.error(
      "[capture] runBuild threw",
      build_id,
      JSON.stringify({ message: err.message, errors: err.errors, response: err.response }, null, 2),
    );
  });

  return {
    build_id,
    brand_slug: slug,
    status: "queued",
    poll_url: `/api/builds/${build_id}`,
  };
}

type RunInputs = {
  asins: string[];
  products: string[];
  aiCategory: string | null;
  aiCompetitors: string[];
  brandLink: string | null;
  region: string;
};

async function runBuild(build_id: string, slug: string, name: string, options: BuildOptions, inputs: RunInputs) {
  const { asins, products, aiCategory, aiCompetitors, brandLink, region } = inputs;
  const keepaDomain = KEEPA_DOMAINS[region] ?? 1;
  const category = aiCategory && aiCategory.trim() ? aiCategory.trim() : null;
  const willDiscoverByProducts = asins.length === 0 && products.length > 0;
  const willDiscoverByCategory = asins.length === 0 && products.length === 0 && !!category;
  const willAutoDiscover = willDiscoverByProducts || willDiscoverByCategory;
  const willHitKeepa = (asins.length > 0 || willAutoDiscover);
  const willHitAI = !!category;
  const willHitCompetitorKeepa = !!category && aiCompetitors.length > 0;
  const willHitApify = willHitKeepa && !!process.env.APIFY_TOKEN;
  const willReadShelf = !!category && !!process.env.APIFY_TOKEN;

  const steps: BuildStep[] = [
    { name: "config", status: "pending" },
    ...(willAutoDiscover ? [{ name: "asin-discovery", status: "pending" as const }] : []),
    ...(willHitKeepa ? [{ name: "keepa", status: "pending" as const }] : []),
    ...(willHitCompetitorKeepa ? [{ name: "keepa-competitors", status: "pending" as const }] : []),
    ...(willHitApify ? [{ name: "apify-amazon", status: "pending" as const }] : []),
    ...(willReadShelf ? [{ name: "amazon-shelf", status: "pending" as const }] : []),
    ...(willHitAI ? [{ name: "ai-visibility", status: "pending" as const }] : []),
    { name: "builder", status: "pending" },
    { name: "relabel", status: "pending" },
    { name: "rebrand", status: "pending" },
    { name: "upload", status: "pending" },
  ];
  const logChunks: string[] = [];
  const logLine = (s: string) => logChunks.push(`[${new Date().toISOString()}] ${s}`);
  logLine(`region ${region} (Keepa domain ${keepaDomain})${brandLink ? ` · ${brandLink}` : ""}`);
  logLine(`measured-only build for "${slug}": only what Keepa, Apify and Claude return reaches the payload.`);

  await updateBuild(build_id, { status: "running", started_at: new Date().toISOString(), steps });

  const VENDOR = resolve(process.cwd(), "vendor", "bravo-platform");
  if (!existsSync(VENDOR)) {
    await failBuild(build_id, steps, logChunks, slug, `vendor dir missing at ${VENDOR}`);
    return;
  }

  const setStep = async (stepName: string, patch: Partial<BuildStep>) => {
    const i = steps.findIndex((s) => s.name === stepName);
    if (i < 0) return;
    steps[i] = { ...steps[i], ...patch };
    await updateBuild(build_id, { steps: [...steps] });
  };
  const runStep = async <T>(stepName: string, fn: () => Promise<T>): Promise<T | null> => {
    await setStep(stepName, { status: "running", started_at: new Date().toISOString() });
    const start = Date.now();
    try {
      const out = await fn();
      await setStep(stepName, { status: "done", duration_ms: Date.now() - start });
      return out;
    } catch (e) {
      const err = (e as Error).message;
      logLine(`${stepName} failed: ${err}`);
      await setStep(stepName, { status: "done", duration_ms: Date.now() - start, error: err });
      return null;
    }
  };

  logLine("preparing working copy");
  const workDir = mkdtempSync(join(tmpdir(), `ccc-build-${slug}-`));
  cpSync(VENDOR, workDir, { recursive: true });
  await setStep("config", { status: "done", duration_ms: 0 });

  let effectiveAsins = asins;
  if (willAutoDiscover) {
    effectiveAsins = (await runStep("asin-discovery", async () => {
      const apiKey = process.env.INS_KEEPA_KEY;
      if (!apiKey) throw new Error("INS_KEEPA_KEY not configured");
      const seen = new Set<string>();
      if (willDiscoverByProducts) {
        for (const p of products) {
          const term = `${name} ${p}`;
          const asin = (await fetchKeepaSearch(term, apiKey, 1, keepaDomain))[0];
          logLine(`  "${term}" → ${asin ?? "no result"}`);
          if (asin) seen.add(asin);
        }
      } else if (category) {
        const term = `${name} ${category}`;
        logLine(`searching Keepa for top ASINs matching "${term}"`);
        for (const a of await fetchKeepaSearch(term, apiKey, 5, keepaDomain)) seen.add(a);
      }
      logLine(`discovered ${seen.size} ASIN(s): ${[...seen].join(", ") || "(none)"}`);
      return [...seen];
    })) ?? [];
  }

  let keepaResult: KeepaBrandAggregate | null = null;
  if (willHitKeepa && effectiveAsins.length > 0) {
    keepaResult = await runStep("keepa", async () => {
      const apiKey = process.env.INS_KEEPA_KEY;
      if (!apiKey) throw new Error("INS_KEEPA_KEY not configured");
      const r = await fetchKeepaBrand(effectiveAsins, apiKey, keepaDomain, name);
      for (const x of r.rejected) logLine(`  excluded ${x.asin}: brand "${x.brand ?? "?"}" · ${(x.title ?? "").slice(0, 80)}`);
      logLine(`Keepa: ${r.asinsWithData}/${r.asinsFetched} listings are ${name}'s (rating ${r.avgRating}, discount ${r.avgDiscountRate}, 30-day in-stock ${r.inStockRate}, reviews ${r.totalReviews})`);
      if (r.asinsWithData === 0) throw new Error(`none of the ${r.asinsFetched} listings belong to ${name}`);
      return r;
    });
  }

  let competitorKeepa: Array<KeepaBrandAggregate | null> = [];
  if (willHitCompetitorKeepa && category) {
    competitorKeepa = (await runStep("keepa-competitors", async () => {
      const apiKey = process.env.INS_KEEPA_KEY;
      if (!apiKey) throw new Error("INS_KEEPA_KEY not configured");
      const out: Array<KeepaBrandAggregate | null> = [];
      for (const comp of aiCompetitors.slice(0, 4)) {
        const found = await fetchKeepaSearch(`${comp} ${category}`, apiKey, 5, keepaDomain);
        if (!found.length) {
          logLine(`  ${comp}: no Keepa search results`);
          out.push(null);
          continue;
        }
        let r = await fetchKeepaBrand(found, apiKey, keepaDomain, comp);
        for (const x of r.rejected) logLine(`  ${comp}: excluded ${x.asin} brand "${x.brand ?? "?"}" · ${(x.title ?? "").slice(0, 60)}`);
        if (r.asinsWithData === 0) {
          const byName = (await fetchKeepaSearch(comp, apiKey, 5, keepaDomain)).filter((a) => !found.includes(a));
          logLine(`  ${comp}: no own listings for "${comp} ${category}", searching "${comp}" → ${byName.length} result(s)`);
          if (byName.length) {
            r = await fetchKeepaBrand(byName, apiKey, keepaDomain, comp);
            for (const x of r.rejected) logLine(`  ${comp}: excluded ${x.asin} brand "${x.brand ?? "?"}" · ${(x.title ?? "").slice(0, 60)}`);
          }
        }
        logLine(`  ${comp}: ${r.asinsWithData}/${r.asinsFetched} listings (rating ${r.avgRating}, discount ${r.avgDiscountRate}, 30-day in-stock ${r.inStockRate})`);
        out.push(r.asinsWithData > 0 ? r : null);
      }
      return out;
    })) ?? [];
  }

  let apifyByAsin = new Map<string, AmazonProduct>();
  const listingAsins = [keepaResult, ...competitorKeepa].flatMap((k) => {
    if (!k) return [];
    const rejected = new Set(k.rejected.map((r) => r.asin));
    return k.perAsin.filter((r) => !rejected.has(r.asin) && (r.priceNow != null || r.rating != null)).map((r) => r.asin);
  });
  if (willHitApify && listingAsins.length) {
    apifyByAsin = (await runStep("apify-amazon", async () => {
      const r = await fetchApifyAmazon(listingAsins, process.env.APIFY_TOKEN!, APIFY_COUNTRY[region] ?? "US");
      logLine(`Apify: ${r.asinsWithData}/${r.asinsFetched} product pages read (avg delivery ${r.avgDeliveryDays}d)`);
      for (const x of r.perAsin) if (x.error) logLine(`  ${x.asin}: ${x.error}`);
      return new Map(r.perAsin.filter((x) => x.price != null).map((x) => [x.asin, x]));
    })) ?? new Map();
  }

  let shelfResults: SearchResult[] | null = null;
  if (willReadShelf && category) {
    shelfResults = await runStep("amazon-shelf", async () => {
      const r = await fetchAmazonSearch(category, process.env.APIFY_TOKEN!, APIFY_COUNTRY[region] ?? "US", 48);
      if (!r.length) throw new Error(`no search results read for "${category}"`);
      logLine(`Amazon search "${category}": ${r.length} results, ${r.filter((x) => x.sponsored).length} flagged sponsored`);
      return r;
    });
  }

  let aiResult: AiSoMResult | null = null;
  if (willHitAI && category) {
    aiResult = await runStep("ai-visibility", async () => {
      logLine(`asking Claude 12 shopper questions about "${category}" twice and counting brand mentions`);
      const r = await fetchAiShareOfMind({ subjectName: name, category, competitors: aiCompetitors });
      logLine(`AI share of answer: ${JSON.stringify(r.shareByBrand)} (${r.totalBrandMentions} mentions, ${r.questionsFailed}/${r.questionsAsked} questions failed)`);
      logLine(`per run: ${r.shareByRun.map((x) => JSON.stringify(x)).join(" | ")}`);
      for (const q of r.perQuestion) logLine(`  [run ${q.run} · ${q.stage}] ${q.q.slice(0, 70)} → ${q.error ? `failed: ${q.error}` : q.mentionOrder.join(" > ") || "no brands"}`);
      return r;
    });
  }

  const relabelInputs: RelabelInputs = buildRelabelInputs({ subjectName: name, competitors: aiCompetitors, category, keepa: keepaResult, competitorKeepa, ai: aiResult, apify: apifyByAsin, shelfResults });
  prepareRelabelWorkDir(workDir, relabelInputs);
  logLine(`applied measurements: ${JSON.stringify(relabelInputs.applied)}`);

  await setStep("builder", { status: "running", started_at: new Date().toISOString() });
  const builderStart = Date.now();
  const outPath = join(workDir, "public", `${REFERENCE_BRAND}-command-center-data.json`);
  if (existsSync(outPath)) unlinkSync(outPath);
  const builderScript = join(workDir, "scripts", "insights", "build-cco-dataset" + ".m" + "js");
  const builder = spawn("node", [builderScript, "--brand", RELABEL_CONFIG_ID], { cwd: workDir, env: { ...process.env } });
  builder.stdout.on("data", (b: Buffer) => logLine(b.toString().trimEnd()));
  builder.stderr.on("data", (b: Buffer) => logLine("ERR " + b.toString().trimEnd()));
  const code: number = await new Promise((res) => builder.on("close", res));
  const builderDur = Date.now() - builderStart;
  if (code !== 0 || !existsSync(outPath)) {
    const err = `builder exited ${code}` + (!existsSync(outPath) ? "; output file missing" : "");
    await setStep("builder", { status: "pending", duration_ms: builderDur, error: err });
    await failBuild(build_id, steps, logChunks, slug, err);
    return;
  }
  await setStep("builder", { status: "done", duration_ms: builderDur });
  logLine(`builder done in ${builderDur}ms`);

  let payloadJson = readFileSync(outPath, "utf8");
  await runStep("relabel", async () => {
    const { json, provenance } = applyProvenance(payloadJson, relabelInputs, name, slug, options.inputs);
    payloadJson = json;
    logLine(`provenance: ${measuredCount(provenance, provenance.subjectSlot)} of 12 measures measured for ${name}`);
  });

  await runStep("rebrand", async () => {
    payloadJson = JSON.stringify(rebrandPayload(JSON.parse(payloadJson) as unknown, {
      subject: { name, slug },
      competitors: aiCompetitors,
      subjectProducts: [],
      competitorProducts: [],
    }));
  });

  await setStep("upload", { status: "running", started_at: new Date().toISOString() });
  const uploadStart = Date.now();
  const payload_url = await uploadPayload(slug, build_id, payloadJson);
  const logs_url = await uploadLog(slug, build_id, logChunks.join("\n"));
  await setStep("upload", { status: "done", duration_ms: Date.now() - uploadStart });
  logLine(`uploaded payload (${payloadJson.length} bytes) → ${payload_url}`);

  await updateBuild(build_id, { status: "ready", steps, finished_at: new Date().toISOString(), payload_url, logs_url });
  const brand = await getBrand(slug);
  if (brand) await upsertBrand({ ...brand, latest_build_id: build_id });
  logLine("build complete");
  await uploadLog(slug, build_id, logChunks.join("\n")).catch(() => {});
  rmSync(workDir, { recursive: true, force: true });
}

async function failBuild(
  build_id: string,
  steps: BuildStep[],
  logChunks: string[],
  slug: string,
  error: string,
) {
  logChunks.push(`[${new Date().toISOString()}] FAILED: ${error}`);
  const logs_url = await uploadLog(slug, build_id, logChunks.join("\n")).catch(() => null);
  await updateBuild(build_id, {
    status: "failed",
    steps,
    finished_at: new Date().toISOString(),
    error,
    logs_url,
  });
}
