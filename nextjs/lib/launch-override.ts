// Builds a launch-data.json for a dynamic brand by taking the vendored Sonos
// launch-data as a template and overriding the subject slot's pricing + review
// fields with real Keepa numbers.
//
// Why keep the subject key as "sonos" internally?
// The config file + builder reference the subject brand by key everywhere.
// Renaming the key would mean rewriting dozens of nested paths in the config
// AND in launch-data (BRANDS array, per-brand metrics, aspect analysis…).
// Keeping the key "sonos" and swapping only the display label + the real
// numbers is 10x less surface area and keeps every downstream query working.
// The dashboard reads `meta.subjectLabel` for the display name — we set that
// in the final payload after the builder runs.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KeepaBrandAggregate } from "./keepa";
import type { AiSoMResult } from "./ai-visibility";
import type { ApifyAmazonAggregate } from "./apify";

const VENDOR_DIR = () => resolve(process.cwd(), "vendor", "bravo-platform");

type LaunchData = {
  subject?: string;
  pricing?: {
    listPrice?: Record<string, number>;
    streetPrice?: Record<string, number>;
    discountRate?: Record<string, number>;
    reviewVolume?: Record<string, number>;
    avgOffer?: Record<string, number>;
    totalOffers?: Record<string, number>;
  };
  retail?: {
    rating?: Record<string, number>;
    inStock?: Record<string, number>;
    leadTime?: Record<string, number>;
    [k: string]: unknown;
  };
  aiSearch?: {
    overall?: Record<string, number>;
    overallMentions?: Record<string, number>;
    [k: string]: unknown;
  };
  // Provenance tracking — which lanes have real data vs reference. The dashboard
  // method tab reads this to show the honest story panel-by-panel.
  provenance?: Record<string, string>;
  capturedAt?: string;
  [k: string]: unknown;
};

export type OverrideResult = {
  modifiedPaths: string[];
  withheldPaths: string[];
  mergedAt: string;
};

export type OverrideInputs = {
  keepa?: KeepaBrandAggregate;
  aiSoM?: AiSoMResult;
  apifyAmazon?: ApifyAmazonAggregate;
  // When true, the dashboard disclosure explicitly flags SimilarWeb traffic
  // as not-captured (because SIMILARWEB_API_KEY isn't configured).
  similarWebMissing?: boolean;
};

/**
 * Reads the vendored sonos-speakers-launch-data.json, overrides the "sonos"
 * slot's pricing/review/aiSearch fields with any real data provided, and
 * returns the merged launch-data for writing to the working dir.
 */
export function overrideSubject(inputs: OverrideInputs): { launchData: LaunchData; audit: OverrideResult } {
  const templatePath = resolve(VENDOR_DIR(), "public", "sonos-speakers-launch-data.json");
  const template = JSON.parse(readFileSync(templatePath, "utf8")) as LaunchData;

  const now = new Date().toISOString();
  const modifiedPaths: string[] = [];
  const withheldPaths: string[] = [];
  const S = "sonos";

  const keepa = inputs.keepa;
  if (keepa) {
    if (keepa.avgListPrice != null && template.pricing?.listPrice) {
      template.pricing.listPrice[S] = keepa.avgListPrice;
      modifiedPaths.push("pricing.listPrice.sonos");
    } else withheldPaths.push("pricing.listPrice.sonos");

    if (keepa.avgStreetPrice != null && template.pricing?.streetPrice) {
      template.pricing.streetPrice[S] = keepa.avgStreetPrice;
      modifiedPaths.push("pricing.streetPrice.sonos");
    } else withheldPaths.push("pricing.streetPrice.sonos");

    if (keepa.avgDiscountRate != null && template.pricing?.discountRate) {
      template.pricing.discountRate[S] = keepa.avgDiscountRate;
      modifiedPaths.push("pricing.discountRate.sonos");
    } else withheldPaths.push("pricing.discountRate.sonos");

    if (keepa.totalReviews != null && template.pricing?.reviewVolume) {
      template.pricing.reviewVolume[S] = keepa.totalReviews;
      modifiedPaths.push("pricing.reviewVolume.sonos");
    } else withheldPaths.push("pricing.reviewVolume.sonos");

    if (keepa.avgRating != null && template.retail?.rating) {
      template.retail.rating[S] = keepa.avgRating;
      modifiedPaths.push("retail.rating.sonos");
    } else withheldPaths.push("retail.rating.sonos");

    if (template.retail?.inStock) {
      template.retail.inStock[S] = keepa.anyInStock ? 1 : 0;
      modifiedPaths.push("retail.inStock.sonos");
    }
  }

  const aiSoM = inputs.aiSoM;
  if (aiSoM && template.aiSearch) {
    if (template.aiSearch.overall) {
      template.aiSearch.overall[S] = aiSoM.subjectShare;
      modifiedPaths.push("aiSearch.overall.sonos");
    }
    if (template.aiSearch.overallMentions) {
      template.aiSearch.overallMentions[S] = aiSoM.subjectMentions;
      modifiedPaths.push("aiSearch.overallMentions.sonos");
    }
  }

  const apify = inputs.apifyAmazon;
  if (apify && apify.asinsWithData > 0) {
    if (apify.avgPrice != null && template.pricing?.avgOffer) {
      template.pricing.avgOffer[S] = apify.avgPrice;
      modifiedPaths.push("pricing.avgOffer.sonos");
    }
    if (apify.totalOffersAvg != null && template.pricing?.totalOffers) {
      template.pricing.totalOffers[S] = apify.totalOffersAvg;
      modifiedPaths.push("pricing.totalOffers.sonos");
    }
    if (apify.avgDeliveryDays != null && template.retail?.leadTime) {
      template.retail.leadTime[S] = apify.avgDeliveryDays;
      modifiedPaths.push("retail.leadTime.sonos");
    }
    // Apify is more current than Keepa for in-stock — override even if Keepa
    // already set it.
    if (template.retail?.inStock) {
      template.retail.inStock[S] = apify.anyInStock ? 1 : 0;
      modifiedPaths.push("retail.inStock.sonos (apify)");
    }
  }

  // Provenance stamp — which upstream was consulted. Everything not listed
  // falls back to the vendored Sonos reference data.
  template.provenance = {
    ...(template.provenance ?? {}),
    keepa: inputs.keepa ? (inputs.keepa.asinsWithData > 0 ? "measured" : "attempted_no_data") : "not_run",
    ai_sov: inputs.aiSoM ? (inputs.aiSoM.totalBrandMentions > 0 ? "measured" : "attempted_no_mentions") : "not_run",
    apify_amazon: inputs.apifyAmazon ? (inputs.apifyAmazon.asinsWithData > 0 ? "measured" : "attempted_no_data") : "not_run",
    similarweb: inputs.similarWebMissing ? "key_missing" : "not_run",
    multi_retailer_apify: "not_run (needs per-retailer actors)",
    pdp_promo_apify: "not_run (needs per-retailer actors)",
    delivery_probes_apify: "not_run (needs checkout-flow actor)",
    dataforseo_google_ai: "not_run (needs DATAFORSEO_LOGIN)",
  };

  template.capturedAt = now;

  return {
    launchData: template,
    audit: { modifiedPaths, withheldPaths, mergedAt: now },
  };
}

/**
 * Backwards-compatible wrapper for the Keepa-only path.
 */
export function overrideSubjectWithKeepa(keepa: KeepaBrandAggregate) {
  return overrideSubject({ keepa });
}
