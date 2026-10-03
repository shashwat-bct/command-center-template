// Build orchestration. Spawns the vendored bravo-platform CCO builder for a
// given slug, streams its output as build steps, uploads the result to GCS,
// and updates the build row in BigQuery throughout. Returns immediately with
// a build_id; the actual work runs in the background.
//
// Scope today: simulation-only runs for brands that already have captures baked
// into the image (sonos). Real-capture steps (Apify, Keepa, SimilarWeb) are the
// next layer and will land in a follow-up — this file leaves hook points for
// them (`options.run_apify`, etc.) but currently ignores them for a
// simulation_only run.

import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, cpSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { getBrand, insertBuild, updateBuild, upsertBrand, type BuildStep, type BuildOptions } from "./bq";
import { uploadLog, uploadPayload } from "./gcs";
import { fetchKeepaBrand, fetchKeepaSearch } from "./keepa";
import { fetchAiShareOfMind, fetchProductNames, type AiSoMResult } from "./ai-visibility";
import { fetchApifyAmazon, type ApifyAmazonAggregate } from "./apify";
import { overrideSubject } from "./launch-override";
import { rebrandPayload } from "./rebrand";

// Brands whose config + captures are vendored into the image. These run their
// own simulation builder with their own numbers.
const BRANDS_WITH_CONFIG = new Set(["sonos", "sony", "shark"]);

