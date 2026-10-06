import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildRelabelInputs } from "../lib/launch-override";
import { RELABEL_CONFIG_ID, applyProvenance, prepareRelabelWorkDir } from "../lib/relabel-pipeline";
import { rebrandPayload } from "../lib/rebrand";
import { inStockShare, listingMatchesBrand, type KeepaBrandAggregate, type KeepaHistory } from "../lib/keepa";
import { AMAZON_RETAIL_SELLER, windowDates, windowEndFor } from "../lib/amazon-series";
import type { AiQuestionResult, AiSoMResult, EngineSoM, FunnelStage } from "../lib/ai-visibility";
import { applyOverrides } from "../lib/brand-overrides";
import { buildAiConsole, crawlerSites } from "../lib/ai-console";
import { botAccess, parseRobots } from "../lib/crawler-access";
import { buildWorkbench, type CommandCenterData } from "../lib/aeo-workbench";
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
const engineShares: Record<"chatgpt" | "gemini", Record<string, number>> = {
  chatgpt: { Theragun: 10, Hyperice: 42, TimTam: 24, Ekrin: 16, Lifepro: 8 },
  gemini: { Theragun: 14, Hyperice: 38, TimTam: 26, Ekrin: 14, Lifepro: 8 },
};
const decision = { Theragun: 50, Hyperice: 20, TimTam: 20, Ekrin: 5, Lifepro: 5 };
const STAGES: FunnelStage[] = ["awareness", "awareness", "awareness", "consideration", "consideration", "consideration", "evaluation", "evaluation", "evaluation", "decision", "decision", "decision"];
const perQuestion: AiQuestionResult[] = (["chatgpt", "gemini"] as const).flatMap((engine) => STAGES.map((stage, i) => {
  const mentionOrder = stage === "decision" ? ["Theragun", "Hyperice", "TimTam"] : ["Hyperice", "TimTam", "Ekrin", "Lifepro"];
  return {
    engine, run: 1, queryId: `q${String(i + 1).padStart(2, "0")}`, stage, focus: "neutral" as const, q: `Question ${i + 1} about massage guns`,
    mentionOrder, otherBrands: ["TOLOCO"],
    brands: [...mentionOrder, "TOLOCO"].map((name, k) => ({ name, rank: k + 1, recommended: k === 0, sentiment: "positive" as const, product: name === "Theragun" ? "PRO Plus" : "" })),
    topPick: mentionOrder[0], attributes: { Theragun: [{ attr: "battery life", polarity: "+" as const }] },
    claims: stage === "decision" ? [{ claim: "Theragun PRO Plus costs $599.", type: "price" as const, product: "PRO Plus", value: "$599" }] : [],
    sources: i === 0 ? [{ url: "https://www.hyperice.com/hypervolt", title: "Hypervolt" }, { url: "https://www.reddit.com/r/massage", title: "r/massage" }] : [], answer: "fixture answer",
  };
}));
const engineSoM = (engine: "chatgpt" | "gemini", label: string): EngineSoM => ({
  engine, label, model: "fixture", webSearch: true, matching: "llm", questionsAsked: 12, questionsFailed: 0,
  shareByBrand: engineShares[engine], mentionRateByBrand: engineShares[engine], shareByStage: { decision, awareness: engineShares[engine] },
  shareByRun: [engineShares[engine]], otherBrands: [{ brand: "TOLOCO", answers: 12 }],
});
const ai: AiSoMResult = {
  engines: [engineSoM("chatgpt", "ChatGPT"), engineSoM("gemini", "Gemini")],
  failedEngines: [{ engine: "claude", label: "Claude", error: "fixture outage" }],
  bank: {
    questions: STAGES.map((stage, i) => ({ id: `q${String(i + 1).padStart(2, "0")}`, stage, focus: "neutral" as const, text: `Question ${i + 1} about massage guns` })),
    attributes: ["battery life", "percussion strength", "noise level", "attachments", "build quality", "value for money"],
    categoryNoun: ["massage gun", "massage guns"], domains: { Theragun: "therabody.com", Hyperice: "hyperice.com" },
  },
  subjectShare: 12, shareByBrand: shares, shareByStage: { decision, awareness: shares }, questionsAsked: 24, questionsFailed: 0, perQuestion,
};
const ASPECTS = ["Battery life", "Percussion strength", "Noise level", "Attachments", "Build quality", "Value for money"];

const VENDOR = resolve(process.cwd(), "vendor", "bravo-platform");

