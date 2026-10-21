import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KeepaBrandAggregate } from "./keepa";
import { brandAliases, type AiSoMResult, type EngineSoM } from "./ai-visibility";
import { buildAmazonSeries, windowDates, windowEndFor, type AmazonSeries } from "./amazon-series";
import type { AmazonProduct, ReviewAspect, SearchResult } from "./apify";
import { shelfSnapshot, type ShelfSnapshot } from "./amazon-shelf";
import { WORLD_VARIATION_SOURCE, retailEventsFor, seededRandom, simulatedAspects } from "./simulated-world";
import { fallbackProfile, type MarketProfile } from "./market-profile";
import { builderPromoTypes, type MechanicId } from "./market-mechanics";
import { importedOnly, mergedRetailSeries, retailSeriesFor, type RetailCapture } from "./retail-offers";
import { measuredRetailDelivery, measuredRetailListings, type MeasuredRetailRecord } from "./retail-feed";
import { combinedVoice, type CombinedVoiceRecord, type VoiceSlot } from "./retail-feed-voice";

export const SUBJECT_SLOT = "sonos";
export const COMPETITOR_SLOTS = ["amazon", "apple", "bose", "jbl"] as const;
export const MODEL_SLOTS_PER_BRAND: Record<string, number> = { sonos: 8, amazon: 8, apple: 8, bose: 8, jbl: 8 };

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
  retailPrices: string[];
  retailMeasured: string[];
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
  listings?: Array<{ asin: string; rating: number | null; reviews: number | null }>;
};

export type MarketRecord = {
  source: MarketProfile["source"];
  category: string;
  region: string;
  durable: boolean;
  retailers: Array<{ id: string; label: string; domain: string; weight: number }>;
  mechanics: MechanicId[];
  traffic: Record<string, { domain: string | null; monthlyVisits: number }>;
  changes: string[];
};

export type ImportedRetailRecord = {
  label: string;
  importedOn: string;
  listings: number;
  retailers: Record<string, { listings: number; first: string; last: string; days: number }>;
};

export type RetailRecord = {
  readOn: string;
  days: string[];
  listings: number;
  retailers: Record<string, number>;
  firstLive?: Record<string, string>;
  imported?: ImportedRetailRecord;
  measured?: MeasuredRetailRecord;
  voice?: CombinedVoiceRecord;
  delivery?: { label: string; listings: number; readings: number };
};

export type MeasurementRecord = {
  windowEnd: string;
  market?: MarketRecord | null;
  retail?: RetailRecord | null;
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
  named: string[];
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
  reviewAspects: Record<string, ReviewAspect[]>;
  applied: AppliedMeasurements;
  record: MeasurementRecord;
};

const VENDOR_DIR = () => resolve(process.cwd(), "vendor", "bravo-platform");

const STAGE_LABELS: Record<string, string> = { awareness: "Awareness", consideration: "Consideration", evaluation: "Evaluation", decision: "Decision" };

type RetailCells = ReturnType<typeof retailSeriesFor>;

const retailerOf = (key: string): string => key.split("|")[1];

function countByRetailer(cells: RetailCells): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(cells)) out[retailerOf(key)] = (out[retailerOf(key)] ?? 0) + 1;
  return out;
}

function firstDayByRetailer(cells: RetailCells): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, days] of Object.entries(cells)) {
    const first = Object.keys(days).sort()[0];
    const rt = retailerOf(key);
    if (first && (!out[rt] || first < out[rt])) out[rt] = first;
  }
  return out;
}

/**
 * A reference price per tracked listing from what other retailers charged in
 * the window (its highest observed price), for listings Amazon did not price.
 */
function retailReference(cells: RetailCells, measured: Record<string, { price: Array<number | null> }>): Record<string, number> {
  const out: Record<string, number> = {};
  const take = (key: string, prices: Array<number | null>) => {
    const id = key.split("|")[0];
    for (const v of prices) if (v != null && v > 0 && v > (out[id] ?? 0)) out[id] = v;
  };
  for (const [key, days] of Object.entries(cells)) take(key, Object.values(days).map((d) => d.price));
  for (const [key, m] of Object.entries(measured)) take(key, m.price);
  return out;
}

