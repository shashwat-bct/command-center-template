import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type RetailerReading = {
  version: 1;
  retailer: string;
  readOn: string;
  location: { zip: string; warehouse: string };
  carried: Record<string, boolean>;
  products: Array<{
    brand: string; item: string; title: string; url: string; units: number; pack: string;
    onlinePrice: number; warehousePrice: number; rating: number; reviews: number;
    online: string; warehouse: string; deliveryBy: string; shippingIncluded: boolean;
    promotion: { label: string; start: string; end: string; onlineOnly: boolean } | null;
  }>;
};

type Series = Record<string, Array<number | null>>;
type Payload = {
  dims: {
    dates: string[]; weeks: string[];
    retailers: Array<{ id: string; label: string; color: string; soft: string; weight: number; kind: string; domain: string; leadDays: number }>;
    models: Array<Record<string, unknown> & { id: string; brand: string }>;
    brands: Array<{ id: string; label: string }>;
    terms: Array<{ id: string }>; cities: Array<{ id: string }>;
  };
  pricing: { price: Series; list: Series; discount: Series };
  promotions: { depthByDay: Series; events: Array<Record<string, unknown>> };
  availability: { stock: Series; byCity: Record<string, number>; episodes: Array<Record<string, unknown>> };
  distribution: { carriage: Series; sellers: Record<string, number>; buybox: Record<string, number>; listings: Array<Record<string, unknown>> };
  delivery: { weekly: Series };
  shelf: { sov: Series; rank: Series; sponsored: Series };
  traffic: { pdp: Series };
  meta: { provenance?: { record?: { anchors?: Record<string, string> } }; marketProfile?: { retailers: Array<Record<string, unknown>>; carriage: Record<string, Record<string, number>>; mechanics: Record<string, Record<string, number>> } };
};

const PROFILE: Record<string, { label: string; color: string; soft: string; kind: string; domain: string; weight: number; mechanics: Record<string, number> }> = {
  costco: { label: "Costco", color: "#0d9488", soft: "#ccfbf1", kind: "club", domain: "costco.com", weight: 0.12, mechanics: { discount: 3, multibuy: 4, delivery: 3, loyalty: 4 } },
};

const CITY_DAYS: Record<string, number> = { nyc: 0, chi: 0.2, lax: 0.3, mia: 0.5, hou: 0.4, den: 0.6 };

const SHELF_RANK: Record<string, Record<string, number>> = { "cottonelle": { category: 2, best: 2, deals: 3 }, "dude-wipes": { category: 5, best: 4, deals: 6 } };

export const readingPath = (slug: string, retailer: string): string => join(process.cwd(), "brand-data", `${slug}.${retailer}.json`);

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const mean = (a: number[]): number | null => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function smooth(a: Array<number | null>, w = 3): Array<number | null> {
  return a.map((_, i) => mean(a.slice(Math.max(0, i - w), i + w + 1).filter((v): v is number => v != null)));
}

/** Each day's price of the brand's real Amazon and Walmart listings relative to their last reading. */
function priceTrend(p: Payload, brand: string): number[] {
  const n = p.dims.dates.length;
  const keys = p.dims.models.filter((m) => m.brand === brand).flatMap((m) => [`${m.id}|amazon`, `${m.id}|walmart`]).filter((k) => p.pricing.price[k]);
  const daily = Array.from({ length: n }, (_, t) => {
    const rel = keys.map((k) => { const s = p.pricing.price[k]; const last = [...s].reverse().find((v) => v != null); return s[t] != null && last ? (s[t] as number) / last : null; }).filter((v): v is number => v != null);
    return rel.length ? rel.sort((a, b) => a - b)[Math.floor(rel.length / 2)] : null;
  });
  return smooth(daily).map((v) => v ?? 1);
}

function meanOver(p: Payload, brand: string, table: Series, retailers: string[]): Array<number | null> {
  const keys = p.dims.models.filter((m) => m.brand === brand).flatMap((m) => retailers.map((r) => `${m.id}|${r}`)).filter((k) => table[k]);
  return p.dims.dates.map((_, t) => mean(keys.map((k) => table[k][t]).filter((v): v is number => v != null)));
}

