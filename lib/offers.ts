import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type PageOffer = {
  date: string;
  retailer: string;
  brand: string;
  model: string;
  modelName: string;
  type: string;
  summary: string | null;
  value: string | null;
  source: string;
  url: string | null;
};

const offersPath = (slug: string): string => join(process.cwd(), "brand-data", `${slug}.offers.json`);
const attached = new Map<string, Buffer>();
const MAX_CACHED = 24;

/**
 * A payload with the offers read on retailer product pages (brand-data/<slug>.offers.json) added as
 * `offers`, or unchanged when the brand has none.
 */
export function withOffers(slug: string, buildId: string, bytes: Buffer): Buffer {
  const path = offersPath(slug);
  if (!existsSync(path)) return bytes;
  const key = `${slug}/${buildId}/${bytes.length}/${statSync(path).mtimeMs}`;
  const hit = attached.get(key);
  if (hit) return hit;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { version: number; offers: PageOffer[] };
    const end = bytes.lastIndexOf("}");
    if (data.version !== 1 || !Array.isArray(data.offers) || end < 0) return bytes;
    const out = Buffer.concat([bytes.subarray(0, end), Buffer.from(`,"offers":${JSON.stringify(data.offers)}`), bytes.subarray(end)]);
    if (attached.size >= MAX_CACHED) attached.delete(attached.keys().next().value as string);
    attached.set(key, out);
    return out;
  } catch (e) {
    console.error(`[offers] ${slug}/${buildId}`, e);
    return bytes;
  }
}

/**
 * The offers read on a brand's retailer product pages, for the build to turn into promotion events.
 */
export function loadReadOffers(slug: string): PageOffer[] {
  const path = offersPath(slug);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8")) as { offers?: PageOffer[] };
  return Array.isArray(data.offers) ? data.offers : [];
}
