import { bucket } from "./gcs";
import { latestReadyBuildId, loadBuildPayload } from "./payload-source";
import type { AiSoMResult, EngineSoM, FunnelStage, QuestionBank } from "./ai-visibility";

const KEY = (slug: string) => `ai-results/v1/${slug}.json`;

export type ReusedAi = { result: AiSoMResult; capturedAt: string; source: "saved" | "previous build" };

type Saved = { version: 1; category: string; brands: string[]; capturedAt: string; result: AiSoMResult };

type PreviousPayload = {
  meta?: { provenance?: { record?: { ai?: Pick<AiSoMResult, "engines" | "failedEngines" | "questionsAsked" | "questionsFailed" | "shareByBrand" | "perQuestion"> | null } } };
  aiConsole?: {
    bank: QuestionBank["questions"];
    attrs: string[];
    categoryNoun: [string, string];
    category: string;
    brands: Array<{ label: string; owned?: string[] }>;
    current: string;
    captures: Record<string, { capturedAt: string }>;
  };
};

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));
const round1 = (v: number): number => Math.round(v * 10) / 10;
const meanBy = (list: Array<Record<string, number>>, keys: string[]): Record<string, number> =>
  Object.fromEntries(keys.map((k) => [k, round1(list.reduce((a, x) => a + (x[k] ?? 0), 0) / Math.max(1, list.length))]));

/**
 * Saves a build's AI answers so a later build of the same brand, category and
 * competitors can reuse them instead of asking every engine again.
 */
export async function saveAiResult(slug: string, category: string, brands: string[], result: AiSoMResult, capturedAt: string): Promise<void> {
  const doc: Saved = { version: 1, category, brands, capturedAt, result };
  await bucket().file(KEY(slug)).save(JSON.stringify(doc), { contentType: "application/json", resumable: false });
}

function fromPayload(p: PreviousPayload, subject: string): ReusedAi | null {
  const ai = p.meta?.provenance?.record?.ai;
  const c = p.aiConsole;
  if (!ai || !c || !ai.engines?.length) return null;
  const tracked = Object.keys(ai.shareByBrand);
  const engines = ai.engines as EngineSoM[];
  const stages = [...new Set(engines.flatMap((e) => Object.keys(e.shareByStage)))] as FunnelStage[];
  const bank: QuestionBank = {
    questions: c.bank,
    attributes: c.attrs,
    categoryNoun: c.categoryNoun,
    domains: Object.fromEntries(c.brands.flatMap((b) => (b.owned?.[0] ? [[b.label, b.owned[0]]] : []))),
  };
  return {
    source: "previous build",
    capturedAt: c.captures[c.current]?.capturedAt ?? new Date().toISOString(),
    result: {
      engines,
      failedEngines: ai.failedEngines,
      bank,
      subjectShare: ai.shareByBrand[subject] ?? 0,
      shareByBrand: ai.shareByBrand,
      shareByStage: Object.fromEntries(stages.map((s) => [s, meanBy(engines.flatMap((e) => (e.shareByStage[s] ? [e.shareByStage[s] as Record<string, number>] : [])), tracked)])),
      questionsAsked: ai.questionsAsked,
      questionsFailed: ai.questionsFailed,
      perQuestion: ai.perQuestion,
    },
  };
}

/**
 * The AI answers of an earlier build of this brand, when its category and
 * brands are the same as this build's: the saved result first, otherwise the
 * one the latest ready build carries. Null when there is none that matches.
 */
export async function loadReusableAi(slug: string, subject: string, category: string, competitors: string[]): Promise<ReusedAi | null> {
  const brands = [subject, ...competitors];
  const saved = await bucket().file(KEY(slug)).download().then(([buf]) => JSON.parse(buf.toString("utf8")) as Saved).catch(() => null);
  if (saved?.version === 1 && saved.category.toLowerCase() === category.toLowerCase() && sameSet(saved.brands, brands)) {
    return { result: saved.result, capturedAt: saved.capturedAt, source: "saved" };
  }
  const id = await latestReadyBuildId(slug);
  const prev = id ? await loadBuildPayload(slug, id) : null;
  if (!prev) return null;
  const p = JSON.parse(prev.bytes.toString("utf8")) as PreviousPayload;
  if (!p.aiConsole || p.aiConsole.category.toLowerCase() !== category.toLowerCase()) return null;
  const reused = fromPayload(p, subject);
  return reused && sameSet(Object.keys(reused.result.shareByBrand), brands) ? reused : null;
}
