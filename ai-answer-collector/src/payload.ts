// Builds the AI Engine Visibility payload for each brand × category, in the
// schema the command-center-template console reads (lib/ai-console.ts
// buildAiConsole → public/ai-visibility.js): the brand set with domains and
// aliases, the question bank, one capture of every read answer with its
// sources and evidence, and the crawler-access read. Every collection that
// asked the bank is a week (oldest first: Week 1, Week 2, …): each week is a
// capture of its own, and an "all weeks" capture pools them for the main
// pages; Change Over Time reads the weeks one by one. Each answer also carries
// its persona, run and week; the dashboard filters on all three.
//
//   npm run payload -- --collection 2026-10 [--pairs sony-tv] [--no-crawler]

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { COUNTRY, PAIRS } from "./config/brands";
import { PERSONAS } from "./config/personas";
import { STAGES } from "./config/questions";
import { loadBank, type Bank } from "./banks";
import { readCrawlerAccess, type CrawlerAccess } from "./crawler-access";
import { enrichedPath, type Reading } from "./enrich";
import type { EngineId, EnginePath } from "./engines";
import { questionHash } from "./jobs";
import type { Manifest } from "./manifest";
import { CollectionStore, DATA_DIR, hostOf, responsePath, type ResponseRecord } from "./store";

const ENGINE_IDS: Record<EngineId, string> = { chatgpt: "gpt", perplexity: "perplexity", gemini: "gemini", copilot: "copilot", claude: "claude" };
const COLORS = ["#1d5aa0", "#d9482b", "#7c3aed", "#d99a1e", "#2a9d6f", "#3f6b8a", "#8c6d1f"];

const RETAIL_HOSTS = ["amazon.", "bestbuy.", "walmart.", "target.", "costco.", "newegg.", "homedepot.", "lowes.", "crutchfield.", "bhphotovideo.", "ebay.", "kohls.", "macys.", "samsclub.", "wayfair.", "dickssportinggoods.", "rei.com"];
const COMMUNITY_HOSTS = ["reddit.", "youtube.", "youtu.be", "quora.", "facebook.", "tiktok.", "x.com", "twitter.", "instagram.", "forum", "community.", "stackexchange."];
const NEWS_HOSTS = ["nytimes.", "cnn.", "bbc.", "reuters.", "apnews.", "washingtonpost.", "wsj.", "usatoday.", "forbes.", "businessinsider.", "cnbc.", "bloomberg.", "theguardian."];

type ConsoleBrand = { id: string; label: string; color: string; subject: boolean; owned: string[]; aliases: string[] };

/** As command-center-template brandAliases: the name, without spaces, and a distinctive last word. */
function brandAliases(brand: string): string[] {
  const words = brand.trim().split(/\s+/);
  const aliases = new Set([brand.trim(), words.join("")]);
  if (words.length > 1 && words[words.length - 1].length >= 4) aliases.add(words[words.length - 1]);
  return [...aliases].filter(Boolean);
}