function build(withMeasurements: boolean, seed: string = SUBJECT.slug): Payload {
  const inputs = buildRelabelInputs({
    subjectName: SUBJECT.name, competitors: COMPETITORS, category: CATEGORY, now: NOW, seed, aspects: ASPECTS,
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

console.log("── hybrid build");
const p = build(true);
const ids = Object.fromEntries(p.dims.brands.map((b) => [b.label, b.id]));
const S = SUBJECT.slug, H = ids.Hyperice;
const val = (metric: string, brand: string) => p.scorecard.qbr[metric]?.[brand]?.value ?? null;
const di = (iso: string) => p.dims.dates.indexOf(iso);
const E1 = "l-b0thera001", E2 = "l-b0thera002";
check(p.dims.models.every((m) => m.id === "l-" + String((m as { asin?: string }).asin).toLowerCase()), "every model is keyed by its own ASIN, not a reference slot name");
check(windowEndFor(NOW) === WINDOW_END && p.dims.dates.at(-1) === WINDOW_END && p.dims.dates.length === 91, "window is the 13 weeks to the last full week", `${p.dims.dates[0]} → ${p.dims.dates.at(-1)}`);
check(p.dims.retailers.length === 5 && p.dims.retailers.some((r) => r.id === "amazon") && p.dims.cities.length === 6, "five retailers and six cities are modelled around Amazon", p.dims.retailers.map((r) => r.id).join(","));
check(p.dims.models.length === 5 && p.dims.models.every((m) => !/Era|Echo|HomePod|SoundLink|JBL/.test(m.label)), "only real listings appear as models", p.dims.models.map((m) => m.label).join(" · "));
check(p.dims.models.filter((m) => m.label.startsWith("TheraGun Mini 3rd Gen")).length === 1, "colour variants of one product fill one slot");

console.log("── measured lanes");
for (const [name, v] of Object.entries(shares)) check(val("aiSov", ids[name]) === v, `AI share for ${name} is the engines' mean ${v}%`, String(val("aiSov", ids[name])));
check((p.ai.overall[S] ?? []).every((v) => v === 12), "AI share series is flat at the reading");
check(p.dims.engines.map((e) => e.label).join(",") === "ChatGPT,Gemini", "engines shown are the ones that answered", p.dims.engines.map((e) => e.label).join(","));
const byEs = (p.ai as unknown as { byEngineStage: Record<string, number[]> }).byEngineStage;
check(byEs[`chatgpt|decision|${S}`]?.every((v) => v === 50) && byEs[`gemini|awareness|${S}`]?.every((v) => v === 14), "per-engine, per-stage series carry that engine's stage reading");
check(p.ai.prompts.length === 24 && p.ai.prompts[0].q.startsWith("ChatGPT: ") && p.ai.prompts[0].topBrand === H, "prompt table has one row per engine and question", `${p.ai.prompts.length} rows`);
check((p.ai.prompts[0] as unknown as { cited: Record<string, boolean> }).cited[H] === true, "a brand whose domain an answer cites is marked cited");
const amz = `${E1}|amazon`;
const price = p.pricing.price[amz] ?? [];
check(price[di("2026-07-01")] === 300 && price[di("2026-07-15")] === 240 && price[di("2026-07-20")] === 300, "Amazon price is Keepa's daily price", `${price[di("2026-07-01")]} / ${price[di("2026-07-15")]} / ${price[di("2026-07-20")]}`);
const stock = p.availability.stock[amz] ?? [];
check(stock[di("2026-08-09")] === 1 && stock[di("2026-08-10")] === 0 && stock[di("2026-08-13")] === 1, "Amazon stock is Keepa's buyable state");
check(p.availability.episodes.some((e) => e.model === E1 && e.retailer === "amazon" && e.start === OOS.from && e.days === 3), "Amazon stock-out detected from history");
check(p.promotions.events.some((e) => e.model === E1 && e.retailer === "amazon" && e.start === SALE.from && e.end === SALE.to && e.depthPct === 20), "Amazon price cut detected from history");
const ownedDays = windowDates(WINDOW_END).filter((d) => d < RESELLER_FROM && (d < OOS.from || d > OOS.to)).length;
check(near(p.distribution.buybox[amz], ownedDays / (91 - 3), 0.02), "Amazon buy-box share from Keepa's owner history", `${p.distribution.buybox[amz]} vs ${(ownedDays / 88).toFixed(3)}`);
check(p.distribution.buybox[`${E2}|amazon`] === 1, "Amazon retail holding the buy box counts as owned");
check(p.pdpScores.some((x) => x.model === E1 && x.retailer === "amazon" && x.measured), "Amazon landing-page score from the Apify product page");
const ratingS = p.voice.rating[S] ?? [];
check(ratingS[di("2026-08-31")] === 3.3 && ratingS[di(RATING_DROP)] === 3.1, "rating is Keepa's daily rating");
const vel = p.voice.velocity[S] ?? [];
check(vel[di("2026-07-01")] === 30 && vel[di("2026-09-05")] === 0, "review velocity ignores reindex jumps");

console.log("── modelled lanes");
const traffic = p.traffic as { daily?: Record<string, number[] | null>; channels?: Record<string, unknown> };
check(Array.isArray(traffic.daily?.[S]) && (traffic.daily?.[S]?.length ?? 0) === 91, "website traffic is modelled for the subject");
check(p.tco.length > 0, "cost of ownership is modelled", `${p.tco.length} rows`);
const aspects = p.voice.aspects[S] as Record<string, number[]> | null;
check(!!aspects && Object.keys(aspects).join("|") === ASPECTS.join("|"), "review themes are the category's own", Object.keys(aspects ?? {}).join(", "));
check(Object.keys(p.pricing.price).some((k) => k.startsWith(`${E1}|`) && !k.endsWith("|amazon")), "the subject's listings are modelled at other retailers");
const events = (p.dims as unknown as { events: Array<{ id: string; start: string; end: string }> }).events;
check(events.length > 0 && events.every((e) => e.start >= p.dims.dates[0] && e.end <= WINDOW_END) && events.some((e) => e.id === "labor"), "retail events fall inside the window", events.map((e) => e.id).join(","));
const lanes = p.meta.provenance?.lanes ?? {};
check(p.meta.provenance?.mode === "hybrid", "payload is marked hybrid");
check(lanes.ai?.status === "measured" && lanes.traffic?.status === "modelled" && lanes.tco?.status === "modelled" && lanes.pricing?.status === "mixed" && lanes.shelf?.status === "mixed", "lane statuses", JSON.stringify(Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, v.status]))));

