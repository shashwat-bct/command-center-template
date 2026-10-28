import type { FeedDay, FeedReview, FeedReviewSummary, RetailFeed } from "./retail-feed";

export type FeedViewProduct = {
  id: string;
  retailer: string;
  item: string;
  brand: string | null;
  brandLabel: string;
  title: string;
  url: string | null;
  units: number | null;
  model: string | null;
  match: "upc" | "line" | null;
};

export type FeedView = {
  label: string;
  importedOn: string;
  sources: string[];
  products: FeedViewProduct[];
  daily: Record<string, FeedDay[]>;
  reviewSummary: Record<string, FeedReviewSummary>;
  reviews: Record<string, FeedReview[]>;
};

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type LaneNote = { status: string; note: string; sources?: string[] };
type Quote = { text: string; tone: "positive" | "negative"; highlight?: string; retailer?: string; rating?: number | null; date?: string; title?: string | null; verified?: boolean | null; variant?: string | null; helpful?: number | null; fulfilledBy?: string | null };
type RetailerListing = { retailer: string; product: string; title: string; url: string | null; positive: number; negative: number; summary: null; quotes: Quote[] };
type AspectCount = { positive: number; negative: number; quotes: Quote[]; listings?: Array<RetailerListing | { asin: string }> };

const ASPECT_WORDS: Record<string, string[]> = {
  effectiveness: ["clean", "effective", "works", "work great", "fresh"],
  fragrance: ["scent", "smell", "fragrance"],
  durability: ["tear", "rip", "thick", "durable", "sturdy", "strong", "fall apart"],
  softness: ["soft", "gentle", "smooth"],
  quality: ["quality"],
  size: ["size", "large", "big", "small"],
  flushability: ["flush", "clog", "plumbing", "septic"],
  value: ["price", "expensive", "value", "cheap", "worth"],
  "value for money": ["price", "expensive", "value", "cheap", "worth", "deal"],
  reliability: ["stopped working", "died", "broke", "defect", "reliable", "went out", "black screen", "won't turn on", "lasted"],
  "picture quality": ["picture", "image", "colors", "colour", "display"],
  "sound quality": ["sound", "audio", "speaker"],
  setup: ["set up", "setup", "install", "easy to use"],
  brightness: ["bright", "dim", "glare"],
};
const MAX_RETAILER_QUOTES = 2;
const MAX_PRODUCT_QUOTES = 2;

