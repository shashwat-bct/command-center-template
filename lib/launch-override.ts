import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KeepaBrandAggregate } from "./keepa";
import { brandAliases, type AiSoMResult, type EngineSoM } from "./ai-visibility";
import { buildAmazonSeries, windowEndFor, type AmazonSeries } from "./amazon-series";
import type { AmazonProduct, SearchResult } from "./apify";
import { shelfSnapshot, type ShelfSnapshot } from "./amazon-shelf";
import { WORLD_VARIATION_SOURCE, retailEventsFor, seededRandom, simulatedAspects } from "./simulated-world";

export const SUBJECT_SLOT = "sonos";
export const COMPETITOR_SLOTS = ["amazon", "apple", "bose", "jbl"] as const;
export const MODEL_SLOTS_PER_BRAND: Record<string, number> = { sonos: 7, amazon: 4, apple: 2, bose: 3, jbl: 4 };

type BrandShares = Record<string, number>;

type LaunchData = {
  brands: Array<{ id: string; label: string; [k: string]: unknown }>;
  pricing: { discountRate: BrandShares; [k: string]: unknown };
  retail: { rating: BrandShares; inStock: BrandShares; [k: string]: unknown };
  aiSearch: { overall: BrandShares; byEngine: Record<string, BrandShares>; byStage: Record<string, BrandShares>; [k: string]: unknown };
  provenance?: Record<string, string>;
  capturedAt?: string;
  [k: string]: unknown;
};

export type AppliedMeasurements = {
  rating: string[];
  discount: string[];
  inStock: string[];
  aiSlots: string[];
  amazonSeries: string[];
  pdp: string[];
  delivery: string[];
  shelf: string[];
  demand: string[];
  effectivePrice: string[];
};

export type KeepaRecord = {
  brand: string;
  asinsUsed: string[];
  asinsRejected: Array<{ asin: string; brand: string | null; title: string | null }>;
  rating: number | null;
  discountRate: number | null;
  inStockRate: number | null;
  listPrice: number | null;
  streetPrice: number | null;
  reviews: number | null;
};

export type MeasurementRecord = {
  windowEnd: string;
  shelf: ShelfSnapshot | null;
  amazonListings: Record<string, Array<{ asin: string; label: string }>>;
  keepa: KeepaRecord[];
  ai: null | {
    engines: EngineSoM[];
    failedEngines: AiSoMResult["failedEngines"];
    questionsAsked: number;
    questionsFailed: number;
    shareByBrand: Record<string, number>;
    perQuestion: AiSoMResult["perQuestion"];
  };
};

export type PromptRow = {
  id: string;
  stage: string;
  q: string;
  present: Record<string, boolean>;
  rank: Record<string, number | null>;
  cited: Record<string, boolean>;
  topBrand: string | null;
};

export type RelabelInputs = {
  launchData: LaunchData;
  configSource: string;
  prompts: PromptRow[] | null;
  series: AmazonSeries;
  shelf: ShelfSnapshot | null;
  aiShares: Record<string, number>;
  aiStageShares: Record<string, Record<string, number>>;
  aiEngineStageShares: Record<string, Record<string, Record<string, number>>>;
  applied: AppliedMeasurements;
  record: MeasurementRecord;
};

const VENDOR_DIR = () => resolve(process.cwd(), "vendor", "bravo-platform");

const STAGE_LABELS: Record<string, string> = { awareness: "Awareness", consideration: "Consideration", evaluation: "Evaluation", decision: "Decision" };

/**
 * Builds the inputs for running the reference builder under another brand:
 * the reference launch-data with every measured field replaced and every
 * unmeasured one varied per brand, a config overlay that simulates the rest of
 * the market around those measurements, and a record of exactly which
 * measurements were applied.
 */
