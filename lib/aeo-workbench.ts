import type { AiConsolePayload } from "./ai-console";
import { buildBaseline, familyOf, type AeoBaseline, type SourceRow } from "./aeo-baseline";
import { seededRandom } from "./simulated-world";

type Series = Record<string, Array<number | null>>;
export type CommandCenterData = {
  dims: {
    retailers: Array<{ id: string; label: string; weight: number }>;
    models: Array<{ id: string; brand: string; label: string; msrp?: number; tier?: string }>;
    aspects?: string[];
  };
  pricing: { price: Series };
  availability: { stock: Series };
  distribution: { carriage: Series };
  pdpScores: Array<{ model: string; brand: string; retailer: string; score: number; fields: Record<string, number> }>;
  voice: { aspects: Record<string, Record<string, number[]> | null> };
};

export const WORKBENCH_VERSION = 5;

/** The search crawler each tracked engine uses to fetch pages it can cite; an engine without one is left out. */
export const ENGINE_SEARCH_BOT: Record<string, string> = { gpt: "OAI-SearchBot", chatgpt: "OAI-SearchBot", claude: "Claude-SearchBot", perplexity: "PerplexityBot", copilot: "Bingbot" };
const WEEKS = 13;
const PRICE_NUM = /(?<![A-Za-z\d.])\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(k)\b)?(?![A-Za-z\d])/gi;
const RANGE_GAP = /^\s*(?:-|–|—|to|and)\s*$/i;

export type PriceQuote = { lo: number; hi: number };

/**
 * Reads the price an engine quoted: a single figure, or a range such as
 * "$1,500–2,000" kept as both ends rather than run together into one number.
 */
