import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bucket } from "./gcs";

export type PageCapture = {
  id: string;
  retailer: string;
  brand: string;
  model: string;
  modelName: string;
  date: string;
  capturedAt: string | null;
  title: string | null;
  url: string | null;
  price: number | null;
  was: number | null;
  saving: number | null;
  savingPct: number | null;
  onSale: boolean;
  priceLabel: string | null;
  otherSellersFrom: number | null;
  availability: string | null;
  stock: string | null;
  delivery: string | null;
  rating: number | null;
  reviews: number | null;
  shipTo: string | null;
  promos: Array<{ type: string | null; summary: string | null; value: string | null }>;
  quality: string | null;
  flags: string[];
  unusable: string | null;
  image: string | null;
  top: string | null;
};

export type CaptureSet = { version: 1; source: string; captures: PageCapture[] };

const capturesPath = (slug: string): string => join(process.cwd(), "brand-data", `${slug}.captures.json`);

/**
 * A brand's retailer product-page captures (brand-data/<slug>.captures.json), or null when it has none.
 */
export function loadCaptures(slug: string): CaptureSet | null {
  const path = capturesPath(slug);
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf8")) as CaptureSet;
  return data.version === 1 && Array.isArray(data.captures) ? data : null;
}

const attached = new Map<string, Buffer>();
const MAX_CACHED = 24;

/**
 * A payload with the brand's product-page captures added as `captures`, or unchanged when it has none.
 */
export function withCaptures(slug: string, buildId: string, bytes: Buffer): Buffer {
  const stamp = existsSync(capturesPath(slug)) ? statSync(capturesPath(slug)).mtimeMs : 0;
  if (!stamp) return bytes;
  const key = `${slug}/${buildId}/${bytes.length}/${stamp}`;
  const hit = attached.get(key);
  if (hit) return hit;
  try {
    const set = loadCaptures(slug);
    const end = bytes.lastIndexOf("}");
    if (!set || end < 0) return bytes;
    const out = Buffer.concat([bytes.subarray(0, end), Buffer.from(`,"captures":${JSON.stringify(set)}`), bytes.subarray(end)]);
    if (attached.size >= MAX_CACHED) attached.delete(attached.keys().next().value as string);
    attached.set(key, out);
    return out;
  } catch (e) {
    console.error(`[captures] ${slug}/${buildId}`, e);
    return bytes;
  }
}

/**
 * One stored capture image, or null when it does not exist.
 */
export async function readCaptureImage(slug: string, file: string): Promise<Buffer | null> {
  try {
    const [buf] = await bucket().file(`captures/v1/${slug}/${file}`).download();
    return buf;
  } catch {
    return null;
  }
}

type PdpPage = { capture: string; date: string; model: string; fields: Record<string, number>; notes: string };

/**
 * Product-page content signals read from each retailer page capture (brand-data/<slug>.pdp.json),
 * keyed "<model id>|<retailer>", or an empty map when the brand has none.
 */
export function loadRetailPdp(slug: string): Record<string, Record<string, number>> {
  const path = join(process.cwd(), "brand-data", `${slug}.pdp.json`);
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf8")) as { pages?: Record<string, PdpPage> };
  return Object.fromEntries(Object.entries(data.pages ?? {}).map(([key, p]) => [key, p.fields]));
}
