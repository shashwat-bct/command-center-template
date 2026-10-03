import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildRelabelInputs } from "../lib/launch-override";
import { RELABEL_CONFIG_ID, applyProvenance, prepareRelabelWorkDir } from "../lib/relabel-pipeline";
import { rebrandPayload } from "../lib/rebrand";
import { inStockShare, listingMatchesBrand, type KeepaBrandAggregate, type KeepaHistory } from "../lib/keepa";
import { AMAZON_RETAIL_SELLER, windowDates, windowEndFor } from "../lib/amazon-series";
import type { AiQuestionResult, AiSoMResult, FunnelStage } from "../lib/ai-visibility";
import { parseAmazonItem, type AmazonProduct, type SearchResult } from "../lib/apify";

type Cell = { value: number | null; rank: number | null; of: number };
type Payload = {
  meta: {
    subject: string;
    category: string;
    provenance?: { mode: string; metrics: Record<string, Record<string, string>>; lanes: Record<string, { status: string; label?: string }> };
    disclosure: { short: string; headline: string; body: string; anchors: Array<{ lane: string; measured: string; source: string; unmeasured?: boolean }> };
  };
  dims: { brands: Array<{ id: string; label: string }>; engines: Array<{ id: string; label: string }>; dates: string[]; retailers: Array<{ id: string }>; cities: unknown[]; models: Array<{ id: string; brand: string; label: string; msrp: number }> };
  ai: { prompts: Array<{ stage: string; q: string; topBrand: string | null; present: Record<string, boolean> }>; overall: Record<string, number[] | null> };
  scorecard: { qbr: Record<string, Record<string, Cell>> };
  trend: Record<string, Record<string, Array<number | null>>>;
  pricing: { price: Record<string, Array<number | null>>; discount: Record<string, Array<number | null>>; mapBreaches: unknown[] };
  availability: { stock: Record<string, number[]>; episodes: Array<{ model: string; retailer: string; start: string; days: number }> };
  promotions: { events: Array<{ model: string; retailer: string; start: string; end: string; depthPct: number; alwaysOn: boolean }> };
  distribution: { buybox: Record<string, number | null> };
  pdpScores: Array<{ model: string; retailer: string; score: number; measured?: boolean }>;
  delivery: { weekly: Record<string, Array<number | null>> };
  voice: { aspects: Record<string, unknown>; rating: Record<string, Array<number | null> | null>; velocity: Record<string, Array<number | null> | null> };
  traffic: Record<string, unknown>;
  shelf: { withheld?: boolean; measured?: { term: string; depth: number; share: Record<string, number>; firstPosition: Record<string, number | null>; results: Array<{ brand: string | null }> } };
  demand?: { rankCategory: string | null; listings: Record<string, { monthlySold: Array<number | null>; rank: Array<number | null> }> };
  effectivePrice?: { listings: Record<string, { effective: Array<number | null>; couponOff: Array<number | null>; deal: Array<0 | 1 | null> }> };
  tco: unknown[];
  reads: Record<string, Array<{ text: string }>>;
};

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};
const near = (a: number | null | undefined, b: number, tol: number) => a != null && Math.abs(a - b) <= tol;

const SUBJECT = { name: "Theragun", slug: "theragun" };
const COMPETITORS = ["Hyperice", "TimTam", "Ekrin", "Lifepro"];
const CATEGORY = "massage gun";
const NOW = new Date("2026-10-03T12:00:00Z");
const WINDOW_END = "2026-09-27";
const OWN_STORE = "AOWNSTORE001";

const KM = (iso: string, hour = 1) => (Date.parse(`${iso}T00:00:00Z`) + hour * 3600000) / 60000 - 21564000;
const steps = (pts: Array<[string, number]>): number[] => pts.flatMap(([d, v]) => [KM(d), v]);
const SALE = { from: "2026-07-14", to: "2026-07-18" };
const OOS = { from: "2026-08-10", to: "2026-08-12" };
const RATING_DROP = "2026-09-01";
const RESELLER_FROM = "2026-09-14";
const DEAL = { from: "2026-08-20", after: "2026-08-22" };
const COUPON = { from: "2026-09-20", after: "2026-09-23" };

