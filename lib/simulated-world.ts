export type RetailEvent = { id: string; label: string; start: string; end: string; lift: number; kind: "retail" | "platform" | "season" };

const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m, d);

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(utc(year, month, 1)).getUTCDay();
  return utc(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = utc(year, month + 1, 0);
  return last - ((new Date(last).getUTCDay() - weekday + 7) % 7) * DAY;
}

function eventsForYear(y: number): RetailEvent[] {
  const ev = (id: string, label: string, from: number, to: number, lift: number, kind: RetailEvent["kind"]): RetailEvent =>
    ({ id, label, start: iso(from), end: iso(to), lift, kind });
  const presidents = nthWeekday(y, 1, 1, 3), memorial = lastWeekday(y, 4, 1), fathers = nthWeekday(y, 5, 0, 3);
  const primeday = nthWeekday(y, 6, 2, 2), labor = nthWeekday(y, 8, 1, 1), bigDeal = nthWeekday(y, 9, 2, 2);
  const thanksgiving = nthWeekday(y, 10, 4, 4);
  return [
    ev("presidents", "Presidents' Day", presidents - 2 * DAY, presidents, 1.12, "retail"),
    ev("memorial", "Memorial Day", memorial - 2 * DAY, memorial, 1.34, "retail"),
    ev("fathers", "Father's Day", fathers - 7 * DAY, fathers, 1.22, "retail"),
    ev("july4", "July 4th", utc(y, 6, 2), utc(y, 6, 6), 1.28, "retail"),
    ev("primeday", "Prime Day", primeday, primeday + DAY, 1.95, "platform"),
    ev("b2s", "Back to school", utc(y, 7, 1), utc(y, 7, 21), 1.15, "season"),
    ev("labor", "Labor Day", labor - 3 * DAY, labor, 1.25, "retail"),
    ev("bigdeal", "Prime Big Deal Days", bigDeal, bigDeal + DAY, 1.6, "platform"),
    ev("bfcm", "Black Friday – Cyber Monday", thanksgiving + DAY, thanksgiving + 4 * DAY, 2.1, "retail"),
    ev("holiday", "Holiday gifting", utc(y, 11, 5), utc(y, 11, 22), 1.3, "season"),
  ];
}

/**
 * US retail-calendar events that overlap the 91-day window ending on
 * `windowEnd`, with the demand lift the builder applies on those days.
 */
export function retailEventsFor(windowEnd: string): RetailEvent[] {
  const end = Date.parse(`${windowEnd}T00:00:00Z`), start = end - 90 * DAY;
  const y = new Date(end).getUTCFullYear();
  return [...eventsForYear(y - 1), ...eventsForYear(y)]
    .filter((e) => Date.parse(`${e.end}T00:00:00Z`) >= start && Date.parse(`${e.start}T00:00:00Z`) <= end)
    .map((e) => ({ ...e, start: iso(Math.max(start, Date.parse(`${e.start}T00:00:00Z`))), end: iso(Math.min(end, Date.parse(`${e.end}T00:00:00Z`))) }));
}

/**
 * A deterministic random source seeded by a string, so a brand's simulated
 * figures are the same on every rebuild and differ between brands.
 */
export function seededRandom(seed: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) { a ^= seed.charCodeAt(i); a = Math.imul(a, 16777619); }
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export type AspectBlock = {
  aspects: string[];
  months: string[];
  source: string;
  byBrand: Record<string, { label: string; basis: "real"; aspects: Record<string, { byMonth: Record<string, number> }> }>;
};

/**
 * Monthly review-theme scores for every brand slot over the twelve months to
 * the window end: each brand's level follows its rating, each theme has its
 * own offset, and months move by a small random walk.
 */