const sentenceWith = (text: string, word: string): string | null => {
  const at = text.toLowerCase().indexOf(word);
  if (at < 0) return null;
  const start = Math.max(text.lastIndexOf(".", at) + 1, text.lastIndexOf("!", at) + 1, text.lastIndexOf("?", at) + 1, 0);
  const ends = [".", "!", "?"].map((c) => text.indexOf(c, at)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  const s = text.slice(start, end).trim();
  return s.length >= 12 ? s.slice(0, 280) : null;
};

type VoiceSection = {
  aspects?: Record<string, Record<string, Array<number | null>>>;
  aspectMeasured?: Record<string, Record<string, boolean[]>>;
  aspectCounts?: Record<string, Record<string, AspectCount & { byRetailer?: Record<string, { positive: number; negative: number }> }>>;
};
const MIN_MENTIONS = 4;

/**
 * Folds each retailer feed's reviews into the Voice of Customer aspects: a
 * review that names an aspect counts as a positive mention when rated 4–5★
 * and a negative one when rated 1–2★, added to Amazon's counts with the split
 * kept per retailer; each aspect's score is re-read from the combined counts;
 * and the newest positive and critical sentences naming the aspect are added
 * as quotes, tagged with the retailer. Returns the mentions and quotes added.
 */
export function withRetailerReviews(voice: VoiceSection | undefined, dims: { brands: Array<{ id: string }>; aspects?: string[]; aspectMonths?: string[] }, view: FeedView): { mentions: number; quotes: number } {
  const out = { mentions: 0, quotes: 0 };
  if (!voice || !dims.aspects?.length) return out;
  const months = dims.aspectMonths?.length ?? 1;
  voice.aspectCounts ??= {}; voice.aspects ??= {}; voice.aspectMeasured ??= {};
  for (const { id: brand } of dims.brands) {
    const reviews = view.products.filter((p) => p.brand === brand)
      .flatMap((p) => (view.reviews[p.id] ?? []).map((r) => ({ r, retailer: p.retailer, product: p })))
      .filter(({ r }) => r.text && r.rating != null && r.rating !== 3)
      .sort((a, z) => z.r.date.localeCompare(a.r.date));
    if (!reviews.length) continue;
    const counts = (voice.aspectCounts[brand] ??= {});
    for (const aspect of dims.aspects) {
      const words = ASPECT_WORDS[aspect.toLowerCase()] ?? [aspect.toLowerCase()];
      const a = (counts[aspect] ??= { positive: 0, negative: 0, quotes: [] });
      a.byRetailer ??= { amazon: { positive: a.positive, negative: a.negative } };
      const rows = new Map<string, RetailerListing>();
      for (const { r, retailer, product } of reviews) {
        const word = words.find((w) => (r.text ?? "").toLowerCase().includes(w));
        if (!word) continue;
        const tone = (r.rating ?? 0) >= 4 ? "positive" : "negative";
        const split = (a.byRetailer[retailer] ??= { positive: 0, negative: 0 });
        split[tone] += 1; a[tone] += 1; out.mentions += 1;
        const row = rows.get(product.id) ?? { retailer, product: product.id, title: product.title, url: product.url, positive: 0, negative: 0, summary: null, quotes: [] };
        row[tone] += 1;
        rows.set(product.id, row);
        const sentence = sentenceWith(r.text ?? "", word);
        if (!sentence) continue;
        const quote: Quote = { text: sentence, tone, highlight: word, retailer, rating: r.rating, date: r.date, title: r.title, verified: r.verified, variant: r.variant ?? null, helpful: r.helpful, fulfilledBy: r.fulfilledBy ?? null };
        if (row.quotes.filter((q) => q.tone === tone).length < MAX_PRODUCT_QUOTES) row.quotes.push(quote);
        if (a.quotes.filter((q) => q.retailer === retailer && q.tone === tone).length < MAX_RETAILER_QUOTES / 2) { a.quotes.push(quote); out.quotes += 1; }
      }
      a.listings = [...(a.listings ?? []), ...rows.values()];
      const total = a.positive + a.negative;
      const series = (voice.aspects[brand] ??= {})[aspect] ?? Array<number | null>(months).fill(null);
      const flags = (voice.aspectMeasured[brand] ??= {})[aspect] ?? Array<boolean>(months).fill(false);
      series[months - 1] = total >= MIN_MENTIONS ? Math.round((a.positive / total) * 100) : series[months - 1];
      flags[months - 1] = series[months - 1] != null;
      voice.aspects[brand][aspect] = series;
      voice.aspectMeasured[brand][aspect] = flags;
    }
  }
  return out;
}

/**
 * Names the feed's retailer reviews on the Voice of Customer lane: their
 * mentions counted into each aspect and their quotes shown beside Amazon's.
 */
export function withFeedReviewLane(lanes: Record<string, LaneNote> | undefined, view: FeedView): void {
  const voice = lanes?.voice;
  if (!voice) return;
  const retailers = [...new Set(view.products.filter((p) => (view.reviews[p.id] ?? []).length).map((p) => p.retailer))];
  if (!retailers.length) return;
  const names = retailers.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(", ");
  voice.note = `${voice.note} ${names} reviews from ${view.label} are added to each aspect: a 4–5★ review naming the aspect counts as a positive mention, a 1–2★ one as negative, with their quotes beside Amazon's.`;
  const source = `Retailer reviews · ${view.label}`;
  voice.sources = [...(voice.sources ?? []).filter((s) => s !== source), source];
}

/**
 * The feed as the dashboard reads it: every product with its brand and
 * tracked listing on this dashboard, each product's daily readings inside the
 * window (a reading after the window closes stands for its last day), and the
 * retailer reviews.
 */
export function feedView(feed: RetailFeed, dims: { brands: Array<{ id: string; label: string }>; models: Array<{ id: string; asin?: string }>; dates: string[] }): FeedView {
  const brandId = new Map(dims.brands.map((b) => [norm(b.label), b.id]));
  const modelOf = new Map(dims.models.flatMap((m) => (m.asin ? [[m.asin, m.id] as const] : [])));
  const first = dims.dates[0], last = dims.dates[dims.dates.length - 1];
  const products = Object.values(feed.products).map((p): FeedViewProduct => ({
    id: p.id, retailer: p.retailer, item: p.item, brand: brandId.get(norm(p.brand)) ?? null, brandLabel: p.brand,
    title: p.title, url: p.url, units: p.units, model: p.asin ? modelOf.get(p.asin) ?? null : null, match: p.match,
  }));
  const daily = Object.fromEntries(products.map((p) => {
    const inWindow = (feed.daily[p.id] ?? []).filter((d) => d.date >= first).map((d) => (d.date > last ? { ...d, date: last } : d));
    const byDay = new Map(inWindow.map((d) => [d.date, d]));
    return [p.id, [...byDay.values()]];
  }));
  return { label: feed.label, importedOn: feed.importedOn, sources: feed.sources, products, daily, reviewSummary: feed.reviewSummary, reviews: feed.reviews };
}
