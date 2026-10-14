import { callLLM } from "./llm";
import { parseJsonObject, MECHANIC_LIBRARY, type MechanicId } from "./market-mechanics";

export type RetailerKind = "marketplace" | "mass" | "club" | "grocery" | "drug" | "specialist" | "home" | "dtc";

export type MarketRetailer = {
  id: string;
  label: string;
  domain: string;
  kind: RetailerKind;
  weight: number;
  leadDays: number;
  priceIndex: number;
  listingQuality: number;
  thirdParty: boolean;
};

export type MarketProfile = {
  version: 1;
  key: string;
  source: "llm" | "llm-unaudited" | "fallback";
  category: string;
  region: string;
  durable: boolean;
  typicalPrice: number;
  retailers: MarketRetailer[];
  carriage: Record<string, Record<string, number>>;
  mechanics: Record<string, Partial<Record<MechanicId, number>>>;
  traffic: Record<string, { domain: string | null; monthlyVisits: number }>;
  eventLift: Record<string, number>;
  changes: string[];
};

const KINDS: RetailerKind[] = ["marketplace", "mass", "club", "grocery", "drug", "specialist", "home", "dtc"];
const CARRIAGE: Record<string, number> = { yes: 0.95, some: 0.5, rare: 0.15, no: 0 };
const DURABLE_ONLY: MechanicId[] = ["protection", "financing", "tradein", "trial", "bnpl"];
const EVENT_IDS = ["presidents", "memorial", "fathers", "july4", "primeday", "b2s", "labor", "bigdeal", "bfcm", "holiday"];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
export const retailerId = (name: string): string => (/^amazon\b/i.test(name.trim()) ? "amazon" : name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "")).slice(0, 24);
const domainOf = (v: unknown): string | null => {
  const s = str(v).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
};

/**
 * Key that decides when a saved profile can be reused: the same category,
 * region and brand set give the same market on every rebuild.
 */
export function marketProfileKey(category: string, region: string, brands: string[]): string {
  return [category.trim().toLowerCase(), region.toUpperCase(), ...brands.map((b) => b.trim().toLowerCase())].join("|");
}

const MECHANIC_MENU = (Object.entries(MECHANIC_LIBRARY) as Array<[MechanicId, { label: string; when: string }]>)
  .map(([id, m]) => `- ${id}: ${m.label} — ${m.when}`).join("\n");

const SCHEMA = `{
  "durable": boolean,            // true for products kept for years (electronics, appliances); false for consumables and replenished goods
  "typicalPrice": number,        // typical shelf price of one listing in this category, in local currency
  "retailers": [                 // 4 or 5 retailers that sell the most of this category in the region, biggest first; Amazon must be one of them
    { "name": string, "domain": string, "kind": "marketplace"|"mass"|"club"|"grocery"|"drug"|"specialist"|"home"|"dtc",
      "share": number,           // share of this category's sales across the listed retailers, 0-100
      "leadDays": number,        // typical days from online order to delivery
      "priceIndex": number,      // typical shelf price vs Amazon for the same item, Amazon = 1.00
      "listingQuality": number,  // 0-1, how complete brand product pages tend to be on this retailer
      "thirdParty": boolean }    // true when most listings are sold by third-party sellers
  ],
  "carriage": { "<brand>": { "<retailer name>": "yes"|"some"|"rare"|"no" } },   // does this retailer actually sell this brand in this category today
  "mechanics": { "<retailer name>": { "<mechanic id>": 1-5 } },                 // promotion mechanics this retailer really runs in this category, with how often (5 = constantly)
  "traffic": { "<brand>": { "domain": string|null, "monthlyVisits": number } }, // the brand's own website and its monthly visits worldwide; null domain if the brand has no site of its own
  "eventLift": { "<event id>": number }                                         // demand multiplier for this category on each retail event, 1.0 = no lift
}`;