// The reference brand used when a request names a brand we don't have a config
// for. The builder runs under this slug and the resulting payload is relabeled
// to the requested brand before upload. The dashboard shows a disclosure.
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

  // Guard against the "SharkNinja took 3 seconds" trap: if the brand has no
  // vendored config AND no inputs were supplied, the build would be a pure
  // Sonos-reference preview. The category alone is enough to proceed because
  // the backend will auto-discover ASINs via Keepa search.
  const hasOwnConfig = BRANDS_WITH_CONFIG.has(slug);
  const hasCategory = !!(input.aiCategory && input.aiCategory.trim().length > 0);
  const hasAsins = !!(input.asins && input.asins.length > 0);
  const hasProducts = !!(input.products && input.products.length > 0);
  const allowRefPreview = input.options && (input.options as { allowReferencePreview?: boolean }).allowReferencePreview === true;
  if (!hasOwnConfig && !hasCategory && !hasAsins && !hasProducts && !allowRefPreview) {
    throw new Error(
      `brand "${slug}" has no vendored config and no inputs. Supply a Category (auto-discover top-selling ASINs via Keepa), specific Product names (Keepa resolves each), or specific ASINs. Vendored brands: ${[...BRANDS_WITH_CONFIG].join(", ")}.`,
    );
  }

  const build_id = "b_" + nanoid(10);
  const options: BuildOptions = { simulation_only: true, ...input.options };

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
  const apifyCountry = APIFY_COUNTRY[region] ?? "US";
  // Does this brand have its own config vendored? If not, the builder runs
  // under the reference brand, and we relabel the output.
  const hasOwnConfig = BRANDS_WITH_CONFIG.has(slug);
  const builderBrand = hasOwnConfig ? slug : REFERENCE_BRAND;
  const relabel = !hasOwnConfig;
  // Discovery runs when we have NO explicit ASINs but something else to search
  // with (category OR product names).
  const willDiscoverByProducts = relabel && asins.length === 0 && products.length > 0;
  const willDiscoverByCategory = relabel && asins.length === 0 && products.length === 0 && !!aiCategory && aiCategory.trim().length > 0;
  const willAutoDiscover = willDiscoverByProducts || willDiscoverByCategory;
  const willHitKeepa = relabel && (asins.length > 0 || willAutoDiscover);
  const willHitAI = relabel && !!aiCategory && aiCategory.trim().length > 0;
  const willHitApify = relabel && (asins.length > 0 || willAutoDiscover) && !!process.env.APIFY_TOKEN;
  const similarWebMissing = relabel && !process.env.SIMILARWEB_API_KEY;

  const steps: BuildStep[] = [
    { name: "config", status: "pending" },
    ...(willAutoDiscover ? [{ name: "asin-discovery", status: "pending" as const }] : []),
    ...(willHitKeepa ? [{ name: "keepa", status: "pending" as const }] : []),
    ...(willHitApify ? [{ name: "apify-amazon", status: "pending" as const }] : []),
    ...(willHitAI ? [{ name: "ai-visibility", status: "pending" as const }] : []),
    { name: "builder", status: "pending" },
    ...(relabel ? [{ name: "relabel", status: "pending" as const }] : []),
    ...(relabel ? [{ name: "rebrand", status: "pending" as const }] : []),
    { name: "upload", status: "pending" },
  ];
  const logChunks: string[] = [];
  const logLine = (s: string) => logChunks.push(`[${new Date().toISOString()}] ${s}`);
  if (hasOwnConfig) {
    logLine(`brand "${slug}" has a vendored config — running its own builder.`);
  } else {
    logLine(`region ${region} (Keepa domain ${keepaDomain}, Apify proxy ${apifyCountry})${brandLink ? ` · ${brandLink}` : ""}`);
    const parts: string[] = [];
    const asinDesc = willDiscoverByProducts
      ? `ASINs resolved from ${products.length} product name(s)`
      : willDiscoverByCategory
        ? `auto-discovered ASINs via Keepa search`
        : `${asins.length} supplied ASIN(s)`;
    if (willHitKeepa) parts.push(`Keepa for ${asinDesc}`);
    if (willHitApify) parts.push(`Apify Amazon live for ${asinDesc}`);
    if (willHitAI) parts.push(`AI share-of-mind on "${aiCategory}"${aiCompetitors.length ? ` vs ${aiCompetitors.join(", ")}` : ""}`);
    if (parts.length === 0) {
      logLine(`brand "${slug}" has no vendored config and no real-data inputs — running the ${REFERENCE_BRAND} builder and relabeling the output as "${name}" (pure reference preview).`);
    } else {
      logLine(`brand "${slug}" has no vendored config — real-data sources this build: ${parts.join(" + ")}. Everything else will be ${REFERENCE_BRAND} reference data.`);
    }
    if (similarWebMissing) logLine(`SimilarWeb traffic lane: no SIMILARWEB_API_KEY configured. Lane will show Sonos reference data with a "key_missing" provenance stamp.`);
  }

  await updateBuild(build_id, { status: "running", started_at: new Date().toISOString(), steps });

  // Resolve the vendored bravo-platform clone bundled with the app. In Docker
  // this lives at /app/vendor/bravo-platform; locally during `npm run dev` it
  // lives at <repo>/nextjs/vendor/bravo-platform.
  const VENDOR = resolve(process.cwd(), "vendor", "bravo-platform");
  if (!existsSync(VENDOR)) {
    await failBuild(build_id, steps, logChunks, slug, `vendor dir missing at ${VENDOR}`);
    return;
  }

  // Named step helpers — the steps array is dynamic (keepa + relabel appear
  // only in some paths) so index-based access is brittle.
  const stepIdx = (name: string) => steps.findIndex((s) => s.name === name);
  const setStep = async (name: string, patch: Partial<BuildStep>) => {
    const i = stepIdx(name);
    if (i < 0) return;
    steps[i] = { ...steps[i], ...patch };
    await updateBuild(build_id, { steps: [...steps] });
  };

  // Copy the vendored tree to a writable temp dir — the builder writes its
  // output next to the config, and the container filesystem is otherwise
  // read-only for the base image's own files.
  logLine("preparing working copy");
  const workDir = mkdtempSync(join(tmpdir(), `ccc-build-${slug}-`));
  cpSync(VENDOR, workDir, { recursive: true });

  await setStep("config", { status: "done", duration_ms: 0 });

  // --- asin-discovery step (resolve products OR category into ASINs) ---
  let effectiveAsins = asins;
  if (willAutoDiscover) {
    await setStep("asin-discovery", { status: "running", started_at: new Date().toISOString() });
    const dStart = Date.now();
    try {
      const apiKey = process.env.INS_KEEPA_KEY;
      if (!apiKey) throw new Error("INS_KEEPA_KEY not configured");
      const discovered: string[] = [];
      const seen = new Set<string>();

      if (willDiscoverByProducts) {
        logLine(`resolving ${products.length} product name(s) via Keepa search (1 ASIN per product)`);
        for (const p of products) {
          const term = `${name} ${p}`;
          const r = await fetchKeepaSearch(term, apiKey, 1, keepaDomain);
          const asin = r[0];
          if (asin && !seen.has(asin)) {
            seen.add(asin);
            discovered.push(asin);
            logLine(`  "${term}" → ${asin}`);
          } else {
            logLine(`  "${term}" → no result`);
          }
        }
      } else if (willDiscoverByCategory && aiCategory) {
        const term = `${name} ${aiCategory}`;
        logLine(`searching Keepa for top ASINs matching "${term}"`);
        const r = await fetchKeepaSearch(term, apiKey, 5, keepaDomain);
        for (const a of r) if (!seen.has(a)) { seen.add(a); discovered.push(a); }
        if (discovered.length === 0) {
          logLine(`no results for "${term}", trying just "${name}"`);
          const alt = await fetchKeepaSearch(name, apiKey, 5, keepaDomain);
          for (const a of alt) if (!seen.has(a)) { seen.add(a); discovered.push(a); }
        }
      }

      effectiveAsins = discovered;
      logLine(`discovered ${effectiveAsins.length} ASIN(s): ${effectiveAsins.join(", ") || "(none)"}`);
      await setStep("asin-discovery", { status: "done", duration_ms: Date.now() - dStart });
    } catch (e) {
      const err = (e as Error).message;
      logLine(`asin-discovery failed: ${err} — proceeding without ASIN-based real data`);
      await setStep("asin-discovery", { status: "done", duration_ms: Date.now() - dStart, error: err });
      effectiveAsins = [];
    }
  }

  // --- keepa step (uses supplied or auto-discovered ASINs) ---
  let keepaResult: Awaited<ReturnType<typeof fetchKeepaBrand>> | null = null;
  if (willHitKeepa && effectiveAsins.length > 0) {
    await setStep("keepa", { status: "running", started_at: new Date().toISOString() });
    const kStart = Date.now();
    try {
      const apiKey = process.env.INS_KEEPA_KEY;
      if (!apiKey) throw new Error("INS_KEEPA_KEY not configured on the backend");
      logLine(`calling Keepa for ${effectiveAsins.length} ASIN(s): ${effectiveAsins.join(", ")}`);
      keepaResult = await fetchKeepaBrand(effectiveAsins, apiKey, keepaDomain);
      logLine(`Keepa: ${keepaResult.asinsWithData}/${keepaResult.asinsFetched} ASINs returned data (avg list $${keepaResult.avgListPrice}, avg street $${keepaResult.avgStreetPrice}, rating ${keepaResult.avgRating}, reviews ${keepaResult.totalReviews})`);
      await setStep("keepa", { status: "done", duration_ms: Date.now() - kStart });
    } catch (e) {
      const err = (e as Error).message;
      logLine(`keepa step failed: ${err} — proceeding without Keepa data`);
      await setStep("keepa", { status: "done", duration_ms: Date.now() - kStart, error: err });
      keepaResult = null;
    }
  }

  // --- apify-amazon step (live Amazon product data) ---
  let apifyResult: ApifyAmazonAggregate | null = null;
  if (willHitApify && effectiveAsins.length > 0) {
    await setStep("apify-amazon", { status: "running", started_at: new Date().toISOString() });
    const aStart = Date.now();
    try {
      const apifyToken = process.env.APIFY_TOKEN!;
      logLine(`calling Apify junglee~Amazon-crawler for ${effectiveAsins.length} ASIN(s): ${effectiveAsins.join(", ")}`);
      apifyResult = await fetchApifyAmazon(effectiveAsins, apifyToken, apifyCountry);
      logLine(`Apify Amazon: ${apifyResult.asinsWithData}/${apifyResult.asinsFetched} ASINs returned data (avg price $${apifyResult.avgPrice}, offers ${apifyResult.totalOffersAvg}, delivery ${apifyResult.avgDeliveryDays}d)`);
      await setStep("apify-amazon", { status: "done", duration_ms: Date.now() - aStart });
    } catch (e) {
      const err = (e as Error).message;
      logLine(`apify-amazon step failed: ${err} — proceeding without live Amazon data`);
      await setStep("apify-amazon", { status: "done", duration_ms: Date.now() - aStart, error: err });
      apifyResult = null;
    }
  }

  // --- ai-visibility step (optional, only when category supplied + non-vendored brand) ---
  let aiResult: AiSoMResult | null = null;
  if (willHitAI && aiCategory) {
    await setStep("ai-visibility", { status: "running", started_at: new Date().toISOString() });
    const aStart = Date.now();
    try {
      logLine(`asking Claude ~8 shopper questions about "${aiCategory}" and counting brand mentions`);
      aiResult = await fetchAiShareOfMind({
        subjectName: name,
        category: aiCategory,
        competitors: aiCompetitors,
      });
      logLine(`AI Share of Mind: ${aiResult.subjectShare}% (${aiResult.subjectMentions}/${aiResult.totalBrandMentions} brand mentions across ${aiResult.questionsAsked} questions) · per-brand: ${JSON.stringify(aiResult.perBrand)}`);
      await setStep("ai-visibility", { status: "done", duration_ms: Date.now() - aStart });
    } catch (e) {
      const err = (e as Error).message;
      logLine(`ai-visibility step failed: ${err} — proceeding without AI SoM data`);
      await setStep("ai-visibility", { status: "done", duration_ms: Date.now() - aStart, error: err });
      aiResult = null;
    }
  }

  // Merge whatever real data we gathered into the launch-data template.
  let overrideAudit: string | null = null;
  if (relabel && (keepaResult || aiResult || apifyResult || similarWebMissing)) {
    const { launchData, audit } = overrideSubject({
      keepa: keepaResult ?? undefined,
      aiSoM: aiResult ?? undefined,
      apifyAmazon: apifyResult ?? undefined,
      similarWebMissing: similarWebMissing || undefined,
    });
    const launchPath = join(workDir, "public", "sonos-speakers-launch-data.json");
    writeFileSync(launchPath, JSON.stringify(launchData));
    overrideAudit = `Real data merged into launch-data: ${audit.modifiedPaths.join(", ")}. Withheld: ${audit.withheldPaths.join(", ") || "none"}.`;
    logLine(overrideAudit);
  }

  // --- builder step ---------------------------------------------------------
  await setStep("builder", { status: "running", started_at: new Date().toISOString() });

  const builderStart = Date.now();
  const outPath = join(workDir, "public", `${builderBrand}-command-center-data.json`);
  if (existsSync(outPath)) unlinkSync(outPath);  // force rebuild

  // Build the builder script path in pieces so Turbopack's static analyser
  // doesn't try to bundle it as a module ref. The .mjs literal gets interpreted
  // as a dynamic import target otherwise and the build fails.
  const builderScript = join(workDir, "scripts", "insights", "build-cco-dataset" + ".m" + "js");
  const builder = spawn("node", [builderScript, "--brand", builderBrand], {
    cwd: workDir,
    env: { ...process.env },
  });
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
  logLine(`builder done in ${builderDur}ms, output ${outPath}`);

  // --- relabel step (only for brands without their own config) -------------
  let payloadJson = readFileSync(outPath, "utf8");
  if (relabel) {
    await setStep("relabel", { status: "running", started_at: new Date().toISOString() });
    const relStart = Date.now();
    const data = JSON.parse(payloadJson) as {
      meta?: {
        subject?: string; subjectLabel?: string; title?: string; subtitle?: string;
        brandMark?: string; disclosure?: { short?: string; headline?: string; body?: string; anchors?: unknown };
      };
    };
    data.meta = data.meta || {};
    data.meta.subjectLabel = name;
    data.meta.title = `${name} · Commercial Command Center`;

    const realSources: string[] = [];
    if (keepaResult && keepaResult.asinsWithData > 0) realSources.push("Keepa");
    if (apifyResult && apifyResult.asinsWithData > 0) realSources.push("Apify Amazon");
    if (aiResult && aiResult.totalBrandMentions > 0) realSources.push("Claude AI share-of-mind");

    const notRunNotes: string[] = [];
    if (similarWebMissing) notRunNotes.push("SimilarWeb traffic (no SIMILARWEB_API_KEY)");
    notRunNotes.push("Apify multi-retailer (needs per-retailer actor configs)");
    notRunNotes.push("Google AI Overviews (needs DATAFORSEO_LOGIN)");

    const headline = realSources.length
      ? `Real data for ${name}: ${realSources.join(" + ")}. Reference data for everything else.`
      : `The numbers on this screen are ${REFERENCE_BRAND}'s captured data — ${name} has no vendored config and no real-data inputs were supplied.`;
    const body = realSources.length
      ? `${overrideAudit ?? ""} Rendering with the ${REFERENCE_BRAND} builder because ${name} has no dedicated config file yet. Not run on this build: ${notRunNotes.join("; ")}. See the Method tab's provenance table for the field-by-field honest story.`
      : `This dashboard renders with ${REFERENCE_BRAND}'s real anchors under the "${name}" label so you can see the shape of what a captured dashboard looks like. For true ${name} figures, supply ASINs (Keepa + Apify Amazon live) or a category (Claude AI share-of-mind) in the admin form, or vendor a config into the image like ${[...BRANDS_WITH_CONFIG].join(", ")}.`;

    data.meta.disclosure = {
      ...(data.meta.disclosure ?? {}),
      short: realSources.length ? `Partial real data · ${realSources.join(" + ")}` : "Reference preview",
      headline,
      body,
      anchors: (data.meta.disclosure as { anchors?: unknown } | undefined)?.anchors ?? [],
    };
    delete data.meta.brandMark;
    payloadJson = JSON.stringify(data);
    await setStep("relabel", { status: "done", duration_ms: Date.now() - relStart });
  }

  // --- rebrand step (replace Sonos competitor set + model catalogue) -------
  if (relabel) {
    await setStep("rebrand", { status: "running", started_at: new Date().toISOString() });
    const rStart = Date.now();
    try {
      // Use user-provided product names if available; else ask Claude for 6.
      let productNames = products;
      if (productNames.length === 0 && aiCategory) {
        logLine(`asking Claude for ${name}'s top product names in "${aiCategory}"`);
        productNames = await fetchProductNames(name, aiCategory, 6);
        logLine(`Claude suggested products: ${productNames.join(", ") || "(none)"}`);
      }
      const data = JSON.parse(payloadJson) as unknown;
      const rebranded = rebrandPayload(data, {
        subject: { name, slug },
        competitors: aiCompetitors,
        products: productNames,
      });
      payloadJson = JSON.stringify(rebranded);
      logLine(
        `rebranded payload: subject "${name}" (${slug}), competitors [${aiCompetitors.join(", ") || "(none)"}], ${productNames.length} products`,
      );
      await setStep("rebrand", { status: "done", duration_ms: Date.now() - rStart });
    } catch (e) {
      const err = (e as Error).message;
      logLine(`rebrand step failed: ${err} — uploading un-rebranded payload`);
      await setStep("rebrand", { status: "done", duration_ms: Date.now() - rStart, error: err });
    }
  }

  // --- upload step ---------------------------------------------------------
  await setStep("upload", { status: "running", started_at: new Date().toISOString() });

  const uploadStart = Date.now();
  const payload_url = await uploadPayload(slug, build_id, payloadJson);
  const logs_url = await uploadLog(slug, build_id, logChunks.join("\n"));
  const uploadDur = Date.now() - uploadStart;
  await setStep("upload", { status: "done", duration_ms: uploadDur });

  logLine(`uploaded payload (${payloadJson.length} bytes) → ${payload_url}`);

  await updateBuild(build_id, {
    status: "ready",
    steps,
    finished_at: new Date().toISOString(),
    payload_url,
    logs_url,
  });

  // Side-effect: update the brand's latest_build_id pointer so the dashboard
  // route can resolve /<slug> to the newest ready payload.
  const brand = await getBrand(slug);
  if (brand) await upsertBrand({ ...brand, latest_build_id: build_id });

  logLine("build complete");
  // Re-upload the final log with the completion line.
  await uploadLog(slug, build_id, logChunks.join("\n")).catch(() => {});
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

// Reads a committed vendor payload directly from disk — used as the dashboard's
// fallback when a brand has no ready builds yet. Returns null if the file isn't
// present (which is the signal that the brand is new/unbuilt).
export function readVendoredPayload(slug: string): string | null {
  const p = resolve(process.cwd(), "vendor", "bravo-platform", "public", `${slug}-command-center-data.json`);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// Writes the raw-bytes HEAD payload shortcut file during container boot, so a
// first visit to /<slug> doesn't block on BQ+GCS when a build has never run.
// Called from server.ts (next's standalone output's server) at module init.
export function warmPublicPayloadFromVendor(slug: string): void {
  const src = resolve(process.cwd(), "vendor", "bravo-platform", "public", `${slug}-command-center-data.json`);
  const dst = resolve(process.cwd(), "public", `${slug}-command-center-data.json`);
  if (!existsSync(src)) return;
  if (existsSync(dst)) return;
  try {
    const text = readFileSync(src, "utf8");
    writeFileSync(dst, text);
  } catch {
    // best-effort
  }
}