const history = (price: number, withEvents: boolean, rating = 33): KeepaHistory => ({
  amazon: steps(withEvents
    ? [["2026-06-01", price * 100], [SALE.from, price * 80], ["2026-07-19", price * 100], [OOS.from, -1], ["2026-08-13", price * 100]]
    : [["2026-06-01", price * 100]]),
  newPrice: null,
  list: steps([["2026-06-01", price * 100]]),
  offers: steps([["2026-06-01", 7]]),
  rating: steps([["2026-06-01", rating], [RATING_DROP, rating - 2]]),
  reviews: windowDates(WINDOW_END, 120).flatMap((d, i) => [KM(d), (d === "2026-09-05" ? 4000 : 1000) + i * 10]),
  buyBoxSellers: withEvents
    ? [String(KM("2026-06-01")), OWN_STORE, String(KM(RESELLER_FROM)), "A3RESELLER99"]
    : [String(KM("2026-06-01")), AMAZON_RETAIL_SELLER],
  deal: withEvents ? steps([["2026-06-01", -1], [DEAL.from, price * 70], [DEAL.after, -1]]) : null,
  coupons: withEvents ? [KM("2026-06-01"), 0, 0, KM(COUPON.from), 1000, 0, KM(COUPON.after), 0, 0] : null,
  salesRank: steps([["2026-06-01", withEvents ? 900 : 4000]]),
  subRanks: withEvents ? { "3767551": steps([["2026-06-01", 12]]), "999": steps([["2026-06-01", 7]]) } : { "3767551": steps([["2026-06-01", 55]]) },
  monthlySold: steps([["2026-06-01", withEvents ? 1000 : 100], ["2026-09-01", withEvents ? 2000 : 100]]),
});
const listing = (asin: string, brand: string, title: string, withEvents: boolean, rating = 33) => ({
  categories: { "3767551": "Massagers" } as Record<string, string>,
  asin, priceNow: 300, listPrice: 300, discountPct: 0, rating: rating / 10, reviews: 2000, inStockShare30d: 1, brand, title,
  history: history(300, withEvents, rating),
});
const aggregate = (perAsin: ReturnType<typeof listing>[], rejected: ReturnType<typeof listing>[] = []): KeepaBrandAggregate => ({
  asinsFetched: perAsin.length, asinsWithData: perAsin.length - rejected.length,
  avgListPrice: 300, avgStreetPrice: 300, avgDiscountRate: 0.02, avgRating: 3.3, totalReviews: 6000, inStockRate: 0.97,
  perAsin, rejected,
});
const toloco = listing("B0OTHER001", "TOLOCO", "TOLOCO Massage Gun", false);
const keepa = aggregate([
  listing("B0THERA001", "Therabody", "TheraGun PRO Plus Massage Gun | Deep Tissue, Black", true),
  listing("B0THERA002", "Therabody", "TheraGun Mini 3rd Gen, Travel", false),
  listing("B0THERA00B", "Therabody", "TheraGun Mini 3rd Gen, Travel, Blue", false),
  listing("B0THERA003", "Therabody", "TheraGun Relief - Daily Comfort", false),
  toloco,
], [toloco]);
const competitorKeepa = [
  aggregate([listing("B0HYPER001", "Hyperice", "Hyperice Hypervolt 2", false, 40), listing("B0HYPER002", "Hyperice", "Hyperice Hypervolt Go 2", false, 40)]),
  null, null, null,
];

const apify = new Map<string, AmazonProduct>([
  ["B0THERA001", { asin: "B0THERA001", brand: "TheraGun", title: "TheraGun PRO Plus Massage Gun", price: 300, listPrice: null, rating: 4.6, reviewCount: 2000, inStock: true, deliveryDays: 5, seller: "TheraGun", sellerId: OWN_STORE, pdp: { images: 12, video: 2, aplus: 1, bullets: 5, specs: 1, reviews: 1 } }],
]);

const shelfResults: SearchResult[] = [
  "TOLOCO Massage Gun Deep Tissue", "Hyperice Hypervolt 2 Pro", "BOB AND BRAD C2", "TheraGun Prime 6th Gen", "Hyperice Hypervolt Go 2",
  "Mebak 3 Massage Gun", "TOLOCO Mini", "RENPHO Active", "TheraGun Mini", "AERLANG Massage Gun",
].map((title, i) => ({ position: i + 1, asin: `B0SHELF${String(i).padStart(3, "0")}`, title, price: 99, sponsored: false }));