/** Shelf price held for weeks at a time, moving only when the real trend moves, ending on today's reading. */
function shelfPrices(anchor: number, trend: number[]): number[] {
  const end = trend[trend.length - 1] || 1;
  const out: number[] = [];
  let held = anchor * (trend[0] / end);
  for (const t of trend) {
    const target = anchor * (t / end);
    if (Math.abs(target - held) / held > 0.025) held = target;
    out.push(Math.max(0.99, Math.round(held) - 0.01));
  }
  out[out.length - 1] = anchor;
  for (let i = out.length - 2; i >= 0 && Math.abs(out[i] - anchor) / anchor <= 0.025; i--) out[i] = anchor;
  return out;
}

/** Instant-savings windows where the brand's real Amazon and Walmart promotions ran deep for a week or more. */
function instantSavings(anchor: number, depth: Array<number | null>, lastFree: number): Array<{ start: number; end: number; off: number }> {
  const deep = smooth(depth, 3).map((v) => (v ?? 0) >= 4);
  const out: Array<{ start: number; end: number; off: number }> = [];
  for (let i = 0; i < deep.length - lastFree; i++) {
    if (!deep[i]) continue;
    let j = i;
    while (j + 1 < deep.length - lastFree && deep[j + 1] && j - i < 20) j++;
    if (j - i >= 6 && (!out.length || i - out[out.length - 1].end > 14)) {
      const d = mean(depth.slice(i, j + 1).filter((v): v is number => v != null)) ?? 5;
      out.push({ start: i, end: j, off: Math.min(6, Math.max(3, Math.round((anchor * d) / 100))) });
    }
    i = j;
  }
  return out;
}

