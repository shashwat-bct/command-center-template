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

const KNOWN_BRANDS = new Set(["sonos"]);  // configs baked into the image today

export type CreateBuildInput = {
  slug: string;
  name: string;
  category?: string | null;
  retailers?: string[];
  models?: unknown[];
  cities?: string[];
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
  if (!KNOWN_BRANDS.has(slug)) {
    throw new Error(
      `brand "${slug}" has no config baked into this image. Known: ${[...KNOWN_BRANDS].join(", ")}. ` +
        `New-brand captures are stage 2.4+.`,
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
  runBuild(build_id, slug, name, options).catch((e: unknown) => {
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

async function runBuild(build_id: string, slug: string, _name: string, options: BuildOptions) {
  const steps: BuildStep[] = [
    { name: "config", status: "pending" },
    { name: "builder", status: "pending" },
    { name: "upload", status: "pending" },
  ];
  const logChunks: string[] = [];
  const logLine = (s: string) => logChunks.push(`[${new Date().toISOString()}] ${s}`);

  await updateBuild(build_id, { status: "running", started_at: new Date().toISOString(), steps });

  // Resolve the vendored bravo-platform clone bundled with the app. In Docker
  // this lives at /app/vendor/bravo-platform; locally during `npm run dev` it
  // lives at <repo>/nextjs/vendor/bravo-platform.
  const VENDOR = resolve(process.cwd(), "vendor", "bravo-platform");
  if (!existsSync(VENDOR)) {
    await failBuild(build_id, steps, logChunks, slug, `vendor dir missing at ${VENDOR}`);
    return;
  }

  // Copy the vendored tree to a writable temp dir — the builder writes its
  // output next to the config, and the container filesystem is otherwise
  // read-only for the base image's own files.
  logLine("preparing working copy");
  const workDir = mkdtempSync(join(tmpdir(), `ccc-build-${slug}-`));
  cpSync(VENDOR, workDir, { recursive: true });

  steps[0] = { ...steps[0], status: "done", duration_ms: 0 };
  await updateBuild(build_id, { steps: [...steps] });

  // --- builder step ---------------------------------------------------------
  steps[1] = { ...steps[1], status: "running", started_at: new Date().toISOString() };
  await updateBuild(build_id, { steps: [...steps] });

  const builderStart = Date.now();
  const outPath = join(workDir, "public", `${slug}-command-center-data.json`);
  if (existsSync(outPath)) unlinkSync(outPath);  // force rebuild

  // Build the builder script path in pieces so Turbopack's static analyser
  // doesn't try to bundle it as a module ref. The .mjs literal gets interpreted
  // as a dynamic import target otherwise and the build fails.
  const builderScript = join(workDir, "scripts", "insights", "build-cco-dataset" + ".m" + "js");
  const builder = spawn("node", [builderScript, "--brand", slug], {
    cwd: workDir,
    env: { ...process.env },
  });
  builder.stdout.on("data", (b: Buffer) => logLine(b.toString().trimEnd()));
  builder.stderr.on("data", (b: Buffer) => logLine("ERR " + b.toString().trimEnd()));

  const code: number = await new Promise((res) => builder.on("close", res));
  const builderDur = Date.now() - builderStart;

  if (code !== 0 || !existsSync(outPath)) {
    const err = `builder exited ${code}` + (!existsSync(outPath) ? "; output file missing" : "");
    steps[1] = { ...steps[1], status: "pending", duration_ms: builderDur, error: err };
    await failBuild(build_id, steps, logChunks, slug, err);
    return;
  }
  steps[1] = { ...steps[1], status: "done", duration_ms: builderDur };
  logLine(`builder done in ${builderDur}ms, output ${outPath}`);
  await updateBuild(build_id, { steps: [...steps] });

  // --- upload step ----------------------------------------------------------
  steps[2] = { ...steps[2], status: "running", started_at: new Date().toISOString() };
  await updateBuild(build_id, { steps: [...steps] });

  const uploadStart = Date.now();
  const payloadJson = readFileSync(outPath, "utf8");
  const payload_url = await uploadPayload(slug, build_id, payloadJson);
  const logs_url = await uploadLog(slug, build_id, logChunks.join("\n"));
  const uploadDur = Date.now() - uploadStart;
  steps[2] = { ...steps[2], status: "done", duration_ms: uploadDur };

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