function sourceKind(host: string, brands: ConsoleBrand[]): string {
  const owner = brands.find((b) => b.owned.some((d) => host === d || host.endsWith(`.${d}`)));
  if (owner) return owner.subject ? "owned" : "rival-owned";
  if (RETAIL_HOSTS.some((h) => host.includes(h))) return "retailer";
  if (COMMUNITY_HOSTS.some((h) => host.includes(h))) return "community";
  if (NEWS_HOSTS.some((h) => host.includes(h))) return "news";
  return host ? "editorial" : "other";
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function consoleBrands(bank: Bank): ConsoleBrand[] {
  const all = [{ id: bank.brand.id, label: bank.brand.label }, ...bank.competitors];
  return all.map((b, i) => {
    const domain = i === 0 ? bank.brand.domain : bank.domains[b.label];
    return { id: b.id, label: b.label, color: COLORS[i % COLORS.length], subject: i === 0, owned: domain ? [domain] : [], aliases: brandAliases(b.label).map((a) => a.toLowerCase()) };
  });
}

function capture(store: CollectionStore, manifest: Manifest, bank: Bank, brands: ConsoleBrand[], week: number) {
  const readings = store.readJson<Record<string, Reading>>(enrichedPath(bank.category.slug)) ?? {};
  const idOf = new Map(brands.map((b) => [b.label.toLowerCase(), b.id]));
  const brandId = (name: string): string => idOf.get(name.toLowerCase()) ?? slug(name);
  const index = [...store.index().values()].filter((e) => e.category === bank.category.slug && e.status === "ok");
  let unread = 0;
  const answers = bank.questions.flatMap((q) => {
    const hash = questionHash(q.text);
    return index.filter((e) => e.questionHash === hash).flatMap((e) => {
      const reading = readings[e.id];
      if (!reading) { unread++; return []; }
      const r = store.readJson<ResponseRecord>(responsePath(e.id));
      if (!r?.answer) return [];
      return [{
        queryId: q.id,
        engine: ENGINE_IDS[r.engine],
        run: r.run,
        week,
        persona: r.persona.id,
        text: r.answer.text,
        brands: reading.brands.map((b) => ({ id: brandId(b.name), rank: b.rank, recommended: b.recommended, sentiment: b.sentiment, product: b.product })),
        topPick: reading.topPick ? brandId(reading.topPick) : null,
        attributes: Object.fromEntries(Object.entries(reading.attributes).map(([name, list]) => [brandId(name), list])),
        subjectClaims: reading.claims.filter((c) => brandId(c.brand ?? "") === bank.brand.id).map(({ claim, type, product, value }) => ({ claim, type, product, value })),
        sources: r.sources.map((s) => {
          const fromUrl = hostOf(s.url);
          const host = !fromUrl || fromUrl.includes("vertexaisearch") ? s.title.toLowerCase().replace(/^www\./, "") : fromUrl;
          return { title: s.title || host, url: s.url, host, kind: sourceKind(host, brands) };
        }),
        path: r.path,
        sha256: r.answer.sha256,
        evidence: r.evidence ? { ...r.evidence, image: r.screenshot ? `/files/${store.collection}/${r.screenshot}` : null } : null,
      }];
    });
  });
  const engines = manifest.engines.filter((e) => answers.some((a) => a.engine === ENGINE_IDS[e.id]));
  const via = (e: { model: string; path: EnginePath }) => (e.path === "ui" ? `${e.model} consumer app via Bright Data` : `${e.model} API via the Atlas LLM proxy`);
  const ui = engines.filter((e) => e.path === "ui").map((e) => e.label), api = engines.filter((e) => e.path === "api").map((e) => e.label);
  return {
    unread,
    capture: {
      key: store.collection,
      basis: `Week ${week}`,
      date: manifest.createdAt.slice(0, 10),
      path: (engines.length && engines.every((e) => e.path === "ui") ? "ui" : "api") as EnginePath,
      capturedAt: manifest.updatedAt,
      engineSource: [ui.length ? `${ui.join(", ")} through their consumer apps (Bright Data)` : "", api.length ? `${api.join(", ")} through the model API` : ""].filter(Boolean).join("; "),
      extractor: "command-center enrichment v1",
      file: null,
      engines: engines.map((e) => ({ id: ENGINE_IDS[e.id], label: e.label, model: e.model })),
      n: answers.length,
      answers,
      search: null,
      enginePaths: Object.fromEntries(engines.map((e) => [ENGINE_IDS[e.id], { path: e.path, n: answers.filter((a) => a.engine === ENGINE_IDS[e.id]).length, via: via(e) }])),
    },
    engines: engines.map((e) => ({ id: ENGINE_IDS[e.id], label: e.label, measured: true, live: false, via: via(e) })),
  };
}

type Capture = ReturnType<typeof capture>;

/**
 * The weeks pooled: the engines of any week, every week's answer count. The answers are not
 * repeated here: the dashboard pools them from the week captures (`pooledFrom`) when it loads.
 */
function pooled(weeks: Capture[]) {
  const last = weeks[weeks.length - 1].capture;
  const answers = weeks.flatMap((w) => w.capture.answers);
  const engines = [...new Map(weeks.flatMap((w) => w.engines).map((e) => [e.id, e])).values()];
  const enginePaths: Record<string, { path: EnginePath; n: number; via: string }> = {};
  for (const w of weeks) for (const [id, p] of Object.entries(w.capture.enginePaths)) enginePaths[id] = { ...p, n: (enginePaths[id]?.n ?? 0) + p.n };
  return {
    unread: weeks.reduce((n, w) => n + w.unread, 0),
    capture: { ...last, key: "all-weeks", basis: weeks.length > 1 ? `Weeks 1–${weeks.length}` : "Week 1", date: weeks[0].capture.date,
      engines: [...new Map(weeks.flatMap((w) => w.capture.engines).map((e) => [e.id, e])).values()], n: answers.length, answers, enginePaths,
      pooledFrom: weeks.map((w) => w.capture.key) },
    engines,
  };
}

/** Earlier collections that asked this bank, oldest first. */
function earlierCollections(current: string, bankKey: string): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== current)
    .map((d) => ({ name: d.name, m: new CollectionStore(d.name).readJson<Manifest>("manifest.json") }))
    .filter((x): x is { name: string; m: Manifest } => !!x.m && x.m.banks.includes(bankKey))
    .filter((x) => x.m.createdAt < (new CollectionStore(current).readJson<Manifest>("manifest.json")?.createdAt ?? ""))
    .sort((a, b) => a.m.createdAt.localeCompare(b.m.createdAt))
    .map((x) => x.name);
}

