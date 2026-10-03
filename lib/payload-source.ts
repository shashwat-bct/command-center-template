import { listLatestReadyBuildPerBrand } from "@/lib/bq";
import { latestPayloadBuildId, readPayloadBytes } from "@/lib/gcs";

export type PayloadSource = { kind: "build"; buildId: string; bytes: Buffer };

const MEASURED_ONLY_MARK = Buffer.from('"mode":"measured-only"');

/**
 * True when a payload was built by the measured-only pipeline. Older builds
 * carry simulated figures and are no longer served.
 */
export const isMeasuredOnly = (source: PayloadSource): boolean => source.bytes.includes(MEASURED_ONLY_MARK);

export const RETIRED_STATUS = 409;
export const retiredResponse = (headers: Record<string, string> = {}): Response =>
  Response.json({ error: "retired", detail: "This build used simulated data and is no longer served. Rebuild the brand from /admin." }, { status: RETIRED_STATUS, headers });

const PAYLOAD_CACHE_SIZE = 16;
const LATEST_TTL_MS = 30_000;
const payloadCache = new Map<string, Buffer>();
const latestCache = new Map<string, { id: string | null; at: number }>();

export async function loadBuildPayload(slug: string, buildId: string): Promise<PayloadSource | null> {
  const key = `${slug}/${buildId}`;
  const cached = payloadCache.get(key);
  if (cached) return { kind: "build", buildId, bytes: cached };
  try {
    const bytes = await readPayloadBytes(slug, buildId);
    if (bytes) {
      payloadCache.set(key, bytes);
      if (payloadCache.size > PAYLOAD_CACHE_SIZE) payloadCache.delete(payloadCache.keys().next().value as string);
      return { kind: "build", buildId, bytes };
    }
  } catch (e) {
    console.error(`[payload-source] ${slug}/${buildId} GCS fetch failed:`, (e as Error).message);
  }
  return null;
}

export async function latestReadyBuildId(slug: string): Promise<string | null> {
  const hit = latestCache.get(slug);
  if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.id;
  let id: string | null = null;
  try {
    id = await latestPayloadBuildId(slug);
  } catch (e) {
    console.error(`[payload-source] ${slug} GCS listing failed, trying BigQuery:`, (e as Error).message);
    try {
      id = (await listLatestReadyBuildPerBrand())[slug]?.build_id ?? null;
    } catch (e2) {
      console.error(`[payload-source] ${slug} BQ query failed:`, (e2 as Error).message);
    }
  }
  latestCache.set(slug, { id, at: Date.now() });
  return id;
}

/**
 * The latest ready build's payload, or null when the brand has none.
 */
export async function loadLatestPayload(slug: string): Promise<PayloadSource | null> {
  const buildId = await latestReadyBuildId(slug);
  if (buildId) {
    const fromBuild = await loadBuildPayload(slug, buildId);
    if (fromBuild) return fromBuild;
  }
  return null;
}

export function payloadResponse(source: PayloadSource, cacheControl: string): Response {
  return new Response(new Uint8Array(source.bytes), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl, "x-build-id": source.buildId },
  });
}