function importedRecord(label: string, importedOn: string, cells: RetailCells): ImportedRetailRecord {
  const byRetailer = new Map<string, { listings: number; days: Set<string> }>();
  for (const [key, days] of Object.entries(cells)) {
    const cur = byRetailer.get(retailerOf(key)) ?? { listings: 0, days: new Set<string>() };
    cur.listings += 1;
    for (const d of Object.keys(days)) cur.days.add(d);
    byRetailer.set(retailerOf(key), cur);
  }
  const retailers: ImportedRetailRecord["retailers"] = {};
  for (const [rt, { listings, days }] of byRetailer) {
    const d = [...days].sort();
    retailers[rt] = { listings, first: d[0], last: d[d.length - 1], days: d.length };
  }
  return { label, importedOn, listings: new Set(Object.keys(cells).map((k) => k.split("|")[0])).size, retailers };
}

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
  market?: MarketProfile | null;
  retail?: RetailCapture | null;
  pinned?: string[];
  seed?: string;
  now?: Date;
}): RelabelInputs {
  const launchData = JSON.parse(
    readFileSync(resolve(VENDOR_DIR(), "public", "sonos-speakers-launch-data.json"), "utf8"),
  ) as LaunchData;
  const seed = input.seed ?? input.subjectName.toLowerCase();
  const rnd = seededRandom(`${seed}:anchors`);
  const vary = (v: number, spread: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v * (1 + (rnd() * 2 - 1) * spread)));
  const applied: AppliedMeasurements = { rating: [], discount: [], inStock: [], aiSlots: [], amazonSeries: [], pdp: [], delivery: [], shelf: [], demand: [], effectivePrice: [], retailPrices: [], retailMeasured: [] };
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
      listings: keepa.perAsin.filter((r) => !rejectedAsins.has(r.asin)).map((r) => ({ asin: r.asin, rating: r.rating, reviews: r.reviews })),
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
      const keys = brandAliases(name, input.category ?? "").map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((k) => k.length >= 3);
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
        named: q.brands.map((b) => b.name),
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
    keepaBySlot.filter(([, brand]) => !!brand).map(([slot, brand, keepa]) => ({ slot, brand, keepa, slotsAvailable: MODEL_SLOTS_PER_BRAND[slot] ?? 0, pinned: input.pinned?.includes(brand) ?? false })),
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

  const window = windowDates(windowEnd);
  const asinSlot = new Map(Object.entries(series.listings).flatMap(([slot, ls]) => ls.map((l) => [l.asin, slot] as const)));
  const tracked = [...asinSlot.keys()];
  const live = input.retail ? retailSeriesFor(input.retail.history, tracked, window[0], windowEnd) : {};
  const imported = input.retail?.imported ? retailSeriesFor(importedOnly(input.retail.history, input.retail.imported), tracked, window[0], windowEnd) : {};
  const retail = mergedRetailSeries(live, imported);
  if (input.retail && Object.keys(retail).length) {
    const asins = new Set(Object.keys(retail).map((k) => k.split("|")[0]));
    const slots = [...asinSlot].filter(([asin]) => asins.has(`l-${asin.toLowerCase()}`)).map(([, slot]) => slot);
    applied.retailPrices.push(...new Set(slots));
    record.retail = {
      readOn: input.retail.date,
      days: [...new Set(Object.values(live).flatMap((d) => Object.keys(d)))].sort(),
      listings: new Set(Object.keys(live).map((k) => k.split("|")[0])).size,
      retailers: countByRetailer(live),
      firstLive: firstDayByRetailer(live),
      ...(input.retail.imported && Object.keys(imported).length ? { imported: importedRecord(input.retail.imported.label, input.retail.imported.importedOn, imported) } : {}),
    };
  }
  const measured = input.retail?.feed
    ? measuredRetailListings({ feed: input.retail.feed, live: input.retail.history, dates: window, asins: tracked })
    : { listings: {}, record: null };
  if (measured.record && input.retail) {
    const asins = new Set(Object.keys(measured.listings).map((k) => k.split("|")[0]));
    applied.retailMeasured.push(...new Set([...asinSlot].filter(([asin]) => asins.has(`l-${asin.toLowerCase()}`)).map(([, slot]) => slot)));
    record.retail = { ...(record.retail ?? { readOn: input.retail.date, days: [], listings: 0, retailers: {} }), measured: measured.record };
  }
  const voiceSlots = keepaBySlot.filter(([slot, brand]) => !!brand && series.listings[slot]).map(([slot, brand, keepa]): VoiceSlot => {
    const asins = new Set((series.listings[slot] ?? []).map((l) => l.asin));
    const pools = new Set((keepa?.perAsin ?? []).filter((r) => asins.has(r.asin) && r.reviews).map((r) => r.reviews as number));
    return { slot, name: brand, rating: series.rating[slot] ?? [], reviews: series.reviews[slot] ?? [], amazonReviews: [...pools].reduce((a, n) => a + n, 0) || null };
  });
  const voice = input.retail?.feed ? combinedVoice(input.retail.feed, window, voiceSlots) : null;
  const delivery = input.retail?.feed ? measuredRetailDelivery(input.retail.feed, tracked, window) : { weekly: {}, readings: 0, listings: 0 };
  if (delivery.listings && record.retail) record.retail = { ...record.retail, delivery: { label: input.retail!.feed!.label, listings: delivery.listings, readings: delivery.readings } };
  if (voice?.record && record.retail) record.retail = { ...record.retail, voice: voice.record };

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
  const market = input.market ?? fallbackProfile(category, "US", brandSlots.map((b) => b.name));
  const world = marketWorld(market, brandSlots, allSlots);
  record.market = {
    source: market.source,
    category: market.category,
    region: market.region,
    durable: market.durable,
    retailers: market.retailers.map((r) => ({ id: r.id, label: r.label, domain: r.domain, weight: r.weight })),
    mechanics: [...new Set(Object.values(market.mechanics).flatMap((m) => Object.keys(m) as MechanicId[]))],
    traffic: market.traffic,
    changes: market.changes,
  };
  const events = retailEventsFor(windowEnd).map((e) => ({ ...e, lift: market.eventLift[e.id] ?? e.lift }));
  const overlay = {
    world,
    seed,
    labels,
    activeSlots: input.competitors.some(Boolean) ? allSlots.filter((_, i) => i === 0 || !!input.competitors[i - 1]) : allSlots,
    category: input.category,
    subjectLabel: input.subjectName,
    title: `${input.subjectName} · Commercial Command Center`,
    engines: input.ai ? input.ai.engines.map((e) => ({ id: e.engine, label: e.label })) : null,
    windowEnd,
    events,
    terms: [
      { id: "category", label: category, vol: 1 },
      { id: "best", label: `best ${category}`, vol: 0.62 },
      { id: "deals", label: `${category} deals`, vol: 0.38 },
    ],
    promptBank: Object.entries(STAGE_LABELS).flatMap(([stage]) => [[stage, `${STAGE_LABELS[stage]} questions about ${category}`]]),
    stageQuestions: input.ai ? Object.fromEntries(input.ai.perQuestion.filter((q) => q.run === 1).map((q) => [q.stage, q.q])) : {},
    listings: series.listings,
    retail,
    measuredListings: measured.listings,
    measuredDelivery: delivery.weekly,
    retailMsrp: retailReference(retail, measured.listings),
    rating: voice ? { ...series.rating, ...voice.rating } : series.rating,
    reviews: voice ? { ...series.reviews, ...voice.reviews } : series.reviews,
  };
  const configSource = `import reference from "./config-sonos.mjs";
const overlay = ${JSON.stringify(overlay)};
const base = { ...reference, ...overlay.world };
${WORLD_VARIATION_SOURCE}
const MEASURED_AMAZON = {}, MEASURED_PDP = {}, MEASURED_DELIVERY = {};
const pos = (v) => (typeof v === "number" && v > 0 ? v : null);
const MODELS = [];
for (const [brand, listings] of Object.entries(overlay.listings)) {
  const slots = base.MODELS.filter((m) => m.brand === brand);
  listings.forEach((l, k) => {
    const m = slots[k] ?? slots[slots.length - 1];
    if (!m) return;
    const id = "l-" + l.asin.toLowerCase();
    MEASURED_AMAZON[id] = { price: l.price, list: l.list, stock: l.stock, offers: l.offers, buybox: l.buybox };
    if (l.pdp) MEASURED_PDP[id] = l.pdp;
    if (l.deliveryDays != null) MEASURED_DELIVERY[id] = l.deliveryDays;
    MODELS.push({ ...m, id, label: l.label, msrp: pos(l.msrp) ?? pos(l.street) ?? overlay.retailMsrp[id] ?? m.msrp, street0: pos(l.street) ?? pos(l.msrp) ?? overlay.retailMsrp[id] ?? m.street0, asin: l.asin, measured: true, anchored: false, launched: null, isNew: false });
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
  MEASURED_RETAIL: overlay.retail,
  MEASURED_LISTINGS: overlay.measuredListings,
  MEASURED_DELIVERY_RETAIL: overlay.measuredDelivery,
  MEASURED_PDP,
  MEASURED_DELIVERY,
  MEASURED_RATING: overlay.rating,
  MEASURED_REVIEWS: overlay.reviews,
  subjectLabel: overlay.subjectLabel,
  title: overlay.title,
  category: overlay.category ?? base.category,
  brandMark: null,
  sourceReports: [],
  BRANDS: base.BRANDS.map((b, i) => ({ ...b, label: overlay.labels[i] ?? b.label })).filter((b) => overlay.activeSlots.includes(b.id)),
  ENGINES: overlay.engines ?? base.ENGINES,
  LAUNCH_PULL: null,
};
`;

  const reviewAspects = Object.fromEntries(Object.entries(series.listings).map(([slot, listings]) => [slot, listings.flatMap((l) => (input.apify?.get(l.asin)?.reviewAspects ?? []).map((a) => ({ ...a, asin: l.asin })))]).filter(([, list]) => list.length));
  return { launchData, configSource, prompts, series, shelf, aiShares, aiStageShares, aiEngineStageShares, reviewAspects, applied, record };
}

