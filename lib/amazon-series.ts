import { dailySeries, listingMatchesBrand, type KeepaBrandAggregate } from "./keepa";
import type { AmazonProduct } from "./apify";

export const WINDOW_DAYS = 91;
const DAY_MS = 86400000;
const REINDEX_MIN = 50;
const REINDEX_SHARE = 0.02;
export const AMAZON_RETAIL_SELLER = "ATVPDKIKX0DER";
const PDP_MAX = { images: 9, video: 3, aplus: 1, bullets: 7, specs: 1, reviews: 1, titleKw: 1 } as const;

export type PdpScoreFields = Record<keyof typeof PDP_MAX, number>;

export type ListingSeries = {
  asin: string;
  label: string;
  msrp: number | null;
  street: number | null;
  price: Array<number | null>;
  list: Array<number | null>;
  stock: Array<0 | 1 | null>;
  offers: Array<number | null>;
  buybox: Array<0 | 1 | null>;
  pdp: PdpScoreFields | null;
  deliveryDays: number | null;
  effective: Array<number | null>;
  couponOff: Array<number | null>;
  deal: Array<0 | 1 | null>;
  monthlySold: Array<number | null>;
  rank: Array<number | null>;
};

export type AmazonSeries = {
  windowEnd: string;
  rankCategory: string | null;
  rankCategoryName: string | null;
  listings: Record<string, ListingSeries[]>;
  rating: Record<string, Array<number | null>>;
  reviews: Record<string, Array<number | null>>;
};

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The Sunday that closes the last complete week before `now` (UTC).
 */
export function windowEndFor(now: Date): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = new Date(today).getUTCDay();
  return iso(today - (dow === 0 ? 7 : dow) * DAY_MS);
}

export function windowDates(end: string, days = WINDOW_DAYS): string[] {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => iso(endMs - (days - 1 - i) * DAY_MS));
}

