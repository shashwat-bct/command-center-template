import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ImportedRetailHistory, RetailHistory, RetailReading } from "./retail-offers";

export type FeedProduct = {
  id: string;
  retailer: string;
  item: string;
  brand: string;
  title: string;
  url: string | null;
  upc: string | null;
  units: number | null;
  asin: string | null;
  listingUnits: number | null;
  match: "upc" | "line" | null;
};

export type FeedDay = {
  date: string;
  price: number | null;
  was: number | null;
  inStock: boolean | null;
  stock: number | null;
  offers: number | null;
  seller: string | null;
  rating: number | null;
  reviews: number | null;
  deliveryDays?: number | null;
  low?: number | null;
  high?: number | null;
  unitPrice?: number | null;
  fulfillment?: string | null;
  retailerFulfilled?: boolean | null;
  orderLimit?: number | null;
  buyNow?: boolean | null;
  shipping?: string | null;
  pickup?: string | null;
  bestSeller?: boolean | null;
  bought?: number | null;
  lowInventory?: boolean | null;
  verifiedReviews?: number | null;
  sellerOffers?: Array<{ seller: string; price: number | null; retailerFulfilled: boolean | null; inStock: boolean | null }>;
  sources: string[];
};

export type FeedReviewSummary = {
  total: number | null;
  withText: number | null;
  avgRating: number | null;
  recommendedPct: number | null;
  stars: Array<number | null>;
  aiSummary: string | null;
  aiBullets: string[];
  aspects: string[];
  topPositive: { text: string; rating: number | null; author: string | null } | null;
  topNegative: { text: string; rating: number | null; author: string | null } | null;
  media?: number | null;
  textOneStar?: number | null;
  textFiveStar?: number | null;
};

export type FeedReview = {
  id: string;
  date: string;
  rating: number | null;
  title: string | null;
  text: string | null;
  author: string | null;
  location: string | null;
  verified: boolean | null;
  recommended: boolean | null;
  helpful: number | null;
  unhelpful: number | null;
  media: number | null;
  seller: string | null;
  variant?: string | null;
  fulfilledBy?: string | null;
  reviewerBadge?: string | null;
};

export type RetailFeed = {
  version: 1;
  label: string;
  importedOn: string;
  sources: string[];
  products: Record<string, FeedProduct>;
  daily: Record<string, FeedDay[]>;
  reviewSummary: Record<string, FeedReviewSummary>;
  reviews: Record<string, FeedReview[]>;
};

export type MeasuredListing = { price: Array<number | null>; list: Array<number | null>; stock: Array<0 | 1>; offers: Array<number | null>; buybox: Array<0 | 1 | null> };

export type MeasuredRetailRecord = {
  label: string;
  retailers: Record<string, { listings: number; first: string; last: string; days: number }>;
};

export const RETAILER_OWN_SELLER: Record<string, string[]> = {
  walmart: ["walmart.com", "walmart"],
  target: ["target", "target.com"],
  amazon: ["amazon.com", "amazon"],
};

const PRICE_STALE_DAYS = 45;
const DAY_MS = 86400000;

export const feedPath = (slug: string): string => join(process.cwd(), "brand-data", `${slug}.feed.json`);

/**
 * Reads a brand's retailer feed (brand-data/<slug>.feed.json), or null when it
 * has none.
 */
export function loadRetailFeed(slug: string): RetailFeed | null {
  const path = feedPath(slug);
  if (!existsSync(path)) return null;
  const feed = JSON.parse(readFileSync(path, "utf8")) as RetailFeed;
  if (feed.version !== 1 || !feed.label || typeof feed.products !== "object") throw new Error(`${path} is not a version 1 retailer feed with a label`);
  return feed;
}

