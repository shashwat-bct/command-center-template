import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureSet, PageCapture } from "./captures";

type Mark = { kind: string; label: string; text: string; x: number; y: number; w: number; h: number };
type Marked = { w: number; h: number; marks: Mark[]; focus?: { x: number; y: number; w: number; h: number }; thumb?: { w: number; h: number } };

type Lane = { id: string; label: string; pages: string[]; what: string; kinds: string[] | null };

const LANES: Lane[] = [
  { id: "landing", label: "Landing page", pages: ["landing", "carriage"], what: "The product page as a shopper meets it: title, rating, price, delivery and stock marked.", kinds: null },
  { id: "pricing", label: "Pricing", pages: ["pricing"], what: "The price the page showed, and any reference price or saving beside it.", kinds: ["price", "was", "saving"] },
  { id: "promotions", label: "Promotions", pages: ["promotions", "calendar", "strategy"], what: "Every offer the page showed: card offers, financing, gift cards, bundles, protection plans, deal badges.", kinds: ["promotion", "saving"] },
  { id: "stock", label: "Availability", pages: ["stock"], what: "The stock and seller lines the page printed.", kinds: ["stock", "seller"] },
  { id: "delivery", label: "Delivery", pages: ["delivery"], what: "The delivery or pickup promise the page printed.", kinds: ["delivery"] },
];
const RETAILER: Record<string, string> = { amazon: "Amazon", walmart: "Walmart", bestbuy: "Best Buy", target: "Target" };

export type SnapshotManifest = {
  instance: string;
  builtAt: string;
  lanes: Array<{ id: string; label: string; pages: string[]; what: string; n: number }>;
  retailers: Array<{ id: string; label: string; n: number }>;
  brands: Array<{ id: string; label: string; n: number }>;
  dates: Array<{ id: string; n: number }>;
  products: Array<{ id: string; n: number }>;
  marks: number;
  sources: string[];
  dropped: string[];
  entries: Array<Record<string, unknown>>;
};

const count = <T>(items: T[], key: (x: T) => string) => [...items.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>())];

/**
 * The "Underlying data" panel's manifest for a brand: every captured retailer page, per dashboard lane, with
 * the boxes where each reading sits on the page, or null when the brand has no marked captures.
 */
export function loadSnapshots(slug: string, set: CaptureSet | null): SnapshotManifest | null {
  const path = join(process.cwd(), "brand-data", `${slug}.marks.json`);
  if (!set || !existsSync(path)) return null;
  const marked = (JSON.parse(readFileSync(path, "utf8")) as { captures?: Record<string, Marked> }).captures ?? {};
  const img = (c: PageCapture, kind: string) => `/api/captures/${slug}/${c.id}.${kind}.jpg`;
  const entries = set.captures.flatMap((c) => {
    const m = marked[c.id];
    if (!m || !m.marks.length) return [];
    const amount = (t: string) => (/\$\s?([\d,]+(?:\.\d{2})?)/.exec(t) || [])[1]?.replace(/,/g, "") ?? null;
    const prices = new Set(m.marks.filter((b) => b.kind === "price").map((b) => amount(b.text)).filter(Boolean));
    const kept = m.marks.filter((b) => !(b.kind === "was" && prices.has(amount(b.text))));
    return LANES.flatMap((lane) => {
      const boxes = kept.filter((b) => !lane.kinds || lane.kinds.includes(b.kind));
      if (!boxes.length) return [];
      return [{
        id: `${lane.id}|${c.id}`, lane: lane.id, retailer: c.retailer, brand: c.brand.toLowerCase(), brandLabel: c.brand, product: c.modelName,
        date: c.date, capturedAt: c.capturedAt, img: img(c, "read"), w: m.w, h: m.h,
        boxes: boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, kind: "rect", label: b.label, text: b.text })),
        read: boxes.map((b) => b.text).filter(Boolean).join(" · "),
        extra: `${RETAILER[c.retailer] ?? c.retailer} · product page${c.shipTo ? ` · delivering to ${c.shipTo}` : ""}`,
        title: c.title, url: c.url,
        focus: m.focus ?? { x: 0, y: 0, w: m.w, h: Math.min(m.h, Math.round(m.w * 0.75)) },
        thumb: { src: img(c, "focus"), w: m.thumb?.w ?? 480, h: m.thumb?.h ?? 360 },
        source: "Retail page capture",
        bakedNote: "Each box was placed by reading the capture after it was taken, and shows where on the page that reading sits; the capture itself is unaltered.",
      }];
    });
  });
  if (!entries.length) return null;
  const caps = set.captures.filter((c) => marked[c.id]?.marks.length);
  return {
    instance: slug,
    builtAt: new Date().toISOString(),
    lanes: LANES.map(({ kinds: _kinds, ...l }) => ({ ...l, n: entries.filter((e) => e.lane === l.id).length })).filter((l) => l.n),
    retailers: count(entries, (e) => e.retailer).map(([id, n]) => ({ id, label: RETAILER[id] ?? id, n })),
    brands: count(entries, (e) => e.brand).map(([id, n]) => ({ id, label: caps.find((c) => c.brand.toLowerCase() === id)?.brand ?? id, n })),
    dates: count(entries, (e) => e.date ?? "").map(([id, n]) => ({ id, n })).sort((a, z) => z.id.localeCompare(a.id)),
    products: count(entries, (e) => e.product).map(([id, n]) => ({ id, n })),
    marks: entries.reduce((n, e) => n + e.boxes.length, 0),
    sources: ["Retail page captures"],
    dropped: [],
    entries,
  };
}
