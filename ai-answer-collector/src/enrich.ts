// The reader pass from command-center-template lib/ai-visibility.ts
// (enrichAnswers): Claude reads each stored answer for every brand it names,
// in order of prominence, whether it recommends each, the sentiment, the
// model named, the single top pick, which attributes it praises or criticises
// per brand, and the factual claims it makes about the subject brand.
// Readings are per category, not per brand: every brand in the category is
// tracked, and claims are recorded for each of them, so an answer shared by
// all brands (a brand-neutral question) is read once. Kept in
// data/<collection>/enriched/<category>.json; re-runs read only answers not
// read yet.
//
//   npm run enrich -- --collection 2026-10 [--categories tv]

import { parseArgs } from "node:util";
import { PAIRS, studyCategory } from "./config/brands";
import { loadBank, type Bank } from "./banks";
import type { Manifest } from "./manifest";
import { callLLM } from "./engines/llm";
import { questionHash } from "./jobs";
import { CollectionStore, responsePath, type ResponseRecord } from "./store";
import { chunk, mapLimit } from "./util";

export type Sentiment = "positive" | "neutral" | "mixed" | "negative";
export type Reading = {
  brands: Array<{ name: string; rank: number; recommended: boolean; sentiment: Sentiment; product: string }>;
  topPick: string | null;
  attributes: Record<string, Array<{ attr: string; polarity: "+" | "-" }>>;
  claims: Array<{ brand: string; claim: string; type: "price" | "spec" | "award" | "comparison" | "availability" | "other"; product: string; value: string }>;
  readAt: string;
};

const jsonIn = <T>(text: string): T => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;
const PER_CALL = 6;

async function enrichAnswers(items: Array<{ q: string; answer: string }>, tracked: string[], category: string, attributes: string[]): Promise<Array<Omit<Reading, "readAt"> & { i: number }>> {
  const listing = items.map((x, i) => `<answer i="${i}">\nQuestion: ${x.q}\n\n${x.answer.slice(0, 7000)}\n</answer>`).join("\n");
  const text = await callLLM({
    system: "You read AI shopping answers and record what they say about brands. Reply with JSON only, no prose.",
    user: `Each answer below responds to a US shopper's question about ${category}. For every answer record:
- "brands": EVERY ${category} brand it names, tracked or not, in order of prominence (rank 1 = most prominent). For each: "name", "rank", "recommended" (true if the answer recommends it), "sentiment" ("positive" | "neutral" | "mixed" | "negative"), and "product" (the model it names for that brand, or "").
- "topPick": the single brand the answer recommends above the others, or null when it gives no verdict.
- "attributes": for each brand, which of these attributes the answer praises (+) or criticises (-): ${attributes.join(", ")}. Use those labels exactly.
- "claims": factual claims the answer makes about any tracked brand — "brand" (the tracked name), "claim" (one sentence), "type" ("price" | "spec" | "award" | "comparison" | "availability" | "other"), "product", "value" (the number or fact, or "").

Tracked brands: ${tracked.map((b) => `"${b}"`).join(", ")}. When a mention refers to a tracked brand — its name, a product line, a parent company, or a misspelling — use the tracked name exactly. Write other brands under their usual name. Do not list retailers or review sites.

Reply with: {"answers":[{"i":0,"brands":[{"name":"","rank":1,"recommended":true,"sentiment":"positive","product":""}],"topPick":null,"attributes":{"Brand":[{"attr":"","polarity":"+"}]},"claims":[{"brand":"","claim":"","type":"other","product":"","value":""}]}]}

${listing}`,
    maxTokens: 6000,
    temperature: 0,
  });
  const parsed = jsonIn<{ answers?: Array<Omit<Reading, "readAt"> & { i: number }> }>(text);
  if (!Array.isArray(parsed.answers)) throw new Error("enrichment returned no answers array");
  return parsed.answers;
}

export const enrichedPath = (category: string) => `enriched/${category}.json`;

/** Reads every stored answer to any question of the given banks (all of one category) not read yet. */
export async function enrichCategory(store: CollectionStore, category: string, banks: Bank[]): Promise<{ read: number; failed: number }> {
  const readings = store.readJson<Record<string, Reading>>(enrichedPath(category)) ?? {};
  const tracked = studyCategory(category).brands.map((b) => b.label);
  const index = [...store.index().values()].filter((e) => e.category === category && e.status === "ok");
  const texts = new Map<string, string>();
  for (const b of banks) for (const q of b.questions) texts.set(questionHash(q.text), q.text);
  const work: Array<{ q: string; ids: string[] }> = [];
  for (const [hash, q] of texts) {
    const ids = index.filter((e) => e.questionHash === hash && !readings[e.id]).map((e) => e.id);
    for (const part of chunk(ids, PER_CALL)) work.push({ q, ids: part });
  }
  let read = 0, failed = 0;
  await mapLimit(work, 4, async ({ q, ids }) => {
    const records = ids.map((id) => store.readJson<ResponseRecord>(responsePath(id))).filter((r): r is ResponseRecord => !!r?.answer);
    try {
      const res = await enrichAnswers(records.map((r) => ({ q, answer: r.answer!.text })), tracked, banks[0].category.noun[1], banks[0].attributes);
      const now = new Date().toISOString();
      records.forEach((r, i) => {
        const e = res.find((x) => x.i === i);
        readings[r.id] = { brands: Array.isArray(e?.brands) ? e.brands : [], topPick: e?.topPick ?? null, attributes: e?.attributes ?? {}, claims: Array.isArray(e?.claims) ? e.claims : [], readAt: now };
        read++;
      });
    } catch (err) {
      failed += records.length;
      console.error(`[enrich] ${category} “${q.slice(0, 50)}”: ${(err as Error).message}`);
    }
  });
  await store.write(enrichedPath(category), JSON.stringify(readings), "application/json");
  return { read, failed };
}

async function main() {
  const { values: args } = parseArgs({ options: { collection: { type: "string" }, categories: { type: "string" } } });
  if (!args.collection) throw new Error("--collection is required");
  const store = new CollectionStore(args.collection);
  const asked = store.readJson<Manifest>("manifest.json")?.banks ?? [];
  const pairs = PAIRS.filter((p) => asked.includes(p.key));
  const categories = args.categories?.split(",").map((s) => s.trim()) ?? [...new Set(pairs.map((p) => p.bc.category))];
  for (const category of categories) {
    const banks = pairs.filter((p) => p.bc.category === category).map((p) => loadBank(p.key));
    if (!banks.length) continue;
    const { read, failed } = await enrichCategory(store, category, banks);
    console.log(`[enrich] ${category}: ${read} answers read for ${banks.map((b) => b.brand.label).join(", ")}${failed ? `, ${failed} failed (re-run to retry)` : ""}`);
  }
}

if (process.argv[1]?.endsWith("enrich.ts")) main().catch((e) => { console.error(e); process.exit(1); });