export function buildRelabelInputs(input: {
  subjectName: string;
  competitors: string[];
  category: string | null;
  keepa: KeepaBrandAggregate | null;
  competitorKeepa?: Array<KeepaBrandAggregate | null>;
  ai: AiSoMResult | null;
  apify?: Map<string, AmazonProduct>;
  shelfResults?: SearchResult[] | null;
  aspects?: string[];
  seed?: string;
  now?: Date;
}): RelabelInputs {
  const launchData = JSON.parse(
    readFileSync(resolve(VENDOR_DIR(), "public", "sonos-speakers-launch-data.json"), "utf8"),
  ) as LaunchData;
  const seed = input.seed ?? input.subjectName.toLowerCase();
  const rnd = seededRandom(`${seed}:anchors`);
  const vary = (v: number, spread: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v * (1 + (rnd() * 2 - 1) * spread)));
  const applied: AppliedMeasurements = { rating: [], discount: [], inStock: [], aiSlots: [], amazonSeries: [], pdp: [], delivery: [], shelf: [], demand: [], effectivePrice: [] };
  const windowEnd = windowEndFor(input.now ?? new Date());
  const record: MeasurementRecord = { windowEnd, shelf: null, amazonListings: {}, keepa: [], ai: null };
  const allSlots = [SUBJECT_SLOT, ...COMPETITOR_SLOTS];

  for (const slot of allSlots) {
    launchData.retail.rating[slot] = Math.round(vary(launchData.retail.rating[slot] ?? 4.3, 0.06, 3.6, 4.9) * 10) / 10;
    launchData.retail.inStock[slot] = vary(launchData.retail.inStock[slot] ?? 0.95, 0.04, 0.8, 1);
    launchData.pricing.discountRate[slot] = vary(launchData.pricing.discountRate[slot] ?? 0.1, 0.5, 0.01, 0.3);
    const shelf = launchData.retail.shelfSov as unknown as BrandShares;
    shelf[slot] = vary(shelf[slot] ?? 8, 0.6, 1, 40);
    launchData.aiSearch.overall[slot] = vary(launchData.aiSearch.overall[slot] ?? 15, 0.5, 2, 45);
  }

  const keepaBySlot: Array<[string, string, KeepaBrandAggregate | null | undefined]> = [
    [SUBJECT_SLOT, input.subjectName, input.keepa],
    ...COMPETITOR_SLOTS.map((slot, i): [string, string, KeepaBrandAggregate | null | undefined] => [slot, input.competitors[i] ?? "", input.competitorKeepa?.[i]]),
  ];
  for (const [slot, brand, keepa] of keepaBySlot) {
    if (!brand || !keepa || keepa.asinsWithData === 0) continue;
    if (keepa.avgRating != null) launchData.retail.rating[slot] = keepa.avgRating;
    if (keepa.avgDiscountRate != null) {
      launchData.pricing.discountRate[slot] = keepa.avgDiscountRate;
      applied.discount.push(slot);
    }
    if (keepa.inStockRate != null) {
      launchData.retail.inStock[slot] = keepa.inStockRate;
      applied.inStock.push(slot);
    }
    const rejectedAsins = new Set(keepa.rejected.map((r) => r.asin));
    record.keepa.push({
      brand,
      asinsUsed: keepa.perAsin.filter((r) => !rejectedAsins.has(r.asin) && (r.priceNow != null || r.rating != null)).map((r) => r.asin),
      asinsRejected: keepa.rejected.map((r) => ({ asin: r.asin, brand: r.brand, title: r.title })),
      rating: keepa.avgRating,
      discountRate: keepa.avgDiscountRate,
      inStockRate: keepa.inStockRate,
      listPrice: keepa.avgListPrice,
      streetPrice: keepa.avgStreetPrice,
      reviews: keepa.totalReviews,
    });
  }

  const brandSlots = [
    { slot: SUBJECT_SLOT, name: input.subjectName },
    ...COMPETITOR_SLOTS.flatMap((slot, i) => (input.competitors[i] ? [{ slot, name: input.competitors[i] }] : [])),
  ];
  const slotByName = new Map(brandSlots.map((b) => [b.name, b.slot]));
  const toSlots = (r: Record<string, number> | undefined): BrandShares =>
    Object.fromEntries(brandSlots.flatMap((b) => (r?.[b.name] == null ? [] : [[b.slot, r[b.name]]])));

  let prompts: PromptRow[] | null = null;
  let aiShares: BrandShares = {};
  let aiStageShares: Record<string, BrandShares> = {};
  let aiEngineStageShares: Record<string, Record<string, BrandShares>> = {};
  if (input.ai) {
    aiShares = toSlots(input.ai.shareByBrand);
    for (const [slot, share] of Object.entries(aiShares)) {
      launchData.aiSearch.overall[slot] = share;
      applied.aiSlots.push(slot);
    }
    launchData.aiSearch.byEngine = Object.fromEntries(input.ai.engines.map((e) => [e.engine, toSlots(e.shareByBrand)]));
    aiStageShares = Object.fromEntries(Object.entries(input.ai.shareByStage).map(([st, v]) => [st, toSlots(v)]));
    launchData.aiSearch.byStage = aiStageShares;
    aiEngineStageShares = Object.fromEntries(input.ai.engines.map((e) => [e.engine, Object.fromEntries(Object.entries(e.shareByStage).map(([st, v]) => [st, toSlots(v)]))]));

    const slots = brandSlots.map((b) => b.slot);
    const labelOf = new Map(input.ai.engines.map((e) => [e.engine, e.label]));
    const citedBy = (sources: Array<{ url: string; title: string }>, name: string): boolean => {
      const keys = brandAliases(name).map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((k) => k.length >= 3);
      return sources.some((src) => keys.some((k) => `${src.url} ${src.title}`.toLowerCase().replace(/[^a-z0-9.]/g, "").includes(k)));
    };
    prompts = input.ai.perQuestion.filter((q) => q.answer != null && q.run === 1).map((q, i) => {
      const order = q.mentionOrder.map((name) => slotByName.get(name)).filter((s): s is string => !!s);
      return {
        id: `q${i + 1}`,
        stage: q.stage,
        q: `${labelOf.get(q.engine) ?? q.engine}: ${q.q}`,
        present: Object.fromEntries(slots.map((s) => [s, order.includes(s)])),
        rank: Object.fromEntries(slots.map((s) => [s, order.includes(s) ? order.indexOf(s) + 1 : null])),
        cited: Object.fromEntries(brandSlots.map((b) => [b.slot, citedBy(q.sources, b.name)])),
        topBrand: order[0] ?? null,
      };
    });

    record.ai = {
      engines: input.ai.engines,
      failedEngines: input.ai.failedEngines,
      questionsAsked: input.ai.questionsAsked,
      questionsFailed: input.ai.questionsFailed,
      shareByBrand: input.ai.shareByBrand,
      perQuestion: input.ai.perQuestion,
    };
  } else {
    const byEngine = launchData.aiSearch.byEngine;
    for (const e of Object.keys(byEngine)) for (const slot of allSlots) byEngine[e][slot] = vary(launchData.aiSearch.overall[slot], 0.25, 1, 60);
    for (const st of Object.keys(launchData.aiSearch.byStage)) for (const slot of allSlots) launchData.aiSearch.byStage[st][slot] = vary(launchData.aiSearch.overall[slot], 0.3, 1, 60);
  }

  const series: AmazonSeries = buildAmazonSeries(
    keepaBySlot.filter(([, brand]) => !!brand).map(([slot, brand, keepa]) => ({ slot, brand, keepa, slotsAvailable: MODEL_SLOTS_PER_BRAND[slot] ?? 0 })),
    windowEnd,
    { apify: input.apify, category: input.category },
  );
  for (const [slot, listings] of Object.entries(series.listings)) {
    applied.amazonSeries.push(slot);
    record.amazonListings[slot] = listings.map((l) => ({ asin: l.asin, label: l.label }));
    if (series.rating[slot]?.some((v) => v != null)) applied.rating.push(slot);
    if (listings.some((l) => l.pdp)) applied.pdp.push(slot);
    if (listings.some((l) => l.deliveryDays != null)) applied.delivery.push(slot);
    if (listings.some((l) => l.monthlySold.some((v) => v != null) || l.rank.some((v) => v != null))) applied.demand.push(slot);
    if (listings.some((l) => l.effective.some((v) => v != null))) applied.effectivePrice.push(slot);
  }

  const shelf = input.shelfResults?.length && input.category
    ? shelfSnapshot(input.category, input.shelfResults, brandSlots, new Date().toISOString().slice(0, 10))
    : null;
  if (shelf) {
    applied.shelf.push(...brandSlots.map((b) => b.slot));
    record.shelf = shelf;
    const shelfSov = launchData.retail.shelfSov as unknown as BrandShares;
    for (const b of brandSlots) shelfSov[b.slot] = shelf.share[b.slot] ?? 0;
  }

  launchData.capturedAt = new Date().toISOString();

  const labels = [input.subjectName, ...COMPETITOR_SLOTS.map((_, i) => input.competitors[i] ?? `Competitor ${i + 1}`)];
  launchData.brands = launchData.brands.map((b, i) => ({ id: b.id, label: labels[i] ?? b.label }));
  (launchData.retail as Record<string, unknown>).aspects = simulatedAspects({
    aspects: input.aspects?.length ? input.aspects : ["Performance", "Build quality", "Ease of use", "Value for money", "Design", "Reliability"],
    windowEnd,
    brands: allSlots.map((slot, i) => ({ slot, label: labels[i], rating: launchData.retail.rating[slot] ?? null })),
    seed,
  });

  const category = input.category ?? "products";
  const overlay = {
    seed,
    labels,
    category: input.category,
    subjectLabel: input.subjectName,
    title: `${input.subjectName} · Commercial Command Center`,
    engines: input.ai ? input.ai.engines.map((e) => ({ id: e.engine, label: e.label })) : null,
    windowEnd,
    events: retailEventsFor(windowEnd),
    terms: [
      { id: "category", label: category, vol: 1 },
      { id: "best", label: `best ${category}`, vol: 0.62 },
      { id: "deals", label: `${category} deals`, vol: 0.38 },
    ],
    promptBank: Object.entries(STAGE_LABELS).flatMap(([stage]) => [[stage, `${STAGE_LABELS[stage]} questions about ${category}`]]),
    stageQuestions: input.ai ? Object.fromEntries(input.ai.perQuestion.filter((q) => q.run === 1).map((q) => [q.stage, q.q])) : {},
    listings: series.listings,
    rating: series.rating,
    reviews: series.reviews,
  };
  const configSource = `import base from "./config-sonos.mjs";
const overlay = ${JSON.stringify(overlay)};
${WORLD_VARIATION_SOURCE}
const MEASURED_AMAZON = {}, MEASURED_PDP = {}, MEASURED_DELIVERY = {};
const MODELS = [];
for (const [brand, listings] of Object.entries(overlay.listings)) {
  const slots = base.MODELS.filter((m) => m.brand === brand);
  listings.forEach((l, k) => {
    const m = slots[k];
    if (!m) return;
    const id = "l-" + l.asin.toLowerCase();
    MEASURED_AMAZON[id] = { price: l.price, list: l.list, stock: l.stock, offers: l.offers, buybox: l.buybox };
    if (l.pdp) MEASURED_PDP[id] = l.pdp;
    if (l.deliveryDays != null) MEASURED_DELIVERY[id] = l.deliveryDays;
    MODELS.push({ ...m, id, label: l.label, msrp: l.msrp ?? l.street ?? m.msrp, street0: l.street ?? l.msrp ?? m.street0, asin: l.asin, measured: true, anchored: false, launched: null, isNew: false });
  });
}
export default {
  ...base,
  ...variation,
  id: "world-" + overlay.seed,
  WINDOW_END: overlay.windowEnd,
  MODELS,
  EVENTS: overlay.events,
  SKIP_READS: MODELS.length === 0,
  STAGES: base.STAGES.map((st) => ({ ...st, q: overlay.stageQuestions[st.id] ?? (overlay.category ? \`\${st.label} questions about \${overlay.category}\` : st.label) })),
  TERMS: overlay.terms,
  PROMPT_BANK: overlay.promptBank,
  MEASURED_AMAZON,
  MEASURED_PDP,
  MEASURED_DELIVERY,
  MEASURED_RATING: overlay.rating,
  MEASURED_REVIEWS: overlay.reviews,
  subjectLabel: overlay.subjectLabel,
  title: overlay.title,
  category: overlay.category ?? base.category,
  brandMark: null,
  sourceReports: [],
  BRANDS: base.BRANDS.map((b, i) => ({ ...b, label: overlay.labels[i] ?? b.label })),
  ENGINES: overlay.engines ?? base.ENGINES,
  LAUNCH_PULL: null,
};
`;

  return { launchData, configSource, prompts, series, shelf, aiShares, aiStageShares, aiEngineStageShares, applied, record };
}
