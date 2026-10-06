// Post-simulation payload rebrander — v2 (context-aware).
//
// v1's mistake: it did a GLOBAL deep key-rename of brand ids. That corrupted
// unrelated sections — e.g. dims.retailers.amazon (the Amazon retailer) got
// renamed to 'rtic' because 'amazon' was in the brand map. v2 only touches
// explicitly brand-aware sections.
//
// Payload sections and their rebrand treatment:
//   meta                 → set meta.subject + subjectLabel
//   dims.brands          → wipe + rewrite from the user's brand list
//   dims.models          → rewrite ALL 20 slots (subject's N + competitors' slots)
//                          using user products for subject, Claude-generated
//                          per-competitor model names for the rest
//   dims.retailers       → LEAVE ALONE (Amazon/Best Buy/Target/Walmart/Newegg)
//   dims.engines         → LEAVE ALONE (gpt/perplexity/gemini/claude)
//   dims.cities,metrics  → LEAVE ALONE
//   scorecard[cadence]   → rename brand KEYS in every nested map
//   trend[metric][brand] → rename brand KEYS
//   pricing/shelf/etc    → rename brand KEYS in all per-brand sub-maps
//   voice.rating.{brand} → rename brand KEYS (incl. voice.aspects.{brand})
//   ai.overall.{brand}   → rename brand KEYS (incl. byEngineStage.*.*.{brand})
//   pdpScores,tco        → rewrite .model/.brand references
//   reads                → leave the prose; brand labels inside are fine
//
// What stays untouched is as important as what gets touched.

const SONOS_BRAND_IDS = ["sonos", "amazon", "apple", "bose", "jbl"] as const;
const SONOS_BRAND_LABELS: Record<string, string> = {
  sonos: "Sonos",
  amazon: "Amazon Echo",
  apple: "Apple HomePod",
  bose: "Bose",
  jbl: "JBL",
};

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

export type RebrandInput = {
  subject: { name: string; slug: string };
  competitors: string[];
  subjectProducts: string[];
  // One list per competitor; parallel to the competitors array. If empty, a
  // placeholder is used.
  competitorProducts: string[][];
};

type BrandRef = { id: string; label: string };

function buildBrandMap(input: RebrandInput): {
  idMap: Record<string, string>;
  labelMap: Record<string, string>;
  newBrands: BrandRef[];
} {
  const idMap: Record<string, string> = {};
  const labelMap: Record<string, string> = {};
  const newBrands: BrandRef[] = [];

  idMap["sonos"] = input.subject.slug;
  labelMap["Sonos"] = input.subject.name;
  newBrands.push({ id: input.subject.slug, label: input.subject.name });

  const slots = ["amazon", "apple", "bose", "jbl"];
  for (let i = 0; i < slots.length; i++) {
    const oldId = slots[i];
    const comp = input.competitors[i];
    if (comp) {
      const newId = slugify(comp);
      idMap[oldId] = newId;
      labelMap[SONOS_BRAND_LABELS[oldId]] = comp;
      newBrands.push({ id: newId, label: comp });
    } else {
      const label = `Competitor ${i + 1}`;
      idMap[oldId] = `comp${i + 1}`;
      labelMap[SONOS_BRAND_LABELS[oldId]] = label;
      newBrands.push({ id: `comp${i + 1}`, label });
    }
  }
  return { idMap, labelMap, newBrands };
}

// Walks a value tree. At every object, if the object has a key that matches a
// Sonos brand id, that key is renamed. Values are NOT remapped (so unrelated
// strings that happen to equal "amazon" are safe). Used for scorecard, trend,
// pricing, shelf, distribution, availability, voice, ai, promotions, traffic.
function renameBrandKeys(node: unknown, idMap: Record<string, string>): unknown {
  if (Array.isArray(node)) return node.map((x) => renameBrandKeys(x, idMap));
  if (node && typeof node === "object") {
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      const newKey = idMap[k] ?? k;
      out[newKey] = renameBrandKeys(v, idMap);
    }
    return out;
  }
  return node;
}

