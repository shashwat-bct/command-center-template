import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FeedDay, FeedProduct, FeedReview, FeedReviewSummary, RetailFeed } from "../lib/retail-feed";

type Row = Record<string, string>;
type Match = { units: number | null; asin: string | null; listingUnits: number | null; match: "upc" | "line" | null };

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
for (const k of ["clean", "matches", "out", "retailer", "label", "on"]) if (!args[k]) throw new Error(`--${k} is required`);

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const read = (name: string): Row[] => parseCsv(readFileSync(join(args.clean, name), "utf8"));
const num = (v: string | undefined): number | null => { if (v == null || v.trim() === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const text = (v: string | undefined): string | null => (v == null || v.trim() === "" ? null : v.trim());
const prose = (v: string | undefined): string | null => { const t = text(v); return t == null ? null : t.replace(/%(2[0-9A-F]|3[A-F]|40|5[B-F]|7[B-E])/gi, (m) => decodeURIComponent(m)); };
const bool = (v: string | undefined): boolean | null => (v === "True" || v === "true" ? true : v === "False" || v === "false" ? false : null);
const AVAILABLE = new Set(["IN_STOCK", "AVAILABLE"]);
const OWN = new Set(["walmart.com"]);

const matches = JSON.parse(readFileSync(args.matches, "utf8")) as Record<string, Match>;
const data = read("all_data_clean.csv");
const retailer = args.retailer;
const pid = (item: string) => `${retailer}:${item}`;

const products: Record<string, FeedProduct> = {};
for (const r of data) {
  const id = pid(r.item_id);
  if (products[id]) continue;
  const m = matches[r.item_id];
  products[id] = {
    id, retailer, item: r.item_id, brand: r.brand, title: r.product_name, url: text(r.walmart_url), upc: text(r.upc),
    units: m?.units ?? null, asin: m?.asin ?? null, listingUnits: m?.listingUnits ?? null, match: m?.match ?? null,
  };
}

const groups = new Map<string, Row[]>();
for (const r of data) {
  const k = `${r.item_id}|${r.date}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}

const flag = (v: string | undefined): boolean | null => { if (v == null || v.trim() === "") return null; const t = v.trim().toLowerCase(); return t === "true" || t === "1" || t === "1.0" ? true : t === "false" || t === "0" || t === "0.0" ? false : null; };
const lastFlag = (list: Row[], col: string): boolean | null => { for (let i = list.length - 1; i >= 0; i--) { const v = flag(list[i][col]); if (v != null) return v; } return null; };
const sellerOffers = (list: Row[]): NonNullable<FeedDay["sellerOffers"]> => {
  const by = new Map<string, NonNullable<FeedDay["sellerOffers"]>[number]>();
  for (const r of list) {
    const seller = text(r.seller_name);
    if (!seller) continue;
    const st = text(r.availability_status) ?? text(r.shipping_availability);
    by.set(seller, { seller, price: num(r.offer_listed_price) ?? num(r.price), retailerFulfilled: flag(r.buybox_wfs_enabled) ?? flag(r.seller_wfs_enabled), inStock: st ? AVAILABLE.has(st) : null });
  }
  return [...by.values()];
};

const promiseDays = (list: Row[]): number | null => {
  const days = list.flatMap((r) => {
    const at = Date.parse(r.ts_utc), by = Date.parse(r.delivery_date ?? "");
    return Number.isFinite(at) && Number.isFinite(by) && by > at ? [(by - at) / 86400000] : [];
  }).sort((a, z) => a - z);
  return days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : null;
};

const daily: Record<string, FeedDay[]> = {};
for (const [k, rows] of groups) {
  const [item, date] = k.split("|");
  rows.sort((a, z) => a.ts_utc.localeCompare(z.ts_utc));
  const product = rows.filter((r) => r.price_kind === "buybox" || r.price_kind === "daily_close");
  const own = rows.filter((r) => r.price_kind === "offer" && OWN.has((r.seller_name || "").toLowerCase()));
  const close = product.filter((r) => r.price_kind === "daily_close" && num(r.price) != null);
  const buybox = product.filter((r) => r.price_kind === "buybox" && num(r.price) != null);
  const priceRow = close[close.length - 1] ?? buybox[buybox.length - 1];
  const states = [...product, ...own].flatMap((r) => {
    const s = text(r.availability_status) ?? text(r.shipping_availability);
    if (s) return [AVAILABLE.has(s)];
    const b = bool(r.in_stock);
    if (b != null) return [b];
    const n = num(r.stock_count);
    return n == null ? [] : [n > 0];
  });
  const lastNum = (list: Row[], col: string) => { for (let i = list.length - 1; i >= 0; i--) { const v = num(list[i][col]); if (v != null) return v; } return null; };
  const lastText = (list: Row[], col: string) => { for (let i = list.length - 1; i >= 0; i--) { const v = text(list[i][col]); if (v) return v; } return null; };
  const ownOffer = [...own].reverse().find((r) => num(r.offer_listed_price) != null || num(r.price) != null);
  const day: FeedDay = {
    date,
    price: priceRow ? num(priceRow.price) : ownOffer ? num(ownOffer.offer_listed_price) ?? num(ownOffer.price) : null,
    was: lastNum(product, "was_price"),
    inStock: states.length ? states[states.length - 1] : null,
    stock: lastNum(product, "stock_count") ?? lastNum(own, "quantity"),
    offers: lastNum(product, "offer_count") ?? (sellerOffers(rows.filter((r) => r.price_kind === "offer")).length || null),
    seller: lastText(product.filter((r) => r.price_kind === "buybox"), "seller_name"),
    rating: lastNum(product.filter((r) => (num(r.current_rating) ?? 0) > 0), "current_rating"),
    reviews: lastNum(product, "current_review_count"),
    deliveryDays: promiseDays([...product, ...own]),
    low: lastNum(close, "price_low"),
    high: lastNum(close, "price_high"),
    unitPrice: lastNum([...product, ...own], "unit_price"),
    fulfillment: lastText([...product, ...own], "fulfillment_type"),
    retailerFulfilled: lastFlag([...product, ...own], "buybox_wfs_enabled"),
    orderLimit: (() => { const v = lastNum([...product, ...own], "order_limit"); return v && v > 0 ? v : null; })(),
    buyNow: lastFlag([...product, ...own], "buy_now_eligible"),
    shipping: lastText([...product, ...own], "shipping_availability"),
    pickup: lastText([...product, ...own], "pickup_status"),
    bestSeller: lastFlag(rows, "badge_best_seller"),
    bought: lastNum(rows, "badge_social_proof_bought") ?? lastNum(rows, "badge_x_sold"),
    lowInventory: lastFlag(rows, "badge_low_inventory"),
    verifiedReviews: lastNum(product, "verified_review_count"),
    sellerOffers: sellerOffers(rows.filter((r) => r.price_kind === "offer")),
    sources: [...new Set([...product, ...own].map((r) => r.source))].sort(),
  };
  if (day.price == null && day.inStock == null && day.offers == null && day.seller == null && day.rating == null && day.reviews == null && day.deliveryDays == null && !day.sellerOffers?.length && day.low == null && day.unitPrice == null) continue;
  (daily[pid(item)] ||= []).push(day);
}
for (const days of Object.values(daily)) days.sort((a, z) => a.date.localeCompare(z.date));

const reviewSummary: Record<string, FeedReviewSummary> = {};
for (const r of read("review_summary_clean.csv")) {
  const quote = (p: "positive" | "negative") => {
    const t = prose(r[`top_${p}_review_text`]);
    return t ? { text: t, rating: num(r[`top_${p}_review_rating`]), author: text(r[`top_${p}_review_author`]) } : null;
  };
  reviewSummary[pid(r.item_id)] = {
    total: num(r.total_reviews), withText: num(r.reviews_with_text), avgRating: num(r.avg_rating), recommendedPct: num(r.recommended_pct),
    stars: [1, 2, 3, 4, 5].map((s) => num(r[`rating_${s}_count`])),
    aiSummary: prose(r.ai_summary),
    aiBullets: (text(r.ai_bullets) ?? "").split(" | ").map((s) => s.trim()).filter(Boolean),
    aspects: (text(r.aspects_detected) ?? "").split(";").map((s) => s.trim()).filter(Boolean),
    topPositive: quote("positive"), topNegative: quote("negative"),
    media: num(r.media_count), textOneStar: num(r.reviews_with_text_1star), textFiveStar: num(r.reviews_with_text_5star),
  };
}

const reviews: Record<string, FeedReview[]> = {};
for (const r of read("reviews_clean.csv")) {
  (reviews[pid(r.item_id)] ||= []).push({
    id: r.review_id, date: r.review_date, rating: num(r.rating), title: prose(r.review_title), text: prose(r.review_text),
    author: text(r.user_nickname), location: text(r.user_location), verified: bool(r.verified_purchaser), recommended: bool(r.recommended),
    helpful: num(r.positive_feedback), unhelpful: num(r.negative_feedback), media: num(r.media_count), seller: text(r.seller_name), variant: text(r.features), fulfilledBy: text(r.fulfilled_by), reviewerBadge: text(r.user_review_count_badge),
  });
}
for (const list of Object.values(reviews)) list.sort((a, z) => z.date.localeCompare(a.date));

const feed: RetailFeed = {
  version: 1, label: args.label, importedOn: args.on,
  sources: [...new Set(data.map((r) => r.source))].sort(),
  products, daily, reviewSummary, reviews,
};
writeFileSync(args.out, JSON.stringify(feed, null, 2) + "\n");
const days = Object.values(daily).flat();
console.log(`${Object.keys(products).length} products (${Object.values(products).filter((p) => p.asin).length} matched to Amazon), ${days.length} product-days ${days.map((d) => d.date).sort()[0]} to ${days.map((d) => d.date).sort().at(-1)}, ${Object.keys(reviewSummary).length} review summaries, ${Object.values(reviews).flat().length} reviews`);
