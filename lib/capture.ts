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
import { fetchAiShareOfMind, generateQuestionBank, type AiSoMResult } from "./ai-visibility";
import { buildAiConsole, crawlerSites, type ConsoleCapture } from "./ai-console";
import { readCrawlerAccess } from "./crawler-access";
import { buildWorkbench, type CommandCenterData } from "./aeo-workbench";
import { applyAiHistory, readingsFrom } from "./ai-history";
import { latestReadyBuildId, loadBuildPayload } from "./payload-source";
import { availableEngines } from "./ai-engines";
import { applyOverrides, loadOverrides } from "./brand-overrides";
import { fetchAmazonSearch, fetchApifyAmazon, type AmazonProduct, type SearchResult } from "./apify";
import { buildRelabelInputs, type RelabelInputs } from "./launch-override";
import { measuredCount } from "./provenance";
import { RELABEL_CONFIG_ID, applyProvenance, prepareRelabelWorkDir } from "./relabel-pipeline";
import { rebrandPayload } from "./rebrand";
import { categoryCheck } from "./listing-relevance";
import { generateMarketProfile, marketProfileKey, type MarketProfile } from "./market-profile";
import { brightDataKey } from "./brightdata";
import { captureRetailOffers, loadRetailHistory, readableRetailers, retailProductsFrom, type RetailCapture } from "./retail-offers";
import { feedPath, feedPriceImport, loadRetailFeed, type RetailFeed } from "./retail-feed";
import { loadReusableAi, saveAiResult } from "./ai-reuse";
import { feedView, withFeedReviewLane, withRetailerReviews } from "./retail-feed-view";

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
  competitorAsins?: Record<string, string[]>;
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
    asins: input.asins ?? [],
    competitorAsins: input.competitorAsins ?? {},
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
    competitorAsins: input.competitorAsins ?? {},
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
  competitorAsins: Record<string, string[]>;
  brandLink: string | null;
  region: string;
};

