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
  mode: "measured-only" | "hybrid";
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
  if (record.ai) sources.ai = `${record.ai.engines.map((e) => e.label).join(", ")} · ${record.ai.questionsAsked - record.ai.questionsFailed} answers`;
  if (applied.shelf.length) sources.shelf = "Apify · Amazon search results on the build date";

  return { version: 2, mode: "hybrid", subjectSlot: SUBJECT_SLOT, metrics, sources, applied, record };
}

export function measuredCount(p: Provenance, slot: string): number {
  return SCORECARD_METRICS.filter((m) => p.metrics[m]?.[slot] === "measured").length;
}

const measuredSlots = (p: Provenance, metric: string): number =>
  Object.values(p.metrics[metric] ?? {}).filter((v) => v === "measured").length;

/**
 * Disclosure copy built from provenance: what this build measured, named by
 * source, and which lanes are modelled around those measurements.
 */
export function disclosureFor(p: Provenance, subjectName: string): { short: string; headline: string; body: string } {
  const parts: string[] = [];
  const ai = p.record.ai;
  if (ai && measuredSlots(p, "aiSov")) parts.push(`AI share of answer for ${plural(measuredSlots(p, "aiSov"), "brand")} across ${ai.engines.map((e) => e.label).join(", ")}`);
  const listingBrands = Object.keys(p.record.amazonListings).length;
  const listings = Object.values(p.record.amazonListings).reduce((n, l) => n + l.length, 0);
  if (listingBrands) parts.push(`daily Amazon price, stock, buy box, rating and reviews for ${plural(listings, "listing")} across ${plural(listingBrands, "brand")} (Keepa, ${windowLabel(p.record.windowEnd)})`);
  if (measuredSlots(p, "pdpScore")) parts.push("Amazon product-page content and delivery promise on the build date (Apify)");
  if (measuredSlots(p, "shelfSov")) parts.push("Amazon organic search results for the category on the build date (Apify)");
  const body = "Other retailers, cities, website traffic, review themes, promotion mechanics beyond Amazon price cuts, cost of ownership, and the day-to-day movement behind single readings are modelled around these measurements.";
  if (!parts.length) {
    return { short: "Modelled view", headline: `No live source answered for ${subjectName} on this build.`, body: "Every figure is modelled. Rebuild once the category and competitors are set to read AI answers and Amazon listings." };
  }
  return { short: "Measured + modelled", headline: `Measured: ${parts.join("; ")}.`, body };
}

function keepaAnchors(rows: KeepaRecord[]): Anchor[] {
  if (!rows.length) return [];
  const basis = rows.map((k) => `${k.brand} ${plural(k.asinsUsed.length, "listing")}${k.asinsRejected.length ? ` (${k.asinsRejected.length} other-brand hit${k.asinsRejected.length === 1 ? "" : "s"} excluded)` : ""}`).join(", ");
  return [{ lane: "Brand check", measured: `Amazon listings found by Keepa search and kept only when the listing's brand or title names the brand — ${basis}`, source: "Keepa search + product API", pins: "Which listings every Amazon figure on this dashboard is computed from." }];
}

/**
 * The anchor ledger: one row per source that reached the dashboard, then one
 * row per lane that is modelled outright.
 */
export function anchorsFor(p: Provenance, lanes: Record<string, { status: string; note: string }>): Anchor[] {
  const ai = p.record.ai;
  const out: Anchor[] = [];
  if (ai) {
    for (const e of ai.engines) {
      const shares = Object.entries(e.shareByBrand).map(([b, v]) => `${b} ${v}%`).join(", ");
      const others = e.otherBrands.slice(0, 5).map((o) => o.brand).join(", ");
      out.push({ lane: `AI answer · ${e.label}`,
        measured: `Share of brand mentions in ${e.questionsAsked - e.questionsFailed} answers (12 shopper questions, asked ${e.shareByRun.length}×) — ${shares}${others ? `; other brands named most: ${others}` : ""}. A brand counts once per answer; untracked brands count in the total.`,
        source: `${e.model}${e.webSearch ? " with web search" : ""} · brands read from each answer by ${e.matching === "llm" ? "an extraction pass" : e.matching === "mixed" ? "an extraction pass, with name matching where it failed" : "name matching"}`,
        pins: "This engine's column, its per-stage split, and its rows in the prompt table. One reading per build, so the lines are flat." });
    }
    for (const f of ai.failedEngines) out.push({ lane: `AI answer · ${f.label}`, measured: `Not read on this build: ${f.error}`, source: "—", pins: "Nothing — the engine is left out.", unmeasured: true });
  }
  out.push(...keepaAnchors(p.record.keepa));
  const listingRows = Object.values(p.record.amazonListings);
  if (listingRows.length) {
    out.push({ lane: "Amazon history", measured: `Daily price, list price, buyable state, offer count, buy-box holder, rating and review count for ${listingRows.map((l) => l.map((x) => x.label).join(", ")).join("; ")}`,
      source: `Keepa price history · ${windowLabel(p.record.windowEnd)}`, pins: "Every Amazon price, discount, price-cut event, stock-out, listing date, seller count, buy-box share, rating and review-velocity figure." });
  }
  if (measuredSlots(p, "pdpScore") || measuredSlots(p, "leadTime")) {
    out.push({ lane: "Amazon product pages", measured: "Image count, video count, enhanced content, bullet count, spec table, reviews and title keyword fit, plus the promised delivery date, for each tracked listing",
      source: "Apify Amazon crawler · build date", pins: "Amazon landing-page scores and the Amazon delivery promise in the latest week." });
  }
  if (p.record.shelf) {
    const sh = p.record.shelf;
    out.push({ lane: "Retail shelf", measured: `First ${sh.depth} organic Amazon search results for "${sh.term}" on ${sh.capturedAt}, each attributed to a brand by its title`,
      source: "Apify Amazon crawler · search page", pins: "The level each brand's Amazon shelf share is anchored to." });
  }
  for (const [lane, s] of Object.entries(lanes)) {
    if (s.status === "modelled") out.push({ lane: LANE_NAMES[lane] ?? lane, measured: `MODELLED. ${s.note}`, source: "simulation seeded per brand", pins: "Levels sized from the category and the measured lanes; shape and movement modelled.", unmeasured: true });
  }
  return out;
}