const shares = { Theragun: 12, Hyperice: 40, TimTam: 25, Ekrin: 15, Lifepro: 8 };
const STAGES: FunnelStage[] = ["awareness", "awareness", "awareness", "consideration", "consideration", "consideration", "evaluation", "evaluation", "evaluation", "decision", "decision", "decision"];
const perQuestion: AiQuestionResult[] = STAGES.map((stage, i) => ({
  run: 1, stage, q: `Question ${i + 1} about massage guns`,
  hitsByBrand: stage === "decision" ? { Theragun: 3, Hyperice: 1, TimTam: 1, Ekrin: 0, Lifepro: 0 } : { Theragun: 0, Hyperice: 4, TimTam: 2, Ekrin: 2, Lifepro: 1 },
  mentionOrder: stage === "decision" ? ["Theragun", "Hyperice", "TimTam"] : ["Hyperice", "TimTam", "Ekrin", "Lifepro"],
  answer: "fixture",
}));
const ai: AiSoMResult = {
  subjectShare: 12, questionsAsked: 12, subjectMentions: 6, totalBrandMentions: 50,
  perBrand: {}, shareByBrand: shares, shareByRun: [shares], questionsFailed: 0, perQuestion,
};

const VENDOR = resolve(process.cwd(), "vendor", "bravo-platform");

