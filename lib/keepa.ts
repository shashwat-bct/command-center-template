// Keepa product API client — real Amazon pricing + review data for a list of
// ASINs. Ported from bravo-platform/scripts/insights/research/keepa-history.mjs,
// kept lean: only the fields the dashboard surfaces (list price, street price,
// discount rate, review count, review rating).
//
// Keepa serves per-ASIN time series in a packed csv array where [t, v, t, v…]
// alternates. Different indices in `product.csv` are different series:
//   csv[0]  = Amazon price (in cents, -1 = out of stock)
//   csv[1]  = Marketplace new (in cents)
//   csv[4]  = List price (in cents)
//   csv[16] = Rating (in 1/10ths — 43 = 4.3★)
//   csv[17] = Review count
// We take the latest value from each. Prices from Amazon fall back to New
// marketplace when Amazon itself isn't selling.

const KEEPA_URL = "https://api.keepa.com/product";

export type KeepaAsinResult = {
  asin: string;
  priceNow: number | null;      // $, Amazon or marketplace-new
  listPrice: number | null;     // $, MSRP
  discountPct: number | null;   // 0-100
  rating: number | null;        // 1-5
  reviews: number | null;
  inStockShare30d: number | null;
  brand: string | null;
  title: string | null;
  history: KeepaHistory | null;
  categories: Record<string, string>;
  error?: string;
};

export type KeepaHistory = {
  amazon: number[] | null;
  newPrice: number[] | null;
  list: number[] | null;
  offers: number[] | null;
  rating: number[] | null;
  reviews: number[] | null;
  buyBoxSellers: string[] | null;
  deal: number[] | null;
  coupons: number[] | null;
  salesRank: number[] | null;
  subRanks: Record<string, number[]> | null;
  monthlySold: number[] | null;
};

export type DailySeries = {
  price: Array<number | null>;
  list: Array<number | null>;
  stock: Array<0 | 1 | null>;
  offers: Array<number | null>;
  rating: Array<number | null>;
  reviews: Array<number | null>;
  buyBoxSeller: Array<string | null>;
  dealPrice: Array<number | null>;
  couponOff: Array<{ cents: number } | { pct: number } | null>;
  salesRank: Array<number | null>;
  subRanks: Record<string, Array<number | null>>;
  monthlySold: Array<number | null>;
};

export type KeepaBrandAggregate = {
  asinsFetched: number;
  asinsWithData: number;
  avgListPrice: number | null;
  avgStreetPrice: number | null;
  avgDiscountRate: number | null;    // 0-1 for the launch-data shape
  avgRating: number | null;
  totalReviews: number | null;
  inStockRate: number | null;
  perAsin: KeepaAsinResult[];
  rejected: KeepaAsinResult[];
};

const latest = (arr: number[] | undefined | null): number | null => {
  if (!arr) return null;
  for (let i = arr.length - 2; i >= 0; i -= 2) if (arr[i + 1] !== -1) return arr[i + 1];
  return null;
};

const cents = (v: number | null): number | null => (v == null ? null : Math.round(v) / 100);

const KEEPA_EPOCH_MINUTES = 21564000;
const keepaMinutesToMs = (m: number): number => (m + KEEPA_EPOCH_MINUTES) * 60000;

const valueAt = (series: number[] | null | undefined, atMs: number): number | null => {
  if (!series || series.length < 2) return null;
  let v: number | null = null;
  for (let i = 0; i < series.length - 1; i += 2) {
    if (keepaMinutesToMs(series[i]) > atMs) break;
    v = series[i + 1];
  }
  return v;
};

export function inStockShare(series: Array<number[] | null | undefined>, nowMs: number, days = 30): number | null {
  const step = 3600000;
  let known = 0, buyable = 0;
  for (let t = nowMs - days * 86400000; t <= nowMs; t += step) {
    const vals = series.map((s) => valueAt(s, t)).filter((v): v is number => v != null);
    if (!vals.length) continue;
    known++;
    if (vals.some((v) => v !== -1)) buyable++;
  }
  return known ? buyable / known : null;
}

const EMPTY = { priceNow: null, listPrice: null, discountPct: null, rating: null, reviews: null, inStockShare30d: null, brand: null, title: null, history: null, categories: {} };

const DAY_MS = 86400000;