function addRetailer(p: Payload, reading: RetailerReading): void {
  const rt = reading.retailer, prof = PROFILE[rt];
  const dates = p.dims.dates, n = dates.length;
  const lead = Math.max(1, dayDiff(reading.readOn, reading.products[0]?.deliveryBy ?? reading.readOn));
  if (!prof || p.dims.retailers.some((r) => r.id === rt)) return;

  const scale = 1 - prof.weight;
  for (const r of p.dims.retailers) r.weight = r2(r.weight * scale);
  p.dims.retailers.push({ id: rt, label: prof.label, color: prof.color, soft: prof.soft, weight: prof.weight, kind: prof.kind, domain: prof.domain, leadDays: lead });

  for (const prod of reading.products) {
    const id = `${rt}-${prod.item}`, key = `${id}|${rt}`, rand = rng(key);
    const name = prod.title.replace(/,\s*\d+[- ]?(Wipes|count)\s*$/i, "");
    p.dims.models.push({ id, brand: prod.brand, label: `${name} · ${prod.units} Count`, tier: "club", msrp: prod.onlinePrice, street0: prod.onlinePrice, anchored: false, launched: null, asin: null, measured: false, isNew: false, retailerOnly: rt });

    const shelf = shelfPrices(prod.onlinePrice, priceTrend(p, prod.brand));
    const realDepth = meanOver(p, prod.brand, p.promotions.depthByDay, ["amazon", "walmart"]);
    const price = [...shelf];
    for (const w of instantSavings(prod.onlinePrice, realDepth, 7)) {
      for (let t = w.start; t <= w.end; t++) price[t] = r2(shelf[t] - w.off);
      p.promotions.events.push({ id: `${id}-is${w.start}`, brand: prod.brand, model: id, retailer: rt, type: "discount", start: dates[w.start], end: dates[w.end], days: w.end - w.start + 1, alwaysOn: false, depthUsd: w.off, depthPct: r1((w.off / shelf[w.start]) * 100), addonUsd: 0, monthly: null });
    }
    if (prod.promotion) {
      const s = Math.max(0, dates.findIndex((d) => d >= prod.promotion!.start)), e = dates.findLastIndex((d) => d <= prod.promotion!.end);
      if (e >= s) p.promotions.events.push({ id: `${id}-mb`, brand: prod.brand, model: id, retailer: rt, type: "multibuy", start: dates[s], end: dates[e], days: e - s + 1, alwaysOn: false, depthUsd: 5, depthPct: r1((5 / prod.onlinePrice) * 100), addonUsd: 0, monthly: null });
    }
    p.pricing.list[key] = shelf;
    p.pricing.price[key] = price;
    p.pricing.discount[key] = price.map((v, t) => r1(((shelf[t] - v) / shelf[t]) * 100));
    p.promotions.depthByDay[key] = p.pricing.discount[key];

    const realStock = meanOver(p, prod.brand, p.availability.stock, ["walmart", "amazon"]);
    const stock = realStock.map((v, t) => (t >= n - 7 ? 1 : v != null && v < 0.6 && rand() < 0.35 ? 0 : 1));
    p.availability.stock[key] = stock;
    for (let t = 0; t < n; t++) {
      if (stock[t] || (t > 0 && !stock[t - 1])) continue;
      let e = t; while (e + 1 < n && !stock[e + 1]) e++;
      p.availability.episodes.push({ model: id, brand: prod.brand, retailer: rt, start: dates[t], days: e - t + 1, afterPromo: false });
    }
    const inStock = stock.reduce((s: number, v) => s + v, 0) / n;
    for (const c of p.dims.cities) {
      p.availability.byCity[`${key}|${c.id}`] = r2(Math.min(1, inStock * (0.93 + rand() * 0.07)));
      const off = (CITY_DAYS[c.id] ?? 0.3) - 0.33;
      p.delivery.weekly[`${key}|${c.id}`] = p.dims.weeks.map((_, w) => r1(Math.max(1, lead + off + (w === p.dims.weeks.length - 1 ? 0 : (rand() - 0.5) * 1.2))));
    }
    p.distribution.carriage[key] = dates.map(() => 1);
    p.distribution.sellers[key] = 1;
    p.distribution.buybox[key] = 1;
    p.distribution.listings.push({ model: id, brand: prod.brand, retailer: rt, sellers: 1, buybox: 1, note: null });
    const walmartPdp = meanOver(p, prod.brand, p.traffic.pdp, ["walmart"]);
    p.traffic.pdp[key] = walmartPdp.map((v) => (v == null ? null : Math.round(v * (prof.weight / 0.35) * (0.9 + rand() * 0.2))));
  }

  for (const b of p.dims.brands) {
    const rank = SHELF_RANK[b.id], rand = rng(`${rt}|shelf|${b.id}`);
    for (const term of p.dims.terms) {
      const k = `${rt}|${term.id}|${b.id}`, r = rank?.[term.id];
      p.shelf.rank[k] = dates.map(() => (r ? r : null));
      p.shelf.sov[k] = dates.map(() => (r ? r1((18 / r) * (0.9 + rand() * 0.2)) : 0));
      p.shelf.sponsored[k] = dates.map(() => 0);
    }
  }

  const rec = ((p.meta.provenance ??= {}).record ??= {});
  (rec.anchors ??= {})[rt] = reading.readOn;
  const mp = p.meta.marketProfile;
  if (mp) {
    mp.retailers.push({ id: rt, label: prof.label, domain: prof.domain, kind: prof.kind, weight: prof.weight, leadDays: lead, priceIndex: 1, listingQuality: 0.7, thirdParty: false });
    for (const b of p.dims.brands) (mp.carriage[b.label] ||= {})[rt] = reading.carried[b.id] ? 0.95 : 0;
    mp.mechanics[rt] = prof.mechanics;
  }
}

const done = new Map<string, Buffer>();
const MAX_CACHED = 24;

/**
 * A payload with each retailer the brand has a reading for (brand-data/<slug>.<retailer>.json)
 * added as a simulated retailer: its listings anchored on the price, stock and delivery read
 * that day, its history following the brand's real Amazon and Walmart trends.
 */
export function withSimulatedRetailers(slug: string, buildId: string, bytes: Buffer): Buffer {
  const files = Object.keys(PROFILE).map((rt) => readingPath(slug, rt)).filter((f) => existsSync(f));
  if (!files.length || !bytes.includes('"pricing"')) return bytes;
  const key = `${slug}/${buildId}/${bytes.length}/${files.map((f) => statSync(f).mtimeMs).join(",")}`;
  const hit = done.get(key);
  if (hit) return hit;
  try {
    const payload = JSON.parse(bytes.toString("utf8")) as Payload;
    for (const f of files) {
      const reading = JSON.parse(readFileSync(f, "utf8")) as RetailerReading;
      if (reading.version === 1) addRetailer(payload, reading);
    }
    const out = Buffer.from(JSON.stringify(payload));
    if (done.size >= MAX_CACHED) done.delete(done.keys().next().value as string);
    done.set(key, out);
    return out;
  } catch (e) {
    console.error(`[simulated-retailer] ${slug}/${buildId}`, e);
    return bytes;
  }
}
