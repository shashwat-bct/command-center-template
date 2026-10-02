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
import { fetchKeepaBrand } from "./keepa";
import { overrideSubjectWithKeepa } from "./launch-override";

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
  category?: string | null;
  retailers?: string[];
  models?: unknown[];
  cities?: string[];
  // Real-data path: when a new brand has no vendored config, the admin can
  // supply ASINs — the backend hits Keepa for each one, aggregates pricing +
  // reviews, and overrides the subject-brand slot in a Sonos-based launch-data.
  asins?: string[];
  options?: BuildOptions;
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
  runBuild(build_id, slug, name, options, input.asins ?? []).catch((e: unknown) => {
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

async function runBuild(build_id: string, slug: string, name: string, options: BuildOptions, asins: string[]) {
  // Does this brand have its own config vendored? If not, the builder runs
  // under the reference brand, and we relabel the output.
  const hasOwnConfig = BRANDS_WITH_CONFIG.has(slug);
  const builderBrand = hasOwnConfig ? slug : REFERENCE_BRAND;
  const relabel = !hasOwnConfig;
  const willHitKeepa = relabel && asins.length > 0;

  const steps: BuildStep[] = [
    { name: "config", status: "pending" },
    ...(willHitKeepa ? [{ name: "keepa", status: "pending" as const }] : []),
    { name: "builder", status: "pending" },
    ...(relabel ? [{ name: "relabel", status: "pending" as const }] : []),
    { name: "upload", status: "pending" },
  ];
  const logChunks: string[] = [];
  const logLine = (s: string) => logChunks.push(`[${new Date().toISOString()}] ${s}`);
  if (hasOwnConfig) {
    logLine(`brand "${slug}" has a vendored config — running its own builder.`);
  } else if (willHitKeepa) {
    logLine(`brand "${slug}" has no vendored config — fetching real Keepa data for ${asins.length} ASIN(s), then running the ${REFERENCE_BRAND} builder with the subject-brand slot overridden with that real data.`);
  } else {
    logLine(`brand "${slug}" has no vendored config and no ASINs — running the ${REFERENCE_BRAND} builder and relabeling the output as "${name}" (reference-only preview).`);
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

  // --- keepa step (optional, only when ASINs supplied + non-vendored brand) ---
  let keepaAudit: string | null = null;
  if (willHitKeepa) {
    await setStep("keepa", { status: "running", started_at: new Date().toISOString() });
    const kStart = Date.now();
    try {
      const apiKey = process.env.INS_KEEPA_KEY;
      if (!apiKey) throw new Error("INS_KEEPA_KEY not configured on the backend");
      logLine(`calling Keepa for ${asins.length} ASIN(s): ${asins.join(", ")}`);
      const keepa = await fetchKeepaBrand(asins, apiKey);
      logLine(`Keepa: ${keepa.asinsWithData}/${keepa.asinsFetched} ASINs returned data (avg list $${keepa.avgListPrice}, avg street $${keepa.avgStreetPrice}, rating ${keepa.avgRating}, reviews ${keepa.totalReviews})`);

      const { launchData, audit } = overrideSubjectWithKeepa(keepa);
      // The config references launch at public/sonos-speakers-launch-data.json
      // (because the builder is running under the Sonos config). We write the
      // overridden launch-data to that same path so the builder picks it up.
      const launchPath = join(workDir, "public", "sonos-speakers-launch-data.json");
      writeFileSync(launchPath, JSON.stringify(launchData));
      keepaAudit = `Real data: ${audit.modifiedPaths.join(", ")}. Withheld (no Keepa return): ${audit.withheldPaths.join(", ") || "none"}.`;
      logLine(keepaAudit);
      await setStep("keepa", { status: "done", duration_ms: Date.now() - kStart });
    } catch (e) {
      const err = (e as Error).message;
      logLine(`keepa step failed: ${err} — proceeding with pure reference data`);
      await setStep("keepa", { status: "done", duration_ms: Date.now() - kStart, error: err });
      // Non-fatal — we fall through to pure reference-preview mode
    }
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

    const headline = willHitKeepa
      ? `Pricing + review data for ${name} is real (Keepa). Shelf, delivery, in-stock and AI-visibility lanes are ${REFERENCE_BRAND} reference data.`
      : `The numbers on this screen are ${REFERENCE_BRAND}'s captured data — ${name} has no vendored config and no ASINs were supplied.`;
    const body = willHitKeepa
      ? `${keepaAudit ?? ""} Rendering with the ${REFERENCE_BRAND} builder (because ${name} has no dedicated config file yet). The dashboard panels that read pricing + reviews from the launch file (list price, street price, discount rate, review ratings, review volume) show ${name}'s real Keepa numbers. The other lanes (shelf SOV, delivery promise, in-stock %, AI engine visibility) still show ${REFERENCE_BRAND}'s reference data because the backend doesn't yet run Apify or SimilarWeb for new brands.`
      : `This dashboard renders with ${REFERENCE_BRAND}'s real anchors under the "${name}" label so you can see the shape of what a captured dashboard looks like. For true ${name} figures, either supply ASINs (we'll run Keepa) or vendor a config + source captures into the image like ${[...BRANDS_WITH_CONFIG].join(", ")}.`;

    data.meta.disclosure = {
      ...(data.meta.disclosure ?? {}),
      short: willHitKeepa ? "Partial real data · Keepa" : "Reference preview",
      headline,
      body,
      anchors: (data.meta.disclosure as { anchors?: unknown } | undefined)?.anchors ?? [],
    };
    delete data.meta.brandMark;
    payloadJson = JSON.stringify(data);
    await setStep("relabel", { status: "done", duration_ms: Date.now() - relStart });
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
