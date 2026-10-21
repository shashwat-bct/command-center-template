import type { FeedDay, FeedProduct, RetailFeed } from "../../lib/retail-feed";

export type PayloadBrand = { id: string; label: string; color: string; subject?: boolean };
export type PayloadModel = { id: string; brand: string; label: string; msrp: number; asin?: string };
export type AspectCount = { positive: number; negative: number; byRetailer?: Record<string, { positive: number; negative: number }> };
export type AiPrompt = { id: string; stage: string; q: string; present: Record<string, boolean>; rank: Record<string, number | null>; topBrand: string | null };
export type PromoEvent = { brand: string; model: string; retailer: string; start: string; end: string; days: number; depthPct: number; type: string; measured?: boolean };
export type Episode = { model: string; brand: string; retailer: string; start: string; days: number; measured?: boolean };

export type Payload = {
  meta: { subject: string; subjectLabel: string; window: { start: string; end: string } };
  dims: { brands: PayloadBrand[]; models: PayloadModel[]; dates: string[]; events: Array<{ id: string; label: string; start: string; end: string }> };
  pricing: { price: Record<string, Array<number | null>> };
  availability: { stock: Record<string, Array<0 | 1 | null>>; episodes: Episode[] };
  distribution: { carriage: Record<string, Array<0 | 1>> };
  promotions: { events: PromoEvent[] };
  scorecard: Record<string, Record<string, Record<string, { value: number | null; rank?: number; of?: number }>>>;
  voice: { aspectCounts: Record<string, Record<string, AspectCount>> };
  ai: { history: Array<{ date: string; overall: Record<string, number>; byEngineStage: Record<string, number> }>; prompts: AiPrompt[] };
};

export type Ctx = { feed: RetailFeed; payload: Payload; subject: PayloadBrand; brands: PayloadBrand[] };

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The payload brand a feed product belongs to: its matched listing's brand, else the
 * brand whose name its own brand field carries.
 */
export function brandOf(ctx: Ctx, p: FeedProduct): PayloadBrand | null {
  const model = p.asin ? ctx.payload.dims.models.find((m) => m.asin === p.asin) : null;
  if (model) return ctx.brands.find((b) => b.id === model.brand) ?? null;
  const own = norm(p.brand ?? "");
  return ctx.brands.find((b) => own.includes(norm(b.label)) || norm(b.label).includes(own)) ?? null;
}

export const daysOf = (ctx: Ctx, p: FeedProduct, from: string, to: string): FeedDay[] =>
  (ctx.feed.daily[p.id] ?? []).filter((d) => d.date >= from && d.date <= to);

export const per100 = (p: FeedProduct, price: number | null): number | null => (price != null && p.units ? (price / p.units) * 100 : null);

export const mean = (v: Array<number | null | undefined>): number | null => {
  const x = v.filter((n): n is number => n != null && Number.isFinite(n));
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
};

export const median = (v: Array<number | null | undefined>): number | null => {
  const x = v.filter((n): n is number => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!x.length) return null;
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
};

export const r1 = (v: number): number => Math.round(v * 10) / 10;
export const r2 = (v: number): number => Math.round(v * 100) / 100;
export const usd = (v: number | null): string => (v == null ? "—" : `$${v.toFixed(2)}`);
export const pct = (v: number | null, d = 1): string => (v == null ? "—" : `${v.toFixed(d)}%`);
export const signed = (v: number | null, d = 1): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

export const niceDate = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * A short label for a feed product: its pack and the scent or line its title names.
 */
export function productLabel(p: FeedProduct): string {
  const line = /(Mint Chill|Shea BUTTer|Shea-Coco|Botanical Bliss|Rosewater|Lavender|Fresh Care|Gentle Plus|Ultra Fresh|Freshmates|Unscented)/i.exec(p.title)?.[1];
  return `${line ?? "Flushable Wipes"}${p.units ? ` · ${p.units} ct` : ""}`;
}

/**
 * The last reading on or before each date, carried forward, for a brand's daily median
 * price per 100 wipes across its feed products.
 */
export function brandDailyPer100(ctx: Ctx, brand: PayloadBrand, dates: string[]): Array<number | null> {
  const products = Object.values(ctx.feed.products).filter((p) => brandOf(ctx, p)?.id === brand.id && p.units);
  const carried = products.map((p) => {
    const days = ctx.feed.daily[p.id] ?? [];
    let k = 0, last: number | null = null, lastOn = "";
    return dates.map((d) => {
      while (k < days.length && days[k].date <= d) { if (days[k].price != null) { last = per100(p, days[k].price); lastOn = days[k].date; } k++; }
      return last != null && (Date.parse(d) - Date.parse(lastOn)) / 86_400_000 <= 21 ? last : null;
    });
  });
  return dates.map((_, i) => { const m = median(carried.map((c) => c[i])); return m == null ? null : r2(m); });
}
