import type { Provenance } from "./provenance";
import { SCORECARD_METRICS } from "./provenance";
import type { AmazonSeries } from "./amazon-series";
import type { ShelfSnapshot } from "./amazon-shelf";

type Cell = { value: number | null; prev: number | null; delta: number | null; deltaPct: number | null; rank: number | null; tied: boolean; of: number };
type MetricDef = { id: string; label: string; good: "up" | "down" | "neutral"; unit?: string };
type Read = { tone: "good" | "watch" | "risk"; text: string };

export type LaneStatus = { status: "measured" | "snapshot" | "not_measured"; note: string; label?: string };

export type MeasuredExtras = {
  aiShares: Record<string, number>;
  aiStageShares: Record<string, Record<string, number>>;
  series: AmazonSeries;
  shelf: ShelfSnapshot | null;
};

type Payload = {
  meta: { subject: string; subjectLabel?: string; provenance?: Provenance & { lanes?: Record<string, LaneStatus> } };
  dims: { brands: Array<{ id: string; label: string }>; metrics: MetricDef[]; dates: string[]; models: Array<{ id: string; brand: string; label: string; asin?: string }>; stages: Array<{ id: string }>; engines: unknown[]; aspects?: unknown[] };
  scorecard: Record<string, Record<string, Record<string, Cell>>>;
  trend: Record<string, Record<string, Array<number | null> | null>>;
  ai: { overall: Record<string, Array<number | null> | null>; byEngineStage: Record<string, Array<number | null>>; prompts?: unknown[] };
  voice: { rating: Record<string, Array<number | null> | null>; velocity: Record<string, Array<number | null> | null>; aspects?: Record<string, unknown>; aspectMeasured?: Record<string, unknown>; aspectMonths?: unknown[] };
  traffic: Record<string, unknown>;
  shelf: Record<string, unknown>;
  demand?: { rankCategory: string | null; rankCategoryName: string | null; listings: Record<string, { monthlySold: Array<number | null>; rank: Array<number | null> }> };
  effectivePrice?: { listings: Record<string, { effective: Array<number | null>; couponOff: Array<number | null>; deal: Array<0 | 1 | null>; list: Array<number | null> }> };
  tco: unknown[];
  delivery: { weekly: Record<string, Array<number | null>> };
  pricing: { mapBreaches: unknown[]; mapFloorPct: unknown; price: Record<string, Array<number | null>> };
  availability: { episodes: Array<{ brand: string; days: number }> };
  promotions: { events: Array<{ brand: string; alwaysOn: boolean; depthPct: number; days: number }> };
  reads: Record<string, Read[]>;
};

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

const emptyCell = (of: number): Cell => ({ value: null, prev: null, delta: null, deltaPct: null, rank: null, tied: false, of });