// Walks nested objects and when it finds a value in a key named `brand` (or
// equal to one of the brand keys), remaps the value. Used for arrays-of-objects
// like dims.models, pdpScores, tco, etc., where each row has { brand: "sonos" }.
function remapBrandValues(node: unknown, idMap: Record<string, string>): unknown {
  if (Array.isArray(node)) return node.map((x) => remapBrandValues(x, idMap));
  if (node && typeof node === "object") {
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === "brand" && typeof v === "string" && idMap[v]) {
        out[k] = idMap[v];
      } else {
        out[k] = remapBrandValues(v, idMap);
      }
    }
    return out;
  }
  return node;
}

// Build a new dims.brands array from scratch. Keeps the colour/soft palette of
// the Sonos template (indexed by slot).
function rewriteDimsBrands(
  originalBrands: Array<Record<string, unknown>>,
  newBrands: BrandRef[],
): Array<Record<string, unknown>> {
  return newBrands.map((nb, i) => {
    const base = originalBrands[i] ?? {};
    return { ...base, id: nb.id, label: nb.label, subject: i === 0 ? true : undefined };
  });
}

// Rewrite dims.models to show the user's products for the subject + reasonable
// competitor product names. Numeric anchors (msrp, street0, launched, tier)
// are kept from the original Sonos models at the same slot index, so the
// simulated price lines + launch events still look plausible.
function rewriteDimsModels(
  originalModels: Array<Record<string, unknown>>,
  idMap: Record<string, string>,
  subject: BrandRef,
  competitors: BrandRef[],
  subjectProducts: string[],
  competitorProducts: string[][],
): Array<Record<string, unknown>> {
  // Group the original models by (new) brand slot
  const byOldBrand: Record<string, Array<Record<string, unknown>>> = {};
  for (const m of originalModels) {
    const b = String(m.brand ?? "");
    (byOldBrand[b] ??= []).push(m);
  }

  const out: Array<Record<string, unknown>> = [];

  const emitForBrand = (
    oldBrand: string,
    newBrand: BrandRef,
    products: string[],
  ) => {
    const originals = byOldBrand[oldBrand] ?? [];
    const n = originals.length; // keep same count so the dashboard stays balanced
    for (let i = 0; i < n; i++) {
      const base = originals[i];
      // CRITICAL: keep the ORIGINAL model id. Many downstream sections key
      // their data by `${modelId}|${retailerId}` (pricing.price, carriage,
      // sellers, …). Renaming the id orphans every one of those lookups.
      // Only the LABEL changes — that's what the dashboard shows.
      const name = base.measured === true ? String(base.label) : products[i] ?? `${newBrand.label} ${i + 1}`;
      out.push({
        ...base,
        label: name,
        brand: newBrand.id,
        // keep base.id unchanged
      });
    }
  };

  // Subject brand first (originally "sonos")
  emitForBrand("sonos", subject, subjectProducts);

  // Each competitor
  const slots = ["amazon", "apple", "bose", "jbl"];
  for (let i = 0; i < slots.length; i++) {
    const comp = competitors[i];
    const products = competitorProducts[i] ?? [];
    emitForBrand(slots[i], comp, products);
  }

  return out;
}