export function shortTitle(title: string | null, fallback: string): string {
  if (!title) return fallback;
  const head = title.split(/\s[|–—-]\s|,|\(/)[0].trim();
  const words = head.length > 60 ? head.slice(0, 61).split(/\s+/).slice(0, -1) : head.split(/\s+/);
  while (words.length > 1 && /^(with|and|for|of|the|a|in|&)$/i.test(words[words.length - 1])) words.pop();
  const short = words.join(" ") || fallback;
  const size = packSize(title);
  return size && !packSize(head) ? `${short} · ${size} Count` : short;
}

/**
 * A short label with the variant a title names after its product name
 * ("Shea-Coco", "Mint Chill"), for listings whose short labels would
 * otherwise read the same.
 */
export function withVariant(label: string, title: string | null): string {
  const variant = (title ?? "").split(/\s[|–—-]\s/)[1]?.split(/,|\(/)[0]?.trim();
  if (!variant || variant.length > 32 || label.toLowerCase().includes(variant.toLowerCase())) return label;
  const [name, size] = label.split(" · ");
  return size ? `${name} ${variant} · ${size}` : `${name} ${variant}`;
}

/**
 * The unit count a listing title states ("288 Count", "48ct", "180 Wipes"),
 * so pack sizes of the same product stay apart.
 */
export function packSize(title: string): number | null {
  const m = /\b(\d{1,5})\s*-?\s*(?:count|ct)\b/i.exec(title) ?? /\b(\d{1,5})\s+total\b/i.exec(title);
  if (m) return Number(m[1]);
  const packsOf = /\b(\d{1,3})\s+packs?\s+of\s+(\d{1,5})\b/i.exec(title);
  if (packsOf) return Number(packsOf[1]) * Number(packsOf[2]);
  const perPack = /\b(\d{1,3})\s+(?:flip-top\s+)?packs?\b[^\d]{0,12}(\d{1,5})\s+(?:[a-z]+\s+)?(?:wipes|sheets)\s+per\s+pack\b/i.exec(title);
  if (perPack) return Number(perPack[1]) * Number(perPack[2]);
  const unit = /\b(\d{1,5})\s*-?\s*(?:[a-z]+\s+)?(?:wipes|sheets|pieces|pcs|pods|tablets|capsules)\b/i.exec(title);
  return unit ? Number(unit[1]) : null;
}

const lastValue = <T>(arr: Array<T | null>): T | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
};

const STALE_LIST_SHARE = 0.6;

const median = (arr: Array<number | null>): number | null => {
  const v = arr.filter((x): x is number => x != null && x > 0).sort((a, z) => a - z);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

/**
 * A listing's list price, or null when it is far below what the listing
 * actually sells for (a list price left over from an older pack).
 */
export function usableListPrice(list: number | null, prices: Array<number | null>): number | null {
  const typical = median(prices);
  return list != null && typical != null && list < typical * STALE_LIST_SHARE ? null : list;
}

/**
 * Turns each brand's brand-checked Keepa listings into daily Amazon series
 * over the dashboard window. `slotsAvailable` caps how many listings a brand
 * can place, one per model slot in the reference catalogue.
 */
function titleFitsCategory(title: string | null, category: string | null): 0 | 1 {
  if (!title || !category) return 0;
  const t = title.toLowerCase();
  const words = category.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return words.length && words.every((w) => t.includes(w.replace(/s$/, ""))) ? 1 : 0;
}

function pdpFields(product: AmazonProduct | undefined, category: string | null): PdpScoreFields | null {
  if (!product?.pdp) return null;
  const cap = (k: keyof typeof PDP_MAX, v: number) => Math.min(PDP_MAX[k], Math.max(0, v));
  return {
    images: cap("images", product.pdp.images),
    video: cap("video", product.pdp.video),
    aplus: product.pdp.aplus,
    bullets: cap("bullets", product.pdp.bullets),
    specs: product.pdp.specs,
    reviews: product.pdp.reviews,
    titleKw: titleFitsCategory(product.title, category),
  };
}

export function buildAmazonSeries(
  brands: Array<{ slot: string; brand: string; keepa: KeepaBrandAggregate | null | undefined; slotsAvailable: number; pinned?: boolean }>,
  windowEnd: string,
  options: { apify?: Map<string, AmazonProduct>; category?: string | null } = {},
): AmazonSeries {
  const dates = windowDates(windowEnd);
  const withPrior = windowDates(windowEnd, WINDOW_DAYS + 1);
  const out: AmazonSeries = { windowEnd, rankCategory: null, rankCategoryName: null, listings: {}, rating: {}, reviews: {} };
  const categoryNames: Record<string, string> = {};
  const subRanksByListing: Array<{ listing: ListingSeries; subRanks: Record<string, Array<number | null>>; root: Array<number | null> }> = [];

  for (const { slot, brand, keepa, slotsAvailable, pinned } of brands) {
    if (!keepa || keepa.asinsWithData === 0) continue;
    const rejected = new Set(keepa.rejected.map((r) => r.asin));
    const usable = keepa.perAsin.filter((r) => r.history && !rejected.has(r.asin) && (r.priceNow != null || r.rating != null));
    for (const r of usable) Object.assign(categoryNames, r.categories ?? {});
    const seen = new Set<string>();
    const picked = usable.map((r) => ({ r, d: dailySeries(r.history!, withPrior), label: shortTitle(r.title, `${brand} ${r.asin}`) }))
      .filter(({ r, d, label }) => {
        const key = pinned ? r.asin : label.toLowerCase();
        if (!d.stock.slice(1).some((v) => v != null) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, slotsAvailable);
    const clash = new Set(picked.map((x) => x.label.toLowerCase()).filter((l, i, all) => all.indexOf(l) !== i));
    const series = picked.map((x) => (pinned || clash.has(x.label.toLowerCase()) ? { ...x, label: withVariant(x.label, x.r.title) } : x));
    if (!series.length) continue;

    const owners = new Set<string>([AMAZON_RETAIL_SELLER]);
    for (const { r } of series) {
      const a = options.apify?.get(r.asin);
      if (a?.sellerId && a.seller && listingMatchesBrand({ brand: a.seller, title: null }, brand)) owners.add(a.sellerId);
    }

    out.listings[slot] = series.map(({ r, d, label }) => ({
      asin: r.asin,
      label,
      msrp: usableListPrice(lastValue(d.list) ?? r.listPrice ?? null, d.price.slice(1)) ?? median(d.price.slice(1)),
      street: lastValue(d.price) ?? r.priceNow ?? null,
      price: d.price.slice(1),
      list: d.list.slice(1),
      stock: d.stock.slice(1),
      offers: d.offers.slice(1),
      buybox: d.buyBoxSeller.slice(1).map((v) => (v == null ? null : owners.has(v) ? 1 : 0)),
      pdp: pdpFields(options.apify?.get(r.asin), options.category ?? null),
      deliveryDays: options.apify?.get(r.asin)?.deliveryDays ?? null,
      ...effectivePrices(d),
      monthlySold: d.monthlySold.slice(1),
      rank: [],
    }));
    out.listings[slot].forEach((listing, i) => subRanksByListing.push({
      listing,
      subRanks: Object.fromEntries(Object.entries(series[i].d.subRanks).map(([id, v]) => [id, v.slice(1)])),
      root: series[i].d.salesRank.slice(1),
    }));

    out.rating[slot] = dates.map((_, i) => {
      const vals = series.map(({ d }) => d.rating[i + 1]).filter((v): v is number => v != null);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    });
    out.reviews[slot] = dates.map((_, i) => {
      let total = 0, any = false;
      const pools = new Set<string>();
      for (const { d } of series) {
        const today = d.reviews[i + 1], prior = d.reviews[i];
        if (today == null || prior == null) continue;
        any = true;
        if (pools.has(`${prior}|${today}`)) continue;
        pools.add(`${prior}|${today}`);
        const delta = today - prior;
        if (Math.abs(delta) > Math.max(REINDEX_MIN, prior * REINDEX_SHARE)) continue;
        total += Math.max(0, delta);
      }
      return any ? total : null;
    });
  }

  out.rankCategory = sharedRankCategory(subRanksByListing.map((x) => x.subRanks));
  out.rankCategoryName = out.rankCategory ? categoryNames[out.rankCategory] ?? null : null;
  for (const x of subRanksByListing) x.listing.rank = out.rankCategory ? x.subRanks[out.rankCategory] ?? dates.map(() => null) : x.root;
  return out;
}

function effectivePrices(d: ReturnType<typeof dailySeries>): Pick<ListingSeries, "effective" | "couponOff" | "deal"> {
  const effective: Array<number | null> = [], couponOff: Array<number | null> = [], deal: Array<0 | 1 | null> = [];
  for (let i = 1; i < d.price.length; i++) {
    const price = d.price[i];
    if (price == null) { effective.push(null); couponOff.push(null); deal.push(null); continue; }
    const dealPrice = d.dealPrice[i];
    const base = dealPrice != null && dealPrice < price ? dealPrice : price;
    const c = d.couponOff[i];
    const off = !c ? 0 : "cents" in c ? c.cents / 100 : (base * c.pct) / 100;
    effective.push(Math.round(Math.max(0, base - off) * 100) / 100);
    couponOff.push(off ? Math.round(off * 100) / 100 : 0);
    deal.push(dealPrice != null && dealPrice < price ? 1 : 0);
  }
  return { effective, couponOff, deal };
}

function sharedRankCategory(listings: Array<Record<string, Array<number | null>>>): string | null {
  const stats = new Map<string, { count: number; ranks: number[] }>();
  for (const subRanks of listings) {
    for (const [id, series] of Object.entries(subRanks)) {
      const vals = series.filter((v): v is number => v != null);
      if (!vals.length) continue;
      const s = stats.get(id) ?? { count: 0, ranks: [] };
      s.count++;
      s.ranks.push(vals[vals.length - 1]);
      stats.set(id, s);
    }
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const best = [...stats.entries()].sort((a, b) => b[1].count - a[1].count || median(a[1].ranks) - median(b[1].ranks))[0];
  return best && best[1].count >= Math.max(2, Math.ceil(listings.length / 2)) ? best[0] : null;
}