function couponAt(triplets: number[] | null | undefined, atMs: number): { cents: number } | { pct: number } | null {
  if (!triplets) return null;
  let oneTime: number | null = null;
  for (let i = 0; i + 2 < triplets.length; i += 3) {
    if (keepaMinutesToMs(triplets[i]) > atMs) break;
    oneTime = triplets[i + 1];
  }
  if (!oneTime) return null;
  return oneTime > 0 ? { cents: oneTime } : { pct: -oneTime };
}

/**
 * Samples Keepa's step series at the end of each ISO day. A day before the
 * listing's first data point is null (not listed); -1 means not buyable.
 */
export function dailySeries(h: KeepaHistory, dates: string[]): DailySeries {
  const out: DailySeries = { price: [], list: [], stock: [], offers: [], rating: [], reviews: [], buyBoxSeller: [], dealPrice: [], couponOff: [], salesRank: [], subRanks: {}, monthlySold: [] };
  const subRankIds = Object.keys(h.subRanks ?? {});
  for (const id of subRankIds) out.subRanks[id] = [];
  const bb = h.buyBoxSellers ?? [];
  for (const d of dates) {
    const at = Date.parse(`${d}T00:00:00Z`) + DAY_MS - 1;
    const amazon = valueAt(h.amazon, at), fresh = valueAt(h.newPrice, at);
    const known = amazon != null || fresh != null;
    const buyable = [amazon, fresh].find((v) => v != null && v !== -1) ?? null;
    out.price.push(buyable == null ? null : cents(buyable));
    out.stock.push(known ? (buyable != null ? 1 : 0) : null);
    const list = valueAt(h.list, at);
    out.list.push(list == null || list === -1 ? null : cents(list));
    const offers = valueAt(h.offers, at);
    out.offers.push(offers == null || offers < 0 ? null : offers);
    const rating = valueAt(h.rating, at);
    out.rating.push(rating == null || rating <= 0 ? null : rating / 10);
    const reviews = valueAt(h.reviews, at);
    out.reviews.push(reviews == null || reviews < 0 ? null : reviews);
    let seller: string | null = null;
    for (let i = 0; i < bb.length - 1; i += 2) {
      if (keepaMinutesToMs(Number(bb[i])) > at) break;
      seller = bb[i + 1];
    }
    out.buyBoxSeller.push(seller);
    const deal = valueAt(h.deal, at);
    out.dealPrice.push(deal == null || deal <= 0 ? null : cents(deal));
    out.couponOff.push(couponAt(h.coupons, at));
    const rank = valueAt(h.salesRank, at);
    out.salesRank.push(rank == null || rank <= 0 ? null : rank);
    for (const id of subRankIds) {
      const r = valueAt(h.subRanks?.[id], at);
      out.subRanks[id].push(r == null || r <= 0 ? null : r);
    }
    const sold = valueAt(h.monthlySold, at);
    out.monthlySold.push(sold == null || sold < 0 ? null : sold);
  }
  return out;
}

