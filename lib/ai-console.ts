import { createHash } from "node:crypto";
import { brandAliases, type AiSoMResult, type FunnelStage } from "./ai-visibility";
import type { EngineId, EnginePath } from "./ai-engines";
import type { CrawlerAccess } from "./crawler-access";

const ENGINE_IDS: Record<EngineId, string> = { chatgpt: "gpt", perplexity: "perplexity", gemini: "gemini", copilot: "copilot", claude: "claude" };

type PathedEngine = { model: string; webSearch: boolean; path: EnginePath };

const engineVia = (e: PathedEngine): string =>
  e.path === "ui" ? `${e.model} consumer app via Bright Data` : `${e.model} API${e.webSearch ? " with web search" : ""}`;

const pathSummary = (engines: Array<PathedEngine & { label: string }>): string => {
  const ui = engines.filter((e) => e.path === "ui").map((e) => e.label);
  const api = engines.filter((e) => e.path === "api").map((e) => e.label);
  return [ui.length ? `${ui.join(", ")} through their consumer apps (Bright Data)` : "", api.length ? `${api.join(", ")} through the model API` : ""].filter(Boolean).join("; ");
};

const STAGES: Array<{ id: FunnelStage; label: string; desc: string; aida: string }> = [
  { id: "awareness", label: "Awareness", desc: "Broad category discovery — the shopper doesn't know what to buy yet.", aida: "Attention" },
  { id: "consideration", label: "Consideration", desc: "Narrowing by use case and features.", aida: "Interest" },
  { id: "evaluation", label: "Evaluation & Trust", desc: "Comparing brands, weighing reliability and whether the premium is worth it.", aida: "Desire" },
  { id: "decision", label: "Decision", desc: "Bottom-funnel — specific models, price ceilings, ready to buy.", aida: "Action" },
];

const RETAIL_HOSTS = ["amazon.", "bestbuy.", "walmart.", "target.", "costco.", "newegg.", "homedepot.", "lowes.", "crutchfield.", "bhphotovideo.", "ebay.", "kohls.", "macys.", "samsclub.", "wayfair.", "dickssportinggoods.", "rei.com"];
const COMMUNITY_HOSTS = ["reddit.", "youtube.", "youtu.be", "quora.", "facebook.", "tiktok.", "x.com", "twitter.", "instagram.", "forum", "community.", "stackexchange."];
const NEWS_HOSTS = ["nytimes.", "cnn.", "bbc.", "reuters.", "apnews.", "washingtonpost.", "wsj.", "usatoday.", "forbes.", "businessinsider.", "cnbc.", "bloomberg.", "theguardian."];

export type ConsoleBrand = { id: string; label: string; color: string; subject: boolean; owned: string[]; aliases: string[] };
export type ConsoleSource = { title: string; url: string; host: string; kind: string };
export type ConsoleAnswer = {
  queryId: string;
  engine: string;
  run: number;
  text: string;
  brands: Array<{ id: string; rank: number; recommended: boolean; sentiment: string; product: string }>;
  topPick: string | null;
  attributes: Record<string, Array<{ attr: string; polarity: "+" | "-" }>>;
  subjectClaims: Array<{ claim: string; type: string; product: string; value: string }>;
  sources: ConsoleSource[];
  path: EnginePath;
  sha256: string;
};
export type ConsoleCapture = {
  key: string;
  basis: string;
  path: EnginePath;
  capturedAt: string;
  engineSource: string;
  extractor: string;
  file: null;
  engines: Array<{ id: string; label: string; model: string }>;
  n: number;
  answers: ConsoleAnswer[];
  search: null;
  enginePaths: Record<string, { path: EnginePath; n: number; via: string }>;
};

