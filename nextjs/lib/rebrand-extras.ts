// Rebranders for the Sony-full-variant extras: AI Visibility, AEO Workbench,
// Snapshots. Each payload has its own brand roster (Sony/Samsung/LG/TCL) and
// its own model catalogue; we rewrite them to the user's inputs the same way
// the base rebrander handles the Sonos payload.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SONY_BRANDS = ["sony", "samsung", "lg", "tcl"] as const;
const SONY_BRAND_LABELS: Record<string, string> = {
  sony: "Sony", samsung: "Samsung", lg: "LG", tcl: "TCL",
};

// A short list of Sony product names that appear verbatim in the payloads
// (BRAVIA models). Order matters for the longest-first text replace.
const SONY_SUBJECT_PRODUCTS = [
  "BRAVIA 9", "BRAVIA 8 II", "BRAVIA 8", "BRAVIA 7", "BRAVIA 5",
  "BRAVIA 3", "A95L", "A80L", "A75L", "X95L", "X90L", "X80L",
];
const SAMSUNG_PRODUCTS = ["S95D", "S90D", "QN95D", "QN90D", "QN85D", "QN800D"];
const LG_PRODUCTS = ["G4", "C4", "B4", "QNED99", "QNED90", "QNED85"];
const TCL_PRODUCTS = ["QM8", "QM7", "QM6", "C845", "C755"];

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

export type ExtrasRebrandInput = {
  subject: { name: string; slug: string };
  // 4 competitor names (parallel to Sony's samsung/lg/tcl slots). If fewer
  // than 3 competitors, synthetic names fill the gap.
  competitors: string[];
  subjectProducts: string[];
  competitorProducts: string[][]; // parallel to competitors
  category: string;
};

function buildExtrasMap(input: ExtrasRebrandInput): {
  idMap: Record<string, string>;
  labelMap: Record<string, string>;
  textRewrites: Array<[RegExp, string]>;
} {
  const idMap: Record<string, string> = {};
  const labelMap: Record<string, string> = {};
  idMap["sony"] = input.subject.slug;
  labelMap["Sony"] = input.subject.name;

  const slots = ["samsung", "lg", "tcl"];
  for (let i = 0; i < slots.length; i++) {
    const oldId = slots[i];
    const comp = input.competitors[i];
    if (comp) {
      idMap[oldId] = slugify(comp);
      labelMap[SONY_BRAND_LABELS[oldId]] = comp;
    } else {
      idMap[oldId] = `comp${i + 1}`;
      labelMap[SONY_BRAND_LABELS[oldId]] = `Competitor ${i + 1}`;
    }
  }

  // Text rewrites: longest first so "BRAVIA 8 II" is matched before "BRAVIA 8".
  const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const textRewrites: Array<[RegExp, string]> = [];
  for (const [sonyLabel, userLabel] of Object.entries(labelMap)) {
    textRewrites.push([new RegExp(`\\b${esc(sonyLabel)}\\b`, "g"), userLabel]);
  }
  const addProductRewrites = (sonyList: string[], userList: string[]) => {
    for (let i = 0; i < sonyList.length; i++) {
      const user = userList[i] ?? userList[0] ?? "";
      if (!user) continue;
      textRewrites.push([new RegExp(esc(sonyList[i]), "g"), user]);
    }
  };
  addProductRewrites(SONY_SUBJECT_PRODUCTS, input.subjectProducts);
  if (input.competitorProducts[0]) addProductRewrites(SAMSUNG_PRODUCTS, input.competitorProducts[0]);
  if (input.competitorProducts[1]) addProductRewrites(LG_PRODUCTS, input.competitorProducts[1]);
  if (input.competitorProducts[2]) addProductRewrites(TCL_PRODUCTS, input.competitorProducts[2]);
  // Category name — "tv" → user's category (e.g. "cordless vacuum")
  textRewrites.push([/\btv\b/gi, input.category]);
  textRewrites.push([/\btelevisions?\b/gi, input.category]);
  // Sort by original pattern length descending
  textRewrites.sort((a, b) => b[0].source.length - a[0].source.length);

  return { idMap, labelMap, textRewrites };
}

// Deep walker: renames object keys matching a brand id, renames `brand`/
// `topBrand`/`id` VALUES, rewrites string values via text replace.
function rebrandDeep(
  node: unknown,
  idMap: Record<string, string>,
  textRewrites: Array<[RegExp, string]>,
  parentKey: string | null,
): unknown {
  if (Array.isArray(node)) {
    return node.map((x) => rebrandDeep(x, idMap, textRewrites, parentKey));
  }
  if (node && typeof node === "object") {
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      const newKey = idMap[k] ?? k;
      out[newKey] = rebrandDeep(v, idMap, textRewrites, k);
    }
    return out;
  }
  if (typeof node === "string") {
    // 1. Brand-id valued fields: id, brand, topBrand, subject, instance
    if (["brand", "topBrand", "subject", "instance"].includes(parentKey ?? "") && idMap[node]) {
      return idMap[node];
    }
    // 2. The `id` key value can also be a brand id (in brands arrays).
    //    We only rename if it's a known brand id to avoid remapping unrelated ids.
    if (parentKey === "id" && idMap[node]) {
      return idMap[node];
    }
    // 3. Text-level prose rewrite — brand labels + model names + "tv" → category
    let out = node;
    for (const [re, replacement] of textRewrites) out = out.replace(re, replacement);
    return out;
  }
  return node;
}

const VENDOR_DIR = () => resolve(process.cwd(), "vendor", "bravo-platform");

function loadTemplate(filename: string): Record<string, unknown> {
  const path = resolve(VENDOR_DIR(), "public", filename);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function rebrandAiVisibility(input: ExtrasRebrandInput): Record<string, unknown> {
  const template = loadTemplate("sony-ai-visibility-data.json");
  const { idMap, textRewrites } = buildExtrasMap(input);
  const out = rebrandDeep(template, idMap, textRewrites, null) as Record<string, unknown>;
  // Overwrite the top-level identity fields with the clean user inputs
  out.instance = input.subject.slug;
  out.subject = input.subject.slug;
  out.subjectLabel = input.subject.name;
  out.category = input.category;
  return out;
}

export function rebrandAeoWorkbench(input: ExtrasRebrandInput): Record<string, unknown> {
  const template = loadTemplate("sony-aeo-workbench-data.json");
  const { idMap, textRewrites } = buildExtrasMap(input);
  const out = rebrandDeep(template, idMap, textRewrites, null) as Record<string, unknown>;
  const meta = out.meta as Record<string, unknown> | undefined;
  if (meta) {
    meta.subject = input.subject.slug;
    meta.subjectLabel = input.subject.name;
    meta.title = `${input.subject.name} · AEO Workbench`;
    meta.category = input.category;
    delete meta.brandMark;
  }
  return out;
}

export function rebrandSnapshots(input: ExtrasRebrandInput): Record<string, unknown> {
  const template = loadTemplate("sony-snapshots.json");
  const { idMap, textRewrites } = buildExtrasMap(input);
  const out = rebrandDeep(template, idMap, textRewrites, null) as Record<string, unknown>;
  out.instance = input.subject.slug;
  out.subject = input.subject.slug;
  // Image URLs point at /evidence/braviapp/*.jpg which don't exist for a new
  // brand. Null the img field so the snapshots viewer shows "no proof" state
  // instead of broken image icons.
  if (Array.isArray(out.entries)) {
    out.entries = (out.entries as Array<Record<string, unknown>>).map((e) => ({
      ...e,
      img: null,
      source: null,
      extra: null,
    }));
  }
  return out;
}