async function runBuild(build_id: string, slug: string, name: string, options: BuildOptions, inputs: RunInputs) {
  const { asins, products, aiCategory, aiCompetitors, competitorAsins, brandLink, region } = inputs;
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
  const hasFeed = existsSync(feedPath(slug));
  const willReadRetail = willHitKeepa && !!category && !!brightDataKey() && !hasFeed;

  const steps: BuildStep[] = [
    { name: "config", status: "pending" },
    ...(willAutoDiscover ? [{ name: "asin-discovery", status: "pending" as const }] : []),
    ...(willHitKeepa ? [{ name: "keepa", status: "pending" as const }] : []),
    ...(willHitCompetitorKeepa ? [{ name: "keepa-competitors", status: "pending" as const }] : []),
    ...(willHitApify ? [{ name: "apify-amazon", status: "pending" as const }] : []),
    ...(willReadShelf ? [{ name: "amazon-shelf", status: "pending" as const }] : []),
    ...(willHitAI ? [{ name: "ai-visibility", status: "pending" as const }] : []),
    ...(category ? [{ name: "market-profile", status: "pending" as const }] : []),
    ...(willReadRetail ? [{ name: "retail-offers", status: "pending" as const }] : []),
    { name: "builder", status: "pending" },
    { name: "relabel", status: "pending" },
    { name: "rebrand", status: "pending" },
    ...(willHitAI ? [{ name: "ai-console", status: "pending" as const }] : []),
    { name: "overrides", status: "pending" },
    ...(hasFeed ? [{ name: "retail-feed", status: "pending" as const }] : []),
    { name: "upload", status: "pending" },
  ];
  const logChunks: string[] = [];
  const logLine = (s: string) => logChunks.push(`[${new Date().toISOString()}] ${s}`);
  logLine(`region ${region} (Keepa domain ${keepaDomain})${brandLink ? ` · ${brandLink}` : ""}`);
  logLine(`build for "${slug}": AI engines, Keepa and Apify readings are laid over a market modelled per brand.`);

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

  const inCategory = category ? categoryCheck(category, logLine) : undefined;
  const logOffCategory = (who: string, r: KeepaBrandAggregate) => {
    for (const x of r.offCategory) logLine(`  ${who}: not ${category} — excluded ${x.asin} · ${(x.title ?? "").slice(0, 80)}`);
  };

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
      const r = await fetchKeepaBrand(effectiveAsins, apiKey, keepaDomain, name, inCategory);
      for (const x of r.rejected.filter((y) => !r.offCategory.includes(y))) logLine(`  excluded ${x.asin}: brand "${x.brand ?? "?"}" · ${(x.title ?? "").slice(0, 80)}`);
      logOffCategory(name, r);
      logLine(`Keepa: ${r.asinsWithData}/${r.asinsFetched} listings are ${name}'s (rating ${r.avgRating}, discount ${r.avgDiscountRate}, 30-day in-stock ${r.inStockRate}, reviews ${r.totalReviews})`);
      if (r.asinsWithData === 0) throw new Error(`none of the ${r.asinsFetched} listings belong to ${name}`);
      return r;
    });
  }

  if (willHitKeepa && !keepaResult) {
    await failBuild(build_id, steps, logChunks, slug, `no Amazon listings found for "${name}" — the brand name must match how it is listed on Amazon (Keepa brand or title), and the listings must be ${category ?? "in the category"}`);
    rmSync(workDir, { recursive: true, force: true });
    return;
  }

  let competitorKeepa: Array<KeepaBrandAggregate | null> = [];
  if (willHitCompetitorKeepa && category) {
    competitorKeepa = (await runStep("keepa-competitors", async () => {
      const apiKey = process.env.INS_KEEPA_KEY;
      if (!apiKey) throw new Error("INS_KEEPA_KEY not configured");
      const out: Array<KeepaBrandAggregate | null> = [];
      for (const comp of aiCompetitors.slice(0, 4)) {
        const pinned = competitorAsins[comp] ?? [];
        if (pinned.length) {
          const r = await fetchKeepaBrand(pinned, apiKey, keepaDomain, comp, inCategory);
          for (const x of r.rejected.filter((y) => !r.offCategory.includes(y))) logLine(`  ${comp}: excluded pinned ${x.asin} brand "${x.brand ?? "?"}" · ${(x.title ?? "").slice(0, 60)}`);
          logOffCategory(comp, r);
          logLine(`  ${comp}: ${r.asinsWithData}/${r.asinsFetched} pinned listings (rating ${r.avgRating}, discount ${r.avgDiscountRate}, 30-day in-stock ${r.inStockRate})`);
          out.push(r.asinsWithData > 0 ? r : null);
          continue;
        }
        const found = await fetchKeepaSearch(`${comp} ${category}`, apiKey, 5, keepaDomain);
        if (!found.length) {
          logLine(`  ${comp}: no Keepa search results`);
          out.push(null);
          continue;
        }
        let r = await fetchKeepaBrand(found, apiKey, keepaDomain, comp, inCategory);
        for (const x of r.rejected.filter((y) => !r.offCategory.includes(y))) logLine(`  ${comp}: excluded ${x.asin} brand "${x.brand ?? "?"}" · ${(x.title ?? "").slice(0, 60)}`);
        logOffCategory(comp, r);
        if (r.asinsWithData === 0) {
          const byName = (await fetchKeepaSearch(comp, apiKey, 5, keepaDomain)).filter((a) => !found.includes(a));
          logLine(`  ${comp}: no own listings for "${comp} ${category}", searching "${comp}" → ${byName.length} result(s)`);
          if (byName.length) {
            r = await fetchKeepaBrand(byName, apiKey, keepaDomain, comp, inCategory);
            for (const x of r.rejected.filter((y) => !r.offCategory.includes(y))) logLine(`  ${comp}: excluded ${x.asin} brand "${x.brand ?? "?"}" · ${(x.title ?? "").slice(0, 60)}`);
            logOffCategory(comp, r);
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
  let aiCapturedAt = new Date();
  let aspects: string[] = [];
  if (willHitAI && category) {
    aiResult = await runStep("ai-visibility", async () => {
      if (options.reuse_ai) {
        const reused = await loadReusableAi(slug, name, category, aiCompetitors).catch(() => null);
        if (reused) {
          aiCapturedAt = new Date(reused.capturedAt);
          aspects = reused.result.bank.attributes.slice(0, 6).map((a) => a.charAt(0).toUpperCase() + a.slice(1));
          logLine(`AI answers reused from the ${reused.source} (captured ${reused.capturedAt}): ${reused.result.engines.map((e) => e.label).join(", ")}, ${reused.result.questionsAsked - reused.result.questionsFailed} answers; share ${JSON.stringify(reused.result.shareByBrand)}`);
          return reused.result;
        }
        logLine("AI answers: none to reuse for this category and these brands, asking the engines");
      }
      const engines = availableEngines();
      const bank = await generateQuestionBank(name, aiCompetitors, category);
      logLine(`question bank for "${category}": ${bank.questions.length} questions (${bank.questions.filter((q) => q.focus === "neutral").length} brand-neutral); attributes: ${bank.attributes.join(", ")}; domains: ${JSON.stringify(bank.domains)}`);
      logLine(`asking ${engines.map((e) => `${e.label} (${e.model}${e.webSearch ? ", web search" : ""})`).join(", ")} every question once`);
      const r = await fetchAiShareOfMind({ subjectName: name, category, competitors: aiCompetitors, engines, bank });
      aspects = bank.attributes.slice(0, 6).map((a) => a.charAt(0).toUpperCase() + a.slice(1));
      for (const f of r.failedEngines) logLine(`  ${f.label} failed: ${f.error}`);
      for (const e of r.engines) {
        logLine(`  ${e.label}: share ${JSON.stringify(e.shareByBrand)} · mentioned in ${JSON.stringify(e.mentionRateByBrand)}% of answers · ${e.questionsFailed}/${e.questionsAsked} failed · brands matched by ${e.matching}`);
        if (e.otherBrands.length) logLine(`    other brands named: ${e.otherBrands.map((o) => `${o.brand} (${o.answers})`).join(", ")}`);
      }
      logLine(`AI share across engines: ${JSON.stringify(r.shareByBrand)}`);
      for (const q of r.perQuestion.filter((x) => x.run === 1)) logLine(`  [${q.engine} · ${q.stage}] ${q.q.slice(0, 70)} → ${q.error ? `failed: ${q.error}` : [...q.mentionOrder, ...q.otherBrands.map((o) => `(${o})`)].join(" > ") || "no brands"}`);
      await saveAiResult(slug, category, [name, ...aiCompetitors], r, aiCapturedAt.toISOString()).catch((e: unknown) => logLine(`  AI answers not saved for reuse: ${(e as Error).message}`));
      return r;
    });
  }

  let market: MarketProfile | null = null;
  if (category) {
    market = await runStep("market-profile", async () => {
      const brands = [name, ...aiCompetitors.slice(0, 4)];
      const key = marketProfileKey(category, region, brands);
      const saved = await previousMarketProfile(slug).catch(() => null);
      if (saved?.key === key && saved.source !== "fallback") {
        logLine(`market profile: reusing the profile from the last build (${saved.source}) — same category, region and brands`);
        return saved;
      }
      const p = await generateMarketProfile({ category, region, brands, subjectSite: brandLink, log: logLine });
      logLine(`market profile (${p.source}): ${p.durable ? "durable" : "consumable"}, typical price ${p.typicalPrice}; retailers ${p.retailers.map((r) => `${r.label} ${Math.round(r.weight * 100)}%`).join(", ")}`);
      for (const b of brands) logLine(`  ${b}: carried ${p.retailers.map((r) => `${r.label} ${p.carriage[b]?.[r.id] ?? "?"}`).join(", ")} · site ${p.traffic[b]?.domain ?? "none"} ~${p.traffic[b]?.monthlyVisits ?? "?"} visits/month`);
      logLine(`  mechanics: ${p.retailers.map((r) => `${r.label} [${Object.keys(p.mechanics[r.id] ?? {}).join(", ")}]`).join("; ")}`);
      for (const c of p.changes) logLine(`  audit: ${c}`);
      return p;
    });
  }

  if (!market) logLine(`market profile: none for this build; using the plain Amazon, Walmart and Target market`);

  let retail: RetailCapture | null = null;
  const retailers = readableRetailers(market?.retailers ?? []);
  if (willReadRetail && retailers.length) {
    retail = await runStep("retail-offers", async () => {
      const products = retailProductsFrom([[name, keepaResult], ...aiCompetitors.slice(0, 4).map((c, i): [string, KeepaBrandAggregate | null] => [c, competitorKeepa[i] ?? null])], listingAsins);
      logLine(`retailer sites: ${products.length} listings at ${retailers.map((r) => r.label).join(", ")}`);
      const r = await captureRetailOffers({ slug, products, retailers: market?.retailers ?? [], key: brightDataKey()!, log: logLine, remember: new Set(products.map((p) => p.asin)) });
      logLine(`retailer sites: ${Object.keys(r.readings).length}/${products.length} listings found at another retailer`);
      return r;
    });
  }

  if (hasFeed) logLine(`retailer sites: not read live; brand-data/${slug}.feed.json supplies the retailer data`);

  let feed: RetailFeed | null = null;
  try {
    feed = loadRetailFeed(slug);
    if (feed) {
      retail ??= { date: new Date().toISOString().slice(0, 10), readings: {}, history: await loadRetailHistory(slug) };
      retail.imported = feedPriceImport(feed);
      retail.feed = feed;
      const days = Object.values(feed.daily).flat().map((d) => d.date).sort();
      const products = Object.values(feed.products);
      logLine(`retailer feed: ${feed.label} — ${products.length} products (${products.filter((p) => p.asin).length} matched to Amazon listings), ${days[0]} to ${days[days.length - 1]}, ${Object.values(feed.reviews).flat().length} reviews; a live reading replaces a feed price on its day`);
    }
  } catch (e) {
    logLine(`retailer feed not applied: ${(e as Error).message}`);
  }

  const relabelInputs: RelabelInputs = buildRelabelInputs({ subjectName: name, competitors: aiCompetitors, category, keepa: keepaResult, competitorKeepa, ai: aiResult, apify: apifyByAsin, shelfResults, aspects, market, retail, seed: slug, pinned: [...(asins.length ? [name] : []), ...aiCompetitors.filter((c) => (competitorAsins[c] ?? []).length)] });
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
    const { json, provenance } = applyProvenance(payloadJson, relabelInputs, name, slug, options.inputs, market);
    payloadJson = json;
    logLine(`provenance: ${measuredCount(provenance, provenance.subjectSlot)} of 12 scorecard measures read from a live source for ${name}; the rest are modelled`);
  });

  await runStep("rebrand", async () => {
    payloadJson = JSON.stringify(rebrandPayload(JSON.parse(payloadJson) as unknown, {
      subject: { name, slug },
      competitors: aiCompetitors,
      subjectProducts: [],
      competitorProducts: [],
    }));
  });

  if (aiResult) {
    const ai = aiResult;
    await runStep("ai-console", async () => {
      const payload = JSON.parse(payloadJson) as { dims: { brands: Array<{ id: string; label: string; color: string }>; models: Array<{ brand: string; label: string; msrp?: number }> }; meta: { subject: string } } & Record<string, unknown>;
      const names = [name, ...aiCompetitors];
      const brands = payload.dims.brands.slice(0, names.length).map((b, i) => ({ ...b, name: names[i] }));
      let previous: ConsoleCapture | null = null;
      const prevId = await latestReadyBuildId(slug).catch(() => null);
      const prev = prevId ? await loadBuildPayload(slug, prevId) : null;
      const prevJson: unknown = prev ? JSON.parse(prev.bytes.toString("utf8")) : null;
      const today = aiCapturedAt.toISOString().slice(0, 10);
      if (prevJson) {
        const pc = (prevJson as { aiConsole?: { captures: Record<string, ConsoleCapture>; current: string } }).aiConsole;
        previous = Object.values(pc?.captures ?? {}).filter((c) => c.basis < today).sort((a, z) => z.basis.localeCompare(a.basis))[0] ?? null;
      }
      const readings = applyAiHistory(payload, readingsFrom(prevJson), today);
      logLine(`AI share history: ${readings.length} reading(s) — ${readings.map((r) => r.date).join(", ")}`);
      const subjectDomain = brandLink ? (() => { try { return new URL(brandLink).hostname.replace(/^www\./, ""); } catch { return null; } })() : null;
      const consolePayload = buildAiConsole({
        slug, ai, brands, subjectDomain, category: category ?? "", market: region,
        products: payload.dims.models.filter((m) => m.brand === payload.meta.subject).map((m) => ({ label: m.label, msrp: m.msrp ?? null })),
        previous, crawlerAccess: null, now: aiCapturedAt,
      });
      const sites = crawlerSites(consolePayload, 8, market ? market.retailers.map((r) => r.domain) : undefined);
      consolePayload.crawlerAccess = await readCrawlerAccess(sites).catch(() => null);
      payload.aiConsole = consolePayload;
      payload.aeoWorkbench = buildWorkbench(consolePayload, payload as unknown as CommandCenterData, slug);
      payloadJson = JSON.stringify(payload);
      const cur = consolePayload.captures[consolePayload.current];
      logLine(`AI console: ${cur.n} answers, ${cur.answers.reduce((n, a) => n + a.sources.length, 0)} citations, ${cur.answers.reduce((n, a) => n + a.subjectClaims.length, 0)} claims about ${name}; ${previous ? `compared with the capture of ${previous.basis}` : "no earlier capture to compare"}; crawler access read for ${consolePayload.crawlerAccess?.sites.length ?? 0} sites`);
    });
  }

  await runStep("overrides", async () => {
    const overrides = loadOverrides(slug);
    if (!overrides) { logLine(`no brand-data/${slug}.json; modelled lanes keep their generated values`); return; }
    const payload = JSON.parse(payloadJson) as unknown;
    const r = applyOverrides(payload, overrides, { ai: relabelInputs.applied.aiSlots.length > 0, amazon: relabelInputs.applied.amazonSeries.length > 0 });
    payloadJson = JSON.stringify(payload);
    logLine(`brand-data/${slug}.json: ${r.applied.length} value(s) applied${r.skipped.length ? `; kept measured data at ${r.skipped.join(", ")}` : ""}`);
  });

  if (feed) {
    const loaded = feed;
    await runStep("retail-feed", async () => {
      const payload = JSON.parse(payloadJson) as { meta: unknown; dims: { brands: Array<{ id: string; label: string }>; models: Array<{ id: string; asin?: string }>; dates: string[]; aspects?: string[]; aspectMonths?: string[] } } & Record<string, unknown>;
      const view = feedView(loaded, payload.dims);
      payload.retailFeed = view;
      const added = withRetailerReviews(payload.voice as Parameters<typeof withRetailerReviews>[0], payload.dims, view);
      logLine(`retailer reviews folded into Voice of Customer: ${added.mentions} aspect mentions, ${added.quotes} quotes`);
      withFeedReviewLane((payload.meta as { provenance?: { lanes?: Record<string, { status: string; note: string; sources?: string[] }> } }).provenance?.lanes, view);
      payloadJson = JSON.stringify(payload);
      logLine(`retailer feed view: ${view.products.length} products, ${Object.values(view.daily).reduce((n, d) => n + d.length, 0)} product-days in the window, ${view.products.filter((p) => p.model).length} tied to a tracked listing`);
    });
  }

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

async function previousMarketProfile(slug: string): Promise<MarketProfile | null> {
  const id = await latestReadyBuildId(slug);
  const prev = id ? await loadBuildPayload(slug, id) : null;
  if (!prev) return null;
  const meta = (JSON.parse(prev.bytes.toString("utf8")) as { meta?: { marketProfile?: MarketProfile } }).meta;
  return meta?.marketProfile?.version === 1 ? meta.marketProfile : null;
}
