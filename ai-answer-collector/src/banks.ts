// Writes the question banks for the study (config/brands.ts).
//
// Per category, banks/<category>.category.json holds what every brand in it
// shares: the brand-neutral questions, the attributes shoppers judge the
// category on and the product noun. TV takes these from the reference bank as
// they are; another category has them adapted from it once.
//
// Per brand, banks/<brand>-<category>.json is the full bank for that brand as
// subject: the category's neutral questions word for word, plus its own
// brand-specific questions (focus "subject" or "vs"). The reference brand
// (Sony for TV) keeps the reference wording; every other brand's are rewritten
// from it by Claude — "Is a Sony Bravia worth the money?" becomes "Is an LG
// OLED worth the money?" — with the same id, stage and focus. Existing files
// are kept unless --force.
//
//   npm run banks                          every enabled category
//   npm run banks -- --categories tv --force

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { STUDY, studyCategory, type StudyBrand, type StudyCategory } from "./config/brands";
import { CATEGORIES, type Category } from "./config/categories";
import { REFERENCE_ATTRIBUTES, REFERENCE_BANK, REFERENCE_CATALOG, type Question } from "./config/questions";
import { callLLM } from "./engines/llm";

export const BANK_DIR = join(import.meta.dirname, "..", "banks");

/** The reference bank is Sony's TV bank. */
const REF = { category: "tv", brand: "Sony", productLine: "BRAVIA" };

export type CategoryBase = {
  category: { slug: string; name: string; noun: [string, string] };
  neutral: Question[];
  attributes: string[];
  source: "reference" | "adapted";
  writtenAt: string;
};

export type Bank = {
  key: string;
  brand: { id: string; label: string; domain: string };
  category: { slug: string; name: string; noun: [string, string] };
  productLine: string;
  competitors: Array<{ id: string; label: string }>;
  questions: Question[];
  attributes: string[];
  /** brand label → official US domain */
  domains: Record<string, string>;
  catalog: Array<{ id: string; label: string; family: string; msrp: number | null }>;
  source: "reference" | "adapted";
  writtenAt: string;
};

const basePath = (category: string) => join(BANK_DIR, `${category}.category.json`);
const bankPath = (key: string) => join(BANK_DIR, `${key}.json`);

export function loadBank(key: string): Bank {
  if (!existsSync(bankPath(key))) throw new Error(`no bank for ${key}: run npm run banks`);
  return JSON.parse(readFileSync(bankPath(key), "utf8")) as Bank;
}

const YEAR = new Date().getFullYear();
const jsonIn = <T>(text: string): T => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const isBranded = (q: Question) => q.focus !== "neutral";
const listing = (qs: Question[]) => qs.map((q) => `${q.id} · ${q.stage} · ${q.focus}${q.promo ? " · promotion" : ""} · ${q.text}`).join("\n");

function category(slugName: string): Category {
  const c = CATEGORIES.find((x) => x.slug === slugName);
  if (!c) throw new Error(`unknown category ${slugName}`);
  return c;
}

/** The category's shared part: the reference's own for TV, adapted once for any other. */
async function writeBase(study: StudyCategory): Promise<CategoryBase> {
  const cat = category(study.category);
  const neutralRef = REFERENCE_BANK.filter((q) => !isBranded(q));
  if (study.category === REF.category) {
    return { category: { slug: cat.slug, name: cat.name, noun: cat.noun }, neutral: neutralRef, attributes: REFERENCE_ATTRIBUTES, source: "reference", writtenAt: new Date().toISOString() };
  }
  const text = await callLLM({
    system: "You adapt shopper research question banks for AI search visibility. Reply with JSON only.",
    user: `Below are brand-neutral shopper questions written for TVs (US market). Rewrite each one for ${cat.name.toLowerCase()} ("${cat.noun[0]}" / "${cat.noun[1]}").

Rules:
- Keep every question's id, stage and intent, its tone and its length. Write it the way a real US shopper types into ChatGPT.
- Every question must stay brand-neutral: name no brand and no model.
- Swap TV-specific details (OLED, 65 inch, PS5, picture quality, dark room…) for the closest equivalent that matters for ${cat.noun[1]}.
- Prices must be realistic for ${cat.noun[1]}. Questions marked "promotion" stay about deals, discounts, sales events or retailers.
- If a question mentions a year, use ${YEAR}.

Questions (id · stage · focus · text):
${listing(neutralRef)}

Also give the 12 to 14 attributes shoppers judge ${cat.noun[1]} on (short lowercase labels) and the singular and plural noun a shopper uses.

Reply with: {"questions":[{"id":"q01","text":"..."}],"attributes":["..."],"noun":["singular","plural"]}`,
    maxTokens: 6000,
    temperature: 0.3,
  });
  const j = jsonIn<{ questions?: Array<{ id: string; text: string }>; attributes?: string[]; noun?: string[] }>(text);
  const byId = new Map((j.questions ?? []).map((q) => [q.id, String(q.text ?? "").trim()]));
  const missing = neutralRef.filter((q) => !byId.get(q.id));
  if (missing.length) throw new Error(`neutral adaptation left out ${missing.map((q) => q.id).join(", ")}`);
  const attributes = (j.attributes ?? []).map((a) => String(a).trim().toLowerCase()).filter((a) => a && a.length < 40).slice(0, 14);
  if (attributes.length < 4) throw new Error("adaptation returned too few attributes");
  return {
    category: { slug: cat.slug, name: cat.name, noun: j.noun?.length === 2 ? [String(j.noun[0]), String(j.noun[1])] : cat.noun },
    neutral: neutralRef.map((q) => ({ ...q, text: byId.get(q.id)! })),
    attributes,
    source: "adapted",
    writtenAt: new Date().toISOString(),
  };
}

