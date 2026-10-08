import { fetchApifyAmazon, type ReviewAspect } from "./apify";
import { bucket } from "./gcs";
import { applyReviewAspects, type MergePayload } from "./payload-merge";

type Model = { brand: string; asin?: string | null };
type Cached = Record<string, ReviewAspect[]>;

const MARK = Buffer.from('"aspectSource"');
const done = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer>>();

const CACHE_VERSION = "v3";
const cacheKey = (slug: string, buildId: string) => `review-aspects/${CACHE_VERSION}/${slug}/${buildId}.json`;

async function readCache(slug: string, buildId: string): Promise<Cached | null> {
  try {
    const [buf] = await bucket().file(cacheKey(slug, buildId)).download();
    return JSON.parse(buf.toString("utf8")) as Cached;
  } catch {
    return null;
  }
}

async function fetchAspects(models: Model[]): Promise<Cached | null> {
  const token = process.env.APIFY_TOKEN;
  const asins = [...new Set(models.map((m) => m.asin).filter((a): a is string => !!a))];
  if (!token || !asins.length) return null;
  const res = await fetchApifyAmazon(asins, token);
  const byAsin = new Map(res.perAsin.map((x) => [x.asin, x]));
  const out: Cached = {};
  for (const m of models) {
    const list = m.asin ? (byAsin.get(m.asin)?.reviewAspects ?? []).map((a) => ({ ...a, asin: m.asin as string })) : [];
    if (list.length) (out[m.brand] ||= []).push(...list);
  }
  return Object.keys(out).length ? out : null;
}

async function backfill(slug: string, buildId: string, bytes: Buffer): Promise<Buffer> {
  const payload = JSON.parse(bytes.toString("utf8")) as MergePayload & { dims: { models?: Model[] } };
  let aspects = await readCache(slug, buildId);
  if (!aspects) {
    aspects = await fetchAspects(payload.dims.models ?? []);
    if (aspects) await bucket().file(cacheKey(slug, buildId)).save(JSON.stringify(aspects), { contentType: "application/json", resumable: false }).catch(() => undefined);
  }
  if (!aspects || !applyReviewAspects(payload, aspects)) return bytes;
  return Buffer.from(JSON.stringify(payload));
}

/**
 * A build's payload with real review-aspect scores: built-in when the build read them, otherwise
 * backfilled once from Amazon's review summaries for the build's own listings and cached beside it.
 */
export async function withReviewAspects(slug: string, buildId: string, bytes: Buffer): Promise<Buffer> {
  if (bytes.includes(MARK)) return bytes;
  const key = `${CACHE_VERSION}/${slug}/${buildId}`;
  const hit = done.get(key);
  if (hit) return hit;
  const running = inflight.get(key) ?? backfill(slug, buildId, bytes).catch(() => bytes);
  inflight.set(key, running);
  const out = await running;
  inflight.delete(key);
  if (out !== bytes) done.set(key, out);
  return out;
}