export function rebrandPayload(payload: unknown, input: RebrandInput): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = { ...(payload as Record<string, unknown>) };

  const { idMap, labelMap, newBrands } = buildBrandMap(input);
  const subjectBrand = newBrands[0];
  const competitors = newBrands.slice(1);

  // Sections where brand ids are used as object keys. Only these get the key
  // rename — nothing else is touched, so retailers / engines / cities / metrics
  // / periods / etc. stay intact.
  const BRAND_KEY_SECTIONS = [
    "scorecard",
    "trend",
    "pricing",
    "shelf",
    "distribution",
    "availability",
    "delivery",
    "voice",
    "ai",
    "promotions",
    "traffic",
  ] as const;
  for (const section of BRAND_KEY_SECTIONS) {
    if (p[section] != null) p[section] = renameBrandKeys(p[section], idMap);
  }

  // Sections where brand ids are string VALUES of a `brand` property on each
  // array element. Discovered by walking the Sonos payload for every path
  // where a `brand` key exists.
  if (Array.isArray(p.pdpScores)) p.pdpScores = remapBrandValues(p.pdpScores, idMap);
  const shelfObj = p.shelf as { measured?: { results?: unknown } } | undefined;
  if (shelfObj?.measured?.results) shelfObj.measured.results = remapBrandValues(shelfObj.measured.results, idMap);
  if (Array.isArray(p.tco)) p.tco = remapBrandValues(p.tco, idMap);
  const availability = p.availability as Record<string, unknown> | undefined;
  if (availability?.episodes && Array.isArray(availability.episodes)) {
    availability.episodes = remapBrandValues(availability.episodes, idMap);
  }
  const distribution = p.distribution as Record<string, unknown> | undefined;
  if (distribution?.listings && Array.isArray(distribution.listings)) {
    distribution.listings = remapBrandValues(distribution.listings, idMap);
  }
  const pricingObj = p.pricing as Record<string, unknown> | undefined;
  if (pricingObj?.dispersion && Array.isArray(pricingObj.dispersion)) {
    pricingObj.dispersion = remapBrandValues(pricingObj.dispersion, idMap);
  }
  if (pricingObj?.mapBreaches && Array.isArray(pricingObj.mapBreaches)) {
    pricingObj.mapBreaches = remapBrandValues(pricingObj.mapBreaches, idMap);
  }
  const promotionsObj = p.promotions as Record<string, unknown> | undefined;
  if (promotionsObj?.events && Array.isArray(promotionsObj.events)) {
    promotionsObj.events = remapBrandValues(promotionsObj.events, idMap);
  }

  // ai.byEngineStage uses compound string keys like "gpt|awareness|sonos" —
  // the trailing segment is a brand id. Pure key-rename misses these.
  const aiObj = p.ai as Record<string, unknown> | undefined;
  if (aiObj?.byEngineStage && typeof aiObj.byEngineStage === "object" && !Array.isArray(aiObj.byEngineStage)) {
    const src = aiObj.byEngineStage as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      const parts = k.split("|");
      const brand = parts[parts.length - 1];
      if (idMap[brand]) parts[parts.length - 1] = idMap[brand];
      next[parts.join("|")] = v;
    }
    aiObj.byEngineStage = next;
  }

  const renameLastSegment = (src: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(src).map(([k, v]) => {
      const parts = k.split("|");
      const last = parts[parts.length - 1];
      if (parts.length > 1 && idMap[last]) parts[parts.length - 1] = idMap[last];
      return [parts.join("|"), v];
    }));
  const shelfSeries = p.shelf as Record<string, unknown> | undefined;
  for (const key of ["sov", "rank", "sponsored"]) {
    const v = shelfSeries?.[key];
    if (v && typeof v === "object" && !Array.isArray(v)) shelfSeries[key] = renameLastSegment(v as Record<string, unknown>);
  }

  // ai.prompts[].topBrand is a brand VALUE, not a key
  if (Array.isArray(aiObj?.prompts)) {
    aiObj.prompts = remapBrandValues(aiObj.prompts, {
      ...idMap,
      // Also handle `topBrand` which may be seen as a brand field — the
      // remapBrandValues function only looks at `brand` currently. Patch
      // ad-hoc for topBrand.
    });
    // Patch topBrand specifically
    aiObj.prompts = (aiObj.prompts as Array<Record<string, unknown>>).map((row) => {
      const tb = row.topBrand;
      if (typeof tb === "string" && idMap[tb]) return { ...row, topBrand: idMap[tb] };
      return row;
    });
  }

  // Text-level prose replacement across `reads` and ai.prompts[].q — brand
  // LABEL substitution ("Sonos" → "Yeti", "Amazon Echo" → "RTIC", etc.) +
  // model-name substitution. Done last so earlier structural changes aren't
  // disturbed.
  const textRewrites: Array<[RegExp, string]> = [];
  const userLabels = new Set(newBrands.map((b) => b.label.toLowerCase()));
  for (const [sonosLabel, userLabel] of Object.entries(labelMap)) {
    if (userLabels.has(sonosLabel.toLowerCase())) continue;
    textRewrites.push([new RegExp(`\\b${sonosLabel.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "g"), userLabel]);
  }
  // Sonos model names → user product names. Zip the ones we have.
  const sonosModels = ["Era 100", "Era 300", "Beam (Gen 2)", "Arc Ultra", "Move 2", "Roam 2", "Era 100 SL"];
  const amazonModels = ["Echo Studio", "Echo Dot Max", "Echo Spot", "Echo Show 8"];
  const appleModels = ["HomePod (2nd gen)", "HomePod mini"];
  const boseModels = ["SoundLink Max", "SoundLink Revolve+", "Smart Speaker 500"];
  const jblModels = ["JBL Charge 5", "JBL Charge 6", "JBL Flip 7", "JBL Xtreme 4"];
  const addModelRewrites = (sonosList: string[], userProducts: string[]) => {
    for (let i = 0; i < sonosList.length; i++) {
      const user = userProducts[i] ?? userProducts[0] ?? "";
      if (!user) continue;
      textRewrites.push([new RegExp(sonosList[i].replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"), user]);
    }
  };
  addModelRewrites(sonosModels, input.subjectProducts);
  if (input.competitorProducts[0]) addModelRewrites(amazonModels, input.competitorProducts[0]);
  if (input.competitorProducts[1]) addModelRewrites(appleModels, input.competitorProducts[1]);
  if (input.competitorProducts[2]) addModelRewrites(boseModels, input.competitorProducts[2]);
  if (input.competitorProducts[3]) addModelRewrites(jblModels, input.competitorProducts[3]);
  // Sort rewrites by original pattern length descending so "Era 100 SL" is
  // matched before "Era 100" and "Amazon Echo" before "Amazon".
  textRewrites.sort((a, b) => b[0].source.length - a[0].source.length);

  const anchored = textRewrites.map(([re, replacement]) => [new RegExp(`^(?:${re.source})$`), replacement] as const);
  const combined = textRewrites.length ? new RegExp(textRewrites.map(([re]) => `(?:${re.source})`).join("|"), "g") : null;
  const rewriteText = (s: string): string =>
    combined ? s.replace(combined, (m) => anchored.find(([re]) => re.test(m))?.[1] ?? m) : s;
  const walkStrings = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walkStrings);
    if (node && typeof node === "object") {
      const src = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) out[k] = walkStrings(v);
      return out;
    }
    if (typeof node === "string") return rewriteText(node);
    return node;
  };
  if (p.reads) p.reads = walkStrings(p.reads);
  if (aiObj?.prompts) aiObj.prompts = walkStrings(aiObj.prompts);
  // dims.events and dims.stages contain prose like "Sonos Play + Era 100 SL
  // on shelf" and category-specific question strings. Rewrite those too.
  const dimsObj = p.dims as Record<string, unknown> | undefined;
  if (dimsObj?.events) dimsObj.events = walkStrings(dimsObj.events);
  if (dimsObj?.stages) dimsObj.stages = walkStrings(dimsObj.stages);

  // dims — rewrite only the brand-aware sub-sections.
  const dims = { ...(p.dims as Record<string, unknown>) };
  if (Array.isArray(dims.brands)) {
    dims.brands = rewriteDimsBrands(dims.brands as Array<Record<string, unknown>>, newBrands);
  }
  if (Array.isArray(dims.models)) {
    dims.models = rewriteDimsModels(
      dims.models as Array<Record<string, unknown>>,
      idMap,
      subjectBrand,
      competitors,
      input.subjectProducts,
      input.competitorProducts,
    );
  }
  p.dims = dims;

  const meta = { ...(p.meta as Record<string, unknown>) };
  meta.subject = subjectBrand.id;
  meta.subjectLabel = subjectBrand.label;
  const provenance = meta.provenance as { metrics?: unknown; record?: unknown; applied?: Record<string, unknown>; subjectSlot?: string } | undefined;
  if (provenance) {
    meta.provenance = {
      ...provenance,
      metrics: renameBrandKeys(provenance.metrics, idMap),
      record: renameBrandKeys(remapBrandValues(provenance.record, idMap), idMap),
      applied: Object.fromEntries(Object.entries(provenance.applied ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => (typeof x === "string" ? idMap[x] ?? x : x)) : v])),
      subjectSlot: subjectBrand.id,
    };
  }
  p.meta = meta;

  return p;
}