type BrandPart = { questions: Question[]; catalog: Bank["catalog"]; source: Bank["source"] };

/** One brand's brand-specific questions and lineup: the reference's own for Sony TV, rewritten for anyone else. */
async function writeBrandPart(study: StudyCategory, base: CategoryBase, brand: StudyBrand): Promise<BrandPart> {
  const brandedRef = REFERENCE_BANK.filter(isBranded);
  if (study.category === REF.category && brand.id === study.reference) return { questions: brandedRef, catalog: REFERENCE_CATALOG, source: "reference" };
  const rivals = study.brands.filter((b) => b.id !== brand.id).map((b) => b.label);
  const sameCategory = study.category === REF.category;
  const how = sameCategory
    ? `Change only the brand: ${REF.brand} becomes ${brand.label}, and each ${REF.brand} model or line (BRAVIA, Bravia 9 II, Bravia 7 II…) becomes the closest ${brand.label} model or line (${brand.productLine}). Where the rival named is ${brand.label}, name ${REF.brand} instead. Keep every other word as it is.`
    : `Rewrite each for ${base.category.noun[1]}: ${REF.brand} becomes ${brand.label} (its line: ${brand.productLine}), ${REF.brand} models become ${brand.label} models, and each rival becomes one of: ${rivals.join(", ")}. Swap TV-specific details for the closest equivalent for ${base.category.noun[1]}, with realistic prices. Keep each question's intent, tone and length.`;
  const text = await callLLM({
    system: "You adapt shopper research question banks for AI search visibility. Reply with JSON only.",
    user: `Below are brand-specific shopper questions about ${REF.brand} TVs (US market). Make the same questions about ${brand.label} ${base.category.noun[1]}.

${how}

Rules:
- Keep every question's id, stage and focus. "subject" questions name ${brand.label} or its line. "vs" questions name ${brand.label} and exactly one rival from: ${rivals.join(", ")}.
- Name a specific model only if you are confident it is sold in the US in ${YEAR}; otherwise use the product line.
- Questions marked "promotion" stay about deals, discounts or promotions.

Questions (id · stage · focus · text):
${listing(brandedRef)}

Also give ${brand.label}'s current US ${base.category.noun[0]} lineup: up to 8 models or series, each with a short family label.

Reply with: {"questions":[{"id":"q27","text":"..."}],"catalog":[{"label":"...","family":"..."}]}`,
    maxTokens: 5000,
    temperature: 0.2,
  });
  const j = jsonIn<{ questions?: Array<{ id: string; text: string }>; catalog?: Array<{ label: string; family?: string }> }>(text);
  const byId = new Map((j.questions ?? []).map((q) => [q.id, String(q.text ?? "").trim()]));
  const missing = brandedRef.filter((q) => !byId.get(q.id));
  if (missing.length) throw new Error(`brand-specific rewrite left out ${missing.map((q) => q.id).join(", ")}`);
  return {
    questions: brandedRef.map((q) => ({ ...q, text: byId.get(q.id)! })),
    catalog: (j.catalog ?? []).slice(0, 8).map((p) => ({ id: slug(String(p.label)), label: String(p.label), family: String(p.family ?? ""), msrp: null })),
    source: "adapted",
  };
}

async function main() {
  const { values: args } = parseArgs({ options: { categories: { type: "string" }, force: { type: "boolean", default: false } } });
  mkdirSync(BANK_DIR, { recursive: true });
  const wanted = args.categories?.split(",").map((s) => s.trim());
  const studies = wanted ? wanted.map(studyCategory) : STUDY.filter((s) => s.enabled);
  for (const study of studies) {
    let base: CategoryBase;
    if (existsSync(basePath(study.category)) && !args.force) {
      base = JSON.parse(readFileSync(basePath(study.category), "utf8")) as CategoryBase;
      console.log(`[banks] ${study.category}: shared questions kept`);
    } else {
      try {
        base = await writeBase(study);
      } catch (e) {
        console.error(`[banks] ${study.category}: shared questions failed: ${(e as Error).message}`);
        continue;
      }
      writeFileSync(basePath(study.category), JSON.stringify(base, null, 2));
      console.log(`[banks] ${study.category}: ${base.neutral.length} shared brand-neutral questions written (${base.source})`);
    }
    for (const brand of study.brands) {
      const key = `${brand.id}-${study.category}`;
      if (existsSync(bankPath(key)) && !args.force) { console.log(`[banks] ${key} kept`); continue; }
      try {
        const part = await writeBrandPart(study, base, brand);
        const own = new Map(part.questions.map((q) => [q.id, q]));
        const shared = new Map(base.neutral.map((q) => [q.id, q]));
        const bank: Bank = {
          key,
          brand: { id: brand.id, label: brand.label, domain: brand.domain },
          category: base.category,
          productLine: brand.productLine,
          competitors: study.brands.filter((b) => b.id !== brand.id).map((b) => ({ id: b.id, label: b.label })),
          // the reference order, each question from the shared set or the brand's own
          questions: REFERENCE_BANK.map((q) => own.get(q.id) ?? shared.get(q.id)!),
          attributes: base.attributes,
          domains: Object.fromEntries(study.brands.map((b) => [b.label, b.domain])),
          catalog: part.catalog,
          source: part.source,
          writtenAt: new Date().toISOString(),
        };
        writeFileSync(bankPath(key), JSON.stringify(bank, null, 2));
        console.log(`[banks] ${key}: ${part.questions.length} brand-specific questions written (${part.source})`);
      } catch (e) {
        console.error(`[banks] ${key} failed: ${(e as Error).message}`);
      }
    }
  }
}

if (process.argv[1]?.endsWith("banks.ts")) main();
