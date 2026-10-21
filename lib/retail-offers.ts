import { bucket } from "./gcs";
import type { RetailFeed } from "./retail-feed";
import type { KeepaBrandAggregate } from "./keepa";
import { callLLM } from "./llm";
import { parseJsonObject } from "./market-mechanics";
import type { MarketRetailer } from "./market-profile";
import { readGeneric } from "./retail-generic";
import { SITE_READERS, type SiteOffer } from "./retail-sites";

const HISTORY_KEY = (slug: string) => `retail-offers/v1/${slug}.json`;
const KEEP_DAYS = 120;
const CONCURRENCY = 4;
const LISTING_BUDGET_MS = 150_000;
const STEP_BUDGET_MS = 360_000;

export type ShopRetailer = Pick<MarketRetailer, "id" | "label" | "domain">;

export type RetailOffer = { price: number; was: number | null; title: string; url: string; shelf?: { price: number; was: number | null; units: number } };

export type RetailReading = Record<string, RetailOffer>;

export type RetailHistory = { version: 1; asins: Record<string, Record<string, RetailReading>>; products?: Record<string, Omit<RetailProduct, "price">> };

export type RetailProduct = { asin: string; brand: string; title: string | null; model: string | null; price: number | null };

export type ImportedMatch = { item: string; title: string; url: string; units: number; listingUnits: number };

export type ImportedRetailHistory = {
  version: 1;
  label: string;
  importedOn: string;
  matches: Record<string, Record<string, ImportedMatch>>;
  asins: Record<string, Record<string, RetailReading>>;
};

export type RetailCapture = {
  date: string;
  readings: Record<string, RetailReading>;
  history: RetailHistory;
  imported?: ImportedRetailHistory | null;
  feed?: RetailFeed | null;
};

type DailyCells = Record<string, Record<string, { price: number; was: number | null }>>;

type Match = { units: number | null; listings: Map<number, number | null> };

const norm = (s: string): string => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/**
 * The search for a product on a retailer's site: the Amazon title's name
 * before the first separator, prefixed with the brand when the title leaves it out.
 */
