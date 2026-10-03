import type { AppliedMeasurements, KeepaRecord, MeasurementRecord } from "./launch-override";
import { COMPETITOR_SLOTS, SUBJECT_SLOT } from "./launch-override";

export type ProvenanceKind = "measured" | "unmeasured";

export const SCORECARD_METRICS = [
  "trafficShare", "sessions", "aiSov", "shelfSov", "pdpScore", "carriage",
  "inStock", "leadTime", "priceIndex", "promoIntensity", "promoDepth", "rating",
] as const;

const AMAZON_HISTORY_METRICS = ["carriage", "inStock", "priceIndex", "promoIntensity", "promoDepth"] as const;

export type Provenance = {
  version: 2;
  mode: "measured-only";
  subjectSlot: string;
  metrics: Record<string, Record<string, ProvenanceKind>>;
  sources: Record<string, string>;
  applied: AppliedMeasurements;
  record: MeasurementRecord;
};

type Anchor = { lane: string; measured: string; source: string; pins: string; unmeasured?: boolean };

const LANE_NAMES: Record<string, string> = {
  traffic: "Website traffic", shelf: "Retail shelf", tco: "Cost of ownership", ai: "AI answer", voice: "Voice of customer",
  landing: "Landing pages", delivery: "Delivery", carriage: "Carriage & buy box", stock: "Availability", pricing: "Pricing",
  promotions: "Promotions", calendar: "Promo calendar", strategy: "Promo strategy",
};
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const windowLabel = (end: string): string => {
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10);
  return `${start} to ${end}`;
};

/**
 * Per-metric, per-brand-slot provenance for a relabelled build. A cell is
 * measured only when this build read it from a source; everything else is
 * blanked on the dashboard. Keys are slot ids; rebranding renames them.
 */
export function computeProvenance(applied: AppliedMeasurements, record: MeasurementRecord): Provenance {
  const slots = [SUBJECT_SLOT, ...COMPETITOR_SLOTS];
  const metrics: Provenance["metrics"] = {};
  for (const m of SCORECARD_METRICS) metrics[m] = Object.fromEntries(slots.map((s) => [s, "unmeasured" as ProvenanceKind]));
  for (const s of applied.amazonSeries) for (const m of AMAZON_HISTORY_METRICS) metrics[m][s] = "measured";
  for (const s of applied.rating) metrics.rating[s] = "measured";
  for (const s of applied.pdp) metrics.pdpScore[s] = "measured";
  for (const s of applied.delivery) metrics.leadTime[s] = "measured";
  for (const s of applied.aiSlots) metrics.aiSov[s] = "measured";
  for (const s of applied.shelf) metrics.shelfSov[s] = "measured";

  const sources: Record<string, string> = {};
  const listings = Object.values(record.amazonListings).reduce((n, l) => n + l.length, 0);
  if (listings) sources.keepa = `Keepa · ${plural(listings, "Amazon listing")}, daily history ${windowLabel(record.windowEnd)}`;
  if (applied.pdp.length || applied.delivery.length) sources.apify = "Apify · Amazon product pages read on the build date";
  if (record.ai) sources.ai = `${record.ai.engine} · ${record.ai.questionsAsked - record.ai.questionsFailed} shopper questions`;
  if (applied.shelf.length) sources.shelf = "Apify · Amazon search results on the build date";

  return { version: 2, mode: "measured-only", subjectSlot: SUBJECT_SLOT, metrics, sources, applied, record };
}

export function measuredCount(p: Provenance, slot: string): number {
  return SCORECARD_METRICS.filter((m) => p.metrics[m]?.[slot] === "measured").length;
}

const measuredSlots = (p: Provenance, metric: string): number =>
  Object.values(p.metrics[metric] ?? {}).filter((v) => v === "measured").length;

/**
 * Disclosure copy built from provenance, so the label can never claim a
 * source whose numbers did not reach the dashboard.
 */
export function disclosureFor(p: Provenance, subjectName: string): { short: string; headline: string; body: string } {
  const parts: string[] = [];
  const ai = p.record.ai;
  if (ai && measuredSlots(p, "aiSov")) parts.push(`AI share of answer for ${plural(measuredSlots(p, "aiSov"), "brand")} (${ai.engine})`);
  const listingBrands = Object.keys(p.record.amazonListings).length;
  const listings = Object.values(p.record.amazonListings).reduce((n, l) => n + l.length, 0);
  if (listingBrands) parts.push(`daily Amazon price, stock, buy box, rating and reviews for ${plural(listings, "listing")} across ${plural(listingBrands, "brand")} (Keepa, ${windowLabel(p.record.windowEnd)})`);
  if (measuredSlots(p, "pdpScore")) parts.push("Amazon product-page content and delivery promise on the build date (Apify)");
  if (measuredSlots(p, "shelfSov")) parts.push("share of Amazon's organic search results for the category on the build date (Apify)");
  if (p.applied.demand.length) parts.push("Amazon demand: monthly purchases and category sales rank (Keepa)");
  if (p.applied.effectivePrice.length) parts.push("effective Amazon price after coupons and lightning deals (Keepa)");
  const n = measuredCount(p, p.subjectSlot);
  if (!parts.length) {
    return {
      short: "Nothing measured",
      headline: `Nothing was measured for ${subjectName} on this build.`,
      body: "Every measure is blank. Add a category and competitors in the admin form to measure AI share and Amazon listings.",
    };
  }
  return {
    short: `${n} of ${SCORECARD_METRICS.length} measures measured for ${subjectName} · nothing simulated`,
    headline: `Measured: ${parts.join("; ")}.`,
    body: "Anything without a source is left blank and marked \"not measured\" — website visits, other retailers and protection-plan/attach-rate costs are not shown. Amazon is the only retailer covered.",
  };
}

