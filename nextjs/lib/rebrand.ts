// Post-simulation payload rebrander.
//
// The simulation output is a Sonos-shaped command-centre payload: brand ids
// are "sonos" / "amazon" / "apple" / "bose" / "jbl", model ids are "era100" /
// "beamg2" / etc. For a new brand without its own vendored config, we want the
// dashboard to display GoPro + DJI + Insta360 + Akaso (not Sonos + Amazon Echo
// + Apple HomePod + Bose), and Hero 12 Black + Hero 11 + Max (not Era 100 +
// Beam Gen 2 + Arc Ultra).
//
// This file deep-walks the payload JSON and renames keys + values + labels.
// The numeric values stay the same — only the identity of what the numbers
// are ABOUT changes.

const SONOS_BRANDS = ["sonos", "amazon", "apple", "bose", "jbl"] as const;
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
  // Up to 4 competitors — we have 4 Sonos competitor slots to fill.
  competitors: string[];
  // Products to show as model names. Up to 6 (Sonos's catalog has 6-20 models).
  products: string[];
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

  // Subject brand → first slot (originally "sonos")
  idMap["sonos"] = input.subject.slug;
  labelMap["Sonos"] = input.subject.name;
  newBrands.push({ id: input.subject.slug, label: input.subject.name });

  // Competitors → remaining 4 slots (originally amazon/apple/bose/jbl)
  const competitorSlots = ["amazon", "apple", "bose", "jbl"];
  for (let i = 0; i < competitorSlots.length; i++) {
    const oldId = competitorSlots[i];
    const comp = input.competitors[i];
    if (comp) {
      const newId = slugify(comp);
      idMap[oldId] = newId;
      labelMap[SONOS_BRAND_LABELS[oldId]] = comp;
      newBrands.push({ id: newId, label: comp });
    } else {
      // Not enough competitors — keep the slot but relabel it generically
      const label = `Competitor ${i + 1}`;
      idMap[oldId] = `competitor-${i + 1}`;
      labelMap[SONOS_BRAND_LABELS[oldId]] = label;
      newBrands.push({ id: `competitor-${i + 1}`, label });
    }
  }

  return { idMap, labelMap, newBrands };
}

// Deep walk the payload. Three transforms applied per node:
//   1. Rename object keys that match a brand id in the map
//   2. Rename string VALUES that match a brand id when they appear in known
//      brand-reference fields (id, brand, subject, …) — anywhere a scalar
//      brand reference lives
//   3. Replace display-label strings in known fields (label, name) via the
//      label map
function rebrandDeep(
  node: unknown,
  idMap: Record<string, string>,
  labelMap: Record<string, string>,
  parentKey: string | null,
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => rebrandDeep(item, idMap, labelMap, parentKey));
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const newKey = idMap[k] ?? k;
      out[newKey] = rebrandDeep(v, idMap, labelMap, k);
    }
    return out;
  }
  if (typeof node === "string") {
    // Brand-id value fields
    if (parentKey === "brand" || parentKey === "id" || parentKey === "subject") {
      return idMap[node] ?? node;
    }
    // Brand-label fields
    if (parentKey === "label" || parentKey === "name" || parentKey === "subjectLabel") {
      return labelMap[node] ?? node;
    }
    return node;
  }
  return node;
}

// Replace the model catalog with the user's product names. Keeps numeric
// anchors (msrp, street0, launched, tier) from the original models so the
// simulated price lines + launch events still look plausible.
function rebrandModels(
  payload: Record<string, unknown>,
  subjectSlug: string,
  products: string[],
): void {
  const dims = payload.dims as Record<string, unknown> | undefined;
  if (!dims || !Array.isArray(dims.models)) return;
  const originalModels = dims.models as Array<Record<string, unknown>>;
  if (products.length === 0) return;

  // Separate subject models from competitor models. Preserve ratio.
  const subjectModels = originalModels.filter((m) => m.brand === subjectSlug);
  const otherModels = originalModels.filter((m) => m.brand !== subjectSlug);

  // Take up to products.length of the subject models and relabel.
  const relabeled: Array<Record<string, unknown>> = [];
  const n = Math.min(products.length, subjectModels.length);
  for (let i = 0; i < n; i++) {
    const base = subjectModels[i];
    const name = products[i];
    relabeled.push({
      ...base,
      id: slugify(name),
      label: name,
    });
  }
  // If user provided more products than the original has subject models, drop
  // the extras (we'd have no anchor data for them). If fewer, keep original
  // IDs for the remainder but still mark as subject.
  for (let i = n; i < subjectModels.length; i++) {
    relabeled.push(subjectModels[i]);
  }

  dims.models = [...relabeled, ...otherModels];
}

export function rebrandPayload(payload: unknown, input: RebrandInput): unknown {
  if (!payload || typeof payload !== "object") return payload;

  const { idMap, labelMap, newBrands } = buildBrandMap(input);

  // Deep-rebrand everything first.
  const rebranded = rebrandDeep(payload, idMap, labelMap, null) as Record<string, unknown>;

  // Then overwrite dims.brands with our clean new list (ids + labels + colours
  // from the Sonos template, re-indexed).
  const dims = rebranded.dims as Record<string, unknown> | undefined;
  if (dims && Array.isArray(dims.brands)) {
    const originalBrands = dims.brands as Array<Record<string, unknown>>;
    dims.brands = newBrands.map((nb, i) => {
      const base = originalBrands[i] ?? {};
      return { ...base, id: nb.id, label: nb.label, subject: i === 0 || undefined };
    });
  }

  // Replace model names if products supplied.
  rebrandModels(rebranded, input.subject.slug, input.products);

  // Ensure meta.subject + subjectLabel reflect the final identity.
  const meta = rebranded.meta as Record<string, unknown> | undefined;
  if (meta) {
    meta.subject = input.subject.slug;
    meta.subjectLabel = input.subject.name;
  }

  return rebranded;
}