export function shoppingQuery(p: RetailProduct): string {
  const head = (p.title ?? "").split(/\s[|–—-]\s|,|\(/)[0].trim().split(/\s+/).slice(0, 9).join(" ");
  const name = head || p.model || "";
  return norm(name).startsWith(norm(p.brand)) ? name : `${p.brand} ${name}`.trim();
}

/**
 * The market's retailers whose own site this build can read: every one but
 * Amazon, through a dedicated reader where there is one and the generic
 * browser reader otherwise.
 */
export function readableRetailers(retailers: ShopRetailer[]): ShopRetailer[] {
  return retailers.filter((r) => r.id !== "amazon" && (SITE_READERS[r.id] || r.domain));
}

const readerFor = (r: ShopRetailer) => SITE_READERS[r.id] ?? ((query: string, key: string) => readGeneric(r, query, key));

/**
 * One product per accepted Keepa listing, with the brand it was tracked under.
 */
export function retailProductsFrom(brands: Array<[string, KeepaBrandAggregate | null | undefined]>, accepted: string[]): RetailProduct[] {
  const keep = new Set(accepted);
  const out = new Map<string, RetailProduct>();
  for (const [brand, k] of brands) {
    if (!k || !brand) continue;
    for (const r of k.perAsin) if (keep.has(r.asin) && !out.has(r.asin)) out.set(r.asin, { asin: r.asin, brand, title: r.title, model: r.model, price: r.priceNow });
  }
  return [...out.values()];
}

const units = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

async function sameProduct(p: RetailProduct, candidates: SiteOffer[], labels: Map<string, string>): Promise<Match> {
  const none: Match = { units: null, listings: new Map() };
  if (!candidates.length) return none;
  const list = candidates.map((c, i) => `${i + 1}. [${labels.get(c.retailer) ?? c.retailer}] ${c.title} — $${c.price}`).join("\n");
  const text = await callLLM({
    system: "You match retail product listings. Reply with JSON only.",
    user: `Product: ${p.brand} · ${p.title ?? ""}${p.model ? ` · model ${p.model}` : ""}\n\nListings:\n${list}\n\nWhich listings sell this same product in any pack size? The brand, the named product line, the scent or formula, the format and the model or generation must all match. Line names must be the same words: "Fresh Feel", "Fresh Care" and "Ultra Fresh" are three different lines. Unscented and fragrance-free are the same scent. Standard packs, pocket packs and individually wrapped singles ("On-The-Go") are three different formats. An "SL", "Pro" or "2nd gen" version is a different model. Leave out bundles with other products, variety packs, refurbished or used units and accessories.\n\nFor the product and for each listing you keep, give the total number of units it holds, read from its title (6 packs of 48 wipes = 288; one speaker = 1). When a listing of the same product line gives only its number of packs, use the product's count per pack. Use null when the title does not say.\n\nReply with only this JSON and nothing before or after it: {"units": product units or null, "same": [{"n": listing number, "units": units or null}]}`,
    maxTokens: 1500,
    temperature: 0,
  });
  const at = [...text.matchAll(/\{\s*"units"/g)].pop()?.index;
  const answer = at == null ? null : parseJsonObject(text.slice(at));
  if (!answer || !Array.isArray(answer.same)) return none;
  const listings = new Map<number, number | null>();
  for (const x of answer.same as Array<{ n?: unknown; units?: unknown }>) {
    const n = Number(x?.n);
    if (Number.isInteger(n) && n >= 1 && n <= candidates.length) listings.set(n - 1, units(x.units));
  }
  return { units: units(answer.units), listings };
}

const MAX_SCALE = 8;
const SAME_SIZE_PRICE = [0.6, 1.6] as const;
const UNSTATED_GAP = Math.log(1.5);

/**
 * The offer restated for the product's quantity: a listing with a different
 * pack size is priced per unit and scaled up or down to match. A listing that
 * does not state its size is kept only when its price is close enough to the
 * Amazon price to be the same quantity; when the product's own size is
 * unknown, only listings that don't state one either are kept.
 */
function scaled(offer: RetailOffer, productUnits: number | null, listingUnits: number | null, amazonPrice: number | null): { offer: RetailOffer; gap: number } | null {
  if (productUnits == null) return listingUnits == null ? { offer, gap: 0 } : null;
  if (listingUnits == null) {
    const ratio = amazonPrice ? offer.price / amazonPrice : null;
    if (ratio == null || ratio < SAME_SIZE_PRICE[0] || ratio > SAME_SIZE_PRICE[1]) return null;
    return { offer, gap: UNSTATED_GAP };
  }
  const factor = productUnits / listingUnits;
  if (factor === 1) return { offer, gap: 0 };
  if (factor > MAX_SCALE || factor < 1 / MAX_SCALE) return null;
  const r2 = (v: number) => Math.round(v * factor * 100) / 100;
  return { offer: { ...offer, price: r2(offer.price), was: offer.was == null ? null : r2(offer.was), shelf: { price: offer.price, was: offer.was, units: listingUnits } }, gap: Math.abs(Math.log(factor)) };
}

type Picked = { reading: RetailReading; why: string };

/**
 * The offers that sell this product: one per retailer, preferring the same
 * pack size, with prices restated for the product's quantity.
 */
export async function pickOffers(p: RetailProduct, offers: SiteOffer[], labels: Map<string, string>): Promise<Picked> {
  const match = await sameProduct(p, offers, labels);
  const best = new Map<string, { offer: RetailOffer; gap: number }>();
  for (const [i, o] of offers.entries()) {
    if (!match.listings.has(i)) continue;
    const s = scaled({ price: o.price, was: o.was, title: o.title, url: o.url }, match.units, match.listings.get(i) ?? null, p.price);
    if (!s) continue;
    const held = best.get(o.retailer);
    if (!held || s.gap < held.gap) best.set(o.retailer, s);
  }
  const reading: RetailReading = Object.fromEntries([...best].map(([rt, b]) => [rt, b.offer]));
  const lines = offers.slice(0, 8).map((o, i) => `${i + 1}. [${o.retailer}] ${o.title.slice(0, 80)} $${o.price}${match.listings.has(i) ? ` (same, ${match.listings.get(i) ?? "?"} units)` : ""}`);
  const why = `${offers.length} offers sold by the retailers themselves; product ${match.units ?? "?"} units; ${match.listings.size} judged the same product${lines.length ? `\n      ${lines.join("\n      ")}` : ""}`;
  return { reading, why };
}

async function readProduct(p: RetailProduct, retailers: ShopRetailer[], key: string, log: (s: string) => void): Promise<Picked> {
  const query = shoppingQuery(p);
  const found = await Promise.all(retailers.map((r) => readerFor(r)(query, key).catch((e: unknown) => {
    log(`  ${p.asin} ${r.label}: ${(e as Error).message}`);
    return [] as SiteOffer[];
  })));
  return pickOffers(p, found.flat(), new Map(retailers.map((r) => [r.id, r.label])));
}

function within<T>(ms: number, work: Promise<T>, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(why)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function loadRetailHistory(slug: string): Promise<RetailHistory> {
  try {
    const [buf] = await bucket().file(HISTORY_KEY(slug)).download();
    const h = JSON.parse(buf.toString("utf8")) as RetailHistory;
    return h.version === 1 ? h : { version: 1, asins: {} };
  } catch {
    return { version: 1, asins: {} };
  }
}

async function saveRetailHistory(slug: string, h: RetailHistory): Promise<void> {
  await bucket().file(HISTORY_KEY(slug)).save(JSON.stringify(h), { contentType: "application/json", resumable: false });
}

/**
 * Reads every tracked product's offers from the market's other retailers' own
 * sites (offers they sell themselves, not marketplace sellers), keeps only
 * listings an LLM confirms are the same product, and appends today's reading
 * to the brand's stored history, with the full titles of the products named in
 * `remember` for later refreshes.
 */
export async function captureRetailOffers(input: {
  slug: string;
  products: RetailProduct[];
  retailers: ShopRetailer[];
  key: string;
  log: (s: string) => void;
  remember?: Set<string>;
  now?: Date;
}): Promise<RetailCapture> {
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);
  const retailers = readableRetailers(input.retailers);
  const skipped = input.retailers.filter((r) => !retailers.includes(r));
  if (skipped.length) input.log(`  no reader for ${skipped.map((r) => r.label).join(", ")}; they stay modelled`);
  const stopAt = Date.now() + STEP_BUDGET_MS;
  const results = await pool(input.products, CONCURRENCY, (p) => {
    const left = Math.min(LISTING_BUDGET_MS, stopAt - Date.now());
    if (left <= 0) return Promise.resolve<Picked>({ reading: {}, why: `skipped, retailer reads passed ${STEP_BUDGET_MS / 60_000} minutes` });
    return within(left, readProduct(p, retailers, input.key, input.log), `no answer from the retailer sites within ${Math.round(left / 1000)}s`).catch((e: unknown): Picked => {
      input.log(`  ${p.asin}: ${(e as Error).message}`);
      return { reading: {}, why: (e as Error).message };
    });
  });
  const readings: Record<string, RetailReading> = {};
  input.products.forEach((p, i) => {
    const r = results[i];
    const found = Object.entries(r.reading);
    input.log(`  ${p.asin} "${shoppingQuery(p)}": ${found.length ? found.map(([rt, o]) => `${rt} $${o.price}${o.was ? ` (was $${o.was})` : ""}${o.shelf ? ` [$${o.shelf.price} for ${o.shelf.units} units]` : ""} ${o.url}`).join(", ") : `no matching offer: ${r.why}`}`);
    if (found.length) readings[p.asin] = r.reading;
  });
  const history = await loadRetailHistory(input.slug);
  const cutoff = new Date(Date.parse(`${date}T00:00:00Z`) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const { asin } of input.products) {
    if (readings[asin]) (history.asins[asin] ||= {})[date] = readings[asin];
    else if (history.asins[asin]) delete history.asins[asin][date];
  }
  if (input.remember?.size) {
    history.products ??= {};
    for (const p of input.products) if (p.title && input.remember.has(p.asin)) history.products[p.asin] = { asin: p.asin, brand: p.brand, title: p.title, model: p.model };
  }
  for (const days of Object.values(history.asins)) for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
  await saveRetailHistory(input.slug, history).catch((e: unknown) => input.log(`  history not saved: ${(e as Error).message}`));
  return { date, readings, history };
}

/**
 * The imported readings that no live reading replaces: a live reading of the
 * same product, retailer and day always wins.
 */
export function importedOnly(live: RetailHistory, imported: ImportedRetailHistory): RetailHistory {
  const asins: RetailHistory["asins"] = {};
  for (const [asin, days] of Object.entries(imported.asins)) {
    for (const [d, reading] of Object.entries(days)) {
      const kept = Object.entries(reading).filter(([rt]) => !live.asins[asin]?.[d]?.[rt]);
      if (kept.length) (asins[asin] ||= {})[d] = Object.fromEntries(kept);
    }
  }
  return { version: 1, asins };
}

/**
 * The builder's per-cell readings, keyed "l-<asin>|<retailer>" then by window
 * day. A reading taken after the window closes stands for its last day.
 */
export function retailSeriesFor(history: RetailHistory, asins: string[], windowStart: string, windowEnd: string): DailyCells {
  const out: DailyCells = {};
  for (const asin of asins) {
    const days = history.asins[asin];
    if (!days) continue;
    for (const d of Object.keys(days).sort()) {
      if (d < windowStart) continue;
      const day = d > windowEnd ? windowEnd : d;
      for (const [rt, o] of Object.entries(days[d])) (out[`l-${asin.toLowerCase()}|${rt}`] ||= {})[day] = { price: o.price, was: o.was };
    }
  }
  return out;
}

/**
 * Live and imported readings together for the window, day by day; a live
 * reading replaces an imported one on its day.
 */
export function mergedRetailSeries(live: DailyCells, imported: DailyCells): DailyCells {
  const out: DailyCells = {};
  for (const [key, days] of Object.entries(imported)) out[key] = { ...days };
  for (const [key, days] of Object.entries(live)) out[key] = { ...(out[key] ?? {}), ...days };
  return out;
}