const RETAILER_COLORS: Record<string, [string, string]> = {
  amazon: ["#d97706", "#fef3c7"], bestbuy: ["#2563eb", "#dbeafe"], target: ["#be123c", "#ffe4e6"], walmart: ["#0891b2", "#cffafe"],
};
const PALETTE: Array<[string, string]> = [["#5b21b6", "#ede9fe"], ["#4d7c0f", "#ecfccb"], ["#db2777", "#fce7f3"], ["#2563eb", "#dbeafe"], ["#0891b2", "#cffafe"], ["#be123c", "#ffe4e6"]];

/**
 * The builder's market settings for a profile: retailers and their colours,
 * which brand each retailer carries, the mechanics each runs, price and
 * delivery offsets, and site-traffic levels per brand slot.
 */
function marketWorld(market: MarketProfile, brandSlots: Array<{ slot: string; name: string }>, allSlots: string[]): Record<string, unknown> {
  const taken = new Set(market.retailers.flatMap((r) => (RETAILER_COLORS[r.id] ? [RETAILER_COLORS[r.id][0]] : [])));
  const free = PALETTE.filter(([c]) => !taken.has(c));
  let next = 0;
  const retailers = market.retailers.map((r) => {
    const [color, soft] = RETAILER_COLORS[r.id] ?? free[next++ % free.length];
    return { id: r.id, label: r.label, color, soft, weight: r.weight, kind: r.kind, domain: r.domain, leadDays: r.leadDays };
  });
  const per = <T>(f: (r: MarketProfile["retailers"][number]) => T): Record<string, T> => Object.fromEntries(market.retailers.map((r) => [r.id, f(r)]));
  const nameOf = new Map(brandSlots.map((b) => [b.slot, b.name]));
  const carriage = Object.fromEntries(allSlots.map((slot) => {
    const row = market.carriage[nameOf.get(slot) ?? ""];
    return [slot, per((r) => (r.id === "amazon" ? 1 : row?.[r.id] ?? 0.5))];
  }));
  const used = new Set<MechanicId>(Object.values(market.mechanics).flatMap((m) => Object.keys(m) as MechanicId[]));
  const traffic = Object.fromEntries(allSlots.flatMap((slot) => {
    const t = market.traffic[nameOf.get(slot) ?? ""];
    return t ? [[slot, Math.max(60, Math.round(t.monthlyVisits / 30))]] : [];
  }));
  const domains = Object.fromEntries(allSlots.flatMap((slot) => {
    const d = market.traffic[nameOf.get(slot) ?? ""]?.domain;
    return d ? [[slot, d]] : [];
  }));
  return {
    RETAILERS: retailers,
    BASE_CARRIAGE: carriage,
    RETAILER_MECHANICS: per((r) => market.mechanics[r.id] ?? { discount: 2 }),
    RETAILER_PRICE_BIAS: per((r) => Math.round((r.priceIndex - 1) * 1000) / 1000),
    RETAILER_LEADTIME: per((r) => r.leadDays),
    RETAILER_PDP_LIFT: per((r) => r.listingQuality),
    THIRD_PARTY_RETAILERS: market.retailers.filter((r) => r.thirdParty).map((r) => r.id),
    PROMO_TYPES: builderPromoTypes(used, market.typicalPrice),
    TRAFFIC_BASE: { ...Object.fromEntries(allSlots.map((s) => [s, 1500])), ...traffic },
    TRAFFIC_DOMAINS: domains,
    TRAFFIC_NOTE: "No capture for this domain — monthly visits sized from an estimate of the brand's site, daily shape modelled.",
    DURABLE: market.durable,
  };
}