export function simulatedAspects(input: { aspects: string[]; windowEnd: string; brands: Array<{ slot: string; label: string; rating: number | null }>; seed: string }): AspectBlock {
  const rnd = seededRandom(`${input.seed}:aspects`);
  const end = new Date(`${input.windowEnd}T00:00:00Z`);
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7));
  const byBrand: AspectBlock["byBrand"] = {};
  for (const b of input.brands) {
    const level = clamp(62 + ((b.rating ?? 4.3) - 4.2) * 32 + (rnd() * 2 - 1) * 6, 42, 90);
    const aspects: AspectBlock["byBrand"][string]["aspects"] = {};
    for (const a of input.aspects) {
      let v = clamp(level + (rnd() * 2 - 1) * 14, 30, 95);
      const byMonth: Record<string, number> = {};
      for (const m of months) { v = clamp(v + (rnd() * 2 - 1) * 4, 28, 96); byMonth[m] = Math.round(v); }
      aspects[a] = { byMonth };
    }
    byBrand[b.slot] = { label: b.label, basis: "real", aspects };
  }
  return { aspects: input.aspects, months, source: "modelled", byBrand };
}

/**
 * Builder source for the per-brand variation applied on top of the reference
 * configuration: every behavioural parameter is perturbed by a generator
 * seeded with the brand, and channel and retailer mixes stay normalised.
 */
export const WORLD_VARIATION_SOURCE = `
const rnd = (() => { let a = 2166136261; for (let i = 0; i < overlay.seed.length; i++) { a ^= overlay.seed.charCodeAt(i); a = Math.imul(a, 16777619); }
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const jit = (v, spread, lo = -Infinity, hi = Infinity) => clamp(v * (1 + (rnd() * 2 - 1) * spread), lo, hi);
const each = (m, f) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, f(v, k)]));
const norm = (m) => { const s = Object.values(m).reduce((a, b) => a + b, 0) || 1; return each(m, (v) => v / s); };
const retailerWeights = norm(Object.fromEntries(base.RETAILERS.map((r) => [r.id, jit(r.weight, 0.3, 0.02)])));
const variation = {
  RETAILERS: base.RETAILERS.map((r) => ({ ...r, weight: Math.round(retailerWeights[r.id] * 100) / 100 })),
  PROMO_APPETITE: each(base.PROMO_APPETITE, (v) => jit(v, 0.45, 0.05, 0.97)),
  TRAFFIC_BASE: each(base.TRAFFIC_BASE, (v) => Math.round(jit(v, 0.5, 4000))),
  TRAFFIC_TREND: each(base.TRAFFIC_TREND, (v) => v + (rnd() * 2 - 1) * 0.05),
  CHANNEL_MIX: each(base.CHANNEL_MIX, (m) => norm(each(m, (v) => jit(v, 0.35, 0.005)))),
  BASE_CARRIAGE: each(base.BASE_CARRIAGE, (m) => each(m, (v, rt) => (rt === "amazon" ? 1 : clamp(jit(v, 0.3), 0.15, 1)))),
  RETAILER_MECHANICS: each(base.RETAILER_MECHANICS, (m) => each(m, (v) => Math.max(1, Math.round(jit(v, 0.5))))),
  PRICE_FLOOR_PCT: each(base.PRICE_FLOOR_PCT, (v) => jit(v, 0.05, 0.55, 0.99)),
  PRICE_DRIFT: each(base.PRICE_DRIFT, (v) => jit(v, 0.4, 0.002, 0.06)),
  SPONSORED_BASE: each(base.SPONSORED_BASE, (v) => jit(v, 0.45, 2, 60)),
  PDP_BRAND_LIFT: each(base.PDP_BRAND_LIFT, (v) => jit(v, 0.06, 0.6, 1)),
  REVIEW_VELOCITY: each(base.REVIEW_VELOCITY, (v) => Math.round(jit(v, 0.5, 3))),
  mapFloorPct: each(base.mapFloorPct, (v) => jit(v, 0.05, 0.5, 0.98)),
  SHELF_RETAILER_BIAS: Object.fromEntries(base.RETAILERS.map((r) => [r.id, Object.fromEntries(base.BRANDS.map((b) => [b.id, r.id === "amazon" ? 1 : jit(1, 0.45, 0.3, 1.8)]))])),
  RATING_DRIFT: {},
  TERM_BIAS: {},
  PAID_PUSH: {},
};
`;
