import { callLLM } from "./llm";
import { availableEngines, type AiEngine, type AnswerSource, type EngineId } from "./ai-engines";

export type FunnelStage = "awareness" | "consideration" | "evaluation" | "decision";
export type QuestionFocus = "neutral" | "subject" | "vs";
export type BankQuestion = { id: string; stage: FunnelStage; focus: QuestionFocus; text: string };
export type Sentiment = "positive" | "neutral" | "mixed" | "negative";
export type EnrichedBrand = { name: string; rank: number; recommended: boolean; sentiment: Sentiment; product: string };
export type AttributeMention = { attr: string; polarity: "+" | "-" };
export type SubjectClaim = { claim: string; type: "price" | "spec" | "award" | "comparison" | "availability" | "other"; product: string; value: string };

export type QuestionBank = {
  questions: BankQuestion[];
  attributes: string[];
  categoryNoun: [string, string];
  domains: Record<string, string>;
};

const STAGES: FunnelStage[] = ["awareness", "consideration", "evaluation", "decision"];
const COMPARE_STAGES: FunnelStage[] = ["awareness", "consideration"];
const HOW_TO = /^\s*(how (do|should|can) i (choose|pick|decide|know|tell)|what (should|do) i (look|need) for|what (features|specs|factors) (matter|should)|what (does|is) (an? )?(ip\d|[a-z0-9-]+ (rating|mean))|how does)/i;

const FALLBACK_TEMPLATES: Array<{ stage: FunnelStage; q: string }> = [
  { stage: "awareness", q: "What are the best {CAT} brands right now?" },
  { stage: "awareness", q: "What are the top-rated {CAT} brands?" },
  { stage: "awareness", q: "What's the most popular {CAT} brand right now?" },
  { stage: "consideration", q: "I'm shopping for a {CAT}. Which brands should I consider?" },
  { stage: "consideration", q: "What {CAT} brands do you recommend for someone just starting out?" },
  { stage: "consideration", q: "What are the most innovative {CAT} brands?" },
  { stage: "evaluation", q: "Compare the top {CAT} brands on quality, price, and features." },
  { stage: "evaluation", q: "Which {CAT} brand has the best reputation among consumers?" },
  { stage: "evaluation", q: "Which {CAT} brands have the best customer reviews?" },
  { stage: "decision", q: "I want to buy a premium {CAT}. Which brands make the best ones?" },
  { stage: "decision", q: "If budget is no concern, what {CAT} should I buy?" },
  { stage: "decision", q: "Which {CAT} brand would you buy today, and why?" },
];

export type AiSoMInput = {
  subjectName: string;
  category: string;
  competitors?: string[];
  bank?: QuestionBank;
  runs?: number;
  engines?: AiEngine[];
  concurrency?: number;
};

export type AiQuestionResult = {
  engine: EngineId;
  run: number;
  queryId: string;
  stage: FunnelStage;
  focus: QuestionFocus;
  q: string;
  mentionOrder: string[];
  otherBrands: string[];
  brands: EnrichedBrand[];
  topPick: string | null;
  attributes: Record<string, AttributeMention[]>;
  claims: SubjectClaim[];
  sources: AnswerSource[];
  answer: string | null;
  error?: string;
};

export type EngineSoM = {
  engine: EngineId;
  label: string;
  model: string;
  webSearch: boolean;
  matching: "llm" | "mixed" | "pattern";
  questionsAsked: number;
  questionsFailed: number;
  shareByBrand: Record<string, number>;
  mentionRateByBrand: Record<string, number>;
  shareByStage: Partial<Record<FunnelStage, Record<string, number>>>;
  shareByRun: Array<Record<string, number>>;
  otherBrands: Array<{ brand: string; answers: number }>;
};

export type AiSoMResult = {
  engines: EngineSoM[];
  failedEngines: Array<{ engine: EngineId; label: string; error: string }>;
  bank: QuestionBank;
  subjectShare: number;
  shareByBrand: Record<string, number>;
  shareByStage: Partial<Record<FunnelStage, Record<string, number>>>;
  questionsAsked: number;
  questionsFailed: number;
  perQuestion: AiQuestionResult[];
};

