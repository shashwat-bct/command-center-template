const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_ID = "junglee~Amazon-crawler";

export type PdpFields = {
  images: number;
  video: number;
  aplus: 0 | 1;
  bullets: number;
  specs: 0 | 1;
  reviews: 0 | 1;
};

export type AmazonProduct = {
  asin: string;
  brand: string | null;
  title: string | null;
  price: number | null;
  listPrice: number | null;
  rating: number | null;
  reviewCount: number | null;
  inStock: boolean | null;
  deliveryDays: number | null;
  seller: string | null;
  sellerId: string | null;
  pdp: PdpFields | null;
  error?: string;
};

export type ApifyAmazonAggregate = {
  asinsFetched: number;
  asinsWithData: number;
  avgPrice: number | null;
  avgDeliveryDays: number | null;
  inStockShare: number | null;
  perAsin: AmazonProduct[];
};

type Row = Record<string, unknown>;

const AMAZON_URL = (asin: string) => `https://www.amazon.com/dp/${asin}`;

export function daysUntil(text: string | null | undefined, now: Date = new Date()): number | null {
  if (!text) return null;
  const s = String(text);
  const nDays = /(\d+)\s+day/i.exec(s);
  if (nDays) return parseInt(nDays[1], 10);
  if (/tomorrow/i.test(s)) return 1;
  if (/today/i.test(s)) return 0;
  const dateMatch = /([A-Za-z]{3,9})\s+(\d{1,2})\b/.exec(s);
  if (dateMatch) {
    const d = new Date(`${dateMatch[1]} ${dateMatch[2]} ${now.getFullYear()}`);
    if (!isNaN(d.getTime())) {
      let diff = Math.ceil((d.getTime() - now.getTime()) / 86400000);
      if (diff < -30) diff += 365;
      if (diff >= 0 && diff < 60) return diff;
    }
  }
  return null;
}

function money(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "value" in v) return money((v as { value: unknown }).value);
  if (typeof v === "string") {
    const m = v.replace(/[$,]/g, "").match(/-?\d+(\.\d+)?/);
    if (m) return parseFloat(m[0]);
  }
  return null;
}

const count = (v: unknown): number => (Array.isArray(v) ? v.length : typeof v === "number" ? v : 0);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const avg = (arr: number[]): number | null =>
  arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

/**
 * Maps one `junglee~Amazon-crawler` dataset item. Shapes verified against a
 * real run (fixture: scripts/fixtures/apify-amazon-items.json).
 */
export function parseAmazonItem(asin: string, row: Row, now: Date = new Date()): AmazonProduct {
  const seller = row.seller;
  return {
    asin,
    brand: text(row.brand),
    title: text(row.title),
    price: money(row.price),
    listPrice: money(row.listPrice),
    rating: typeof row.stars === "number" ? row.stars : null,
    reviewCount: typeof row.reviewsCount === "number" ? row.reviewsCount : null,
    inStock: typeof row.inStock === "boolean" ? row.inStock : null,
    deliveryDays: daysUntil(text(row.delivery), now),
    seller: seller && typeof seller === "object" ? text((seller as Row).name) : text(seller),
    sellerId: seller && typeof seller === "object" ? text((seller as Row).id) : null,
    pdp: {
      images: count(row.highResolutionImages),
      video: count(row.videosCount),
      aplus: row.aPlusContent ? 1 : 0,
      bullets: count(row.features),
      specs: count(row.productOverview) > 0 ? 1 : 0,
      reviews: row.hasReviews === true ? 1 : 0,
    },
  };
}

const EMPTY = { brand: null, title: null, price: null, listPrice: null, rating: null, reviewCount: null, inStock: null, deliveryDays: null, seller: null, sellerId: null, pdp: null };

export async function fetchApifyAmazon(asins: string[], apifyToken: string, proxyCountry = "US"): Promise<ApifyAmazonAggregate> {
  const results: AmazonProduct[] = [];
  if (asins.length) {
    try {
      const url = `${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${apifyToken}&timeout=180`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryOrProductUrls: asins.map((a) => ({ url: AMAZON_URL(a) })),
          maxItemsPerStartUrl: 1,
          scrapeProductDetails: true,
          useCaptchaSolver: false,
          proxyCountry,
        }),
      });
      if (!r.ok) throw new Error(`apify ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
      const rows = (await r.json()) as Row[];
      const byAsin = new Map<string, Row>();
      for (const row of rows) {
        const asin = String(row.asin ?? row.originalAsin ?? "").toUpperCase();
        if (/^[A-Z0-9]{10}$/.test(asin)) byAsin.set(asin, row);
      }
      for (const asin of asins) {
        const row = byAsin.get(asin);
        results.push(row ? parseAmazonItem(asin, row) : { asin, ...EMPTY, error: "no data in Apify response" });
      }
    } catch (e) {
      for (const asin of asins) results.push({ asin, ...EMPTY, error: (e as Error).message.slice(0, 120) });
    }
  }

  const withData = results.filter((p) => p.price != null);
  const stock = withData.map((p) => p.inStock).filter((v): v is boolean => v != null);
  return {
    asinsFetched: results.length,
    asinsWithData: withData.length,
    avgPrice: avg(withData.map((p) => p.price).filter((v): v is number => v != null)),
    avgDeliveryDays: avg(withData.map((p) => p.deliveryDays).filter((v): v is number => v != null)),
    inStockShare: stock.length ? stock.filter(Boolean).length / stock.length : null,
    perAsin: results,
  };
}

export type SearchResult = { position: number; asin: string; title: string; price: number | null; sponsored: boolean };

/**
 * Reads an Amazon search results page for `term` in result order. The actor
 * reports organic results; sponsored placements are not flagged reliably.
 */
export async function fetchAmazonSearch(term: string, apifyToken: string, proxyCountry = "US", depth = 48): Promise<SearchResult[]> {
  const url = `${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${apifyToken}&timeout=180`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      categoryOrProductUrls: [{ url: `https://www.amazon.com/s?k=${encodeURIComponent(term)}` }],
      maxItemsPerStartUrl: depth,
      scrapeProductDetails: false,
      useCaptchaSolver: false,
      proxyCountry,
    }),
  });
  if (!r.ok) throw new Error(`apify search ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const rows = (await r.json()) as Row[];
  return rows
    .map((row, i) => ({
      position: typeof row.position === "number" ? row.position : i + 1,
      asin: String(row.asin ?? ""),
      title: text(row.title) ?? "",
      price: money(row.price),
      sponsored: row.isSponsored === true,
    }))
    .filter((x) => x.asin && x.title)
    .sort((a, b) => a.position - b.position)
    .slice(0, depth);
}
