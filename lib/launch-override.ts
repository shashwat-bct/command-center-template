import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KeepaBrandAggregate } from "./keepa";
import type { AiSoMResult } from "./ai-visibility";
import { buildAmazonSeries, windowEndFor, type AmazonSeries } from "./amazon-series";
import type { AmazonProduct, SearchResult } from "./apify";
import { shelfSnapshot, type ShelfSnapshot } from "./amazon-shelf";

export const SUBJECT_SLOT = "sonos";
export const COMPETITOR_SLOTS = ["amazon", "apple", "bose", "jbl"] as const;
export const MEASURED_AI_ENGINE = { id: "claude", label: "Claude" } as const;
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
    engine: string;
    shareByRun: Array<Record<string, number>>;
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
  applied: AppliedMeasurements;
  record: MeasurementRecord;
};

const VENDOR_DIR = () => resolve(process.cwd(), "vendor", "bravo-platform");

/**
 * Builds the inputs for running the reference builder under another brand:
 * the Sonos launch-data with the subject's measured fields replaced, a config
 * overlay that removes Sonos-specific effects, and a record of exactly which
 * measurements were applied so the payload can label every number.
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
  now?: Date;
}): RelabelInputs {
  const launchData = JSON.parse(
    readFileSync(resolve(VENDOR_DIR(), "public", "sonos-speakers-launch-data.json"), "utf8"),
  ) as LaunchData;
  const applied: AppliedMeasurements = { rating: [], discount: [], inStock: [], aiSlots: [], amazonSeries: [], pdp: [], delivery: [], shelf: [], demand: [], effectivePrice: [] };
  const windowEnd = windowEndFor(input.now ?? new Date());
  const record: MeasurementRecord = { windowEnd, shelf: null, amazonListings: {}, keepa: [], ai: null };

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

  let prompts: PromptRow[] | null = null;
  let aiShares: Record<string, number> = {};
  let aiStageShares: Record<string, Record<string, number>> = {};
  if (input.ai) {
    const slotByName = new Map<string, string>([
      [input.subjectName, SUBJECT_SLOT],
      ...COMPETITOR_SLOTS.flatMap((slot, i): Array<[string, string]> => (input.competitors[i] ? [[input.competitors[i], slot]] : [])),
    ]);
    const measured: BrandShares = {};
    for (const [name, slot] of slotByName) {
      const share = input.ai.shareByBrand[name];
      if (share == null) continue;
      measured[slot] = share;
      launchData.aiSearch.overall[slot] = share;
      applied.aiSlots.push(slot);
    }
    launchData.aiSearch.byEngine = { [MEASURED_AI_ENGINE.id]: measured };

    const answered = input.ai.perQuestion.filter((q) => q.answer != null);
    const byStage: Record<string, BrandShares> = {};
    for (const stage of new Set(answered.map((q) => q.stage))) {
      const hits: BrandShares = {};
      for (const q of answered.filter((x) => x.stage === stage)) {
        for (const [name, slot] of slotByName) hits[slot] = (hits[slot] ?? 0) + (q.hitsByBrand[name] ?? 0);
      }
      const total = Object.values(hits).reduce((a, b) => a + b, 0);
      if (total > 0) byStage[stage] = Object.fromEntries(Object.entries(hits).map(([slot, h]) => [slot, Math.round((h / total) * 1000) / 10]));
    }
    launchData.aiSearch.byStage = byStage;
    aiShares = measured;
    aiStageShares = byStage;

    const slots = [...slotByName.values()];
    prompts = answered.map((q, i) => {
      const order = q.mentionOrder.map((name) => slotByName.get(name)).filter((s): s is string => !!s);
      return {
        id: `q${i + 1}`,
        stage: q.stage,
        q: q.run > 1 ? `${q.q} (asked again)` : q.q,
        present: Object.fromEntries(slots.map((s) => [s, order.includes(s)])),
        rank: Object.fromEntries(slots.map((s) => [s, order.includes(s) ? order.indexOf(s) + 1 : null])),
        cited: Object.fromEntries(slots.map((s) => [s, false])),
        topBrand: order[0] ?? null,
      };
    });

    record.ai = {
      engine: MEASURED_AI_ENGINE.label,
      questionsAsked: input.ai.questionsAsked,
      questionsFailed: input.ai.questionsFailed,
      shareByBrand: input.ai.shareByBrand,
      shareByRun: input.ai.shareByRun,
      perQuestion: input.ai.perQuestion,
    };
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

  const brandSlots = [
    { slot: SUBJECT_SLOT, name: input.subjectName },
    ...COMPETITOR_SLOTS.flatMap((slot, i) => (input.competitors[i] ? [{ slot, name: input.competitors[i] }] : [])),
  ];
  const shelf = input.shelfResults?.length && input.category
    ? shelfSnapshot(input.category, input.shelfResults, brandSlots, new Date().toISOString().slice(0, 10))
    : null;
  if (shelf) {
    applied.shelf.push(...brandSlots.map((b) => b.slot));
    record.shelf = shelf;
  }

  launchData.capturedAt = new Date().toISOString();

  const labels = [input.subjectName, ...COMPETITOR_SLOTS.map((_, i) => input.competitors[i] ?? `Competitor ${i + 1}`)];
  launchData.brands = launchData.brands.map((b, i) => ({ id: b.id, label: labels[i] ?? b.label }));
  const overlay = {
    labels,
    category: input.category,
    subjectLabel: input.subjectName,
    title: `${input.subjectName} · Commercial Command Center`,
    engines: input.ai ? [MEASURED_AI_ENGINE] : null,
    windowEnd,
    stageQuestions: input.ai ? Object.fromEntries(input.ai.perQuestion.filter((q) => q.run === 1).map((q) => [q.stage, q.q])) : {},
    listings: series.listings,
    rating: series.rating,
    reviews: series.reviews,
  };
  const configSource = `import base from "./config-sonos.mjs";
const overlay = ${JSON.stringify(overlay)};
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
    MODELS.push({ ...m, id, label: l.label, msrp: l.msrp ?? l.street ?? m.msrp, street0: l.street ?? l.msrp ?? m.street0, asin: l.asin, measured: true, launched: null, isNew: false });
  });
}
export default {
  ...base,
  WINDOW_END: overlay.windowEnd,
  MODELS,
  RETAILERS: base.RETAILERS.filter((r) => r.id === "amazon").map((r) => ({ ...r, weight: 1 })),
  CITIES: [],
  EVENTS: [],
  SKIP_READS: true,
  STAGES: base.STAGES.map((st) => ({ ...st, q: overlay.stageQuestions[st.id] ?? (overlay.category ? \`\${st.label} questions about \${overlay.category}\` : st.label) })),
  TERMS: overlay.category ? [{ id: "category", label: overlay.category, vol: 1 }] : base.TERMS.slice(0, 1).map((t) => ({ ...t, label: "category" })),
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

  return { launchData, configSource, prompts, series, shelf, aiShares, aiStageShares, applied, record };
}