console.log("── per-brand variation");
const again = build(true);
const other = build(true, "another-brand");
const td = (x: Payload) => JSON.stringify((x.traffic as { daily?: unknown }).daily);
check(td(again) === td(p), "the same brand gets the same modelled figures on every build");
check(td(other) !== td(p), "a different brand gets different modelled figures");

console.log("── disclosure");
const d = p.meta.disclosure;
check(d.short === "Measured + modelled" && /ChatGPT, Gemini/.test(d.headline), "disclosure names the measured sources", d.headline.slice(0, 120));
check(d.anchors.some((a) => a.lane === "AI answer · ChatGPT" && !a.unmeasured) && d.anchors.some((a) => a.lane === "AI answer · Claude" && a.unmeasured), "ledger has one row per engine, and the failed engine is marked");
check(["Website traffic", "Cost of ownership"].every((l) => d.anchors.some((a) => a.lane === l && a.unmeasured)), "ledger lists the modelled lanes");
const whole = JSON.stringify(p);
const leak = whole.match(/Sonos|Amazon Echo|HomePod|\bBose\b|\bJBL\b|Era 100|Echo Studio|SoundLink|speaker/i);
check(!leak, "no reference-brand names anywhere in the payload", leak ? whole.slice(Math.max(0, (leak.index ?? 0) - 80), (leak.index ?? 0) + 80) : "");
check(!/"slot":"(sonos|amazon|apple|bose|jbl)"|"(sonos|homepod2|echostudio)"/.test(whole), "no internal reference-slot names anywhere in the payload");
check(Object.values(p.reads).flat().every((r) => !/null|NaN|undefined/.test(r.text)), "reads are complete sentences");

