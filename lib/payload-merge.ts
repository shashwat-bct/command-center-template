import type { ReviewAspect, ReviewQuote } from "./apify";
import type { Provenance } from "./provenance";

type Cell = { value: number | null; prev: number | null; delta: number | null; deltaPct: number | null; rank: number | null; tied: boolean; of: number };
type MetricDef = { id: string; label: string; good: "up" | "down" | "neutral"; unit?: string };
type Read = { tone: "good" | "watch" | "risk"; text: string };

export type LaneStatus = { status: "measured" | "mixed" | "modelled"; note: string; label?: string; sources?: string[] };

export type MeasuredExtras = {
  reviewAspects?: Record<string, ReviewAspect[]>;
  aiShares: Record<string, number>;
  aiStageShares: Record<string, Record<string, number>>;
  aiEngineStageShares: Record<string, Record<string, Record<string, number>>>;
};

export type MergePayload = Payload;

type Payload = {
  meta: { subject: string; subjectLabel?: string; provenance?: Provenance & { lanes?: Record<string, LaneStatus> } };
  dims: { brands: Array<{ id: string; label: string }>; metrics: MetricDef[]; dates: string[]; engines: Array<{ id: string; label: string }> };
  scorecard: Record<string, Record<string, Record<string, Cell>>>;
  trend: Record<string, Record<string, Array<number | null> | null>>;
  ai: { overall: Record<string, Array<number | null> | null>; byEngineStage: Record<string, Array<number | null>>; prompts?: unknown[] };
  reads: Record<string, Read[]>;
  voice?: Record<string, unknown>;
};

type ListingTally = { asin: string; positive: number; negative: number; summary: string | null; quotes: ReviewQuote[] };
type AspectTally = { name: string; positive: number; negative: number; quotes: ReviewQuote[]; listings: ListingTally[] };

const VOICE_MEASURED_NOTE = "Amazon rating and review counts are read daily from Keepa; aspect scores are the share of positive mentions in Amazon's review summaries.";
const MIN_ASPECT_MENTIONS = 4;
const MAX_ASPECTS = 6;

