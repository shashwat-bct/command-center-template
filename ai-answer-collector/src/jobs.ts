import { createHash } from "node:crypto";
import { PAIRS } from "./config/brands";
import { CATEGORIES, type Category } from "./config/categories";
import { PERSONAS, type Persona } from "./config/personas";
import { STAGES, type Question } from "./config/questions";
import { loadBank, type Bank } from "./banks";
import { DEFAULT_ENGINES, ENGINES, type EngineId } from "./engines";

/** Every question is asked this many times per engine and persona. */
export const RUNS = 3;

export type QuestionRef = { bank: string; questionId: string; stage: Question["stage"]; focus: Question["focus"] };

export type Job = {
  id: string;
  engine: EngineId;
  category: Category;
  persona: Persona;
  /** The question as the bank words it, without the persona. */
  questionText: string;
  questionHash: string;
  /** Exactly what the engine is asked. */
  prompt: string;
  run: number;
  /** Every bank question this prompt answers (a shared neutral question has one per brand). */
  refs: QuestionRef[];
};

export type Scope = { engines: EngineId[]; banks: Bank[]; personas: Persona[]; stages: string[]; questionIds: string[] | null; runs: number };

export const questionHash = (text: string): string => createHash("sha256").update(text.trim()).digest("hex").slice(0, 12);

export const buildPrompt = (p: Persona, questionText: string): string => `${p.preamble} ${questionText.trim()}`;

export const jobId = (engine: EngineId, category: string, persona: string, hash: string, run: number): string => `${engine}/${category}/${persona}/${hash}/r${run}`;

const list = (s: string | undefined): string[] | null => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);

function check<T extends string>(wanted: string[] | null, known: T[], what: string): void {
  const bad = (wanted ?? []).filter((w) => !known.includes(w as T));
  if (bad.length) throw new Error(`unknown ${what}: ${bad.join(", ")} (known: ${known.join(", ")})`);
}

export type ScopeArgs = { engines?: string; pairs?: string; brands?: string; categories?: string; stages?: string; questions?: string };

/**
 * Both personas and three runs always. By default every brand of every enabled
 * category (config/brands.ts); the filters narrow brands, categories, engines
 * and questions.
 */
export function scopeFrom(a: ScopeArgs): Scope {
  const engines = (list(a.engines) ?? DEFAULT_ENGINES) as EngineId[];
  check(engines, Object.keys(ENGINES) as EngineId[], "engine");
  const pairs = list(a.pairs), brands = list(a.brands), cats = list(a.categories), stages = list(a.stages);
  check(pairs, PAIRS.map((p) => p.key), "brand-category pair");
  check(brands, [...new Set(PAIRS.map((p) => p.brand.id))], "brand");
  check(cats, [...new Set(PAIRS.map((p) => p.bc.category))], "category in the study");
  check(stages, STAGES.map((s) => s.id), "stage");
  // default: every brand of every enabled category; naming categories or pairs reaches disabled ones too
  const keys = PAIRS.filter((p) => (pairs ? pairs.includes(p.key) : cats ? cats.includes(p.bc.category) : p.enabled) && (!brands || brands.includes(p.brand.id))).map((p) => p.key);
  if (!keys.length) throw new Error("no brand-category pair matches the filters");
  return { engines, banks: keys.map(loadBank), personas: PERSONAS, stages: stages ?? STAGES.map((s) => s.id), questionIds: list(a.questions), runs: RUNS };
}

/**
 * Every (engine, category, persona, question, run) in scope, run 1 first. A
 * question worded identically in two banks of one category is one job.
 */
export function expandJobs(s: Scope): Job[] {
  const byId = new Map<string, Job>();
  for (let run = 1; run <= s.runs; run++)
    for (const engine of s.engines)
      for (const bank of s.banks) {
        const category = CATEGORIES.find((c) => c.slug === bank.category.slug)!;
        for (const persona of s.personas)
          for (const q of bank.questions) {
            if (!s.stages.includes(q.stage) || (s.questionIds && !s.questionIds.includes(q.id))) continue;
            const hash = questionHash(q.text);
            const id = jobId(engine, category.slug, persona.id, hash, run);
            const ref: QuestionRef = { bank: bank.key, questionId: q.id, stage: q.stage, focus: q.focus };
            const existing = byId.get(id);
            if (existing) existing.refs.push(ref);
            else byId.set(id, { id, engine, category, persona, questionText: q.text, questionHash: hash, prompt: buildPrompt(persona, q.text), run, refs: [ref] });
          }
      }
  return [...byId.values()];
}
