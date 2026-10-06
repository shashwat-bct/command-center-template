import type { Provenance } from "./provenance";

type Cell = { value: number | null; prev: number | null; delta: number | null; deltaPct: number | null; rank: number | null; tied: boolean; of: number };
type MetricDef = { id: string; label: string; good: "up" | "down" | "neutral"; unit?: string };
type Read = { tone: "good" | "watch" | "risk"; text: string };

export type LaneStatus = { status: "measured" | "mixed" | "modelled"; note: string; label?: string; sources?: string[] };

export type MeasuredExtras = {
  aiShares: Record<string, number>;
  aiStageShares: Record<string, Record<string, number>>;
  aiEngineStageShares: Record<string, Record<string, Record<string, number>>>;
};

type Payload = {
  meta: { subject: string; subjectLabel?: string; provenance?: Provenance & { lanes?: Record<string, LaneStatus> } };
  dims: { brands: Array<{ id: string; label: string }>; metrics: MetricDef[]; dates: string[]; engines: Array<{ id: string; label: string }> };
  scorecard: Record<string, Record<string, Record<string, Cell>>>;
  trend: Record<string, Record<string, Array<number | null> | null>>;
  ai: { overall: Record<string, Array<number | null> | null>; byEngineStage: Record<string, Array<number | null>>; prompts?: unknown[] };
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
    for (const [slot, share] of Object.entries(shares)) {
      if (p.ai.overall[slot] === undefined) continue;
      p.ai.overall[slot] = Array(days).fill(share);
    }
    for (const key of Object.keys(p.ai.byEngineStage)) {
      const [engine, stage, b] = key.split("|");
      if (shares[b] == null) continue;
      p.ai.byEngineStage[key] = Array(days).fill(extras.aiEngineStageShares[engine]?.[stage]?.[b] ?? extras.aiStageShares[stage]?.[b] ?? shares[b]);
    }
    for (const cadence of Object.keys(p.scorecard)) {
      const cells = p.scorecard[cadence].aiSov;
      if (!cells) continue;
      for (const [b, v] of Object.entries(shares)) if (cells[b]) cells[b] = { ...cells[b], value: v, prev: v, delta: 0, deltaPct: 0 };
      rerank(cells, "up");
    }
    if (p.trend.aiSov) for (const [b, v] of Object.entries(shares)) if (p.trend.aiSov[b]) p.trend.aiSov[b] = Array(p.trend.aiSov[b]!.length).fill(v);
    p.reads.ai = aiReads(p, shares);
    p.reads.overview = [...p.reads.ai, ...(p.reads.overview ?? []).filter((r) => !/AI answer/i.test(r.text))];
  } else {
    p.ai.prompts = [];
  }

  p.meta.provenance = { ...prov, lanes: laneStatuses(prov) };
  return p;
}