export function laneStatuses(p: Provenance): Record<string, LaneStatus> {
  const anyMeasured = (metric: string) => Object.values(p.metrics[metric] ?? {}).some((k) => k === "measured");
  const amazon = anyMeasured("priceIndex");
  const nm = (note: string): LaneStatus => ({ status: "not_measured", note });
  return {
    traffic: p.applied.demand.length
      ? { status: "measured", label: "Amazon Demand", note: "Website visits are not measured. This page shows Amazon demand instead: \"bought in past month\" and daily category sales rank, from Keepa." }
      : nm("No website-traffic source is connected. A SimilarWeb key would provide monthly visit levels."),
    shelf: p.applied.shelf.length
      ? { status: "snapshot", note: `First ${p.record.shelf?.depth ?? 0} organic Amazon results for "${p.record.shelf?.term ?? ""}" on the build date, via Apify. Sponsored placements are not identified.` }
      : nm("Amazon search results were not read for this build."),
    tco: p.applied.effectivePrice.length
      ? { status: "measured", label: "Effective Price", note: "What a shopper pays on Amazon after lightning deals and clip coupons, daily from Keepa. Protection plans, card offers and their take-up rates are not measured." }
      : nm("Effective price needs Amazon price history, which was not read for this build."),
    ai: anyMeasured("aiSov") ? { status: "snapshot", note: "One Claude reading per build; the lines are flat because there is no history between readings." } : nm("Claude's answers were not read on this build — see the build log for why."),
    voice: anyMeasured("rating") ? { status: "measured", note: "Daily Amazon rating and review counts from Keepa. Review aspects are not measured." } : nm("No Amazon listings were found for these brands."),
    landing: anyMeasured("pdpScore") ? { status: "snapshot", note: "Product-page content read once per build from Amazon via Apify." } : nm("Product pages were not read for this build."),
    delivery: anyMeasured("leadTime") ? { status: "snapshot", note: "The delivery date Amazon promised on the day of the build, via Apify. Earlier weeks are blank." } : nm("Delivery promises were not read for this build."),
    carriage: amazon ? { status: "measured", note: "Amazon only. Listing dates and seller counts from Keepa; buy box is Amazon or the brand's own store holding it." } : nm("No Amazon listings were found."),
    stock: amazon ? { status: "measured", note: "Amazon only, daily from Keepa." } : nm("No Amazon listings were found."),
    pricing: amazon ? { status: "measured", note: "Amazon only, daily from Keepa." } : nm("No Amazon listings were found."),
    promotions: amazon ? { status: "measured", note: "Amazon price cuts detected from Keepa's daily prices. Coupons, bundles and other mechanics are not measured." } : nm("No Amazon listings were found."),
    calendar: amazon ? { status: "measured", note: "Amazon price cuts detected from Keepa's daily prices." } : nm("No Amazon listings were found."),
    strategy: amazon ? { status: "measured", note: "Computed from the Amazon price cuts above." } : nm("No Amazon listings were found."),
  };
}