const factorOf = (p: FeedProduct): number => (p.units && p.listingUnits ? p.listingUnits / p.units : 1);
const r2 = (v: number): number => Math.round(v * 100) / 100;
const ageDays = (from: string, to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
const ownSeller = (retailer: string, seller: string | null): 0 | 1 | null =>
  seller == null ? null : (RETAILER_OWN_SELLER[retailer] ?? []).includes(seller.trim().toLowerCase()) ? 1 : 0;

/**
 * The feed's matched products, one per tracked Amazon listing and retailer:
 * the UPC match first, then the closest pack size.
 */
export function feedMatches(feed: RetailFeed): Map<string, FeedProduct> {
  const best = new Map<string, FeedProduct>();
  const gap = (p: FeedProduct) => Math.abs(Math.log(factorOf(p)));
  for (const p of Object.values(feed.products)) {
    if (!p.asin) continue;
    const key = `${p.asin}|${p.retailer}`;
    const held = best.get(key);
    if (!held || (p.match === "upc" && held.match !== "upc") || (p.match === held.match && gap(p) < gap(held))) best.set(key, p);
  }
  return best;
}

/**
 * The feed's daily prices for each matched listing in the stored history's
 * shape, restated for the listing's pack size.
 */
export function feedPriceImport(feed: RetailFeed): ImportedRetailHistory {
  const asins: ImportedRetailHistory["asins"] = {};
  const matches: ImportedRetailHistory["matches"] = {};
  for (const p of feedMatches(feed).values()) {
    const asin = p.asin as string;
    const f = factorOf(p);
    for (const d of feed.daily[p.id] ?? []) {
      if (d.price == null) continue;
      const offer: RetailReading[string] = { price: r2(d.price * f), was: d.was == null ? null : r2(d.was * f), title: p.title, url: p.url ?? "" };
      if (f !== 1 && p.units) offer.shelf = { price: d.price, was: d.was, units: p.units };
      ((asins[asin] ||= {})[d.date] ||= {})[p.retailer] = offer;
    }
    (matches[asin] ||= {})[p.retailer] = { item: p.item, title: p.title, url: p.url ?? "", units: p.units ?? 1, listingUnits: p.listingUnits ?? p.units ?? 1 };
  }
  return { version: 1, label: feed.label, importedOn: feed.importedOn, matches, asins };
}

/**
 * Daily measured series over the window for every tracked listing the feed
 * covers at a retailer, in the shape the builder reads for Amazon: price,
 * offer count and whether the retailer itself holds the buy box (each carried
 * from its last reading for up to 45 days, a live website price winning on its
 * day), list (crossed-out price, else the higher of MSRP and price) and stock
 * (the latest reading's state; a price reading means in stock, and a day with
 * no reading counts as in stock).
 */
export function measuredRetailListings(input: {
  feed: RetailFeed;
  live: RetailHistory;
  msrp: Record<string, number | null>;
  dates: string[];
  asins: string[];
}): { listings: Record<string, MeasuredListing>; record: MeasuredRetailRecord | null } {
  const { feed, live, msrp, dates } = input;
  const tracked = new Set(input.asins);
  const windowEnd = dates[dates.length - 1];
  const listings: Record<string, MeasuredListing> = {};
  const byRetailer = new Map<string, { listings: number; days: Set<string> }>();
  for (const p of feedMatches(feed).values()) {
    if (!tracked.has(p.asin as string)) continue;
    const days = (feed.daily[p.id] ?? []).filter((d) => d.date <= windowEnd).sort((a, z) => a.date.localeCompare(z.date));
    if (!days.some((d) => d.price != null)) continue;
    const f = factorOf(p);
    const liveDays = Object.entries(live.asins[p.asin as string] ?? {})
      .flatMap(([d, reading]) => (reading[p.retailer] ? [[d > windowEnd ? windowEnd : d, reading[p.retailer].price] as const] : []));
    const liveOn = new Map<string, number>(liveDays);
    const out: MeasuredListing = { price: [], list: [], stock: [], offers: [], buybox: [] };
    let k = 0, price: { v: number; on: string } | null = null, was: number | null = null, stock: 0 | 1 = 1;
    let offers: { v: number; on: string } | null = null, buybox: { v: 0 | 1; on: string } | null = null;
    const fresh = <T>(x: { v: T; on: string } | null, date: string): T | null => (x && ageDays(x.on, date) <= PRICE_STALE_DAYS ? x.v : null);
    const seen = new Set<string>();
    for (const date of dates) {
      while (k < days.length && days[k].date <= date) {
        const d = days[k++];
        if (d.price != null) { price = { v: d.price * f, on: d.date }; was = d.was == null ? null : d.was * f; stock = 1; }
        if (d.inStock != null) stock = d.inStock ? 1 : 0;
        if (d.offers != null) offers = { v: d.offers, on: d.date };
        const own = ownSeller(p.retailer, d.seller);
        if (own != null) buybox = { v: own, on: d.date };
        if (d.date >= dates[0]) seen.add(d.date);
      }
      const liveToday = liveOn.get(date);
      const v = liveToday ?? fresh(price, date);
      if (liveToday != null) { stock = 1; seen.add(date); }
      const m = msrp[p.asin as string] ?? null;
      out.price.push(v == null ? null : r2(v));
      out.list.push(v == null ? null : r2(liveToday == null && was != null ? was : Math.max(m ?? 0, v)));
      out.stock.push(stock);
      out.offers.push(fresh(offers, date));
      out.buybox.push(fresh(buybox, date));
    }
    listings[`l-${(p.asin as string).toLowerCase()}|${p.retailer}`] = out;
    const r = byRetailer.get(p.retailer) ?? { listings: 0, days: new Set<string>() };
    r.listings += 1;
    for (const d of seen) r.days.add(d);
    byRetailer.set(p.retailer, r);
  }
  if (!byRetailer.size) return { listings, record: null };
  const retailers: MeasuredRetailRecord["retailers"] = {};
  for (const [rt, { listings: n, days }] of byRetailer) {
    const d = [...days].sort();
    retailers[rt] = { listings: n, first: d[0] ?? dates[0], last: d[d.length - 1] ?? windowEnd, days: d.length };
  }
  return { listings, record: { label: feed.label, retailers } };
}

/**
 * Each tracked listing's promised delivery at a retailer, per window week: the
 * median of the promises read that week (days from the reading to the
 * promised date), null for a week without one.
 */
export function measuredRetailDelivery(feed: RetailFeed, asins: string[], dates: string[]): { weekly: Record<string, Array<number | null>>; readings: number; listings: number } {
  const tracked = new Set(asins);
  const weeks = Math.floor(dates.length / 7);
  const weekly: Record<string, Array<number | null>> = {};
  let readings = 0;
  for (const p of feedMatches(feed).values()) {
    if (!tracked.has(p.asin as string)) continue;
    const byWeek = Array.from({ length: weeks }, () => [] as number[]);
    for (const d of feed.daily[p.id] ?? []) {
      const i = dates.indexOf(d.date);
      if (i < 0 || d.deliveryDays == null || Math.floor(i / 7) >= weeks) continue;
      byWeek[Math.floor(i / 7)].push(d.deliveryDays);
      readings += 1;
    }
    if (!byWeek.some((w) => w.length)) continue;
    weekly[`l-${(p.asin as string).toLowerCase()}|${p.retailer}`] = byWeek.map((w) => (w.length ? w.sort((a, z) => a - z)[Math.floor(w.length / 2)] : null));
  }
  return { weekly, readings, listings: Object.keys(weekly).length };
}
