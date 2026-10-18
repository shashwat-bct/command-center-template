// Reads the retail audit tool's Google Sheet ("Retail Audit Tool Results", one
// tab per category, one row per PDP capture: price, list price, availability,
// promotions, delivery, rating, reviews, read off each screenshot) and writes
// the retail payload the dashboard's Retail Shelf and AI × Shelf pages read,
// next to the AI payload of the same brand × category.
//
//   npm run retail -- --collection 2026-10 [--pairs sony-tv]
//
// The sheet keeps growing, so the rows as read are kept beside the payload
// (retail/sheet-<tab>.json): the dashboard can always be traced back to them.
// Price cells are formatted as dates in the sheet, so values are read unformatted.
// Credentials: RETAIL_SHEETS_KEY (service-account JSON, default the retail
// audit tool's ~/.config/retail-audit/sheets-sa.json), else ADC.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GoogleAuth } from "google-auth-library";
import { PAIRS, studyCategory } from "./config/brands";
import { CATEGORIES } from "./config/categories";
import { CollectionStore } from "./store";

const SHEET_ID = process.env.RETAIL_SHEET_ID || "1ROg3oL9l-k_JxAqwAmZ1z0o577ok4a9-4FvvHMf7lyI";
const KEY_FILE = process.env.RETAIL_SHEETS_KEY || join(homedir(), ".config", "retail-audit", "sheets-sa.json");

/** The sheet tab that carries each study category. Bluetooth Speakers is the nearest the audit has to wireless speakers. */
export const RETAIL_TABS: Record<string, string> = { tv: "TV", smartphones: "Smartphones", "wireless-speakers": "Bluetooth Speakers" };

type Cell = string | number | boolean;

export type RetailRow = {
  date: string;
  capturedAt: string;
  retailer: string;
  brand: string;
  product: string;
  productModel: string;
  title: string;
  url: string;
  screenshot: string;
  availability: string;
  price: number | null;
  listPrice: number | null;
  discountPct: number | null;
  onSale: boolean;
  priceLabel: string;
  stock: string;
  delivery: string;
  shipTo: string;
  rating: number | null;
  reviews: number | null;
  promos: Array<{ type: string; summary: string; value: string }>;
  quality: string;
  flags: string[];
  /** a US-dollar price read off a US page */
  priceUsable: boolean;
  /** "new", "prepaid" (new, locked to a carrier's prepaid plan) or "renewed" (refurbished, restored, pre-owned, used, open box) */
  condition: Condition;
  /** the configuration the price is for: screen size ("65-inch") or storage ("128GB"), when the title gives it */
  variant: string;
  /** one listing: brand × product × retailer where the audit holds one link per model (TV), else the page URL */
  listingKey: string;
};

export type Condition = "new" | "prepaid" | "renewed";

export type RetailModel = { id: string; label: string; brand: string; product: string; match: string };

export type RetailPayload = {
  /** the study category slug: the dashboard words prices, sizes and model names per category */
  categorySlug: string;
  source: { sheetId: string; sheetUrl: string; tab: string; readAt: string; rows: number; excluded: Record<string, number> };
  subject: string;
  category: string;
  dates: string[];
  retailers: string[];
  models: RetailModel[];
  rows: RetailRow[];
};

async function readTab(tab: string): Promise<Cell[][]> {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"], ...(existsSync(KEY_FILE) ? { keyFile: KEY_FILE } : {}) });
  const client = await auth.getClient();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const res = await client.request<{ values?: Cell[][] }>({ url });
  return res.data.values ?? [];
}

const num = (v: Cell | undefined): number | null => {
  if (v === "" || v == null || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: Cell | undefined): string => (v == null ? "" : String(v)).trim();
/** A sheet date: a serial day number (the tab formats the column as a date) or an ISO string. */
const day = (v: Cell | undefined): string =>
  typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10) : str(v).slice(0, 10);
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A case-insensitive pattern that finds a shelf model in an AI answer's product
 * name: "BRAVIA 8 II" as a phrase that "BRAVIA 8" alone does not satisfy; model
 * codes such as "U8 U8QG" as alternatives.
 */