function factualReads(p: Payload, prov: Provenance): Record<string, Read[]> {
  const S = p.meta.subject, name = p.meta.subjectLabel ?? S;
  const brands = brandsOf(p);
  const q = p.scorecard.qbr;
  const label = (b: string) => p.dims.brands.find((x) => x.id === b)?.label ?? b;
  const def = (m: string) => p.dims.metrics.find((x) => x.id === m);
  const tone = (c: Cell): Read["tone"] => (c.rank === 1 ? "good" : c.rank != null && c.rank === c.of ? "risk" : "watch");
  const line = (m: string, fmt: (v: number) => string, what: string): Read | null => {
    const c = q[m]?.[S];
    if (!c || c.value == null || prov.metrics[m]?.[S] !== "measured") return null;
    const leaders = Object.entries(q[m]).filter(([b, x]) => x.rank === 1 && b !== S).map(([b]) => label(b));
    const leadNote = c.rank !== 1 && leaders.length ? `; ${leaders.join(" and ")} ${leaders.length > 1 ? "rank" : "ranks"} first` : "";
    const dir = def(m)?.good === "down" ? ", lower is better" : "";
    const ranking = c.rank == null ? "" : `, ranked ${c.rank} of ${c.of} brand${c.of === 1 ? "" : "s"} measured${dir}${leadNote}`;
    return { tone: c.rank == null ? "watch" : tone(c), text: `${name}'s ${what} is ${fmt(c.value)}${ranking}.` };
  };
  const pct = (v: number) => `${round1(v)}%`;
  const out: Record<string, Read[]> = {};
  const add = (key: string, r: Read | null) => { if (r) (out[key] ??= []).push(r); };

  add("overview", line("aiSov", pct, "share of Claude's answers"));
  add("overview", line("rating", (v) => `${v.toFixed(2)}★`, "average Amazon rating"));
  add("overview", line("priceIndex", pct, "average Amazon price as a share of list price"));
  add("overview", line("inStock", pct, "Amazon in-stock rate"));
  add("ai", line("aiSov", pct, "share of Claude's answers"));
  add("voice", line("rating", (v) => `${v.toFixed(2)}★`, "average Amazon rating"));
  add("availability", line("inStock", pct, "Amazon in-stock rate"));
  add("pricing", line("priceIndex", pct, "average Amazon price as a share of list price"));
  add("promotions", line("promoIntensity", pct, "share of listing-days with an Amazon price cut"));
  add("promotions", line("promoDepth", pct, "average Amazon price-cut depth"));
  add("distribution", line("carriage", pct, "share of days its tracked listings were live on Amazon"));
  add("delivery", line("leadTime", (v) => `${round1(v)} days`, "promised Amazon delivery time on the build date"));
  add("overview", line("shelfSov", pct, `share of the first Amazon search results for "${prov.record.shelf?.term ?? ""}"`));
  add("shelf", line("shelfSov", pct, `share of the first ${prov.record.shelf?.depth ?? 0} organic Amazon results for "${prov.record.shelf?.term ?? ""}"`));
  const first = prov.record.shelf?.firstPosition[S];
  if (prov.record.shelf) add("shelf", { tone: first == null ? "risk" : first <= 10 ? "good" : "watch", text: first == null
    ? `None of ${name}'s listings appear in the first ${prov.record.shelf.depth} organic Amazon results for "${prov.record.shelf.term}".`
    : `${name}'s best organic position for "${prov.record.shelf.term}" is #${first}.` });

  const eps = p.availability.episodes.filter((e) => e.brand === S);
  if (prov.metrics.inStock?.[S] === "measured") {
    add("availability", { tone: eps.length ? "watch" : "good", text: eps.length
      ? `${eps.length} out-of-stock spell${eps.length === 1 ? "" : "s"} on ${name}'s Amazon listings cost ${eps.reduce((a, e) => a + e.days, 0)} listing-days in the window.`
      : `${name}'s tracked Amazon listings were never out of stock in the window.` });
  }
  const cuts = p.promotions.events.filter((e) => e.brand === S && !e.alwaysOn);
  if (prov.metrics.promoIntensity?.[S] === "measured") {
    add("promotions", { tone: "watch", text: cuts.length
      ? `${cuts.length} Amazon price cut${cuts.length === 1 ? "" : "s"} on ${name}'s listings, deepest ${round1(Math.max(...cuts.map((e) => e.depthPct)))}%, lasting ${round1(cuts.reduce((a, e) => a + e.days, 0) / cuts.length)} days on average.`
      : `No Amazon price cuts on ${name}'s listings in the window.` });
  }
  const modelsOf = (b: string) => p.dims.models.filter((m) => m.brand === b).map((m) => m.id);
  const latest = (arr: Array<number | null>) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  const meanOf = (arr: Array<number | null>) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  if (p.demand) {
    const soldBy = (b: string) => modelsOf(b).reduce((n, id) => n + (latest(p.demand!.listings[id]?.monthlySold ?? []) ?? 0), 0);
    const total = brands.reduce((n, b) => n + soldBy(b), 0);
    const mine = soldBy(S);
    if (total) add("demand", { tone: "watch", text: `${name}'s tracked Amazon listings show at least ${mine.toLocaleString("en-US")} bought in the past month — ${round1((mine / total) * 100)}% of the ${total.toLocaleString("en-US")} across all tracked listings (Amazon's "bought in past month" is a floor, e.g. 1K+).` });
  }
  if (p.effectivePrice) {
    const ids = modelsOf(S).filter((id) => p.effectivePrice!.listings[id]);
    const eff = meanOf(ids.flatMap((id) => p.effectivePrice!.listings[id].effective));
    const shelf = meanOf(ids.flatMap((id) => p.pricing.price[`${id}|amazon`] ?? []));
    const couponDays = ids.reduce((n, id) => n + p.effectivePrice!.listings[id].couponOff.filter((v) => (v ?? 0) > 0).length, 0);
    const dealDays = ids.reduce((n, id) => n + p.effectivePrice!.listings[id].deal.filter((v) => v === 1).length, 0);
    if (eff != null && shelf != null) add("tco", { tone: "watch", text: `${name}'s listings averaged $${eff.toFixed(2)} at checkout against a $${shelf.toFixed(2)} Amazon price; clip coupons ran on ${couponDays} listing-days and lightning deals on ${dealDays}.` });
  }
  return out;
}

const brandsOf = (p: Payload): string[] => p.dims.brands.map((b) => b.id);