export type AiConsolePayload = {
  instance: string;
  subject: string;
  subjectLabel: string;
  productLine: string;
  category: string;
  categoryNoun: [string, string];
  catCopy: Record<string, string>;
  market: string;
  generatedAt: string;
  brands: ConsoleBrand[];
  stages: typeof STAGES;
  engines: Array<{ id: string; label: string; measured: boolean; live: boolean; via: string }>;
  attrs: string[];
  bank: AiSoMResult["bank"]["questions"];
  catalog: { products: Array<{ id: string; label: string; family: string; msrp: number | null }>; msrpNote: string };
  weighting: { method: string; favour: Record<string, number> };
  captures: Record<string, ConsoleCapture>;
  current: string;
  previous: string | null;
  driftPair: { from: string; to: string } | null;
  apiCurrent: string;
  volatility: null;
  googleAI: null;
  crawlerAccess: CrawlerAccess | null;
  evidenceSummary: null;
  askLinks: Record<string, string>;
  liveConfig: { endpoint: string | null; directUrl: string | null; engines: string[]; path: string };
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Classifies a cited site as the subject's own, a tracked rival's own, a
 * retailer, a community, news, or editorial.
 */
export function sourceKind(host: string, brands: ConsoleBrand[]): string {
  const owner = brands.find((b) => b.owned.some((d) => host === d || host.endsWith(`.${d}`)));
  if (owner) return owner.subject ? "owned" : "rival-owned";
  if (RETAIL_HOSTS.some((h) => host.includes(h))) return "retailer";
  if (COMMUNITY_HOSTS.some((h) => host.includes(h))) return "community";
  if (NEWS_HOSTS.some((h) => host.includes(h))) return "news";
  return host ? "editorial" : "other";
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Builds the AI Engine Visibility console's payload from a build's engine
 * answers: the brand set with its domains and aliases, the question bank,
 * one capture of every enriched answer with its sources, the previous build's
 * capture for change over time, and the crawler-access read.
 */
export function buildAiConsole(input: {
  slug: string;
  ai: AiSoMResult;
  brands: Array<{ id: string; label: string; color: string; name: string }>;
  subjectDomain: string | null;
  category: string;
  market: string;
  products: Array<{ label: string; msrp: number | null }>;
  previous: ConsoleCapture | null;
  crawlerAccess: CrawlerAccess | null;
  now?: Date;
}): AiConsolePayload {
  const now = input.now ?? new Date();
  const subjectName = input.brands[0]?.name ?? input.slug;
  const domains = input.ai.bank.domains;
  const brands: ConsoleBrand[] = input.brands.map((b, i) => {
    const domain = i === 0 && input.subjectDomain ? input.subjectDomain : domains[b.name];
    return { id: b.id, label: b.label, color: b.color, subject: i === 0, owned: domain ? [domain] : [], aliases: brandAliases(b.name).map((a) => a.toLowerCase()) };
  });
  const idOf = new Map(input.brands.map((b) => [b.name, b.id]));
  const brandId = (name: string): string => idOf.get(name) ?? slug(name);

  const basis = now.toISOString().slice(0, 10);
  const key = input.previous && input.previous.key === basis ? `${basis}-b` : basis;
  const pathOf = new Map(input.ai.engines.map((e) => [e.engine, e.path]));
  const capturePath: EnginePath = input.ai.engines.every((e) => e.path === "ui") ? "ui" : "api";
  const answers: ConsoleAnswer[] = input.ai.perQuestion.filter((q) => q.answer != null).map((q) => {
    const sources = q.sources.map((s): ConsoleSource => {
      const fromUrl = hostOf(s.url);
      const host = !fromUrl || fromUrl.includes("vertexaisearch") ? s.title.toLowerCase().replace(/^www\./, "") : fromUrl;
      return { title: s.title || host, url: s.url, host, kind: sourceKind(host, brands) };
    });
    return {
      queryId: q.queryId,
      engine: ENGINE_IDS[q.engine],
      run: q.run,
      text: q.answer as string,
      brands: q.brands.map((b) => ({ id: brandId(b.name), rank: b.rank, recommended: b.recommended, sentiment: b.sentiment, product: b.product })),
      topPick: q.topPick ? brandId(q.topPick) : null,
      attributes: Object.fromEntries(Object.entries(q.attributes).map(([name, list]) => [brandId(name), list])),
      subjectClaims: q.claims,
      sources,
      path: pathOf.get(q.engine) ?? "api",
      sha256: createHash("sha256").update(q.answer as string).digest("hex"),
    };
  });
  const engines = input.ai.engines.map((e) => ({ id: ENGINE_IDS[e.engine], label: e.label, model: e.model }));
  const capture: ConsoleCapture = {
    key, basis, path: capturePath, capturedAt: now.toISOString(),
    engineSource: pathSummary(input.ai.engines),
    extractor: "command-center enrichment v1", file: null, engines, n: answers.length, answers, search: null,
    enginePaths: Object.fromEntries(input.ai.engines.map((e) => [ENGINE_IDS[e.engine], { path: e.path, n: answers.filter((a) => a.engine === ENGINE_IDS[e.engine]).length, via: engineVia(e) }])),
  };
  const captures: Record<string, ConsoleCapture> = { [key]: capture };
  if (input.previous) captures[input.previous.key] = input.previous;

  return {
    instance: input.slug,
    subject: brands[0]?.id ?? input.slug,
    subjectLabel: input.brands[0]?.label ?? subjectName,
    productLine: subjectName,
    category: input.category,
    categoryNoun: input.ai.bank.categoryNoun,
    catCopy: {
      claimKinds: "price, spec and feature",
      journey: "needs and budget, then features, then brand, then model, then where to buy",
      subBrands: `${subjectName}'s product lines`,
      personas: "a first-time buyer, an upgrader or a value-first shopper",
      rivalsExample: "any brand",
      truthSet: "prices, specs and features",
    },
    market: input.market,
    generatedAt: now.toISOString(),
    brands,
    stages: STAGES,
    engines: input.ai.engines.map((e) => ({ id: ENGINE_IDS[e.engine], label: e.label, measured: true, live: false, via: engineVia(e) })),
    attrs: input.ai.bank.attributes,
    bank: input.ai.bank.questions,
    catalog: { products: input.products.map((p, i) => ({ id: `p${i + 1}`, label: p.label, family: "", msrp: p.msrp })), msrpNote: "list price on Amazon (US$), from Keepa" },
    weighting: { method: "presence × (1/rank) × favourability", favour: { positive: 1, neutral: 0.6, mixed: 0.6, negative: 0.2 } },
    captures,
    current: key,
    previous: input.previous?.key ?? null,
    driftPair: input.previous ? { from: input.previous.key, to: key } : null,
    apiCurrent: key,
    volatility: null,
    googleAI: null,
    crawlerAccess: input.crawlerAccess,
    evidenceSummary: null,
    askLinks: { gpt: "https://chatgpt.com/?q=", perplexity: "https://www.perplexity.ai/search?q=", claude: "https://claude.ai/new?q=", gemini: "https://gemini.google.com/app", copilot: "https://copilot.microsoft.com/?q=", googleAiMode: "https://www.google.com/search?udm=50&q=" },
    liveConfig: { endpoint: "/api/ai-live", directUrl: null, engines: input.ai.engines.map((e) => ENGINE_IDS[e.engine]), path: `${pathSummary(input.ai.engines)}; the measured capture used the same engines the same way` },
  };
}

/**
 * The sites whose crawler access matters for a brand: its own domain, each
 * rival's, the main retailers, and the hosts the engines cited most.
 */
export function crawlerSites(console: Pick<AiConsolePayload, "brands" | "captures" | "current">, topHosts = 8, retailers: string[] = ["amazon.com", "bestbuy.com", "walmart.com", "target.com"]): Array<{ host: string; kind: string }> {
  const own = console.brands.flatMap((b) => b.owned.map((d) => ({ host: `www.${d}`, kind: b.id })));
  const retail = retailers.map((d) => ({ host: `www.${d}`, kind: "retail" }));
  const counts = new Map<string, { n: number; kind: string }>();
  for (const a of console.captures[console.current]?.answers ?? []) {
    for (const s of a.sources) {
      if (!s.host || s.kind === "owned" || s.kind === "rival-owned") continue;
      const c = counts.get(s.host) ?? { n: 0, kind: s.kind === "retailer" ? "retail" : s.kind === "community" ? "community" : "editorial" };
      c.n++;
      counts.set(s.host, c);
    }
  }
  const cited = [...counts].sort((a, z) => z[1].n - a[1].n).slice(0, topHosts).map(([host, c]) => ({ host, kind: c.kind }));
  return [...own, ...retail, ...cited.filter((x) => !retailers.some((d) => x.host.endsWith(d)))];
}