function build(withMeasurements: boolean): Payload {
  const inputs = buildRelabelInputs({
    subjectName: SUBJECT.name, competitors: COMPETITORS, category: CATEGORY, now: NOW,
    keepa: withMeasurements ? keepa : null, competitorKeepa: withMeasurements ? competitorKeepa : [],
    ai: withMeasurements ? ai : null, apify: withMeasurements ? apify : new Map(), shelfResults: withMeasurements ? shelfResults : null,
  });
  const workDir = mkdtempSync(join(tmpdir(), "verify-relabel-"));
  try {
    cpSync(VENDOR, workDir, { recursive: true });
    prepareRelabelWorkDir(workDir, inputs);
    execFileSync("node", [join(workDir, "scripts", "insights", "build-cco-dataset.mjs"), "--brand", RELABEL_CONFIG_ID], { cwd: workDir, stdio: "pipe" });
    const raw = readFileSync(join(workDir, "public", "sonos-command-center-data.json"), "utf8");
    const { json } = applyProvenance(raw, inputs, SUBJECT.name);
    return rebrandPayload(JSON.parse(json), { subject: SUBJECT, competitors: COMPETITORS, subjectProducts: [], competitorProducts: [] }) as Payload;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

console.log("── Keepa and Apify parsing");
const listings: Array<[string, string, string, boolean]> = [
  ["GoPro", "LEVOIT", "Levoit Air Purifiers for Bedroom Home Pets", false],
  ["Yeti", "YETI", "YETI Tundra 45 Cooler, Navy", true],
  ["Yeti", "Titan", "Titan 16 Can Zipperless HardBody Cooler", false],
  ["GoPro", "AKASO", "AKASO EK7000 4K30FPS 20MP WiFi Action Camera", false],
  ["Theragun", "Therabody", "TheraGun Therabody Relief Massage Gun", true],
  ["Theragun", "TOLOCO", "TOLOCO Massage Gun, Deep Tissue", false],
  ["Amazon Echo", "Amazon", "Echo Pop | Full sound compact smart speaker", true],
  ["Amazon Echo", "Amazon Basics", "Amazon Basics Bluetooth Speaker Wireless", false],
  ["Apple HomePod", "Apple", "HomePod mini - Midnight", true],
  ["Apple HomePod", "Beats", "Beats Pill - Wireless Bluetooth Speaker", false],
];
for (const [brand, b, title, want] of listings) check(listingMatchesBrand({ brand: b, title }, brand) === want, `${title.slice(0, 32)}… ${want ? "kept" : "excluded"} for ${brand}`);
const nowMs = Date.UTC(2026, 9, 1), day = 86400000;
const kmMs = (ms: number) => ms / 60000 - 21564000;
const share = inStockShare([[kmMs(nowMs - 40 * day), 1999, kmMs(nowMs - 10 * day), -1], null], nowMs);
check(near(share, 2 / 3, 0.02), "30-day in-stock share counts days with a buyable offer", share?.toFixed(3));
const items = JSON.parse(readFileSync("scripts/fixtures/apify-amazon-items.json", "utf8")) as Array<Record<string, unknown>>;
const parsed = items.map((row) => parseAmazonItem(String(row.asin), row, new Date("2026-10-03T12:00:00Z")));
check(parsed.every((x) => x.price != null && x.price > 0), "Apify: every item has a price", parsed.map((x) => x.price).join(", "));
check(parsed[0].brand === "TheraGun" && parsed[0].rating === 4.6 && parsed[0].reviewCount === 1976, "Apify: brand, rating, review count");
check(parsed[0].deliveryDays === 5 && parsed[0].seller === "TheraGun" && !!parsed[0].sellerId, "Apify: delivery days and buy-box seller", `${parsed[0].deliveryDays}d ${parsed[0].seller} ${parsed[0].sellerId}`);
check(!!parsed[0].pdp && parsed[0].pdp.images > 0 && parsed[0].pdp.aplus === 1, "Apify: product-page content", JSON.stringify(parsed[0].pdp));

console.log("── measured build");
const p = build(true);
const ids = Object.fromEntries(p.dims.brands.map((b) => [b.label, b.id]));
const S = SUBJECT.slug, H = ids.Hyperice, T = ids.TimTam;
const val = (metric: string, brand: string) => p.scorecard.qbr[metric]?.[brand]?.value ?? null;
const prov = p.meta.provenance?.metrics ?? {};
const di = (iso: string) => p.dims.dates.indexOf(iso);
const E1 = "l-b0thera001", E2 = "l-b0thera002";
check(p.dims.models.every((m) => m.id === "l-" + String((m as { asin?: string }).asin).toLowerCase()), "every model is keyed by its own ASIN, not a Sonos slot name");

check(windowEndFor(NOW) === WINDOW_END && p.dims.dates.at(-1) === WINDOW_END && p.dims.dates.length === 91, "window is the 13 weeks to the last full week", `${p.dims.dates[0]} → ${p.dims.dates.at(-1)}`);
check(p.dims.retailers.length === 1 && p.dims.retailers[0].id === "amazon" && p.dims.cities.length === 0, "Amazon is the only retailer; no simulated cities");
check(p.dims.models.length === 5 && p.dims.models.every((m) => !/Era|Echo|HomePod|SoundLink|JBL|Theragun \d/.test(m.label)), "only real listings appear as models", p.dims.models.map((m) => m.label).join(" · "));
check(p.dims.models.filter((m) => m.label.startsWith("TheraGun Mini 3rd Gen")).length === 1, "colour variants of one product fill one slot");

for (const [name, s] of Object.entries(shares)) check(val("aiSov", ids[name]) === s, `AI share for ${name} is exactly Claude's ${s}%`, String(val("aiSov", ids[name])));
check((p.ai.overall[S] ?? []).every((v) => v === 12), "AI share series is flat at the single reading");
check(p.dims.engines.length === 1 && p.dims.engines[0].label === "Claude", "Claude is the only engine shown");
check(p.ai.prompts.length === 12 && p.ai.prompts[0].topBrand === H && p.ai.prompts[11].topBrand === S, "prompt table comes from the answers");

const amz = `${E1}|amazon`;
const price = p.pricing.price[amz] ?? [];
check(price[di("2026-07-01")] === 300 && price[di("2026-07-15")] === 240 && price[di("2026-07-20")] === 300, "Amazon price is Keepa's daily price", `${price[di("2026-07-01")]} / ${price[di("2026-07-15")]} / ${price[di("2026-07-20")]}`);
const stock = p.availability.stock[amz] ?? [];
check(stock[di("2026-08-09")] === 1 && stock[di("2026-08-10")] === 0 && stock[di("2026-08-13")] === 1, "Amazon stock is Keepa's buyable state");
check(p.availability.episodes.some((e) => e.model === E1 && e.start === OOS.from && e.days === 3), "stock-out detected from history");
check(p.promotions.events.some((e) => e.model === E1 && e.start === SALE.from && e.end === SALE.to && e.depthPct === 20), "price cut detected from history");
check(p.promotions.events.every((e) => !e.alwaysOn), "no simulated always-on mechanics");
const ownedDays = windowDates(WINDOW_END).filter((d) => d < RESELLER_FROM && (d < OOS.from || d > OOS.to)).length;
check(near(p.distribution.buybox[amz], ownedDays / (91 - 3), 0.02), "buy-box share from Keepa's owner history (brand store, then a reseller)", `${p.distribution.buybox[amz]} vs ${(ownedDays / 88).toFixed(3)}`);
check(p.distribution.buybox[`${E2}|amazon`] === 1, "Amazon retail holding the buy box counts as owned");
check(p.pdpScores.some((x) => x.model === E1 && x.measured), "landing-page score from Apify product page");
check(p.pdpScores.length > 0 && p.pdpScores.every((x) => x.measured), "listings Apify didn't read get no landing-page score (never simulated)", `${p.pdpScores.length} rows`);
check((p.delivery.weekly[`${E1}|amazon|national`] ?? []).at(-1) === 5 && (p.delivery.weekly[`${E1}|amazon|national`] ?? []).slice(0, -1).every((v) => v == null), "delivery is the single Apify reading in the last week");
const ratingS = p.voice.rating[S] ?? [];
check(ratingS[di("2026-08-31")] === 3.3 && ratingS[di(RATING_DROP)] === 3.1, "rating is Keepa's daily rating");
const vel = p.voice.velocity[S] ?? [];
check(vel[di("2026-07-01")] === 30 && vel[di("2026-09-05")] === 0 && vel[di("2026-09-06")] === 0, "review velocity ignores reindex jumps");
check(near(val("priceIndex", S), 98.4, 1.5), "price index from real prices", String(val("priceIndex", S)));
check(near(val("rating", H), (63 * 4.0 + 28 * 3.8) / 91, 0.02), "competitor rating from its own history (4.0, then 3.8 from 1 Sep)", String(val("rating", H)));

check(p.meta.provenance?.mode === "measured-only", "payload is marked measured-only");
for (const m of ["aiSov", "rating", "inStock", "priceIndex", "promoDepth", "promoIntensity", "carriage", "pdpScore", "leadTime"]) check(prov[m]?.[S] === "measured", `${m} measured for ${SUBJECT.name}`);
for (const m of ["trafficShare", "sessions"]) check(prov[m]?.[S] === "unmeasured" && val(m, S) == null && p.trend[m][S].every((v) => v == null), `${m} not measured and blank`);

const sh = p.shelf.measured;
check(!!sh && sh.term === CATEGORY && sh.depth === 10, "shelf: search results for the category stored", `${sh?.term} · ${sh?.depth}`);
check(val("shelfSov", S) === 20 && val("shelfSov", H) === 20 && val("shelfSov", T) === 0, "shelf share = share of result positions (Theragun 2/10, Hyperice 2/10, TimTam 0)", `${val("shelfSov", S)} / ${val("shelfSov", H)} / ${val("shelfSov", T)}`);
check(sh?.firstPosition[S] === 4 && sh?.firstPosition[H] === 2 && sh?.firstPosition[T] === null, "shelf: best position per brand", JSON.stringify(sh?.firstPosition));
check(sh?.results.filter((r) => r.brand === null).length === 6 && sh?.results.some((r) => r.brand === S), "shelf: other brands counted, slot ids renamed to brand ids");
check(prov.shelfSov?.[S] === "measured" && prov.shelfSov?.[T] === "measured", "shelf share labelled measured for every brand (0 is a reading)");

const dm = p.demand?.listings[E1];
check(p.demand?.rankCategory === "3767551" && (p.demand as { rankCategoryName?: string }).rankCategoryName === "Massagers", "demand: sales rank uses the category most listings share, with its name", String(p.demand?.rankCategory));
check(dm?.monthlySold[di("2026-08-31")] === 1000 && dm?.monthlySold[di("2026-09-01")] === 2000, "demand: 'bought in past month' history from Keepa");
check(dm?.rank.every((v) => v === 12) === true, "demand: daily subcategory rank");

const ep = p.effectivePrice?.listings[E1];
check(ep?.effective[di("2026-08-19")] === 300 && ep?.effective[di("2026-08-20")] === 210 && ep?.deal[di("2026-08-21")] === 1 && ep?.deal[di("2026-08-22")] === 0, "effective price: lightning deal price used while live", `${ep?.effective[di("2026-08-20")]}`);
check(ep?.effective[di("2026-09-20")] === 290 && ep?.couponOff[di("2026-09-21")] === 10 && ep?.couponOff[di("2026-09-23")] === 0, "effective price: clip coupon taken off", `${ep?.effective[di("2026-09-20")]}`);
check(ep?.effective[di("2026-07-15")] === 240, "effective price: follows the daily price otherwise");
check(prov.rating?.[T] === "unmeasured" && val("rating", T) == null && p.voice.rating[T] == null, "brand with no listings: rating blank, not simulated");
check(val("aiSov", T) === 25 && p.scorecard.qbr.aiSov[T].of === 5, "brand with no listings still has its measured AI share");
check(p.scorecard.qbr.rating[S].of === 2 && p.scorecard.qbr.rating[S].rank != null, "ranks are recomputed over measured brands only", `rank ${p.scorecard.qbr.rating[S].rank} of ${p.scorecard.qbr.rating[S].of}`);
check(p.traffic.withheld === true && p.tco.length === 0 && p.pricing.mapBreaches.length === 0, "simulated traffic, attach-rate TCO and assumed price floor removed");
const lanes = p.meta.provenance?.lanes ?? {};
check(lanes.traffic?.status === "measured" && lanes.traffic?.label === "Amazon Demand" && lanes.tco?.label === "Effective Price" && lanes.shelf?.status === "snapshot" && lanes.pricing?.status === "measured", "lane statuses and labels", JSON.stringify(Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, v.label ?? v.status]))));
check(Object.values(p.voice.aspects).every((v) => v === null) && (p.voice as { aspectMonths?: unknown[] }).aspectMonths?.length === 0 && (p.dims as { aspects?: unknown[] }).aspects?.length === 0, "review aspects withheld, with no leftover aspect names or months");
check(!/"slot":"(sonos|amazon|apple|bose|jbl)"|"(sonos|homepod2|echostudio)"/.test(JSON.stringify(p)), "no internal reference-slot names anywhere in the payload");

