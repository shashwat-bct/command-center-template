import type { RetailFeed } from "./retail-feed";

export type VoiceSlot = {
  slot: string;
  name: string;
  rating: Array<number | null>;
  reviews: Array<number | null>;
  amazonReviews: number | null;
};

export type CombinedVoiceRecord = {
  label: string;
  retailers: Record<string, { products: number; reviews: number }>;
  added: Record<string, Array<number>>;
};

type Point = { date: string; rating: number | null; reviews: number | null; source: string };

const DAY_MS = 86400000;
const REINDEX_SHARE = 0.5;
const SUMMARY = "review-summary";
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r2 = (v: number): number => Math.round(v * 100) / 100;
const days = (a: string, z: string): number => Math.round((Date.parse(`${z}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

function pointsOf(feed: RetailFeed, id: string, windowEnd: string): Point[] {
  const pts: Point[] = (feed.daily[id] ?? [])
    .filter((d) => (d.rating != null && d.rating > 0) || d.reviews != null)
    .map((d) => ({ date: d.date, rating: d.rating != null && d.rating > 0 ? d.rating : null, reviews: d.reviews, source: d.sources.join("+") }));
  const s = feed.reviewSummary[id];
  if (s && (s.avgRating != null || s.total != null)) pts.push({ date: feed.importedOn > windowEnd ? windowEnd : feed.importedOn, rating: s.avgRating, reviews: s.total, source: SUMMARY });
  return pts.sort((a, z) => a.date.localeCompare(z.date));
}

function latest(pts: Point[], day: string, field: "rating" | "reviews"): number | null {
  let v: number | null = null;
  for (const p of pts) { if (p.date > day) break; if (p[field] != null) v = p[field]; }
  return v;
}

function dailyNew(pts: Point[], dates: string[]): number[] {
  const out = dates.map(() => 0);
  const counts = pts.filter((p) => p.reviews != null && p.source !== SUMMARY) as Array<Point & { reviews: number }>;
  for (let i = 1; i < counts.length; i++) {
    const a = counts[i - 1], z = counts[i];
    if (a.source !== z.source) continue;
    const span = days(a.date, z.date), delta = z.reviews - a.reviews;
    if (span <= 0 || delta < 0 || delta > a.reviews * REINDEX_SHARE) continue;
    dates.forEach((d, k) => { if (d > a.date && d <= z.date) out[k] += delta / span; });
  }
  return out;
}

/**
 * Each brand's daily rating and review velocity across every retailer: the
 * Amazon series (one review pool counted once) joined with each retailer
 * feed's products of the brand, the rating weighted by review count and the
 * new reviews added together. A retailer's rating holds its last reading; its
 * new reviews are spread evenly between two review-count readings from the
 * same source (its review summary counts reviews differently, so it weighs the
 * rating but never adds new reviews).
 */
export function combinedVoice(feed: RetailFeed, dates: string[], slots: VoiceSlot[]): { rating: Record<string, Array<number | null>>; reviews: Record<string, Array<number | null>>; record: CombinedVoiceRecord | null } {
  const windowEnd = dates[dates.length - 1];
  const rating: Record<string, Array<number | null>> = {};
  const reviews: Record<string, Array<number | null>> = {};
  const retailers: CombinedVoiceRecord["retailers"] = {};
  const added: CombinedVoiceRecord["added"] = {};
  for (const s of slots) {
    const products = Object.values(feed.products).filter((p) => norm(p.brand) === norm(s.name));
    const pts = products.map((p) => ({ p, pts: pointsOf(feed, p.id, windowEnd) })).filter((x) => x.pts.length);
    if (!pts.length) { rating[s.slot] = s.rating; reviews[s.slot] = s.reviews; continue; }
    const fresh = pts.map((x) => dailyNew(x.pts, dates));
    added[s.slot] = dates.map((_, i) => Math.round(fresh.reduce((a, f) => a + f[i], 0) * 10) / 10);
    rating[s.slot] = dates.map((d, i) => {
      let num = 0, den = 0;
      const amz = s.rating[i];
      if (amz != null && s.amazonReviews) { num += amz * s.amazonReviews; den += s.amazonReviews; }
      for (const x of pts) {
        const r = latest(x.pts, d, "rating"), n = latest(x.pts, d, "reviews");
        if (r != null && n) { num += r * n; den += n; }
      }
      return den ? r2(num / den) : amz;
    });
    reviews[s.slot] = dates.map((_, i) => {
      const other = fresh.reduce((a, f) => a + f[i], 0);
      const amz = s.reviews[i];
      return amz == null && !other ? null : Math.round((amz ?? 0) + other);
    });
    for (const x of pts) {
      const r = (retailers[x.p.retailer] ??= { products: 0, reviews: 0 });
      r.products += 1;
      r.reviews += latest(x.pts, windowEnd, "reviews") ?? 0;
    }
  }
  return { rating, reviews, record: Object.keys(retailers).length ? { label: feed.label, retailers, added } : null };
}