export function parsePriceQuote(text: string): PriceQuote | null {
  const found: Array<{ n: number; start: number; end: number }> = [];
  for (const m of String(text).matchAll(PRICE_NUM)) {
    const n = parseFloat(m[1].replace(/,/g, "") + (m[2] ?? "")) * (m[3] ? 1000 : 1);
    if (n >= 20 && n < 100000) found.push({ n, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  if (!found.length) return null;
  const [a, b] = found;
  if (b && RANGE_GAP.test(String(text).slice(a.end, b.start)) && b.n > a.n) return { lo: a.n, hi: b.n };
  return { lo: a.n, hi: a.n };
}

function priceVerdict(q: PriceQuote, shelf: number): "matches" | "stale" | "wrong" {
  const gap = shelf < q.lo ? q.lo - shelf : shelf > q.hi ? shelf - q.hi : 0;
  const d = gap / shelf;
  return d <= 0.05 ? "matches" : d <= 0.15 ? "stale" : "wrong";
}
const PILOT_END = 8;
const PHASES = ["baseline", "diagnose", "diagnose", "fix & earn", "fix & earn", "fix & earn", "fix & earn", "re-read", "re-read", "programme", "programme", "programme", "programme"];
const PLACEMENT = ["identified", "contacted", "agreed", "live", "cited"];
const CONTENT = ["brief", "drafted", "live", "cited"];
const PDP_FIELDS: Array<{ id: string; label: string }> = [
  { id: "images", label: "Image count" }, { id: "video", label: "Video on page" }, { id: "aplus", label: "Enhanced content" }, { id: "bullets", label: "Feature bullets" },
  { id: "specs", label: "Spec completeness" }, { id: "reviews", label: "Reviews syndicated" }, { id: "titleKw", label: "Title keyword fit" },
];
const GENERIC_WORDS = new Set(["portable", "bluetooth", "wireless", "speaker", "speakers", "with", "for", "and", "the", "new", "black", "white", "blue", "red", "smart", "pro-grade", "edition"]);

const r1 = (v: number): number => Math.round(v * 10) / 10;
const last = (a: Array<number | null> | undefined): number | null => { if (!a) return null; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const ramp = (start: number, target: number, from: number, to: number): number[] =>
  Array.from({ length: WEEKS }, (_, w) => (w < from ? start : w >= to ? target : Math.round(start + ((target - start) * (w - from + 1)) / (to - from + 1))));
const statusSeries = (stages: string[], weeks: number[], before: string): string[] =>
  Array.from({ length: WEEKS }, (_, w) => { let s = before; weeks.forEach((wk, i) => { if (w >= wk) s = stages[i]; }); return s; });

/**
 * The family name of a listing: its title with the brand and generic words
 * dropped, kept to the first words that name the model ("Flip 7").
 */
export function familyName(label: string, brand: string, categoryWords: string[] = []): string {
  const words = label.replace(new RegExp(`^${brand.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*`, "i"), "").split(/[\s,|–—-]+/).filter(Boolean);
  const stop = new Set([...GENERIC_WORDS, ...categoryWords.flatMap((w) => w.toLowerCase().split(/\s+/))]);
  const out: string[] = [];
  for (const w of words) { if (stop.has(w.toLowerCase()) || out.length >= 3) break; out.push(w); }
  return out.join(" ") || label;
}

function trajectory(rnd: () => number, start: number, uplift: number, band: number): number[] {
  return Array.from({ length: WEEKS }, (_, w) => (w === 0 ? r1(start) : r1(start + uplift * Math.pow(w / 12, 1.4) + (rnd() * 2 - 1) * band * 0.4)));
}

/**
 * Builds the AEO Workbench payload: week 0 measured from the console's
 * capture and the command centre's lanes, and a twelve-week programme after
 * it simulated per brand inside the sampling band.
 */
export function buildWorkbench(c: AiConsolePayload, cc: CommandCenterData, seed: string): unknown {
  const rnd = seededRandom(`${seed}:workbench`);
  const S = c.subject, SL = c.subjectLabel;
  const rivals = c.brands.filter((b) => !b.subject);
  const models = cc.dims.models.filter((m) => m.brand === S);
  const families = [...new Set(models.map((m) => familyName(m.label, c.productLine, c.categoryNoun)))];
  const base: AeoBaseline = buildBaseline(c, families);
  const start = new Date(base.capturedAt);
  const weeks = Array.from({ length: WEEKS }, (_, n) => ({ id: `W${String(n).padStart(2, "0")}`, n, date: new Date(start.getTime() + n * 7 * 86400000).toISOString().slice(0, 10), label: n ? `Week ${n}` : "Baseline", phase: PHASES[n] }));
  const retailers = cc.dims.retailers.map((r) => ({ id: r.id, label: r.label, weight: r.weight }));
  const crawlSites = c.crawlerAccess?.sites ?? [];
  const readableAt = (rid: string): { state: string; blocked: number; of: number } => {
    const site = crawlSites.find((x) => x.kind === "retail" && x.host.includes(rid));
    if (!site) return { state: "not audited", blocked: 0, of: 0 };
    const bots = [...new Set(c.engines.map((e) => ENGINE_SEARCH_BOT[e.id]).filter((b): b is string => !!b))];
    const search = bots.map((b) => site.bots[b]?.state);
    const blocked = search.filter((s) => s === "blocked").length;
    return { state: blocked === search.length ? "blocked" : blocked ? "partial" : "open", blocked, of: search.length };
  };
  const key = (m: string, r: string) => `${m}|${r}`;

  const priceRows = c.captures[c.current].answers.flatMap((a) => a.subjectClaims.filter((cl) => cl.type === "price").map((cl) => ({ a, cl })));
  const verdicts = { matches: 0, stale: 0, wrong: 0, unverifiable: 0, notInCatalogue: 0, sizeNotTracked: 0 };
  const rows = priceRows.map(({ a, cl }, i) => {
    const quote = parsePriceQuote(cl.value || cl.claim) ?? parsePriceQuote(cl.claim);
    const family = familyOf(cl.product || cl.claim, families);
    const shelf = family ? models.filter((m) => familyName(m.label, c.productLine, c.categoryNoun) === family).map((m) => last(cc.pricing.price[key(m.id, "amazon")])).find((p) => p != null) ?? null : null;
    let verdict: keyof typeof verdicts = "unverifiable";
    if (!quote) verdict = "unverifiable";
    else if (!family) verdict = "notInCatalogue";
    else if (shelf == null) verdict = "unverifiable";
    else verdict = priceVerdict(quote, shelf);
    verdicts[verdict]++;
    return { id: `c${i + 1}`, claim: cl.claim, value: quote ? quote.lo : null, valueHi: quote && quote.hi !== quote.lo ? quote.hi : null, shelf, product: cl.product, family, engine: a.engine, question: c.bank.find((q) => q.id === a.queryId)?.text ?? "", hosts: [...new Set(a.sources.map((s) => s.host))].slice(0, 4), verdict, detail: shelf != null ? `${family} on Amazon: $${Math.round(shelf).toLocaleString("en-US")} on the shelf` : family ? `${family}: no shelf price read` : "model not in the tracked catalogue" };
  });
  const otherTotal = base.claims.total - rows.length;
  const outOfDate = Math.round(otherTotal * (0.03 + rnd() * 0.03)), wrongOther = Math.round(otherTotal * (0.02 + rnd() * 0.03));
  const corrections = rows.filter((r) => r.verdict === "wrong" || r.verdict === "stale").slice(0, 9).map((r, i) => ({ id: `c${10 + i}`, product: r.family ?? r.product, engine: r.engine, host: r.hosts[0] ?? "", verdict: r.verdict, filedWeek: 1 + (i % 3), confirmedWeek: i % 4 === 3 ? null : 4 + (i % 4) }));
  const filedBy = (w: number) => corrections.filter((x) => x.filedWeek <= w).length;
  const confirmedBy = (w: number) => corrections.filter((x) => x.confirmedWeek != null && x.confirmedWeek <= w).length;

  const subjectSites = crawlSites.filter((x) => x.kind === S).map((x) => ({ host: x.host.replace(/^www\./, ""), blocked: Object.values(x.bots).filter((b) => b.state === "blocked").length, llmsTxt: x.llmsTxt }));
  const feedRows = models.flatMap((m) => retailers.filter((r) => last(cc.distribution.carriage[key(m.id, r.id)]) === 1).slice(0, 3).map((r) => {
    const price = last(cc.pricing.price[key(m.id, r.id)]);
    const inStock = last(cc.availability.stock[key(m.id, r.id)]) === 1;
    const off = rnd() < 0.3;
    return { model: familyName(m.label, c.productLine, c.categoryNoun), retailer: r.label, rid: r.id, shelfPrice: price, feedPrice: price, inStock, feedInStock: off ? !inStock || rnd() < 0.5 ? false : inStock : inStock, fixedWeek: off ? 4 + Math.floor(rnd() * 2) : null };
  })).slice(0, 15);
  for (const f of feedRows) if (f.fixedWeek != null && f.feedInStock === f.inStock) f.feedInStock = !f.inStock;
  const mismatches = feedRows.filter((f) => f.fixedWeek != null).length;

  const pdpFor = (rid: string) => cc.pdpScores.filter((p) => p.brand === S && p.retailer === rid);
  const measuredPdp = cc.pdpScores.filter((p) => p.brand === S);
  const listing = retailers.map((r) => {
    const ms = models.filter((m) => last(cc.distribution.carriage[key(m.id, r.id)]) === 1);
    const own = pdpFor(r.id);
    const pdp = own.length ? own : measuredPdp;
    const pdpAvg = own.length ? Math.round(mean(own.map((p) => p.score))) : ms.length && measuredPdp.length ? Math.round(Math.min(98, Math.max(40, mean(measuredPdp.map((p) => p.score)) * (0.75 + rnd() * 0.3)))) : 0;
    const readable = readableAt(r.id);
    const readiness = readable.state === "blocked" ? 0 : Math.round(pdpAvg * (readable.state === "partial" ? 0.6 : 1));
    const lift = readable.state === "blocked" ? 0 : 4 + Math.round(rnd() * 6);
    const prices = ms.map((m) => { const p = last(cc.pricing.price[key(m.id, r.id)]); return p != null && m.msrp ? (p / m.msrp) * 100 : null; }).filter((v): v is number => v != null);
    return {
      retailer: r.label, rid: r.id, weight: r.weight, readable, carried: ms.length, of: models.length,
      stockPct: Math.round(mean(ms.map((m) => (last(cc.availability.stock[key(m.id, r.id)]) ?? 0) * 100))),
      pdpAvg, priceIdx: r1(mean(prices)), readiness,
      weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, pdp: Math.min(100, pdpAvg + (w >= 4 ? Math.round((lift * (w - 3)) / 9) : 0)), readiness: Math.min(100, readiness + (w >= 4 && readiness ? Math.round((lift * (w - 3)) / 9) : 0)) })),
      fields: PDP_FIELDS.map((f) => ({ ...f, max: Math.max(0, ...pdp.map((p) => p.fields[f.id] ?? 0)), avg: r1(mean(pdp.map((p) => p.fields[f.id] ?? 0))) })),
    };
  });
  const bestOpen = [...listing].filter((l) => l.readable.state !== "blocked" && l.pdpAvg).sort((a, z) => z.weight - a.weight)[0] ?? listing[0];

  const catalogue = families.map((f) => {
    const ms = models.filter((m) => familyName(m.label, c.productLine, c.categoryNoun) === f);
    const carriedAt = retailers.filter((r) => ms.some((m) => last(cc.distribution.carriage[key(m.id, r.id)]) === 1));
    const named = base.catalogue[f]?.n ?? 0;
    const shelfPrices = ms.flatMap((m) => retailers.map((r) => last(cc.pricing.price[key(m.id, r.id)]))).filter((v): v is number => v != null);
    const shelfWeight = Math.round(carriedAt.reduce((n, r) => n + r.weight, 0) * 100);
    return {
      family: f, models: ms.map((m) => m.label), tier: ms[0]?.tier ?? "core", msrp: ms[0]?.msrp ?? null, named, namedQuestions: base.catalogue[f]?.questions.length ?? 0,
      engines: base.catalogue[f]?.engines ?? [], carriedAt: carriedAt.map((r) => r.label), shelfWeight,
      stockPct: Math.round(mean(ms.flatMap((m) => carriedAt.map((r) => (last(cc.availability.stock[key(m.id, r.id)]) ?? 0) * 100)))),
      shelfPrice: shelfPrices.length ? Math.min(...shelfPrices) : null, pdpAvg: Math.round(mean(cc.pdpScores.filter((p) => ms.some((m) => m.id === p.model)).map((p) => p.score))) || 0,
      priority: Math.round(shelfWeight * 0.6 + Math.max(0, 40 - named * 4)),
      weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, named: named + (w >= 6 ? Math.floor((w - 4) / 3) : 0) })),
    };
  });

  const nonOwned = base.sources.top.filter((s) => ["editorial", "community", "news"].includes(s.kind));
  const pipeline = nonOwned.slice(0, 8).map((s, i) => {
    const first = 1 + (i % 3);
    const stageWeeks = [0, first, first + 2, first + 5 + (i % 2), Math.min(12, first + 7 + (i % 3))];
    return { host: s.host, kind: s.kind, citations: s.n, gap: s.gap, namedRate: s.n ? Math.round((s.named / s.n) * 100) : 0, ask: `${SL} in the ${c.categoryNoun[1]} round-ups and head-to-head reviews this site publishes`, evidence: "Atlas: review-theme scores and shelf price for the pitch", stageWeeks, weekly: statusSeries(PLACEMENT, stageWeeks, "identified") };
  });
  const top5 = base.sources.top.slice(0, 5).map((s) => s.host);
  const top5Named = (() => { const ans = c.captures[c.current].answers.filter((a) => a.sources.some((s) => top5.includes(s.host))); return ans.length ? r1((ans.filter((a) => a.brands.some((m) => m.id === S)).length / ans.length) * 100) : 0; })();

  const attrRows = c.attrs.map((at) => {
    const own = base.attrNet[S]?.[at] ?? 0;
    const best = Math.max(...rivals.map((r) => base.attrNet[r.id]?.[at] ?? 0));
    return { attr: at, engineNet: own, rivalBest: best, gap: best - own, voc: null as null | Record<string, number> };
  }).filter((x) => x.gap > 0).sort((a, z) => z.gap - a.gap).slice(0, 7);
  const aspectOf = (b: string, at: string): number | null => {
    const a = cc.voice.aspects[b]; if (!a) return null;
    const k = Object.keys(a).find((x) => x.toLowerCase().split(/\W+/).some((w) => w.length > 3 && at.includes(w)));
    return k ? last(a[k]) : null;
  };
  for (const r of attrRows) {
    const own = aspectOf(S, r.attr);
    const best = Math.max(...rivals.map((x) => aspectOf(x.id, r.attr) ?? 0));
    if (own != null) r.voc = { [S]: own, best };
  }

  const vsQ = base.h2h.questions;
  const pages = [
    ...rivals.map((rv, i) => {
      const q = vsQ.find((x) => x.text.toLowerCase().includes(rv.label.toLowerCase()));
      const picks = q?.picks ?? Object.fromEntries(c.engines.map((e) => [e.id, null]));
      const stageWeeks = [1 + (i % 2), 3 + (i % 3), 5 + (i % 3), 8 + (i % 3)];
      return { id: `h2h-${i + 1}`, kind: "comparison", question: q?.text ?? `${SL} vs ${rv.label} — which ${c.categoryNoun[0]} should I buy?`, todayWins: Object.values(picks).filter((p) => p === S).length, todayOf: Object.values(picks).filter((p) => p).length, todayPicks: picks, stageWeeks, atlas: "live shelf price table from Atlas pricing; review-theme evidence from Voice of Customer", weekly: statusSeries(CONTENT, stageWeeks, "planned") };
    }),
    ...c.bank.filter((q) => q.stage === "consideration").slice(0, 4).map((q, i) => {
      const stageWeeks = [2 + i, 4 + i, 6 + i, 9 + Math.min(3, i)];
      return { id: `uc-${i + 1}`, kind: "use-case", question: q.text, todayWins: 0, todayOf: 0, todayPicks: {}, stageWeeks, atlas: "review themes from Voice of Customer", weekly: statusSeries(CONTENT, stageWeeks, "planned") };
    }),
  ];
  const liveBy = (items: Array<{ weekly: string[] }>, w: number, ok: string[]) => items.filter((x) => ok.includes(x.weekly[w])).length;

  const cap = c.captures[c.current];
  const communityHosts: SourceRow[] = base.sources.top.filter((s) => s.kind === "community");
  const communityCites = cap.answers.flatMap((a) => a.sources.filter((s) => s.kind === "community").map(() => a));
  const productA = families[0] ?? SL, productB = families[1] ?? SL, rivalA = rivals[0]?.label ?? "the category leader";
  const items = [
    { id: "v1", title: `${SL} ${productA} vs ${rivalA} — the real-world comparison`, kind: "review + chapter titles" },
    { id: "v2", title: `${SL} ${productB}: long-term review`, kind: "review + transcript" },
    { id: "t1", title: `Which ${c.categoryNoun[0]} should I buy? — thread answer with specs and shelf prices`, kind: "thread answer" },
    { id: "t2", title: `${SL} vs ${rivals[1]?.label ?? rivalA} — owner experiences`, kind: "thread answer" },
    { id: "v3", title: `Best ${c.categoryNoun[1]} this year — ${SL} line-up explained`, kind: "explainer + chapter titles" },
  ].map((x, i) => { const stageWeeks = [1 + (i % 3), 3 + (i % 3), 5 + (i % 3), 8 + (i % 3)]; return { ...x, stageWeeks, atlas: "review themes and rating velocity from Voice of Customer", weekly: statusSeries(CONTENT, stageWeeks, "planned") }; });

  const shopping = families.map((f) => {
    const ms = models.filter((m) => familyName(m.label, c.productLine, c.categoryNoun) === f);
    const rowsR = retailers.map((r) => { const m = ms.find((x) => last(cc.distribution.carriage[key(x.id, r.id)]) === 1); return { retailer: r.label, carried: !!m, price: m ? last(cc.pricing.price[key(m.id, r.id)]) : null, inStock: m ? last(cc.availability.stock[key(m.id, r.id)]) === 1 : null, readable: readableAt(r.id).state }; });
    const feedComplete = 60 + Math.round(rnd() * 20);
    return { family: f, rows: rowsR, feedComplete, weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, feedComplete: Math.min(100, feedComplete + (w >= 3 ? (w - 2) * 4 : 0)), fulfilled: Math.min(98, 62 + Math.round(rnd() * 10) + (w >= 4 ? (w - 3) * 3 : 0)) })) };
  });

  const band = { onePass: r1(5 + rnd() * 2.5), sevenPass: r1(2 + rnd() * 0.8) };
  const s0 = base.share[S] ?? 0, p0 = base.presence[S]?.rate ?? 0, t0 = base.topPick.out[S] ?? 0;
  const h0 = base.h2h.n ? r1((base.h2h.win / base.h2h.n) * 100) : 0;
  const series = {
    share: { label: "Share of AI answer", unit: "%", data: trajectory(rnd, s0, Math.max(2, s0 * 0.3), band.sevenPass) },
    presence: { label: "Named in", unit: "% of questions", data: trajectory(rnd, p0, Math.min(100 - p0, 9), band.sevenPass).map((v) => Math.min(100, v)) },
    topPick: { label: "Top-pick share", unit: "%", data: trajectory(rnd, t0, Math.max(2, t0 * 0.35), band.sevenPass) },
    h2hWin: { label: "Head-to-head win rate", unit: "%", data: trajectory(rnd, h0, 10, band.sevenPass) },
    top5Named: { label: `${SL} named on top-5 sources`, unit: "%", data: trajectory(rnd, top5Named, Math.min(100 - top5Named, 9), band.sevenPass).map((v) => Math.min(100, v)) },
  };
  const shareGain = series.share.data[12] - s0;
  const rivalTotal = rivals.reduce((n, r) => n + (base.share[r.id] ?? 0), 0) || 1;
  const rivalShare = Object.fromEntries(rivals.map((r) => { const b0 = base.share[r.id] ?? 0; return [r.id, Array.from({ length: WEEKS }, (_, w) => r1(b0 - (shareGain * (b0 / rivalTotal) * w) / 12 + (rnd() * 2 - 1) * 0.6))]; }));

  const accessOpen = subjectSites.some((s) => s.blocked > 0) ? 1 : 0;
  const nQ = base.questions;
  const deliverables = [
    { id: "baseline", group: "Diagnose", label: "Baseline at production sampling", what: "Every question in the bank run seven times per engine so that each share and presence figure carries a confidence interval.", atlas: [], owner: "BrandContext", cadence: "week 1, then monthly", kpi: "questions with a stable estimate", unit: `of ${nQ}`, start: 0, target: nQ, series: ramp(0, nQ, 1, 1), page: "baseline" },
    { id: "truthset", group: "Diagnose", label: "Claim truth-set", what: "Every checkable claim the engines make about the brand, verified: prices against the Atlas shelf ladder, specs and awards by the product team.", atlas: ["Pricing", "Availability", "Catalogue"], owner: `${SL} product marketing + BrandContext`, cadence: "week 1, refreshed monthly", kpi: "claims verified", unit: `of ${base.claims.total}`, start: 0, target: base.claims.total, series: ramp(0, base.claims.total, 1, 2), page: "truthset" },
    { id: "access", group: "Diagnose", label: "Crawler and access audit", what: "robots.txt, bot management and rendering of the brand's own domains and the sites that carry it, against every engine's crawlers.", atlas: [], owner: `${SL} web platform`, cadence: "week 1, quarterly", kpi: "access findings open", unit: "", start: accessOpen, target: 0, series: ramp(accessOpen, 0, 2, 2), page: "access" },
    { id: "feeds", group: "Diagnose", label: "Feed and shopping-surface audit", what: "Merchant and retailer feeds reconciled against the Atlas shelf: price, stock and carriage per SKU per retailer.", atlas: ["Pricing", "Availability", "Carriage"], owner: `${SL} retail ops + BrandContext`, cadence: "week 1, weekly", kpi: "feed mismatches open", unit: "", start: mismatches, target: 0, series: ramp(mismatches, 0, 4, 5), page: "access" },
    { id: "listing", group: "Diagnose", label: "Listing readiness", what: "Which retailer listings the engines can read at all, and how complete the readable ones are.", atlas: ["PDP content", "Carriage", "Availability"], owner: "BrandContext", cadence: "week 1, monthly", kpi: `readiness at ${bestOpen.retailer}`, unit: "/100", start: bestOpen.readiness, target: Math.min(100, bestOpen.readiness + 5), series: bestOpen.weekly.map((w) => w.readiness), page: "listing" },
    { id: "catalogue", group: "Diagnose", label: "Catalogue presence map", what: "Every model in the line-up against how often the engines name it, weighted by where it is carried and selling.", atlas: ["Carriage", "Shelf share", "Pricing"], owner: "BrandContext", cadence: "week 1, monthly", kpi: "models named at least once", unit: `of ${families.length}`, start: catalogue.filter((x) => x.named > 0).length, target: families.length, series: ramp(catalogue.filter((x) => x.named > 0).length, families.length, 6, 10), page: "catalogue" },
    { id: "corrections", group: "Fix", label: "Source corrections", what: "Each wrong or stale claim traced to the cited page and corrected there; confirmed when a re-read returns the true value.", atlas: ["Pricing"], owner: `BrandContext outreach + ${SL} PR`, cadence: "weeks 2–8", kpi: "corrections confirmed on re-read", unit: `of ${corrections.length}`, start: 0, target: corrections.length, series: Array.from({ length: WEEKS }, (_, w) => confirmedBy(w)), page: "truthset" },
    { id: "botfix", group: "Fix", label: "Bot manager and access fixes", what: "The search crawlers fetch product pages; proven from crawl logs, not from robots.txt.", atlas: [], owner: `${SL} web platform`, cadence: "weeks 1–2", kpi: "engines with crawl-log proof", unit: `of ${c.engines.length}`, start: 0, target: c.engines.length, series: ramp(0, c.engines.length, 2, 3), page: "access" },
    { id: "feedfix", group: "Fix", label: "Feed hygiene", what: `Price and stock in every feed match the shelf Atlas reads, so shopping surfaces show the right ${SL} model at the right price.`, atlas: ["Pricing", "Availability"], owner: `${SL} retail ops`, cadence: "weeks 2–6, then weekly", kpi: "SKUs with feed matching shelf", unit: "%", start: feedRows.length ? Math.round(((feedRows.length - mismatches) / feedRows.length) * 100) : 100, target: 100, series: ramp(feedRows.length ? Math.round(((feedRows.length - mismatches) / feedRows.length) * 100) : 100, 100, 4, 5), page: "access" },
    { id: "placement", group: "Earn", label: "Source placement", what: `${SL} in the reviews, lists and threads the engines actually cite, starting with the sources cited most where the brand is absent.`, atlas: ["Voice of Customer", "Pricing"], owner: `${SL} PR / reviews programme + BrandContext`, cadence: "weeks 2–12", kpi: "placements live", unit: `of ${pipeline.length}`, start: 0, target: pipeline.length, series: Array.from({ length: WEEKS }, (_, w) => liveBy(pipeline, w, ["live", "cited"])), page: "sources" },
    { id: "community", group: "Earn", label: "Community and video", what: "Transcripts, chapter titles and thread answers on the video and forum sources the engines quote.", atlas: ["Voice of Customer"], owner: `${SL} social + creator programme`, cadence: "weeks 3–12", kpi: "items live", unit: `of ${items.length}`, start: 0, target: items.length, series: Array.from({ length: WEEKS }, (_, w) => liveBy(items, w, ["live", "cited"])), page: "community" },
    { id: "comparison", group: "Own", label: "Comparison pages", what: "Pages that answer the head-to-head questions directly, with a live price table and review evidence, answer-first.", atlas: ["Pricing", "Voice of Customer", "Catalogue"], owner: `${SL} content + BrandContext`, cadence: "weeks 3–10", kpi: "pages live", unit: `of ${pages.filter((p) => p.kind === "comparison").length}`, start: 0, target: pages.filter((p) => p.kind === "comparison").length, series: Array.from({ length: WEEKS }, (_, w) => liveBy(pages.filter((p) => p.kind === "comparison"), w, ["live", "cited"])), page: "content" },
    { id: "usecase", group: "Own", label: "Use-case guides", what: "The questions shoppers ask before they know the model, argued with what buyers say.", atlas: ["Voice of Customer"], owner: `${SL} content`, cadence: "weeks 4–10", kpi: "guides live", unit: `of ${pages.filter((p) => p.kind === "use-case").length}`, start: 0, target: pages.filter((p) => p.kind === "use-case").length, series: Array.from({ length: WEEKS }, (_, w) => liveBy(pages.filter((p) => p.kind === "use-case"), w, ["live", "cited"])), page: "content" },
    { id: "pdp", group: "Own", label: "Listing content on readable retailers", what: "Claims, specs and comparisons carried onto the product pages the engines can read, with reviews syndicated.", atlas: ["PDP content", "Voice of Customer"], owner: `${SL} retail content`, cadence: "weeks 4–8", kpi: `${bestOpen.retailer} PDP score`, unit: "/100", start: bestOpen.pdpAvg, target: Math.min(100, bestOpen.pdpAvg + 10), series: bestOpen.weekly.map((w) => w.pdp), page: "listing" },
    { id: "entity", group: "Own", label: "Entity hygiene", what: "Model naming the engines can resolve, specs published once, structured where it matters for shopping.", atlas: ["Catalogue"], owner: `${SL} product marketing`, cadence: "weeks 2–4", kpi: "naming confusions open", unit: "", start: Math.min(3, families.length), target: 0, series: ramp(Math.min(3, families.length), 0, 2, 4), page: "catalogue" },
    { id: "monitor", group: "Measure", label: "Monthly full-bank read, weekly decision read", what: "The same bank, engines and reader on a cadence, with drift reported against the baseline.", atlas: [], owner: "BrandContext", cadence: "weekly / monthly", kpi: "reads delivered", unit: "", start: 0, target: 14, series: [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14], page: "trajectory" },
    { id: "shopping", group: "Measure", label: "Shopping-surface monitor", what: `Whether the ${SL} model an engine recommends is carried, in stock and at the claimed price where the engine points.`, atlas: ["Availability", "Pricing", "Carriage"], owner: "BrandContext", cadence: "weekly", kpi: "recommendations fulfillable", unit: "%", start: shopping[0]?.weekly[0].fulfilled ?? 0, target: 95, series: Array.from({ length: WEEKS }, (_, w) => Math.round(mean(shopping.map((s) => s.weekly[w].fulfilled)))), page: "shopping" },
    { id: "demand", group: "Measure", label: "Demand-weighted question bank", what: "The bank weighted by what shoppers actually ask, from retail search terms and site search, not by our judgement.", atlas: ["Retail search terms", "Web traffic"], owner: "BrandContext", cadence: "month 2", kpi: "questions carrying a demand weight", unit: `of ${nQ}`, start: 0, target: nQ, series: [0, 0, 0, 0, 0, Math.round(nQ / 2), Math.round(nQ / 2), Math.round(nQ / 2), nQ, nQ, nQ, nQ, nQ], page: "baseline" },
  ];
  const invert = (d: { start: number; target: number }) => d.target < d.start;
  const ledgerA = deliverables.map((d) => ({ id: d.id, group: d.group, label: d.label, kpi: d.kpi, unit: d.unit, baseline: d.series[0], pilot: d.series[PILOT_END], end: d.series[12], target: d.target, invert: invert(d), done: invert(d) ? d.series[12] <= d.target : d.series[12] >= d.target }));
  const ledgerB = Object.entries(series).map(([id, s]) => ({ id, label: s.label, unit: s.unit, baseline: s.data[0], pilot: s.data[PILOT_END], end: s.data[12], band: band.sevenPass, cleared: s.data[12] - s.data[0] > band.sevenPass }));
  const done = ledgerA.filter((x) => x.done && deliverables.find((d) => d.id === x.id)!.series[PILOT_END] === x.end).length;
  const rank = [...c.brands].sort((a, z) => (base.share[z.id] ?? 0) - (base.share[a.id] ?? 0)).findIndex((b) => b.id === S) + 1;
  const blockedRetail = listing.filter((l) => l.readable.state === "blocked").map((l) => l.retailer);

  return {
    version: WORKBENCH_VERSION,
    meta: {
      title: `${SL} · AEO Workbench`, subtitle: "A twelve-week AEO programme, simulated forward from a measured week 0", subject: S, subjectLabel: SL, brandMark: null, market: c.market, category: c.category,
      generatedFrom: { aiVisibility: c.generatedAt, commandCenter: { start: weeks[0].date, end: weeks[12].date, days: 84, weeks: 12 } },
      pilotEndWeek: PILOT_END,
      disclosure: {
        short: "Simulated programme view",
        headline: "The programme figures on these screens are simulated, not measured.",
        body: `Week 0 is the measured ${weeks[0].date} capture: ${nQ} shopper questions on ${c.engines.length} engines, read by one extractor, with every answer's receipt on the AI Visibility console. Every week after it is a simulation of what an AEO programme would do and what the engines would show in response, drawn inside the sampling band. Nothing here is a promise; it is the shape of the work.`,
        anchors: [
          { lane: "AI answer share, presence, position, top pick", measured: `${base.answers} engine answers to ${nQ} questions on ${c.engines.length} engines, captured ${weeks[0].date}; brand comparisons on the ${base.compare.questions} brand-neutral questions`, source: "AI console capture", pins: "week 0 of every outcome series; the rivals' shares at week 0" },
          { lane: `Claims about ${SL}`, measured: `${base.claims.total} checkable statements extracted from the same answers`, source: "same capture · subjectClaims", pins: "the truth-set rows; price verdicts against the Amazon shelf" },
          { lane: "Sources and citation gap", measured: `${base.sources.total} citations across ${base.sources.distinct} domains; ${SL} named in ${top5Named}% of answers citing the top five`, source: "same capture · sources", pins: "the placement pipeline's targets and week-0 named rate" },
          { lane: "Crawler access", measured: `robots.txt of ${crawlSites.length} sites against ${c.crawlerAccess?.bots.length ?? 0} crawlers`, source: "crawler audit", pins: "retailer readability in listing readiness; the access findings at week 0" },
          { lane: "Atlas pricing, availability, carriage, PDP content, reviews", measured: "the command centre's lanes: Amazon measured, other retailers modelled", source: "command-centre payload", pins: "price verdicts, feed audit, listing readiness, catalogue weights, fulfilment", modelled: true },
          { lane: "Programme progress, weeks 1–12", measured: "nothing — no programme has run", source: "this builder", pins: "every pipeline stage, correction, placement and page status after week 0", unmeasured: true },
          { lane: "Outcome trajectories, weeks 1–12", measured: "nothing — drawn inside the sampling band from the measured week 0", source: "this builder", pins: "share, presence, top pick, head-to-head and top-5 named after week 0", unmeasured: true },
        ],
      },
    },
    dims: { weeks, brands: c.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject })), engines: c.engines.map((e) => ({ id: e.id, label: e.label })), stages: c.stages, retailers, families, attrs: c.attrs, aspects: cc.dims.aspects ?? [], stagesPlacement: PLACEMENT, statusContent: CONTENT },
    baseline: base,
    truthSet: {
      price: { total: rows.length, ...verdicts, rows },
      other: { total: otherTotal, verdicts: { confirmed: otherTotal - outOfDate - wrongOther, "out of date": outOfDate, wrong: wrongOther } },
      corrections,
      weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, verified: w === 0 ? 0 : w === 1 ? Math.round(base.claims.total * 0.55) : base.claims.total, filed: filedBy(w), confirmed: confirmedBy(w) })),
    },
    access: {
      sonySites: subjectSites,
      bot403: { host: subjectSites[0]?.host ?? "", finding: "serves its pages to AI search crawlers; no bot-manager block was seen in the audit", fixedWeek: 0 },
      llmsRivals: crawlSites.filter((x) => x.llmsTxt && rivals.some((r) => r.id === x.kind)).map((x) => x.host.replace(/^www\./, "")),
      feed: { rows: feedRows, mismatches, weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, open: feedRows.filter((f) => f.fixedWeek != null && w < f.fixedWeek).length })) },
      crawlerWeekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, sonyBlockingRules: w < 2 ? subjectSites.reduce((n, s) => n + s.blocked, 0) : 0, bot403: false })),
    },
    listing,
    catalogue,
    sources: {
      top: base.sources.top, kinds: base.sources.kinds, total: base.sources.total, top5Named, pipeline,
      weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, live: liveBy(pipeline, w, ["live", "cited"]), cited: liveBy(pipeline, w, ["cited"]), top5Named: series.top5Named.data[w] })),
    },
    content: {
      argue: attrRows, pages,
      weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, live: liveBy(pages, w, ["live", "cited"]), cited: liveBy(pages, w, ["cited"]), h2hWin: series.h2hWin.data[w] })),
    },
    community: {
      share: base.sources.total ? r1((communityCites.length / base.sources.total) * 100) : 0,
      named: communityCites.length ? Math.round((communityCites.filter((a) => a.brands.some((m) => m.id === S)).length / communityCites.length) * 100) : 0,
      hosts: communityHosts, items,
      weekly: Array.from({ length: WEEKS }, (_, w) => ({ week: w, live: liveBy(items, w, ["live", "cited"]), namedRate: Math.min(100, (communityCites.length ? Math.round((communityCites.filter((a) => a.brands.some((m) => m.id === S)).length / communityCites.length) * 100) : 0) + (w >= 6 ? w - 5 : 0)) })),
    },
    shopping,
    trajectory: { bands: band, series, rivalShare },
    deliverables,
    ledger: { A: ledgerA, B: ledgerB },
    reads: {
      overview: [
        { tone: "good", text: `Week 0 is measured: ${SL} holds ${s0}% of the weighted AI answer, ${rank === 1 ? "first" : `rank ${rank}`} of ${c.brands.length}, and is named in ${base.presence[S]?.n ?? 0} of ${base.compare.questions} brand-neutral questions.` },
        { tone: "watch", text: `The engines make ${base.claims.total} checkable claims about ${SL}; against the Amazon shelf ${verdicts.wrong} price claims are wrong and ${verdicts.stale} are stale. That is the first deliverable.` },
        { tone: "watch", text: `By the end of the eight-week pilot the simulation closes ${done} of ${deliverables.length} controlled deliverables; ${ledgerB.filter((x) => x.cleared).length} of ${ledgerB.length} outcome measures move beyond the ±${band.sevenPass}-point sampling band.` },
        { tone: "watch", text: blockedRetail.length ? `${blockedRetail.join(" and ")} ${blockedRetail.length === 1 ? "blocks" : "block"} the AI search crawlers; ${bestOpen.retailer} is readable. Listing work lands where the engines can read, and feeds carry the rest.` : `No audited retailer blocks the AI search crawlers; ${bestOpen.retailer} is the readable listing to work first.` },
      ],
    },
    links: { console: "#ai-overview", commandCenter: "#scorecard" },
  };
}