export function modelPattern(label: string): string {
  let tokens = label.split(/\s+/).filter((t) => !/^20\d\d$/.test(t));
  if (tokens.length > 1) tokens = tokens.filter((t) => !/^oled$/i.test(t));
  const roman = /^(ii|iii|iv)$/i;
  if (tokens.length > 1 && tokens.every((t) => /\d/.test(t))) return tokens.map((t) => `\\b${reEsc(t)}\\b`).join("|");
  const phrase = tokens.map(reEsc).join("[\\s-]*");
  return `\\b${phrase}\\b${roman.test(tokens[tokens.length - 1]) ? "" : "(?![\\s-]*(?:ii|iii|iv)\\b)"}`;
}

/**
 * The phone tab is a search-results crawl, not a curated model list: its `brand`
 * cell is the title's first word ("Restored", "Straight") and `product` the full
 * title. Brand, model, storage and condition are read off the title instead.
 */
const PHONE_LINES: Array<[RegExp, string, RegExp]> = [
  [/\b(?:apple|iphone)\b/i, "Apple", /\biPhone\s*(\d{1,2}[a-z]?|XR|XS|SE|X)\b(?:\s*(Pro\s*Max|Pro|Plus|Max|Mini|Air))?/i],
  [/\b(?:samsung|galaxy)\b/i, "Samsung", /\bGalaxy\s+(?:(Z)\s*(Fold|Flip)\s*(\d+)|([SAM])\s?(\d{2,3}))(?:\s*(Ultra|FE|Plus|Edge|\+|5G))?(?:\s*(Ultra|FE|Plus|Edge))?/i],
  [/\b(?:google|pixel)\b/i, "Google", /\bPixel\s*(\d{1,2}a?|Fold|XL)\b(?:\s*(Pro\s*XL|Pro\s*Fold|Pro|XL))?/i],
];
const title = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\b(pro|max|plus|mini|air|ultra|edge|fold|flip|xl)\b/gi, (w) => w.toUpperCase() === "XL" ? "XL" : w[0].toUpperCase() + w.slice(1).toLowerCase());