export function applyReviewAspects(p: Payload, byBrand: Record<string, ReviewAspect[]>): boolean {
  const tallies: Record<string, Record<string, AspectTally>> = {};
  for (const [brand, list] of Object.entries(byBrand)) {
    const t: Record<string, AspectTally> = {};
    for (const a of list) {
      const key = a.name.trim().toLowerCase();
      const cur = (t[key] ||= { name: a.name.trim(), positive: 0, negative: 0, quotes: [], listings: [] });
      cur.positive += a.positive;
      cur.negative += a.negative;
      for (const q of a.quotes ?? []) if (cur.quotes.length < 3 && !cur.quotes.some((x) => x.text === q.text)) cur.quotes.push(q);
      if (a.asin) cur.listings.push({ asin: a.asin, positive: a.positive, negative: a.negative, summary: a.summary ?? null, quotes: (a.quotes ?? []).slice(0, 4) });
    }
    tallies[brand] = t;
  }
  const keys = [...new Set(Object.values(tallies).flatMap((t) => Object.keys(t)))];
  const rank = keys.map((k) => {
    const scored = Object.values(tallies).filter((t) => t[k] && t[k].positive + t[k].negative >= MIN_ASPECT_MENTIONS).length;
    const mentions = Object.values(tallies).reduce((n, t) => n + (t[k] ? t[k].positive + t[k].negative : 0), 0);
    return { k, scored, mentions };
  }).filter((r) => r.scored > 0).sort((a, b) => b.scored - a.scored || b.mentions - a.mentions).slice(0, MAX_ASPECTS);
  if (!rank.length) return false;
  const dims = p.dims as Payload["dims"] & { aspects?: string[]; aspectMonths?: string[] };
  const months = dims.aspectMonths && dims.aspectMonths.length ? dims.aspectMonths : [p.dims.dates[p.dims.dates.length - 1].slice(0, 7)];
  const label = (k: string) => Object.values(tallies).find((t) => t[k])![k].name;
  dims.aspects = rank.map((r) => label(r.k));
  dims.aspectMonths = months;
  const last = months.length - 1;
  const aspects: Record<string, Record<string, Array<number | null>>> = {};
  const measured: Record<string, Record<string, boolean[]>> = {};
  const counts: Record<string, Record<string, { positive: number; negative: number; quotes: ReviewQuote[]; listings: ListingTally[] }>> = {};
  for (const b of p.dims.brands) {
    const t = tallies[b.id];
    if (!t) continue;
    const row: Record<string, Array<number | null>> = {};
    const flags: Record<string, boolean[]> = {};
    const cnt: Record<string, { positive: number; negative: number; quotes: ReviewQuote[]; listings: ListingTally[] }> = {};
    for (const r of rank) {
      const a = t[r.k];
      const n = a ? a.positive + a.negative : 0;
      const series: Array<number | null> = months.map(() => null);
      if (a && n >= MIN_ASPECT_MENTIONS) series[last] = Math.round((a.positive / n) * 100);
      row[label(r.k)] = series;
      flags[label(r.k)] = months.map((_, i) => i === last && series[last] != null);
      if (a) cnt[label(r.k)] = { positive: a.positive, negative: a.negative, quotes: a.quotes, listings: a.listings };
    }
    if (Object.values(row).some((s) => s[last] != null)) { aspects[b.id] = row; measured[b.id] = flags; counts[b.id] = cnt; }
  }
  if (!Object.keys(aspects).length) return false;
  p.voice = { ...(p.voice ?? {}), aspects, aspectMeasured: measured, aspectCounts: counts, aspectSource: "amazon-review-summary" };
  const lanes = p.meta.provenance && p.meta.provenance.lanes;
  if (lanes && lanes.voice) lanes.voice = { ...lanes.voice, status: "measured", note: VOICE_MEASURED_NOTE };
  return true;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function rerank(cells: Record<string, Cell>, good: MetricDef["good"]): void {
  const present = Object.entries(cells).filter(([, c]) => c.value != null) as Array<[string, Cell & { value: number }]>;
  const sorted = [...present].sort((a, b) => (good === "down" ? a[1].value - b[1].value : b[1].value - a[1].value));
  for (const c of Object.values(cells)) {
    c.of = present.length;
    if (c.value == null || good === "neutral") { c.rank = null; c.tied = false; continue; }
    c.rank = sorted.findIndex(([, x]) => x.value === c.value) + 1;
    c.tied = sorted.filter(([, x]) => x.value === c.value).length > 1;
  }
}

/**
 * Which lanes of a build are measured, which mix measured Amazon data with
 * modelled retailers, and which are modelled outright.
 */
export function laneStatuses(p: Provenance): Record<string, LaneStatus> {
  const anyMeasured = (metric: string) => Object.values(p.metrics[metric] ?? {}).some((k) => k === "measured");
  const amazon = anyMeasured("priceIndex");
  const engines = p.record.ai?.engines.map((e) => e.label) ?? [];
  const keepa = "Keepa · Amazon daily history";
  const modelled = (note: string): LaneStatus => ({ status: "modelled", note, sources: [] });
  const amazonMixed = (what: string): LaneStatus => amazon
    ? { status: "mixed", note: `Amazon ${what} is read daily from Keepa; the other retailers are modelled around it.`, sources: [keepa] }
    : modelled(`No Amazon listings were found, so ${what} is modelled for every retailer.`);
  return {
    scorecard: { status: "mixed", note: "Each cell is marked: real where a source read it on this build, synthetic where it is modelled.", sources: [...(engines.length ? [`${engines.join(", ")} answers`] : []), ...(amazon ? [keepa] : []), ...(p.applied.pdp.length ? ["Apify · Amazon product pages"] : []), ...(p.applied.shelf.length ? ["Apify · Amazon search"] : [])] },
    ai: anyMeasured("aiSov")
      ? { status: "measured", note: `Answers from ${engines.join(", ")} to the same shopper questions, read on the build date. One reading per build, so the lines are flat.`, sources: engines.map((e) => `${e} answers`) }
      : modelled("No AI engine answered on this build, so AI share is modelled."),
    traffic: modelled("Website traffic, channels, engagement and product-page visits are modelled."),
    voice: anyMeasured("rating")
      ? { status: "mixed", note: "Amazon rating and review counts are read daily from Keepa; review themes are modelled.", sources: [keepa] }
      : modelled("Ratings and review themes are modelled."),
    shelf: p.applied.shelf.length
      ? { status: "mixed", note: `Amazon's organic results for "${p.record.shelf?.term ?? ""}" were read on the build date and anchor the Amazon shelf; other retailers, terms and the daily movement are modelled.`, sources: ["Apify · Amazon search results"] }
      : modelled("Shelf share is modelled."),
    landing: anyMeasured("pdpScore")
      ? { status: "mixed", note: "Amazon product pages were read on the build date; other retailers' pages are modelled.", sources: ["Apify · Amazon product pages"] }
      : modelled("Product-page scores are modelled."),
    carriage: amazonMixed("listing and buy-box history"),
    stock: amazonMixed("stock"),
    delivery: anyMeasured("leadTime")
      ? { status: "mixed", note: "Amazon's delivery promise was read on the build date; other retailers, cities and earlier weeks are modelled.", sources: ["Apify · Amazon delivery promise"] }
      : modelled("Delivery promises are modelled."),
    pricing: amazonMixed("pricing"),
    promotions: amazonMixed("price-cut history"),
    calendar: amazonMixed("price-cut history"),
    strategy: amazonMixed("price-cut history"),
    tco: modelled("Protection plans, financing, attach rates and who funds each offer are modelled."),
  };
}

function aiReads(p: Payload, shares: Record<string, number>): Read[] {
  const S = p.meta.subject, name = p.meta.subjectLabel ?? S;
  const label = (b: string) => p.dims.brands.find((x) => x.id === b)?.label ?? b;
  const ranked = Object.entries(shares).sort((a, z) => z[1] - a[1]);
  const mine = shares[S];
  if (mine == null || !ranked.length) return [];
  const rank = ranked.findIndex(([b]) => b === S) + 1;
  const leader = ranked[0][0] === S ? null : label(ranked[0][0]);
  const engines = p.dims.engines.map((e) => e.label).join(", ");
  return [{
    tone: rank === 1 ? "good" : rank === ranked.length ? "risk" : "watch",
    text: `${name} holds ${round1(mine)}% of brand mentions across ${engines}, ${rank === 1 ? "the most of the brands tracked" : `rank ${rank} of ${ranked.length}${leader ? `; ${leader} leads at ${round1(ranked[0][1])}%` : ""}`}.`,
  }];
}

/**
 * Lays this build's measurements over the builder's simulated market: AI share
 * becomes the engines' reading (flat across the window, per engine and stage),
 * everything the builder already anchored to Keepa and Apify stays, and every
 * other lane keeps its modelled values. Stamps lane statuses into provenance.
 */
export function mergeMeasured(payload: unknown, prov: Provenance, extras: MeasuredExtras): unknown {
  const p = payload as Payload;
  const days = p.dims.dates.length;
  const shares = extras.aiShares;

  if (Object.keys(shares).length) {
    for (const slot of Object.keys(p.ai.overall)) p.ai.overall[slot] = shares[slot] == null ? null : Array(days).fill(shares[slot]);
    for (const key of Object.keys(p.ai.byEngineStage)) {
      const [engine, stage, b] = key.split("|");
      if (shares[b] == null) { p.ai.byEngineStage[key] = Array(days).fill(null); continue; }
      p.ai.byEngineStage[key] = Array(days).fill(extras.aiEngineStageShares[engine]?.[stage]?.[b] ?? extras.aiStageShares[stage]?.[b] ?? shares[b]);
    }
    for (const cadence of Object.keys(p.scorecard)) {
      const cells = p.scorecard[cadence].aiSov;
      if (!cells) continue;
      for (const b of Object.keys(cells)) cells[b] = shares[b] == null ? { ...cells[b], value: null, prev: null, delta: null, deltaPct: null } : { ...cells[b], value: shares[b], prev: shares[b], delta: 0, deltaPct: 0 };
      rerank(cells, "up");
    }
    if (p.trend.aiSov) for (const b of Object.keys(p.trend.aiSov)) if (p.trend.aiSov[b]) p.trend.aiSov[b] = shares[b] == null ? null : Array(p.trend.aiSov[b]!.length).fill(shares[b]);
    p.reads.ai = aiReads(p, shares);
    p.reads.overview = [...p.reads.ai, ...(p.reads.overview ?? []).filter((r) => !/AI answer/i.test(r.text))];
  } else {
    p.ai.prompts = [];
  }

  const realAspects = extras.reviewAspects ? applyReviewAspects(p, extras.reviewAspects) : false;
  const lanes = laneStatuses(prov);
  if (realAspects && lanes.voice) lanes.voice = { ...lanes.voice, status: "measured", note: VOICE_MEASURED_NOTE };
  p.meta.provenance = { ...prov, lanes };
  return p;
}