const round1 = (v: number): number => Math.round(v * 10) / 10;
const escapeRe = (s: string): string => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const jsonIn = <T>(text: string): T => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;

/**
 * Names a brand might appear under in free text: the name itself, the name
 * without spaces, and the distinctive product-line word of a two-word name
 * (HomePod for "Apple HomePod").
 */
export function brandAliases(brand: string): string[] {
  const words = brand.trim().split(/\s+/);
  const aliases = new Set([brand.trim(), words.join("")]);
  if (words.length > 1 && words[words.length - 1].length >= 4) aliases.add(words[words.length - 1]);
  return [...aliases].filter(Boolean);
}

const aliasPattern = (brand: string): RegExp =>
  new RegExp(`\\b(?:${brandAliases(brand).map(escapeRe).join("|")})`, "i");

/**
 * Tracked brands found in a text by name, in order of first appearance. A
 * name is matched at the start of a word, so "Shark" also finds "SharkNinja".
 */
export function patternMentions(text: string, brands: string[]): string[] {
  return brands
    .map((b) => [b, text.search(aliasPattern(b))] as const)
    .filter(([, i]) => i >= 0)
    .sort((a, z) => a[1] - z[1])
    .map(([b]) => b);
}

function fallbackBank(category: string): QuestionBank {
  return {
    questions: FALLBACK_TEMPLATES.map((t, i) => ({ id: `q${String(i + 1).padStart(2, "0")}`, stage: t.stage, focus: "neutral", text: t.q.replace("{CAT}", category) })),
    attributes: ["performance", "build quality", "ease of use", "value for money", "design", "reliability"],
    categoryNoun: [category, `${category}s`],
    domains: {},
  };
}

/**
 * Writes the shopper question bank for a category with Claude: six questions
 * per funnel stage. Awareness and consideration name no brand, so brands are
 * compared on them; evaluation and decision also carry questions naming the
 * subject and comparing it with a rival. Also returns the attributes shoppers
 * judge the category on and each brand's official website. Falls back to
 * fixed questions.
 */
