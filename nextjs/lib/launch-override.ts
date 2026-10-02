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
    [k: string]: unknown;
  };
  capturedAt?: string;
  [k: string]: unknown;
};

export type OverrideResult = {
  modifiedPaths: string[];
  withheldPaths: string[];
  mergedAt: string;
};

/**
 * Reads the vendored sonos-speakers-launch-data.json, overrides the "sonos"
 * slot's pricing + review fields with Keepa output, and returns the merged
 * launch-data for writing to the working dir.
 */
export function overrideSubjectWithKeepa(
  keepa: KeepaBrandAggregate,
): { launchData: LaunchData; audit: OverrideResult } {
  const templatePath = resolve(VENDOR_DIR(), "public", "sonos-speakers-launch-data.json");
  const template = JSON.parse(readFileSync(templatePath, "utf8")) as LaunchData;

  const now = new Date().toISOString();
  const modifiedPaths: string[] = [];
  const withheldPaths: string[] = [];

  // We overwrite the "sonos" key everywhere the subject brand lives — the
  // display name gets set in meta.subjectLabel elsewhere.
  const S = "sonos";

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

  template.capturedAt = now;

  return {
    launchData: template,
    audit: { modifiedPaths, withheldPaths, mergedAt: now },
  };
}
