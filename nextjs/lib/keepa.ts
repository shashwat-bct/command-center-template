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
  inStock: boolean;
  error?: string;
};

export type KeepaBrandAggregate = {
  asinsFetched: number;
  asinsWithData: number;
  avgListPrice: number | null;
  avgStreetPrice: number | null;
  avgDiscountRate: number | null;    // 0-1 for the launch-data shape
  avgRating: number | null;
  totalReviews: number | null;
  anyInStock: boolean;
  perAsin: KeepaAsinResult[];
};

const latest = (arr: number[] | undefined | null): number | null => {
  if (!arr) return null;
  for (let i = arr.length - 2; i >= 0; i -= 2) if (arr[i + 1] !== -1) return arr[i + 1];
  return null;
};

const cents = (v: number | null): number | null => (v == null ? null : Math.round(v) / 100);

// Keepa product search — turns a free-text query ("Dyson cordless vacuum") into
// a ranked list of ASINs. Used for auto-discovery so the admin doesn't have to
// hand-paste ASINs from Amazon URLs. Rank is Keepa's own popularity signal
// (BSR-weighted). We take the top N and feed them to fetchKeepaBrand +
// fetchApifyAmazon.
export async function fetchKeepaSearch(term: string, apiKey: string, limit = 5): Promise<string[]> {
  const url = `https://api.keepa.com/search?key=${apiKey}&domain=1&type=product&term=${encodeURIComponent(term)}&page=0`;
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

export async function fetchKeepaAsin(asin: string, apiKey: string): Promise<KeepaAsinResult> {
  const url = `${KEEPA_URL}?key=${apiKey}&domain=1&asin=${encodeURIComponent(asin)}&history=1&rating=1&stats=30`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { asin, priceNow: null, listPrice: null, discountPct: null, rating: null, reviews: null, inStock: false, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { products?: Array<{ csv?: Array<number[] | null> }>; tokensLeft?: number };
    const p = j.products?.[0];
    if (!p?.csv) return { asin, priceNow: null, listPrice: null, discountPct: null, rating: null, reviews: null, inStock: false, error: "no data" };
    const amazon = p.csv[0], newM = p.csv[1], list = p.csv[4], rating = p.csv[16], reviews = p.csv[17];
    const priceArr = amazon?.length ? amazon : newM;
    const pNow = cents(latest(priceArr));
    const listNow = cents(latest(list));
    const discount = (listNow && pNow && listNow > pNow) ? Math.round((1 - pNow / listNow) * 1000) / 10 : null;
    return {
      asin,
      priceNow: pNow,
      listPrice: listNow,
      discountPct: discount,
      rating: rating ? (latest(rating) ?? 0) / 10 : null,
      reviews: reviews ? latest(reviews) : null,
      inStock: (latest(amazon) != null) || (latest(newM) != null),
    };
  } catch (e) {
    return { asin, priceNow: null, listPrice: null, discountPct: null, rating: null, reviews: null, inStock: false, error: (e as Error).message.slice(0, 60) };
  }
}

export async function fetchKeepaBrand(asins: string[], apiKey: string): Promise<KeepaBrandAggregate> {
  const results: KeepaAsinResult[] = [];
  for (const asin of asins) {
    const r = await fetchKeepaAsin(asin, apiKey);
    results.push(r);
    // Keepa paces per-key; 500ms gap keeps us comfortably under their rate.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const withData = results.filter((r) => r.priceNow != null || r.rating != null);
  const avg = (arr: number[]): number | null =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

  const listPrices = withData.map((r) => r.listPrice).filter((v): v is number => v != null);
  const streetPrices = withData.map((r) => r.priceNow).filter((v): v is number => v != null);
  const discounts = withData.map((r) => r.discountPct).filter((v): v is number => v != null);
  const ratings = withData.map((r) => r.rating).filter((v): v is number => v != null);
  const reviewSums = withData.reduce<number>((sum, r) => sum + (r.reviews ?? 0), 0);

  return {
    asinsFetched: results.length,
    asinsWithData: withData.length,
    avgListPrice: avg(listPrices),
    avgStreetPrice: avg(streetPrices),
    // launch-data expects a 0-1 ratio, Keepa reports 0-100
    avgDiscountRate: discounts.length ? Math.round(avg(discounts)! * 10) / 1000 : null,
    avgRating: avg(ratings),
    totalReviews: reviewSums || null,
    anyInStock: withData.some((r) => r.inStock),
    perAsin: results,
  };
}