function keepaAnchors(rows: KeepaRecord[]): Anchor[] {
  if (!rows.length) return [];
  const basis = rows.map((k) => `${k.brand} ${plural(k.asinsUsed.length, "listing")}${k.asinsRejected.length ? ` (${k.asinsRejected.length} other-brand hit${k.asinsRejected.length === 1 ? "" : "s"} excluded)` : ""}`).join(", ");
  return [{ lane: "Brand check", measured: `Amazon listings found by Keepa search and kept only when the listing's brand or title names the brand — ${basis}`, source: "Keepa search + product API", pins: "Which listings every Amazon figure on this dashboard is computed from." }];
}

/**
 * The anchor ledger for a measured-only build: one row per source that
 * reached the dashboard, and one row per lane that is deliberately blank.
 */
export function anchorsFor(p: Provenance, lanes: Record<string, { status: string; note: string }>): Anchor[] {
  const ai = p.record.ai;
  const out: Anchor[] = [];
  if (ai) {
    const range = (b: string): string => {
      const vals = ai.shareByRun.map((r) => r[b]).filter((v): v is number => v != null);
      return vals.length > 1 ? ` (runs ${Math.min(...vals)}–${Math.max(...vals)}%)` : "";
    };
    const shares = Object.entries(ai.shareByBrand).map(([b, v]) => `${b} ${v}%${range(b)}`).join(", ");
    out.push({ lane: "AI answer", measured: `Share of brand mentions in ${ai.engine}'s answers to ${ai.questionsAsked - ai.questionsFailed} shopper questions (12 questions, each asked ${ai.shareByRun.length}×) across four funnel stages — ${shares}`,
      source: `${ai.engine} via the Atlas LLM proxy`, pins: "Each brand's share, its per-stage split, and every row of the prompt table. One reading per build, so the lines are flat." });
  }
  out.push(...keepaAnchors(p.record.keepa));
  const listingRows = Object.values(p.record.amazonListings);
  if (listingRows.length) {
    out.push({ lane: "Amazon history", measured: `Daily price, list price, buyable state, offer count, buy-box holder, rating and review count for ${listingRows.map((l) => l.map((x) => x.label).join(", ")).join("; ")}`,
      source: `Keepa price history · ${windowLabel(p.record.windowEnd)}`, pins: "Every Amazon price, discount, price-cut event, stock-out, listing date, seller count, buy-box share, rating and review-velocity figure." });
  }
  if (measuredSlots(p, "pdpScore") || measuredSlots(p, "leadTime")) {
    out.push({ lane: "Amazon product pages", measured: "Image count, video count, enhanced content, bullet count, spec table, reviews and title keyword fit, plus the promised delivery date, for each tracked listing",
      source: "Apify Amazon crawler · build date", pins: "Landing-page scores and the delivery promise. A single reading, so earlier weeks are blank." });
  }
  if (p.record.shelf) {
    const sh = p.record.shelf;
    out.push({ lane: "Retail shelf", measured: `First ${sh.depth} organic Amazon search results for "${sh.term}" on ${sh.capturedAt}, each attributed to a brand by its title`,
      source: "Apify Amazon crawler · search page", pins: "Each brand's share of shelf and its best position. Sponsored placements are not identified by the crawler and are not counted separately." });
  }
  if (p.applied.demand.length) {
    out.push({ lane: "Amazon demand", measured: "Amazon's \"bought in past month\" figure (a floor: 1K+ means at least 1,000) and the daily sales rank in the subcategory the listings share",
      source: `Keepa monthly-sold and sales-rank history · ${windowLabel(p.record.windowEnd)}`, pins: "Every figure on the Amazon demand page. Website visits are not measured." });
  }
  if (p.applied.effectivePrice.length) {
    out.push({ lane: "Effective price", measured: "Daily Amazon price, lightning-deal price when a deal was live, and one-time clip coupons",
      source: `Keepa price, deal and coupon history · ${windowLabel(p.record.windowEnd)}`, pins: "What a shopper pays at checkout before tax. Protection plans, card offers and their take-up rates are not measured and not included." });
  }
  for (const [lane, s] of Object.entries(lanes)) {
    if (s.status === "not_measured") out.push({ lane: LANE_NAMES[lane] ?? lane, measured: `NOT MEASURED. ${s.note}`, source: "—", pins: "Nothing — the lane is blank.", unmeasured: true });
  }
  return out;
}
