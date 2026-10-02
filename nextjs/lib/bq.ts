// BigQuery client + helpers for the brands and builds tables.
// All reads/writes go through here so the shape is single-sourced.

import { BigQuery } from "@google-cloud/bigquery";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "bravo-platform-bc";
const DATASET = process.env.BQ_DATASET || "cco_mgmt";

export const bq = new BigQuery({ projectId: PROJECT_ID });

export type BuildStatus = "queued" | "running" | "ready" | "failed" | "cancelled";

export type BuildStep = {
  name: string;
  status: BuildStatus | "pending" | "done";
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  error?: string;
};

export type BuildOptions = {
  run_apify?: boolean;
  run_keepa?: boolean;
  run_similarweb?: boolean;
  run_ai_visibility?: boolean;
  // When true, skip real captures and just re-run the simulation using the
  // committed captures baked into the image. The MVP path.
  simulation_only?: boolean;
};

export type BuildRow = {
  build_id: string;
  brand_slug: string;
  status: BuildStatus;
  options: BuildOptions | null;
  steps: BuildStep[] | null;
  started_at: string | null;
  finished_at: string | null;
  payload_url: string | null;
  logs_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type BrandRow = {
  slug: string;
  name: string;
  category: string | null;
  retailers: string[] | null;
  models: unknown[] | null;
  cities: string[] | null;
  latest_build_id: string | null;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();

// BigQuery returns TIMESTAMP columns as { value: "ISO string" } objects from
// query results. Feeding one back into a streaming insert fails ("not a
// record"), so we unwrap any timestamp-shaped value to its string.
const unwrapTs = (v: unknown): unknown => {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object) && typeof (v as { value: unknown }).value === "string") {
    return (v as { value: string }).value;
  }
  return v;
};

const TS_FIELDS = new Set(["created_at", "updated_at", "started_at", "finished_at"]);
// JSON columns must be serialised as strings for streaming insert — passing
// an array is treated as "insert multiple rows" by the tabledata.insertAll API.
const JSON_FIELDS = new Set(["options", "steps", "retailers", "models", "cities"]);

const prepRow = <T extends Record<string, unknown>>(row: T): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) { out[k] = null; continue; }
    if (TS_FIELDS.has(k)) { out[k] = unwrapTs(v); continue; }
    if (JSON_FIELDS.has(k)) { out[k] = typeof v === "string" ? v : JSON.stringify(v); continue; }
    out[k] = v;
  }
  return out;
};

export async function insertBuild(row: Omit<BuildRow, "created_at" | "updated_at"> & { steps?: BuildStep[]; options?: BuildOptions | null }) {
  const createdAt = now();
  const r = prepRow({ ...row, steps: row.steps ?? null, options: row.options ?? null, created_at: createdAt, updated_at: createdAt });
  await bq.dataset(DATASET).table("builds").insert([r]);
}

export async function updateBuild(
  build_id: string,
  patch: Partial<Omit<BuildRow, "build_id" | "created_at">>,
) {
  // BQ streaming-insert'd rows can't be UPDATE'd for 90 min. So we do an INSERT
  // of the next full snapshot and let the query layer pick the newest by
  // (build_id, updated_at). This is cheap and avoids the streaming buffer lock.
  // See getLatestBuild for the read-side logic.
  const createdAt = now();
  // Pull the previous snapshot so we don't lose fields the caller didn't set.
  const prev = await getLatestBuild(build_id);
  if (!prev) throw new Error(`updateBuild: no existing build with id ${build_id}`);
  const next: BuildRow = {
    ...prev,
    ...patch,
    build_id,
    created_at: prev.created_at,  // keep original
    updated_at: createdAt,
  };
  const r = prepRow(next);
  await bq.dataset(DATASET).table("builds").insert([r]);
}

export async function getLatestBuild(build_id: string): Promise<BuildRow | null> {
  const [rows] = await bq.query({
    query: `SELECT * FROM \`${PROJECT_ID}.${DATASET}.builds\`
            WHERE build_id = @build_id
            ORDER BY updated_at DESC
            LIMIT 1`,
    params: { build_id },
  });
  return (rows[0] as BuildRow) ?? null;
}

export async function listLatestBuildsPerBrand(limit = 50): Promise<BuildRow[]> {
  // One row per build_id — the newest snapshot. Then rank by created_at desc.
  const [rows] = await bq.query({
    query: `WITH latest_per_build AS (
              SELECT * EXCEPT(rn) FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY build_id ORDER BY updated_at DESC) rn
                FROM \`${PROJECT_ID}.${DATASET}.builds\`
              ) WHERE rn = 1
            )
            SELECT * FROM latest_per_build
            ORDER BY created_at DESC
            LIMIT @lim`,
    params: { lim: limit },
  });
  return rows as BuildRow[];
}

export async function listLatestReadyBuildPerBrand(): Promise<Record<string, BuildRow>> {
  // The dashboard uses this to resolve /<slug> to the newest ready payload.
  const [rows] = await bq.query({
    query: `WITH latest_per_build AS (
              SELECT * EXCEPT(rn) FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY build_id ORDER BY updated_at DESC) rn
                FROM \`${PROJECT_ID}.${DATASET}.builds\`
              ) WHERE rn = 1
            ),
            ranked AS (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY brand_slug ORDER BY finished_at DESC NULLS LAST) rn
              FROM latest_per_build
              WHERE status = 'ready'
            )
            SELECT * EXCEPT(rn) FROM ranked WHERE rn = 1`,
  });
  const out: Record<string, BuildRow> = {};
  for (const r of rows as BuildRow[]) out[r.brand_slug] = r;
  return out;
}

export async function upsertBrand(row: Omit<BrandRow, "created_at" | "updated_at">) {
  // BigQuery MERGE from the Node client is awkward; using DML + SELECT.
  const timestamp = now();
  const existing = await getBrand(row.slug);
  const createdAt = existing?.created_at ?? timestamp;
  const r = prepRow({ ...row, created_at: createdAt, updated_at: timestamp });
  // Streaming insert — duplicates will be collapsed by getBrand's ORDER BY updated_at DESC.
  await bq.dataset(DATASET).table("brands").insert([r]);
}

export async function getBrand(slug: string): Promise<BrandRow | null> {
  const [rows] = await bq.query({
    query: `SELECT * FROM \`${PROJECT_ID}.${DATASET}.brands\`
            WHERE slug = @slug
            ORDER BY updated_at DESC
            LIMIT 1`,
    params: { slug },
  });
  return (rows[0] as BrandRow) ?? null;
}

export async function listBrands(): Promise<BrandRow[]> {
  const [rows] = await bq.query({
    query: `WITH latest AS (
              SELECT * EXCEPT(rn) FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY updated_at DESC) rn
                FROM \`${PROJECT_ID}.${DATASET}.brands\`
              ) WHERE rn = 1
            )
            SELECT * FROM latest ORDER BY created_at DESC`,
  });
  return rows as BrandRow[];
}