export async function generateQuestionBank(subject: string, competitors: string[], category: string, perStage = 6): Promise<QuestionBank> {
  try {
    const text = await callLLM({
      system: "You design shopper research for AI search visibility. Reply with JSON only.",
      user: `Category: ${category} (US shoppers). Subject brand: ${subject}. Competitors: ${competitors.join(", ")}.

Write ${perStage + 2} questions for each funnel stage — awareness, consideration, evaluation, decision — phrased the way a real shopper types into ChatGPT. Every awareness and consideration question must name no brand ("neutral"). In evaluation and decision, ${perStage - 1} questions name no brand ("neutral"), two name ${subject} ("subject"), and one compares ${subject} with one competitor ("vs"). Vary use cases, budgets and needs.

Every question must be one a shopper asks expecting specific brands or models back — for example "best ${category} for <use> under $<price>", "which ${category} should I buy for <need>", "what's the most reliable ${category} brand", "<brand> or <brand> for <use>?". The "vs" question must name ${subject} and one of the competitors listed above. If a question mentions a year, use ${new Date().getFullYear()}. Never write educational or how-to questions that can be answered without naming a product: no "how do I choose…", "what should I look for…", "what features matter…", "what does <spec> mean…", "how does … work".

Also list the 12 product attributes shoppers judge a ${category} on (short lowercase labels), the singular and plural noun for the product as a shopper says it, and each brand's official US website domain.

Reply with: {"questions":[{"stage":"awareness","focus":"neutral","text":"..."}],"attributes":["..."],"noun":["singular","plural"],"domains":{"${subject}":"example.com"}}`,
      maxTokens: 3500,
      temperature: 0.4,
    });
    const j = jsonIn<{ questions?: Array<{ stage: string; focus: string; text: string }>; attributes?: string[]; noun?: string[]; domains?: Record<string, string> }>(text);
    const questions = (j.questions ?? [])
      .filter((q) => STAGES.includes(q.stage as FunnelStage) && typeof q.text === "string" && q.text.length > 8)
      .map((q, i): BankQuestion => ({ id: `q${String(i + 1).padStart(2, "0")}`, stage: q.stage as FunnelStage, focus: (["neutral", "subject", "vs"].includes(q.focus) ? q.focus : "neutral") as QuestionFocus, text: q.text.trim() }))
      .filter((q) => !(COMPARE_STAGES.includes(q.stage) && q.focus !== "neutral"))
      .filter((q) => !HOW_TO.test(q.text));
    const picked = STAGES.flatMap((st) => {
      const inStage = questions.filter((q) => q.stage === st);
      const branded = [...inStage.filter((q) => q.focus === "vs").slice(0, 1), ...inStage.filter((q) => q.focus === "subject").slice(0, 2)];
      return [...inStage.filter((q) => q.focus === "neutral").slice(0, perStage - branded.length), ...branded];
    }).map((q, i) => ({ ...q, id: `q${String(i + 1).padStart(2, "0")}` }));
    if (picked.length < 8) throw new Error(`only ${picked.length} questions`);
    const attributes = (j.attributes ?? []).map((a) => String(a).trim().toLowerCase()).filter((a) => a && a.length < 40).slice(0, 14);
    return {
      questions: picked,
      attributes: attributes.length >= 4 ? attributes : fallbackBank(category).attributes,
      categoryNoun: j.noun?.length === 2 ? [String(j.noun[0]), String(j.noun[1])] : [category, `${category}s`],
      domains: Object.fromEntries(Object.entries(j.domains ?? {}).map(([k, v]) => [k, String(v).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")])),
    };
  } catch (e) {
    console.error("[ai-visibility] question bank fell back to fixed questions:", (e as Error).message);
    return fallbackBank(category);
  }
}

type Enriched = {
  i: number;
  brands: EnrichedBrand[];
  topPick: string | null;
  attributes: Record<string, AttributeMention[]>;
  claims: SubjectClaim[];
};

async function enrichAnswers(items: Array<{ q: string; answer: string }>, tracked: string[], subject: string, category: string, attributes: string[]): Promise<Enriched[]> {
  const listing = items.map((x, i) => `<answer i="${i}">\nQuestion: ${x.q}\n\n${x.answer.slice(0, 7000)}\n</answer>`).join("\n");
  const text = await callLLM({
    system: "You read AI shopping answers and record what they say about brands. Reply with JSON only, no prose.",
    user: `Each answer below responds to a US shopper's question about ${category}. For every answer record:
- "brands": EVERY ${category} brand it names, tracked or not, in order of prominence (rank 1 = most prominent). For each: "name", "rank", "recommended" (true if the answer recommends it), "sentiment" ("positive" | "neutral" | "mixed" | "negative"), and "product" (the model it names for that brand, or "").
- "topPick": the single brand the answer recommends above the others, or null when it gives no verdict.
- "attributes": for each brand, which of these attributes the answer praises (+) or criticises (-): ${attributes.join(", ")}. Use those labels exactly.
- "claims": factual claims the answer makes about ${subject} — "claim" (one sentence), "type" ("price" | "spec" | "award" | "comparison" | "availability" | "other"), "product", "value" (the number or fact, or "").

Tracked brands: ${tracked.map((b) => `"${b}"`).join(", ")}. When a mention refers to a tracked brand — its name, a product line, a parent company, or a misspelling — use the tracked name exactly. Write other brands under their usual name. Do not list retailers or review sites.

Reply with: {"answers":[{"i":0,"brands":[{"name":"","rank":1,"recommended":true,"sentiment":"positive","product":""}],"topPick":null,"attributes":{"Brand":[{"attr":"","polarity":"+"}]},"claims":[]}]}

${listing}`,
    maxTokens: 6000,
    temperature: 0,
  });
  const parsed = jsonIn<{ answers?: Enriched[] }>(text);
  if (!Array.isArray(parsed.answers)) throw new Error("enrichment returned no answers array");
  return parsed.answers;
}

/**
 * Reads a handful of answers to one question for every brand they name, the
 * top pick, attribute verdicts and claims about the subject.
 */
export async function readAnswers(question: string, answers: string[], tracked: string[], subject: string, category: string, attributes: string[]): Promise<Array<{ brands: EnrichedBrand[]; topPick: string | null; claims: SubjectClaim[] }>> {
  const res = await enrichAnswers(answers.map((answer) => ({ q: question, answer })), tracked, subject, category, attributes);
  return answers.map((_, i) => {
    const e = res.find((x) => x.i === i);
    return { brands: Array.isArray(e?.brands) ? e.brands : [], topPick: e?.topPick ?? null, claims: Array.isArray(e?.claims) ? e.claims : [] };
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function shares(rows: AiQuestionResult[], tracked: string[]): Record<string, number> {
  const answered = rows.filter((r) => r.answer != null);
  const hits = Object.fromEntries(tracked.map((b) => [b, answered.filter((r) => r.mentionOrder.includes(b)).length]));
  const others = answered.reduce((n, r) => n + r.otherBrands.length, 0);
  const total = Object.values(hits).reduce((a, b) => a + b, 0) + others;
  return Object.fromEntries(tracked.map((b) => [b, total ? round1((hits[b] / total) * 100) : 0]));
}

const SENTIMENTS: Sentiment[] = ["positive", "neutral", "mixed", "negative"];
const CLAIM_TYPES: SubjectClaim["type"][] = ["price", "spec", "award", "comparison", "availability", "other"];

type Raw = { run: number; queryId: string; stage: FunnelStage; focus: QuestionFocus; q: string; answer: string | null; sources: AnswerSource[]; error?: string };

async function runEngine(engine: AiEngine, questions: Array<Omit<Raw, "answer" | "sources" | "error">>, tracked: string[], subject: string, category: string, attributes: string[], concurrency: number): Promise<{ som: EngineSoM; rows: AiQuestionResult[] }> {
  const raw = await mapLimit(questions, concurrency, async (x): Promise<Raw> => {
    try {
      const a = await engine.ask(x.q);
      if (!a.text.trim()) throw new Error("empty answer");
      return { ...x, answer: a.text, sources: a.sources };
    } catch (e) {
      return { ...x, answer: null, sources: [], error: (e as Error).message.slice(0, 200) };
    }
  });
  const answered = raw.map((r, i) => [r, i] as const).filter(([r]) => r.answer != null);
  if (!answered.length) throw new Error(raw[0]?.error ?? "every question failed");

  const found = new Map<number, Enriched>();
  const enrichInto = async (chunk: Array<readonly [Raw, number]>): Promise<void> => {
    const res = await enrichAnswers(chunk.map(([r]) => ({ q: r.q, answer: r.answer as string })), tracked, subject, category, attributes);
    for (const e of res) if (chunk[e.i] && Array.isArray(e.brands)) found.set(chunk[e.i][1], e);
  };
  const chunks: Array<Array<readonly [Raw, number]>> = [];
  for (let i = 0; i < answered.length; i += 3) chunks.push(answered.slice(i, i + 3));
  await mapLimit(chunks, 4, async (chunk) => {
    try {
      await enrichInto(chunk);
    } catch (e) {
      console.error(`[ai-visibility] ${engine.label} enrichment batch failed, retrying one answer at a time:`, (e as Error).message);
      for (const one of chunk) await enrichInto([one]).catch((err: Error) => console.error(`[ai-visibility] ${engine.label} enrichment failed for one answer:`, err.message));
    }
  });
  const matching: EngineSoM["matching"] = found.size >= answered.length * 0.9 ? "llm" : found.size ? "mixed" : "pattern";

  const trackedLower = new Map(tracked.map((b) => [b.toLowerCase(), b]));
  const canonical = (n: string): string | undefined => trackedLower.get(n.trim().toLowerCase()) ?? tracked.find((b) => aliasPattern(b).test(n));
  const rows: AiQuestionResult[] = raw.map((r, i) => {
    const base = { engine: engine.id, run: r.run, queryId: r.queryId, stage: r.stage, focus: r.focus, q: r.q, sources: r.sources };
    if (r.answer == null) return { ...base, mentionOrder: [], otherBrands: [], brands: [], topPick: null, attributes: {}, claims: [], answer: null, error: r.error };
    const e = found.get(i);
    const listed: EnrichedBrand[] = e
      ? e.brands.filter((b) => b && typeof b.name === "string" && b.name.trim())
      : patternMentions(r.answer, tracked).map((name, k) => ({ name, rank: k + 1, recommended: false, sentiment: "neutral", product: "" }));
    const seen = new Set<string>();
    const brands: EnrichedBrand[] = [];
    for (const b of [...listed].sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99))) {
      const name = canonical(b.name) ?? b.name.trim();
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      brands.push({ name, rank: brands.length + 1, recommended: !!b.recommended, sentiment: SENTIMENTS.includes(b.sentiment) ? b.sentiment : "neutral", product: typeof b.product === "string" ? b.product : "" });
    }
    for (const name of patternMentions(r.answer, tracked)) {
      if (!seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); brands.push({ name, rank: brands.length + 1, recommended: false, sentiment: "neutral", product: "" }); }
    }
    const isTracked = (n: string) => tracked.includes(n);
    const topPick = e?.topPick ? canonical(e.topPick) ?? e.topPick.trim() : null;
    const attributesOut: Record<string, AttributeMention[]> = {};
    for (const [b, list] of Object.entries(e?.attributes ?? {})) {
      const name = canonical(b) ?? b.trim();
      const clean = (Array.isArray(list) ? list : []).filter((x) => attributes.includes(String(x.attr).toLowerCase()) && (x.polarity === "+" || x.polarity === "-")).map((x) => ({ attr: String(x.attr).toLowerCase(), polarity: x.polarity }));
      if (clean.length) attributesOut[name] = clean;
    }
    const claims = (e?.claims ?? []).filter((c) => c && typeof c.claim === "string" && c.claim.trim()).map((c) => ({
      claim: c.claim.trim(), type: CLAIM_TYPES.includes(c.type) ? c.type : "other", product: typeof c.product === "string" ? c.product : "", value: typeof c.value === "string" ? c.value : String(c.value ?? ""),
    }));
    return {
      ...base,
      mentionOrder: brands.filter((b) => isTracked(b.name)).map((b) => b.name),
      otherBrands: brands.filter((b) => !isTracked(b.name)).map((b) => b.name),
      brands, topPick, attributes: attributesOut, claims, answer: r.answer,
    };
  });

  const ok = rows.filter((r) => r.answer != null);
  const compare = ok.filter((r) => COMPARE_STAGES.includes(r.stage) && r.focus === "neutral");
  const basis = compare.length >= Math.min(6, ok.length) ? compare : ok;
  const stages = [...new Set(ok.map((r) => r.stage))];
  const runs = [...new Set(rows.map((r) => r.run))].sort();
  const otherCounts = new Map<string, number>();
  for (const r of ok) for (const b of r.otherBrands) otherCounts.set(b, (otherCounts.get(b) ?? 0) + 1);
  return {
    rows,
    som: {
      engine: engine.id,
      label: engine.label,
      model: engine.model,
      webSearch: engine.webSearch,
      matching,
      questionsAsked: rows.length,
      questionsFailed: rows.length - ok.length,
      shareByBrand: shares(basis, tracked),
      mentionRateByBrand: Object.fromEntries(tracked.map((b) => [b, round1((basis.filter((r) => r.mentionOrder.includes(b)).length / basis.length) * 100)])),
      shareByStage: Object.fromEntries(stages.map((s) => [s, shares(ok.filter((r) => r.stage === s && r.focus === "neutral"), tracked)])),
      shareByRun: runs.map((n) => shares(basis.filter((r) => r.run === n), tracked)),
      otherBrands: [...otherCounts].map(([brand, answers]) => ({ brand, answers })).sort((a, z) => z.answers - a.answers).slice(0, 10),
    },
  };
}

const meanBy = (list: Array<Record<string, number>>, keys: string[]): Record<string, number> =>
  Object.fromEntries(keys.map((k) => [k, round1(list.reduce((a, x) => a + (x[k] ?? 0), 0) / Math.max(1, list.length))]));

/**
 * Asks every available AI engine the question bank, reads each answer for
 * every brand it names (rank, recommendation, sentiment, product), its top
 * pick, attribute praise and criticism, and its claims about the subject.
 * Share of answer is computed on the awareness and consideration questions,
 * which name no brand (per stage on each stage's brand-neutral questions): a tracked
 * brand's answers over all brand mentions, untracked brands included, a brand
 * counting once per answer — per engine, per stage, and averaged over engines.
 */
export async function fetchAiShareOfMind(input: AiSoMInput): Promise<AiSoMResult> {
  const subject = input.subjectName.trim();
  const competitors = (input.competitors ?? []).map((s) => s.trim()).filter(Boolean);
  const bank = input.bank ?? fallbackBank(input.category);
  const runs = Math.max(1, input.runs ?? 1);
  const questions = Array.from({ length: runs }, (_, run) => bank.questions.map((q) => ({ run: run + 1, queryId: q.id, stage: q.stage, focus: q.focus, q: q.text }))).flat();
  const tracked = [subject, ...competitors];
  const engines = input.engines ?? availableEngines();

  const settled = await Promise.allSettled(engines.map((e) => runEngine(e, questions, tracked, subject, input.category, bank.attributes, input.concurrency ?? 6)));
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const failedEngines = settled.flatMap((s, i) => (s.status === "rejected" ? [{ engine: engines[i].id, label: engines[i].label, error: String((s.reason as Error)?.message ?? s.reason).slice(0, 200) }] : []));
  if (!results.length) throw new Error(`no engine answered: ${failedEngines.map((f) => `${f.label}: ${f.error}`).join("; ")}`);

  const ok = results.map((r) => r.som);
  const perQuestion = results.flatMap((r) => r.rows);
  const stageKeys = [...new Set(ok.flatMap((e) => Object.keys(e.shareByStage)))] as FunnelStage[];
  const shareByBrand = meanBy(ok.map((e) => e.shareByBrand), tracked);
  return {
    engines: ok,
    failedEngines,
    bank,
    subjectShare: shareByBrand[subject] ?? 0,
    shareByBrand,
    shareByStage: Object.fromEntries(stageKeys.map((s) => [s, meanBy(ok.flatMap((e) => (e.shareByStage[s] ? [e.shareByStage[s] as Record<string, number>] : [])), tracked)])),
    questionsAsked: perQuestion.length,
    questionsFailed: perQuestion.filter((q) => q.answer == null).length,
    perQuestion,
  };
}

/**
 * Asks Claude for the main competing brands in a category, for requests that
 * name no competitors. Returns brand names only, never the subject itself.
 */
export async function fetchCompetitorBrands(subjectName: string, category: string, count = 4): Promise<string[]> {
  const text = await callLLM({
    system: "You are a market analyst. Reply with brand names only, one per line, no numbering or commentary.",
    user: `Name the ${count} brands that compete most directly with ${subjectName} in ${category} in the US, as shoppers would see them on Amazon. One brand name per line.`,
    maxTokens: 120,
    temperature: 0,
  });
  const subject = subjectName.trim().toLowerCase();
  return text
    .split("\n")
    .map((s) => s.replace(/^[-\d.*)\s]+/, "").trim())
    .filter((s) => s.length > 0 && s.length < 40 && s.toLowerCase() !== subject)
    .slice(0, count);
}