function prompt(category: string, region: string, brands: string[], subjectSite: string | null): string {
  return `Category: ${category}
Region: ${region}
Brands: ${brands.join(", ")}${subjectSite ? `\n${brands[0]}'s official site: ${subjectSite}` : ""}

Describe the real retail market for this category in this region as JSON matching this schema (no comments in your output):
${SCHEMA}

Mechanic ids you may use (only these):
${MECHANIC_MENU}

Event ids: ${EVENT_IDS.join(", ")}

Rules:
- Only retailers that genuinely sell this category in volume in ${region}. Never include a retailer just because it is large: an electronics chain does not sell toiletries, a grocer does not sell televisions.
- Carriage must reflect where each brand is actually stocked. A small direct-to-consumer brand is usually "no" at clubs and grocers; a house brand is only "yes" at its owner.
- Mechanics must be ones this retailer runs for this category: protection plans, financing and trade-ins only exist for durable goods; subscribe-and-save, digital coupons and multi-buy deals are typical for consumables.
- monthlyVisits is the order of magnitude a web-analytics panel would show for the brand's own site, not for its retail listings. A niche brand's site gets tens of thousands of visits, a household brand's site a few hundred thousand to low millions. Brands sold mainly through retailers have small sites.
- eventLift reflects how much this category really moves on that event: Prime Day lifts most Amazon categories, back to school matters for school supplies and laptops, holiday gifting barely moves household staples.
- Use the brand names and retailer names exactly as you list them, consistently across all fields.
Return only the JSON object.`;
}

function auditPrompt(category: string, region: string, brands: string[], draft: string): string {
  return `You are auditing a market profile before it drives a commercial dashboard that a brand team will read. Anything that is not true of the real ${region} market for "${category}" will be spotted immediately and discredit the whole dashboard.

Brands: ${brands.join(", ")}

Draft:
${draft}

Mechanic ids allowed: ${Object.keys(MECHANIC_LIBRARY).join(", ")}

Check every field against what you know of the real market:
- Is each retailer a real, major seller of this category in ${region}? Replace any that are not (for example an electronics chain listed for a grocery product) with one that is.
- For every brand × retailer, is the brand really stocked there? Correct anything that overstates a small brand's distribution.
- Does each retailer really run each listed mechanic for this category? Remove mechanics that do not apply (protection plans, financing and trade-ins on consumables, for example).
- Is each brand's domain its real official site, and is monthlyVisits the right order of magnitude?
- Are the event lifts plausible for this category?

Return JSON: { "profile": <the corrected profile, same schema as the draft>, "changes": [ "<one short line per correction>" ] }. If nothing needs correcting, return the draft unchanged with an empty changes list. Return only the JSON object.`;
}

type RawProfile = {
  durable?: unknown;
  typicalPrice?: unknown;
  retailers?: unknown;
  carriage?: unknown;
  mechanics?: unknown;
  traffic?: unknown;
  eventLift?: unknown;
};

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function lookup<T>(map: Record<string, T>, name: string): T | undefined {
  if (name in map) return map[name];
  const want = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = Object.keys(map).find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "") === want);
  return hit ? map[hit] : undefined;
}

/**
 * Turns a raw model answer into a profile the builder can run on: every
 * number clamped to a sane range, Amazon always present, weights normalised,
 * mechanics limited to the library and to what the category can carry.
 */
export function normaliseProfile(raw: RawProfile, ctx: { key: string; category: string; region: string; brands: string[]; source: MarketProfile["source"]; changes: string[] }): MarketProfile {
  const durable = raw.durable === true;
  const typicalPrice = clamp(num(raw.typicalPrice, 25), 1, 20000);
  const seen = new Set<string>();
  const retailers: MarketRetailer[] = [];
  const rawRetailers = Array.isArray(raw.retailers) ? raw.retailers.map(record) : [];
  for (const r of rawRetailers) {
    const label = str(r.name);
    const id = retailerId(label);
    if (!label || !id || seen.has(id)) continue;
    seen.add(id);
    const kind = KINDS.includes(r.kind as RetailerKind) ? (r.kind as RetailerKind) : id === "amazon" ? "marketplace" : "mass";
    retailers.push({
      id,
      label: id === "amazon" ? "Amazon" : label,
      domain: domainOf(r.domain) ?? `${id}.com`,
      kind,
      weight: clamp(num(r.share, 10), 1, 90),
      leadDays: Math.round(clamp(num(r.leadDays, 3), 1, 10) * 10) / 10,
      priceIndex: Math.round(clamp(num(r.priceIndex, 1), 0.85, 1.2) * 1000) / 1000,
      listingQuality: Math.round(clamp(num(r.listingQuality, 0.85), 0.5, 1) * 100) / 100,
      thirdParty: id !== "amazon" && r.thirdParty === true,
    });
    if (retailers.length === 5) break;
  }
  if (!seen.has("amazon")) {
    retailers.unshift({ id: "amazon", label: "Amazon", domain: "amazon.com", kind: "marketplace", weight: 40, leadDays: 2, priceIndex: 1, listingQuality: 1, thirdParty: false });
    if (retailers.length > 5) retailers.pop();
  }
  const total = retailers.reduce((s, r) => s + r.weight, 0) || 1;
  for (const r of retailers) r.weight = Math.round((r.weight / total) * 100) / 100;

  const rawCarriage = record(raw.carriage);
  const carriage: MarketProfile["carriage"] = {};
  for (const brand of ctx.brands) {
    const row = record(lookup(rawCarriage, brand));
    carriage[brand] = Object.fromEntries(retailers.map((r) => {
      if (r.id === "amazon") return [r.id, 1];
      const v = lookup(row, r.label) ?? lookup(row, r.id);
      return [r.id, typeof v === "number" ? clamp(v, 0, 1) : CARRIAGE[str(v).toLowerCase()] ?? 0.5];
    }));
  }

  const rawMech = record(raw.mechanics);
  const mechanics: MarketProfile["mechanics"] = {};
  for (const r of retailers) {
    const row = record(lookup(rawMech, r.label) ?? lookup(rawMech, r.id));
    const out: Partial<Record<MechanicId, number>> = {};
    for (const [k, v] of Object.entries(row)) {
      const id = k as MechanicId;
      if (!(id in MECHANIC_LIBRARY)) continue;
      if (!durable && DURABLE_ONLY.includes(id)) continue;
      if ((id === "financing" || id === "bnpl") && typicalPrice < 60) continue;
      out[id] = Math.round(clamp(num(v, 2), 1, 5));
    }
    if (!out.discount) out.discount = 2;
    mechanics[r.id] = out;
  }

  const rawTraffic = record(raw.traffic);
  const traffic: MarketProfile["traffic"] = {};
  for (const brand of ctx.brands) {
    const t = record(lookup(rawTraffic, brand));
    traffic[brand] = { domain: domainOf(t.domain), monthlyVisits: Math.round(clamp(num(t.monthlyVisits, 50000), 2000, 400_000_000)) };
  }

  const rawEvents = record(raw.eventLift);
  const eventLift = Object.fromEntries(EVENT_IDS.flatMap((id) => (rawEvents[id] == null ? [] : [[id, Math.round(clamp(num(rawEvents[id], 1), 0.9, 2.6) * 100) / 100]])));

  return { version: 1, key: ctx.key, source: ctx.source, category: ctx.category, region: ctx.region, durable, typicalPrice, retailers, carriage, mechanics, traffic, eventLift, changes: ctx.changes };
}

/**
 * A plain profile for when Claude cannot be reached: the three retailers that
 * sell almost every category, with the mechanics every category has.
 */
export function fallbackProfile(category: string, region: string, brands: string[]): MarketProfile {
  return normaliseProfile({
    durable: false,
    typicalPrice: 30,
    retailers: [
      { name: "Amazon", domain: "amazon.com", kind: "marketplace", share: 48, leadDays: 2, priceIndex: 1, listingQuality: 1 },
      { name: "Walmart", domain: "walmart.com", kind: "mass", share: 30, leadDays: 3, priceIndex: 0.99, listingQuality: 0.82 },
      { name: "Target", domain: "target.com", kind: "mass", share: 22, leadDays: 3.5, priceIndex: 1.02, listingQuality: 0.88 },
    ],
    carriage: Object.fromEntries(brands.map((b) => [b, { Walmart: "some", Target: "some" }])),
    mechanics: { Amazon: { discount: 4, coupon: 3, delivery: 4 }, Walmart: { discount: 3, delivery: 3 }, Target: { discount: 2, loyalty: 3, delivery: 2 } },
    traffic: {},
    eventLift: {},
  }, { key: marketProfileKey(category, region, brands), category, region, brands, source: "fallback", changes: [] });
}

/**
 * The retail market a category sells through, written by Claude and then
 * checked by a second Claude pass that corrects anything untrue, before code
 * clamps every value. Falls back to a plain three-retailer market.
 */
export async function generateMarketProfile(input: { category: string; region: string; brands: string[]; subjectSite?: string | null; log?: (line: string) => void }): Promise<MarketProfile> {
  const profile = await draftAndAudit(input);
  const site = domainOf(input.subjectSite);
  const subject = input.brands[0];
  if (site && subject && profile.traffic[subject]) profile.traffic[subject] = { ...profile.traffic[subject], domain: site };
  return profile;
}

async function draftAndAudit(input: { category: string; region: string; brands: string[]; subjectSite?: string | null; log?: (line: string) => void }): Promise<MarketProfile> {
  const { category, region, brands } = input;
  const log = input.log ?? (() => {});
  const key = marketProfileKey(category, region, brands);
  const system = "You are a retail category analyst with detailed, current knowledge of which retailers sell which brands, the promotions they run and the size of brand websites. You answer only with valid JSON.";
  let draft: Record<string, unknown> | null = null;
  try {
    draft = parseJsonObject(await callLLM({ system, user: prompt(category, region, brands, input.subjectSite ?? null), maxTokens: 3000, temperature: 0 }));
  } catch (e) {
    log(`market profile: draft failed (${(e as Error).message.slice(0, 120)}); using the plain three-retailer market`);
    return fallbackProfile(category, region, brands);
  }
  if (!draft) {
    log("market profile: draft was not JSON; using the plain three-retailer market");
    return fallbackProfile(category, region, brands);
  }
  try {
    const audited = parseJsonObject(await callLLM({ system, user: auditPrompt(category, region, brands, JSON.stringify(draft)), maxTokens: 3500, temperature: 0 }));
    const profile = audited ? record(audited.profile) : {};
    const changes = Array.isArray(audited?.changes) ? audited.changes.map(str).filter(Boolean).slice(0, 30) : [];
    if (Array.isArray(profile.retailers) && profile.retailers.length) {
      return normaliseProfile(profile, { key, category, region, brands, source: "llm", changes });
    }
    log("market profile: audit returned no profile; using the unaudited draft");
  } catch (e) {
    log(`market profile: audit failed (${(e as Error).message.slice(0, 120)}); using the unaudited draft`);
  }
  return normaliseProfile(draft, { key, category, region, brands, source: "llm-unaudited", changes: [] });
}