/** As command-center-template crawlerSites: own and rival domains, the main retailers, and the most-cited hosts. */
function crawlerSites(brands: ConsoleBrand[], answers: Array<{ sources: Array<{ host: string; kind: string }> }>, topHosts = 8) {
  const retailers = ["amazon.com", "bestbuy.com", "walmart.com", "target.com"];
  const counts = new Map<string, { n: number; kind: string }>();
  for (const a of answers) for (const s of a.sources) {
    if (!s.host || s.kind === "owned" || s.kind === "rival-owned") continue;
    const c = counts.get(s.host) ?? { n: 0, kind: s.kind === "retailer" ? "retail" : s.kind === "community" ? "community" : "editorial" };
    c.n++;
    counts.set(s.host, c);
  }
  const cited = [...counts].sort((a, z) => z[1].n - a[1].n).slice(0, topHosts).map(([host, c]) => ({ host, kind: c.kind }));
  return [
    ...brands.flatMap((b) => b.owned.map((d) => ({ host: d.split(".").length > 2 ? d : `www.${d}`, kind: b.id }))),
    ...retailers.map((d) => ({ host: `www.${d}`, kind: "retail" })),
    ...cited.filter((x) => !retailers.some((d) => x.host.endsWith(d))),
  ];
}

export async function buildPayload(collection: string, bank: Bank, opts: { crawler: boolean }) {
  const store = new CollectionStore(collection);
  const manifest = store.readJson<Manifest>("manifest.json");
  if (!manifest) throw new Error(`collection ${collection} has no manifest`);
  const brands = consoleBrands(bank);
  // the weeks: every collection up to this one that asked the bank and has read answers
  const weeks = [...earlierCollections(collection, bank.key), collection]
    .map((name) => { const st = new CollectionStore(name); return capture(st, st.readJson<Manifest>("manifest.json")!, bank, brands, 0); })
    .filter((w) => w.capture.key === collection || w.capture.n);
  weeks.forEach((w, i) => { w.capture.basis = `Week ${i + 1}`; for (const a of w.capture.answers) a.week = i + 1; });
  const names = weeks.map((w) => w.capture.key);
  const cur = pooled(weeks);
  const [prev, last] = weeks.length > 1 ? weeks.slice(-2) : [null, null];

  let crawlerAccess: CrawlerAccess | null = store.readJson<CrawlerAccess>(`crawler/${bank.key}.json`);
  if (!crawlerAccess && opts.crawler) {
    crawlerAccess = await readCrawlerAccess(crawlerSites(brands, cur.capture.answers));
    await store.write(`crawler/${bank.key}.json`, JSON.stringify(crawlerAccess, null, 2), "application/json");
  }

  const captures: Record<string, unknown> = { [cur.capture.key]: { ...cur.capture, answers: [] }, ...Object.fromEntries(weeks.map((w) => [w.capture.key, w.capture])) };
  const hasPrev = !!(prev && last && prev.capture.n && last.capture.n);
  const [noun, nouns] = bank.category.noun;
  const payload = {
    instance: bank.key,
    subject: bank.brand.id,
    subjectLabel: bank.brand.label,
    productLine: bank.productLine,
    category: bank.category.slug,
    categoryNoun: [noun, nouns],
    catCopy: {
      claimKinds: "price, spec and feature",
      journey: "needs and budget, then features, then brand, then model, then where to buy",
      subBrands: `${bank.brand.label}'s product lines such as ${bank.productLine}`,
      personas: "a value seeker or a feature enthusiast",
      rivalsExample: bank.competitors.map((c) => c.label).slice(0, 3).join(", "),
      truthSet: "prices, specs and features",
    },
    market: COUNTRY,
    generatedAt: new Date().toISOString(),
    brands,
    stages: STAGES,
    engines: cur.engines,
    attrs: bank.attributes,
    bank: bank.questions.map(({ id, stage, focus, text }) => ({ id, stage, focus, text })),
    catalog: { products: bank.catalog, msrpNote: bank.catalog.some((p) => p.msrp != null) ? "launch MSRP from the instance brief (US$)" : "model list only; no prices on file" },
    weighting: { method: "presence × (1/rank) × favourability", favour: { positive: 1, neutral: 0.6, mixed: 0.6, negative: 0.2 } },
    captures,
    current: cur.capture.key,
    previous: hasPrev ? prev!.capture.key : null,
    driftPair: hasPrev ? { from: prev!.capture.key, to: last!.capture.key } : null,
    apiCurrent: cur.capture.key,
    volatility: null,
    googleAI: null,
    crawlerAccess,
    evidenceSummary: null,
    askLinks: { gpt: "https://chatgpt.com/?q=", perplexity: "https://www.perplexity.ai/search?q=", claude: "https://claude.ai/new?q=", gemini: "https://gemini.google.com/app", copilot: "https://copilot.microsoft.com/?q=", googleAiMode: "https://www.google.com/search?udm=50&q=" },
    liveConfig: { endpoint: null, directUrl: null, engines: [], path: "measured capture only" },
    // added for this tool: the dashboard's persona and run filters
    personas: PERSONAS.map((p) => ({ id: p.id, label: p.label, preamble: p.preamble })),
    runs: manifest.runs,
    weeks: weeks.map((w, i) => ({ week: i + 1, key: w.capture.key, label: `Week ${i + 1}`, date: w.capture.date, n: w.capture.n })),
  };
  await store.write(`payloads/${bank.key}.json`, JSON.stringify(payload), "application/json");
  return { answers: cur.capture.n, unread: cur.unread, weeks: names };
}

async function main() {
  const { values: args } = parseArgs({ options: { collection: { type: "string" }, pairs: { type: "string" }, "no-crawler": { type: "boolean", default: false } } });
  if (!args.collection) throw new Error("--collection is required");
  const manifest = new CollectionStore(args.collection).readJson<Manifest>("manifest.json");
  const keys = args.pairs?.split(",").map((s) => s.trim()) ?? PAIRS.map((p) => p.key).filter((k) => manifest?.banks.includes(k));
  for (const key of keys) {
    const r = await buildPayload(args.collection, loadBank(key), { crawler: !args["no-crawler"] });
    console.log(`[payload] ${key}: ${r.answers} answers${r.unread ? ` (${r.unread} not read yet — run npm run enrich)` : ""} · ${r.weeks.map((w, i) => `week ${i + 1} = ${w}`).join(", ")}`);
  }
}

if (process.argv[1]?.endsWith("payload.ts")) main().catch((e) => { console.error(e); process.exit(1); });
