export type MechanicId =
  | "discount" | "coupon" | "subscribe" | "multibuy" | "giftcard" | "loyalty" | "delivery" | "bundle" | "clearance"
  | "card" | "cashback" | "bnpl" | "financing" | "tradein" | "protection" | "trial";

type Family = "price" | "finance" | "value" | "addon";

type Mechanic = {
  label: string;
  when: string;
  family: Family;
  costToBrand: number;
  attach: number;
  note: string;
  mode?: "always" | "episodic";
  depth?: [number, number];
};

const FAMILY_COLOR: Record<Family, string> = { price: "#be123c", finance: "#2563eb", value: "#0891b2", addon: "#5b21b6" };

export const MECHANIC_LIBRARY: Record<MechanicId, Mechanic> = {
  discount: { label: "Price discount", when: "straight markdown off the shelf price; every retailer", family: "price", costToBrand: 1, attach: 1, note: "Straight markdown off the shelf price. Modelled as fully brand-funded through price protection — the assumption on this page a commercial team is most likely to want to change, and the one that moves the funding split furthest." },
  coupon: { label: "Digital coupon", when: "clip or app coupon taken at checkout (Amazon clip coupons, Target Circle, Walmart rollback coupons)", family: "price", costToBrand: 0.9, attach: 0.38, mode: "episodic", depth: [8, 25], note: "Clip or app coupon taken at checkout; only shoppers who clip it get it." },
  subscribe: { label: "Subscribe & save", when: "repeat-delivery discount on replenished goods (Amazon Subscribe & Save, Target and Walmart auto-delivery)", family: "price", costToBrand: 0.5, attach: 0.27, mode: "always", depth: [5, 15], note: "Repeat-delivery discount, taken only by shoppers who subscribe." },
  multibuy: { label: "Multi-buy", when: "buy 2 save $X, buy 2 get 1, BOGO 50% on consumables and household goods", family: "price", costToBrand: 0.8, attach: 0.3, mode: "episodic", depth: [15, 33], note: "Saving earned by buying more than one, e.g. buy 2 get 1 free." },
  giftcard: { label: "Gift card with purchase", when: "spend $X on the category, get a $5–$10 retailer gift card (Target, CVS, Walgreens)", family: "value", costToBrand: 0.6, attach: 0.42, mode: "episodic", depth: [10, 20], note: "Retailer gift card earned on a qualifying spend." },
  loyalty: { label: "Loyalty reward", when: "loyalty cash or points on the purchase (Target Circle, Walmart+ cash, CVS ExtraBucks)", family: "value", costToBrand: 0.3, attach: 0.33, mode: "always", depth: [2, 5], note: "Loyalty cash or points paid on the purchase." },
  delivery: { label: "Delivery offer", when: "free or accelerated shipping", family: "value", costToBrand: 0.2, attach: 0.62, note: "Free or accelerated shipping." },
  bundle: { label: "Bundle", when: "second product or service attached below list", family: "value", costToBrand: 0.7, attach: 0.16, note: "Second product or service attached below list." },
  clearance: { label: "Clearance", when: "end-of-life markdown to clear stock", family: "price", costToBrand: 0.85, attach: 1, note: "End-of-life markdown to clear stock." },
  card: { label: "Card offer", when: "retailer store or co-brand card discount (Target Circle Card 5%, Amazon Prime Visa)", family: "finance", costToBrand: 0.25, attach: 0.14, mode: "always", depth: [3, 5], note: "Retailer store card offer, taken only by cardholders." },
  cashback: { label: "Cash back", when: "loyalty rebate paid back after purchase", family: "price", costToBrand: 0.45, attach: 0.23, note: "Loyalty rebate paid back after purchase." },
  bnpl: { label: "Buy now, pay later", when: "pay in 4 / Affirm on higher-ticket items", family: "finance", costToBrand: 0.35, attach: 0.19, note: "Pay in 4 / Affirm. Cost is the platform fee." },
  financing: { label: "Financing", when: "monthly instalment offer on big-ticket durables", family: "finance", costToBrand: 0.3, attach: 0.11, note: "Monthly instalment offer at $/mo." },
  tradein: { label: "Trade-in", when: "credit for returning an old device; electronics only", family: "price", costToBrand: 0.6, attach: 0.08, note: "Save % when an old device is returned." },
  protection: { label: "Protection plan", when: "retailer-sold warranty on durable goods", family: "addon", costToBrand: 0, attach: 0.21, note: "Retailer-sold warranty. Adds to what the shopper pays." },
  trial: { label: "Service trial", when: "music, streaming or membership trial attached to a device", family: "value", costToBrand: 0.15, attach: 0.27, note: "Music or membership trial attached to the purchase." },
};

export type BuilderPromoType = {
  id: MechanicId;
  label: string;
  family: Family;
  color: string;
  costToBrand: number;
  attach: number;
  kind: Family;
  note: string;
  mode?: "always" | "episodic";
  depth?: [number, number];
  faceUsd?: number;
};

/**
 * The promotion types the builder runs for a market: only the mechanics some
 * retailer uses, with soft-value faces scaled to the category's price.
 */
export function builderPromoTypes(used: Iterable<MechanicId>, typicalPrice: number): BuilderPromoType[] {
  const ids = new Set<MechanicId>(["discount", ...used]);
  const round = (v: number): number => Math.round(v * 100) / 100;
  const face: Partial<Record<MechanicId, number>> = {
    delivery: round(Math.min(9.99, Math.max(2.99, typicalPrice * 0.18))),
    trial: 32,
    bundle: round(typicalPrice * 0.08),
  };
  return (Object.keys(MECHANIC_LIBRARY) as MechanicId[]).filter((id) => ids.has(id)).map((id) => {
    const m = MECHANIC_LIBRARY[id];
    return {
      id, label: m.label, family: m.family, color: FAMILY_COLOR[m.family], costToBrand: m.costToBrand, attach: m.attach, kind: m.family, note: m.note,
      ...(m.mode ? { mode: m.mode } : {}), ...(m.depth ? { depth: m.depth } : {}), ...(face[id] != null ? { faceUsd: face[id] } : {}),
    };
  });
}

/**
 * The first JSON object in a model answer, or null when there is none.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