/** "Restored Google Pixel 7 Pro 5G - Carrier Unlocked - 128GB" → Google · "Pixel 7 Pro". */
export function phoneModel(text: string): { brand: string; model: string } | null {
  for (const [brandRe, brand, modelRe] of PHONE_LINES) {
    if (!brandRe.test(text)) continue;
    const m = modelRe.exec(text);
    if (!m) return { brand, model: "" };
    if (brand === "Samsung") {
      const suffix = [m[6], m[7]].filter((x) => x && !/^5G$/i.test(x)).map((x) => (x === "+" ? "+" : title(x))).join(" ");
      const base = m[1] ? `Galaxy Z ${title(m[2])}${m[3]}` : `Galaxy ${m[4].toUpperCase()}${m[5]}`;
      return { brand, model: `${base}${suffix ? (suffix === "+" ? "+" : " " + suffix) : ""}` };
    }
    const line = brand === "Apple" ? "iPhone" : "Pixel";
    return { brand, model: title(`${line} ${m[1].toUpperCase().replace(/^(\d+)([A-Z])$/, (_, n, l) => n + l.toLowerCase())}${m[2] ? " " + m[2] : ""}`) };
  }
  return null;
}
const RENEWED_RE = /\b(?:renewed|refurbished|restored|pre-?owned|used|open\s*box)\b/i;
const PREPAID_RE = /\b(?:prepaid|straight\s*talk|tracfone|total\s*(?:by\s*)?wireless|family\s*mobile|boost\s*mobile|visible|cricket|locked\s+to)\b/i;
const storageOf = (s: string): string => { const m = /\b(\d{2,4})\s*(GB|TB)\b(?!\s*RAM)/i.exec(s.replace(/\b\d+\s*GB\s*RAM\b|\bRAM\s*\d+\s*GB\b/gi, "")); return m ? `${m[1]}${m[2].toUpperCase()}` : ""; };
const sizeOf = (s: string): string => { const m = /\b(\d{2,3})\s*(?:["”]|-?\s*inch(?:es)?\b|-?in\b|\s*class\b)/i.exec(s); return m ? `${m[1]}-inch` : ""; };

/** Pattern for a phone model: "Pixel 10 Pro" matches "Pixel 10 Pro (128GB)" but not "Pixel 10 Pro XL"; "Galaxy Z Fold8" matches "Z Fold 8". */
export function phonePattern(model: string): string {
  const tokens = model.split(/\s+/);
  const lead = tokens[0] === "Galaxy" ? (tokens[1] === "Z" ? "(?:Galaxy[\\s-]*)?(?:Z[\\s-]*)?" : "(?:Galaxy[\\s-]*)?") : "";
  const rest = (tokens[0] === "Galaxy" ? tokens.slice(tokens[1] === "Z" ? 2 : 1) : tokens)
    .map((t) => reEsc(t).replace(/([a-z])(?=\d)/gi, "$1[\\s-]*")).join("[\\s-]*");
  return `\\b${lead}${rest}${/\+$/.test(model) ? "" : "\\b"}(?![\\s-]*(?:(?:pro|max|xl|fold|ultra|plus|fe|edge|mini|lite|air)\\b|\\+))`;
}

export function toRows(values: Cell[][], brandIds: Map<string, string>, phones = false): { rows: RetailRow[]; excluded: Record<string, number> } {
  const [head, ...body] = values;
  const col = (name: string) => head.findIndex((h) => String(h) === name);
  const ix = Object.fromEntries(
    ["date", "captured_at", "retailer", "page_type", "product", "brand", "product_model", "full_title", "availability", "current_price", "original_price", "discount_pct", "is_on_sale", "price_label", "currency", "stock_status", "delivery", "rating", "review_count", "ship_to_location", "quality", "flags", "screenshot", "url"]
      .map((n) => [n, col(n)]),
  );
  const promoIx = [1, 2, 3].map((k) => [col(`promo_${k}_type`), col(`promo_${k}_summary`), col(`promo_${k}_value`)]);
  const excluded: Record<string, number> = {};
  const rows: RetailRow[] = [];
  for (const r of body) {
    const g = (n: string) => (ix[n] >= 0 ? r[ix[n]] : undefined);
    const fullTitle = str(g("full_title")) || str(g("product"));
    const phone = phones ? phoneModel(fullTitle) : null;
    const brand = brandIds.get((phone ? phone.brand : str(g("brand"))).toLowerCase());
    if (!brand) { excluded["brand outside the study"] = (excluded["brand outside the study"] ?? 0) + 1; continue; }
    if (phones && !phone!.model) { excluded["no model named in the listing title"] = (excluded["no model named in the listing title"] ?? 0) + 1; continue; }
    if (str(g("page_type")) && str(g("page_type")) !== "PDP") { excluded["not a product page"] = (excluded["not a product page"] ?? 0) + 1; continue; }
    const flags = str(g("flags")).split(/,\s*/).filter(Boolean);
    const quality = str(g("quality"));
    const price = num(g("current_price"));
    const listPrice = num(g("original_price"));
    const condition: Condition = RENEWED_RE.test(`${fullTitle} ${str(g("price_label"))}`) ? "renewed" : PREPAID_RE.test(fullTitle) ? "prepaid" : "new";
    const product = phone ? `${phone.brand} ${phone.model}` : str(g("product"));
    const usdUs = str(g("currency") || "USD") === "USD" && !flags.includes("not_us_location") && !flags.includes("currency_not_usd");
    const priceUsable = usdUs && quality !== "unavailable" && price != null && price > 0;
    rows.push({
      date: day(g("date")),
      capturedAt: str(g("captured_at")),
      retailer: str(g("retailer")),
      brand,
      product,
      productModel: str(g("product_model")),
      title: str(g("full_title")),
      url: str(g("url")),
      screenshot: str(g("screenshot")),
      availability: str(g("availability")),
      price,
      listPrice: listPrice != null && price != null && listPrice > price ? listPrice : null,
      discountPct: listPrice != null && price != null && listPrice > price ? Math.round((1 - price / listPrice) * 1000) / 10 : null,
      onSale: g("is_on_sale") === true || str(g("is_on_sale")).toUpperCase() === "TRUE",
      priceLabel: str(g("price_label")),
      stock: str(g("stock_status")),
      delivery: str(g("delivery")),
      shipTo: str(g("ship_to_location")),
      rating: num(g("rating")),
      reviews: num(g("review_count")),
      promos: promoIx
        .map(([t, s, v]) => ({ type: str(r[t]), summary: str(r[s]), value: str(r[v]) }))
        .filter((p) => p.type || p.summary),
      quality,
      flags,
      priceUsable,
      condition,
      variant: phones ? storageOf(fullTitle) : sizeOf(fullTitle),
      listingKey: phones ? str(g("url")) || `${brand}|${product}|${str(g("retailer"))}|${rows.length}` : `${brand}|${product}|${str(g("retailer"))}`,
    });
    if (!priceUsable) excluded["price not usable (non-US page, no price or unusable capture)"] = (excluded["price not usable (non-US page, no price or unusable capture)"] ?? 0) + 1;
  }
  // A capture run whose ratings were all written as whole stars (2026-09-27) carries no
  // usable rating: 4.4 and 4.0 both read 4. Those ratings are dropped, the rest of the row kept.
  for (const date of new Set(rows.map((x) => x.date))) {
    const rs = rows.filter((x) => x.date === date && x.rating != null);
    if (rs.length >= 5 && rs.every((x) => Number.isInteger(x.rating))) {
      for (const x of rs) x.rating = null;
      excluded[`ratings rounded to whole stars on ${date}`] = rs.length;
    }
  }
  return { rows, excluded };
}

export async function buildRetail(collection: string, key: string): Promise<RetailPayload | null> {
  const pair = PAIRS.find((p) => p.key === key);
  if (!pair) throw new Error(`unknown pair ${key}`);
  const tab = RETAIL_TABS[pair.bc.category];
  if (!tab) return null;
  const study = studyCategory(pair.bc.category);
  const brandIds = new Map(study.brands.map((b) => [b.label.toLowerCase(), b.id]));
  const store = new CollectionStore(collection);
  const values = await readTab(tab);
  await store.write(`retail/sheet-${slug(tab)}.json`, JSON.stringify({ sheetId: SHEET_ID, tab, readAt: new Date().toISOString(), values }), "application/json");
  const phones = pair.bc.category === "smartphones";
  const { rows, excluded } = toRows(values, brandIds, phones);
  const products = [...new Map(rows.map((r) => [`${r.brand}|${r.product}`, r])).values()];
  const models = products.map((r) => {
    const brandLabel = study.brands.find((b) => b.id === r.brand)!.label;
    const label = r.product.replace(new RegExp(`^${reEsc(brandLabel)}\\s+`, "i"), "");
    return { id: slug(`${r.brand}-${label}`), label, brand: r.brand, product: r.product, match: phones ? phonePattern(label) : modelPattern(label) };
  });
  const payload: RetailPayload = {
    categorySlug: pair.bc.category,
    source: { sheetId: SHEET_ID, sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`, tab, readAt: new Date().toISOString(), rows: values.length - 1, excluded },
    subject: pair.brand.id,
    category: CATEGORIES.find((c) => c.slug === pair.bc.category)?.name ?? pair.bc.category,
    dates: [...new Set(rows.map((r) => r.date))].sort(),
    retailers: [...new Set(rows.map((r) => r.retailer))].sort(),
    models,
    rows,
  };
  await store.write(`retail/${key}.json`, JSON.stringify(payload), "application/json");
  return payload;
}

async function main() {
  const { values: args } = parseArgs({ options: { collection: { type: "string" }, pairs: { type: "string" } } });
  if (!args.collection) throw new Error("--collection is required");
  const store = new CollectionStore(args.collection);
  const keys = args.pairs?.split(",").map((s) => s.trim())
    ?? PAIRS.map((p) => p.key).filter((k) => existsSync(store.abs(`payloads/${k}.json`)));
  for (const key of keys) {
    const p = await buildRetail(args.collection, key);
    if (!p) { console.log(`[retail] ${key}: no sheet tab for this category`); continue; }
    const own = p.rows.filter((r) => r.brand === p.subject);
    console.log(`[retail] ${key}: ${p.rows.length} rows from "${p.source.tab}" (${own.length} ${key.split("-")[0]}), ${p.models.length} models, ${p.retailers.length} retailers, readings ${p.dates.join(", ")}`);
  }
}

if (process.argv[1]?.endsWith("retail.ts")) main().catch((e) => { console.error(e); process.exit(1); });
