// Apify client for live Amazon product data.
// Uses the junglee~Amazon-crawler public actor via run-sync-get-dataset-items —
// Apify runs the actor, waits for it to finish, and streams the dataset back in
// one HTTP request. Typical latency: 20-40 s for a handful of ASINs.
//
// What this gives us *beyond* Keepa:
//   · Current list price + sale price (Keepa is historical, can lag a day)
//   · Total offer count (Keepa gives us Amazon's own; we want # of sellers)
//   · Delivery estimate ("Arrives Monday, Oct 7" → days from today)
//   · Buy-box seller
//
// Keepa stays the primary source for historical price + 30-day discount rate.

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_ID = "junglee~Amazon-crawler";

export type AmazonProduct = {
  asin: string;
  price: number | null;              // current street price $
  listPrice: number | null;          // MSRP $
  rating: number | null;             // 1-5
  reviewCount: number | null;
  inStock: boolean;
  totalOffers: number | null;        // # of sellers
  deliveryDays: number | null;       // from "arrives in X days" or similar
  seller: string | null;             // buy-box seller
  title: string | null;
  raw?: unknown;                     // kept for debugging if needed
  error?: string;
};

export type ApifyAmazonAggregate = {
  asinsFetched: number;
  asinsWithData: number;
  avgPrice: number | null;
  avgListPrice: number | null;
  avgDeliveryDays: number | null;
  totalOffersAvg: number | null;
  anyInStock: boolean;
  perAsin: AmazonProduct[];
};

const AMAZON_URL = (asin: string) => `https://www.amazon.com/dp/${asin}`;

// Parse "Arrives Mon, Oct 7" / "Delivery October 7" / "Free delivery in 2 days"
// → number of days from now. Returns null if nothing recognisable.
function daysUntil(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = String(text);
  // Plain "N day(s)"
  const nDays = /(\d+)\s+day/i.exec(s);
  if (nDays) return parseInt(nDays[1], 10);
  // "Tomorrow" / "Today"
  if (/tomorrow/i.test(s)) return 1;
  if (/today/i.test(s)) return 0;
  // Full-date parse — Amazon doesn't year it, so we assume current year
  // (and roll forward if the date has already passed).
  const dateMatch = /([A-Za-z]{3,9})\s+(\d{1,2})/i.exec(s);
  if (dateMatch) {
    const now = new Date();
    const d = new Date(`${dateMatch[1]} ${dateMatch[2]} ${now.getFullYear()}`);
    if (!isNaN(d.getTime())) {
      let diff = Math.ceil((d.getTime() - now.getTime()) / 86400000);
      if (diff < -30) diff += 365;  // rolled past year end
      if (diff >= 0 && diff < 60) return diff;
    }
  }
  return null;
}

const avg = (arr: number[]): number | null =>
  arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

export async function fetchApifyAmazon(asins: string[], apifyToken: string, proxyCountry = "US"): Promise<ApifyAmazonAggregate> {
  if (!asins.length) {
    return {
      asinsFetched: 0, asinsWithData: 0,
      avgPrice: null, avgListPrice: null, avgDeliveryDays: null, totalOffersAvg: null,
      anyInStock: false, perAsin: [],
    };
  }

  // junglee~Amazon-crawler input format: array of { url, asin, keyword, ... }
  // startUrls is the common pattern. We give it one URL per ASIN.
  const input = {
    categoryOrProductUrls: asins.map((a) => ({ url: AMAZON_URL(a) })),
    maxItemsPerStartUrl: 1,
    scrapeProductDetails: true,
    useCaptchaSolver: false,
    proxyCountry,
  };

  const results: AmazonProduct[] = [];
  try {
    const url = `${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${apifyToken}&timeout=180`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`apify ${r.status}: ${body.slice(0, 200)}`);
    }
    const rows = (await r.json()) as Array<Record<string, unknown>>;

    const byAsin = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const asin = String(row.asin ?? row.ASIN ?? row.productAsin ?? "").toUpperCase();
      if (/^[A-Z0-9]{10}$/.test(asin)) byAsin.set(asin, row);
    }

    for (const asin of asins) {
      const row = byAsin.get(asin);
      if (!row) {
        results.push({
          asin, price: null, listPrice: null, rating: null, reviewCount: null,
          inStock: false, totalOffers: null, deliveryDays: null, seller: null, title: null,
          error: "no data in Apify response",
        });
        continue;
      }
      const price =
        asNumber(row.price) ?? asNumber((row.priceDetails as { price?: unknown } | undefined)?.price) ?? null;
      const listPrice =
        asNumber(row.listPrice) ?? asNumber((row.priceDetails as { listPrice?: unknown } | undefined)?.listPrice) ?? null;
      const rating = asNumber(row.stars ?? row.rating);
      const reviewCount = asInt(row.reviewsCount ?? row.reviewCount ?? row.ratingsTotal);
      const inStock = row.inStock === true || row.availability === "In Stock" ||
        (typeof row.availabilityAmazon === "string" && /in stock/i.test(row.availabilityAmazon));
      const totalOffers = asInt(row.offersCount ?? row.sellersCount ?? row.totalOffers);
      const seller = (row.seller as string | undefined) ?? (row.soldBy as string | undefined) ?? null;
      const title = (row.title as string | undefined) ?? (row.name as string | undefined) ?? null;
      const deliveryText =
        (row.deliveryMessage as string | undefined) ??
        (row.delivery as string | undefined) ??
        (row.arrivalDate as string | undefined) ?? null;

      results.push({
        asin,
        price,
        listPrice,
        rating,
        reviewCount,
        inStock: !!inStock,
        totalOffers,
        deliveryDays: daysUntil(deliveryText),
        seller,
        title,
      });
    }
  } catch (e) {
    for (const asin of asins) {
      results.push({
        asin, price: null, listPrice: null, rating: null, reviewCount: null,
        inStock: false, totalOffers: null, deliveryDays: null, seller: null, title: null,
        error: (e as Error).message.slice(0, 120),
      });
    }
  }

  const withData = results.filter((p) => p.price != null || p.rating != null || p.title != null);
  const prices = withData.map((p) => p.price).filter((v): v is number => v != null);
  const listPrices = withData.map((p) => p.listPrice).filter((v): v is number => v != null);
  const deliveries = withData.map((p) => p.deliveryDays).filter((v): v is number => v != null);
  const offers = withData.map((p) => p.totalOffers).filter((v): v is number => v != null);

  return {
    asinsFetched: results.length,
    asinsWithData: withData.length,
    avgPrice: avg(prices),
    avgListPrice: avg(listPrices),
    avgDeliveryDays: avg(deliveries),
    totalOffersAvg: avg(offers),
    anyInStock: withData.some((p) => p.inStock),
    perAsin: results,
  };
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = v.replace(/[$,]/g, "").match(/-?\d+(\.\d+)?/);
    if (m) return parseFloat(m[0]);
  }
  return null;
}

function asInt(v: unknown): number | null {
  const n = asNumber(v);
  return n == null ? null : Math.round(n);
}