const d = p.meta.disclosure;
check(/nothing simulated/.test(d.short) && !/Sonos|reference/i.test(`${d.short} ${d.headline} ${d.body}`), "disclosure claims nothing simulated and names no reference brand", d.short);
check(d.anchors.filter((a) => !a.unmeasured).every((a) => ["AI answer", "Brand check", "Amazon history", "Amazon product pages", "Retail shelf", "Amazon demand", "Effective price"].includes(a.lane)), "ledger lists only real sources as measured");
check(["Retail shelf", "Amazon demand", "Effective price"].every((l) => d.anchors.some((a) => a.lane === l && !a.unmeasured)), "ledger lists shelf, demand and effective price sources");
check(d.anchors.some((a) => /Theragun 4 listings \(1 other-brand hit excluded\)/.test(a.measured)), "ledger records the brand check");
const text = JSON.stringify(p.reads) + JSON.stringify(p.dims) + JSON.stringify(d);
check(!/Sonos|Amazon Echo|HomePod|\bBose\b|\bJBL\b|Era 100|speaker/i.test(text), "no Sonos-world names anywhere in reads, dims or disclosure");
check((p.reads.overview ?? []).length > 0 && Object.values(p.reads).flat().every((r) => !/null|NaN|undefined/.test(r.text)), "reads are factual and complete", (p.reads.overview ?? [])[0]?.text);
check(p.meta.category === CATEGORY, "category from the request");

console.log("── build with nothing measured");
const r = build(false);
const rprov = r.meta.provenance?.metrics ?? {};
check(Object.values(rprov).every((m) => Object.values(m).every((k) => k === "unmeasured")), "every cell not measured");
check(r.meta.disclosure.short === "Nothing measured", "disclosure says nothing was measured");
check(Object.values(r.scorecard.qbr).every((cells) => Object.values(cells).every((c) => c.value == null)), "every scorecard value is blank");
check(r.dims.models.length === 0, "no invented products");
check(r.dims.engines.length === 0 && (r.ai.prompts ?? []).length === 0 && Object.values(r.ai.overall).every((v) => v == null), "with no Claude answers, no AI data is left in the payload (no simulated engines or prompts)");
const rl = r.meta.provenance?.lanes ?? {};
check(["traffic", "shelf", "tco"].every((l) => rl[l]?.status === "not_measured") && !r.demand && !r.effectivePrice && r.shelf.withheld === true, "with nothing read, demand, shelf and effective price stay blank");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