console.log("── AI console");
const cons = buildAiConsole({
  slug: S, ai, brands: p.dims.brands.slice(0, 5).map((b, i) => ({ ...b, color: (b as { color?: string }).color ?? "#000", name: [SUBJECT.name, ...COMPETITORS][i] })),
  subjectDomain: "therabody.com", category: CATEGORY, market: "US", products: [{ label: "TheraGun PRO Plus", msrp: 599 }], previous: null, crawlerAccess: null, now: NOW,
});
const cap = cons.captures[cons.current];
check(cap.n === 24 && cap.answers.every((a) => a.engine === "gpt" || a.engine === "gemini"), "console capture holds every answer under the console's engine ids", `${cap.n}`);
check(cap.answers[0].brands[0].id === H && cap.answers[0].brands.some((b) => b.id === "toloco") && cap.answers[0].topPick === H, "console brands use the dashboard's brand ids, untracked brands get their own");
check(cap.answers[0].sources[0].kind === "rival-owned" && cap.answers[0].sources[1].kind === "community", "cited sites are classified (rival-owned, community)", cap.answers[0].sources.map((x) => x.kind).join(","));
check(cons.brands[0].owned[0] === "therabody.com" && cons.brands[0].subject && cons.attrs.length === 6 && cons.bank.length === 12, "brand domains, attributes and the question bank reach the console");
check(cap.answers.some((a) => a.subjectClaims.length > 0) && cap.answers.some((a) => a.attributes[S]?.[0]?.attr === "battery life"), "claims and attribute verdicts are carried per answer");
const sites = crawlerSites(cons);
check(sites[0].host === "www.therabody.com" && sites.some((x) => x.host === "reddit.com"), "crawler audit covers the brands' sites and the most-cited hosts", sites.map((x) => x.host).join(", "));
const groups = parseRobots("User-agent: *\nDisallow: /cart\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\nAllow: /products/\n");
check(botAccess(groups, "GPTBot").state === "blocked" && botAccess(groups, "ClaudeBot").state === "partial" && botAccess(groups, "Bingbot").state === "open" && botAccess(groups, "GPTBot").explicit, "robots.txt is read per crawler");

const wb = buildWorkbench(cons, p as unknown as CommandCenterData, S) as { baseline: { share: Record<string, number>; questions: number }; dims: { weeks: unknown[]; families: string[] }; deliverables: Array<{ series: number[] }>; ledger: { A: unknown[]; B: unknown[] }; listing: Array<{ rid: string }>; reads: { overview: Array<{ text: string }> } };
check(wb.dims.weeks.length === 13 && wb.deliverables.length === 18 && wb.deliverables.every((d) => d.series.length === 13), "workbench: 13 weeks, 18 deliverables with weekly series");
check(wb.baseline.questions === 12 && wb.baseline.share[S] != null && wb.ledger.A.length === 18 && wb.ledger.B.length === 5, "workbench: week 0 measured from the console capture, both ledgers built");
check(wb.listing.length === 5 && wb.dims.families.length > 0 && wb.reads.overview.every((r) => !/undefined|NaN|null/.test(r.text)), "workbench: listing per retailer, catalogue families and clean reads", wb.dims.families.join(", "));
check(!/Sony|BRAVIA|Samsung|\bTCL\b/.test(JSON.stringify(wb)), "workbench: no reference-brand names");

const clash = rebrandPayload({ meta: {}, dims: { brands: [{ id: "sonos", label: "Sonos" }, { id: "amazon", label: "Amazon Echo" }, { id: "apple", label: "Apple HomePod" }, { id: "bose", label: "Bose" }, { id: "jbl", label: "JBL" }] }, reads: { overview: [{ tone: "good", text: "JBL holds 20% of brand mentions; Bose trails; Amazon Echo is absent." }] } },
  { subject: { name: "JBL", slug: "jbl" }, competitors: ["Bose", "Sony", "Ultimate Ears", "Anker Soundcore"], subjectProducts: [], competitorProducts: [] }) as { reads: { overview: Array<{ text: string }> } };
check(clash.reads.overview[0].text === "JBL holds 20% of brand mentions; Bose trails; Bose is absent.", "a brand named like a reference slot keeps its name; other reference names still map", clash.reads.overview[0].text);

console.log("── overrides");
const copy = JSON.parse(JSON.stringify(p)) as Payload;
const res = applyOverrides(copy, { traffic: { basis: { [S]: { note: "from the brand" } } }, ai: { overall: { [S]: [99] } }, pricing: { price: { [amz]: [1] } } } as never, { ai: true, amazon: true });
check(((copy.traffic as { basis: Record<string, { note: string }> }).basis[S].note === "from the brand"), "override replaces a modelled value");
check(res.skipped.includes("ai") && res.skipped.includes(`pricing.price.${amz}`) && copy.pricing.price[amz][0] === 300, "override cannot replace measured AI or Amazon data", res.skipped.join(", "));

console.log("── build with nothing measured");
const r = build(false);
check(r.meta.provenance?.mode === "hybrid" && r.meta.disclosure.short === "Modelled view", "disclosure says the view is modelled", r.meta.disclosure.short);
check(r.dims.models.length === 0, "no invented products");
check((r.ai.prompts ?? []).length === 0, "no invented prompt rows");
const rleak = JSON.stringify(r).match(/Sonos|Amazon Echo|HomePod|\bBose\b|\bJBL\b|Era 100|speaker/i);
check(!rleak, "no reference-brand names with nothing measured", rleak ? JSON.stringify(r).slice(Math.max(0, (rleak.index ?? 0) - 80), (rleak.index ?? 0) + 80) : "");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