// Keepa product search — turns a free-text query ("Dyson cordless vacuum") into
// a ranked list of ASINs. Used for auto-discovery so the admin doesn't have to
// hand-paste ASINs from Amazon URLs. Rank is Keepa's own popularity signal
// (BSR-weighted). We take the top N and feed them to fetchKeepaBrand +
// fetchApifyAmazon.
export async function fetchKeepaSearch(term: string, apiKey: string, limit = 5, domain = 1): Promise<string[]> {
  const url = `https://api.keepa.com/search?key=${apiKey}&domain=${domain}&type=product&term=${encodeURIComponent(term)}&page=0`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = (await r.json()) as { asinList?: string[]; products?: Array<{ asin?: string }> };
    const list = j.asinList ?? j.products?.map((p) => p.asin).filter((a): a is string => !!a) ?? [];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchKeepaAsin(asin: string, apiKey: string, domain = 1): Promise<KeepaAsinResult> {
  const url = `${KEEPA_URL}?key=${apiKey}&domain=${domain}&asin=${encodeURIComponent(asin)}&history=1&rating=1&stats=30&buybox=1`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { asin, ...EMPTY, error: `HTTP ${r.status}` };
    const j = (await r.json()) as {
      products?: Array<{
        csv?: Array<number[] | null>; brand?: string; title?: string; buyBoxSellerIdHistory?: string[];
        couponHistory?: number[]; salesRanks?: Record<string, number[]>; monthlySoldHistory?: number[];
        categoryTree?: Array<{ catId?: number; name?: string }>;
      }>;
      tokensLeft?: number;
    };
    const p = j.products?.[0];
    if (!p?.csv) return { asin, ...EMPTY, brand: p?.brand ?? null, title: p?.title ?? null, error: "no data" };
    const amazon = p.csv[0], newM = p.csv[1], list = p.csv[4], offers = p.csv[11], rating = p.csv[16], reviews = p.csv[17];
    const priceArr = amazon?.length ? amazon : newM;
    const pNow = cents(latest(priceArr));
    const listNow = cents(latest(list));
    const discount = (listNow && pNow) ? Math.max(0, Math.round((1 - pNow / listNow) * 1000) / 10) : null;
    return {
      asin,
      priceNow: pNow,
      listPrice: listNow,
      discountPct: discount,
      rating: rating ? (latest(rating) ?? 0) / 10 : null,
      reviews: reviews ? latest(reviews) : null,
      inStockShare30d: inStockShare([amazon, newM], Date.now()),
      brand: p.brand ?? null,
      title: p.title ?? null,
      categories: Object.fromEntries((p.categoryTree ?? []).flatMap((c) => (c.catId != null && c.name ? [[String(c.catId), c.name]] : []))),
      history: {
        amazon: amazon ?? null, newPrice: newM ?? null, list: list ?? null, offers: offers ?? null, rating: rating ?? null, reviews: reviews ?? null,
        buyBoxSellers: p.buyBoxSellerIdHistory ?? null, deal: p.csv[8] ?? null, coupons: p.couponHistory ?? null,
        salesRank: p.csv[3] ?? null, subRanks: p.salesRanks ?? null, monthlySold: p.monthlySoldHistory ?? null,
      },
    };
  } catch (e) {
    return { asin, ...EMPTY, error: (e as Error).message.slice(0, 60) };
  }
}

export async function fetchKeepaBrand(asins: string[], apiKey: string, domain = 1, brandName?: string): Promise<KeepaBrandAggregate> {
  const results: KeepaAsinResult[] = [];
  for (const asin of asins) {
    const r = await fetchKeepaAsin(asin, apiKey, domain);
    results.push(r);
    // Keepa paces per-key; 500ms gap keeps us comfortably under their rate.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const hasData = results.filter((r) => r.priceNow != null || r.rating != null);
  const withData = brandName ? hasData.filter((r) => listingMatchesBrand(r, brandName)) : hasData;
  const rejected = hasData.filter((r) => !withData.includes(r));
  const avg = (arr: number[]): number | null =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

  const listPrices = withData.map((r) => r.listPrice).filter((v): v is number => v != null);
  const streetPrices = withData.map((r) => r.priceNow).filter((v): v is number => v != null);
  const discounts = withData.map((r) => r.discountPct).filter((v): v is number => v != null);
  const ratings = withData.map((r) => r.rating).filter((v): v is number => v != null);
  const reviewSums = withData.reduce<number>((sum, r) => sum + (r.reviews ?? 0), 0);
  const stockShares = withData.map((r) => r.inStockShare30d).filter((v): v is number => v != null);

  return {
    asinsFetched: results.length,
    asinsWithData: withData.length,
    avgListPrice: avg(listPrices),
    avgStreetPrice: avg(streetPrices),
    // launch-data expects a 0-1 ratio, Keepa reports 0-100
    avgDiscountRate: discounts.length ? Math.round(avg(discounts)! * 10) / 1000 : null,
    avgRating: avg(ratings),
    totalReviews: reviewSums || null,
    inStockRate: stockShares.length ? Math.round((stockShares.reduce((a, b) => a + b, 0) / stockShares.length) * 1000) / 1000 : null,
    perAsin: results,
    rejected,
  };
}

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const words = (s: string | null | undefined): string[] => (s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * True when the listing's Keepa brand or title names the brand. A multi-word
 * name matches when every word appears in the brand field or the title, so
 * "Amazon Echo" matches brand "Amazon" + title "Echo Pop" but not "Amazon Basics".
 */
export function listingMatchesBrand(listing: Pick<KeepaAsinResult, "brand" | "title">, brandName: string): boolean {
  const want = normalise(brandName);
  if (!want) return false;
  if ([listing.brand, listing.title].some((v) => !!v && normalise(v).includes(want))) return true;
  const tokens = words(brandName);
  if (tokens.length < 2) return false;
  const have = new Set([...words(listing.brand), ...words(listing.title)]);
  return tokens.every((t) => have.has(t));
}