/**
 * Removes everything on a relabelled payload that was not measured for this
 * build: unmeasured scorecard cells and trends are blanked and re-ranked, the
 * traffic/shelf/TCO lanes are emptied, AI share is set to the single reading,
 * and the builder's narrative is replaced by statements of measured fact.
 */
export function keepMeasuredOnly(payload: unknown, prov: Provenance, extras: MeasuredExtras): unknown {
  const p = payload as Payload;
  const aiShareBySlot = extras.aiShares, aiStageShareBySlot = extras.aiStageShares;
  const snapshots: Record<string, Record<string, number>> = { aiSov: aiShareBySlot, ...(extras.shelf ? { shelfSov: extras.shelf.share } : {}) };
  const brands = p.dims.brands.map((b) => b.id);
  const days = p.dims.dates.length;

  if (!Object.keys(aiShareBySlot).length) {
    p.ai = { overall: Object.fromEntries(brands.map((b) => [b, null])), byEngineStage: {}, prompts: [] };
    p.dims.engines = [];
  }
  for (const [slot, share] of Object.entries(aiShareBySlot)) {
    if (!p.ai.overall[slot]) continue;
    p.ai.overall[slot] = Array(days).fill(share);
    for (const key of Object.keys(p.ai.byEngineStage)) {
      const [, stage, b] = key.split("|");
      if (b === slot) p.ai.byEngineStage[key] = Array(days).fill(aiStageShareBySlot[stage]?.[slot] ?? share);
    }
  }

  for (const cadence of Object.keys(p.scorecard)) {
    for (const m of SCORECARD_METRICS) {
      const cells = p.scorecard[cadence][m];
      if (!cells) continue;
      for (const b of brands) {
        if (prov.metrics[m]?.[b] !== "measured") cells[b] = emptyCell(brands.length);
      }
      for (const b of brands) {
        const v = snapshots[m]?.[b];
        if (v != null && prov.metrics[m]?.[b] === "measured") cells[b] = { ...cells[b], value: v, prev: null, delta: null, deltaPct: null };
      }
      rerank(cells, p.dims.metrics.find((x) => x.id === m)?.good ?? "up");
    }
  }
  for (const m of SCORECARD_METRICS) {
    if (!p.trend[m]) continue;
    for (const b of brands) {
      if (prov.metrics[m]?.[b] !== "measured") p.trend[m][b] = Array((p.trend[m][b] ?? []).length || 13).fill(null);
      else if (snapshots[m]?.[b] != null) p.trend[m][b] = Array((p.trend[m][b] ?? []).length || 13).fill(snapshots[m][b]);
    }
  }

  p.voice.aspects = Object.fromEntries(brands.map((b) => [b, null]));
  p.voice.aspectMeasured = Object.fromEntries(brands.map((b) => [b, null]));
  p.voice.aspectMonths = [];
  p.dims.aspects = [];
  for (const b of brands) {
    if (prov.metrics.rating?.[b] !== "measured") {
      p.voice.rating[b] = null;
      p.voice.velocity[b] = null;
    }
  }

  p.traffic = { withheld: true };
  p.shelf = extras.shelf ? { measured: extras.shelf } : { withheld: true };
  p.tco = [];
  const listingByAsin = new Map(Object.values(extras.series.listings).flat().map((l) => [l.asin, l]));
  const byModel = <T>(pick: (l: AmazonSeries["listings"][string][number]) => T) =>
    Object.fromEntries(p.dims.models.flatMap((m) => { const l = m.asin ? listingByAsin.get(m.asin) : undefined; return l ? [[m.id, pick(l)]] : []; }));
  if (prov.applied.demand.length) p.demand = { rankCategory: extras.series.rankCategory, rankCategoryName: extras.series.rankCategoryName, listings: byModel((l) => ({ monthlySold: l.monthlySold, rank: l.rank })) };
  if (prov.applied.effectivePrice.length) p.effectivePrice = { listings: byModel((l) => ({ effective: l.effective, couponOff: l.couponOff, deal: l.deal, list: l.list })) };
  p.pricing.mapBreaches = [];
  p.pricing.mapFloorPct = null;
  p.reads = factualReads(p, prov);
  p.meta.provenance = { ...prov, lanes: laneStatuses(prov) };
  return p;
}
