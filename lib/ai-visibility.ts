// Real AI Share of Mind for a brand. Asks Claude a battery of shopper
// questions in the brand's category, counts how often each brand (subject +
// competitors) appears in the answers, computes the subject's share of voice.
// This is a slimmed-down version of bravo-platform's AI Visibility capture —
// no multi-engine fan-out, no persona/scope config, no live warm cache. One
// model, a dozen questions, a single aggregated share %.

import { callLLM } from "./llm";

export type FunnelStage = "awareness" | "consideration" | "evaluation" | "decision";

const QUESTION_TEMPLATES: Array<{ stage: FunnelStage; q: string }> = [
  { stage: "awareness", q: "What are the best {CAT} brands right now? Give me a short ranked list with a sentence per brand." },
  { stage: "awareness", q: "What are the top-rated {CAT} brands?" },
  { stage: "awareness", q: "What's the most popular {CAT} brand right now?" },
  { stage: "consideration", q: "If I'm shopping for a {CAT}, which brands should I consider? Rank them." },
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
  subjectName: string;             // display name, e.g. "Dyson"
  category: string;                 // e.g. "cordless vacuum" or "wireless speakers"
  competitors?: string[];           // other brand names to look for
  questionCount?: number;
  runs?: number;
};

export type AiQuestionResult = {
  run: number;
  stage: FunnelStage;
  q: string;
  hitsByBrand: Record<string, number>;
  mentionOrder: string[];
  answer: string | null;
  error?: string;
};

export type AiSoMResult = {
  subjectShare: number;             // 0-100
  questionsAsked: number;
  subjectMentions: number;
  totalBrandMentions: number;
  perBrand: Record<string, number>;
  shareByBrand: Record<string, number>;
  shareByRun: Array<Record<string, number>>;
  questionsFailed: number;
  perQuestion: AiQuestionResult[];
};

const SYSTEM = `You are a product research assistant. Answer the shopper's question briefly and concretely — focus on specific brand names. Be natural and conversational; do not refuse to recommend brands. Return just prose, no bullets, no formatting, one short paragraph of 2-4 sentences.`;

const brandPattern = (brand: string): RegExp =>
  new RegExp(`\\b${brand.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "gi");

function countMentions(text: string, brand: string): number {
  return brand ? (text.match(brandPattern(brand)) ?? []).length : 0;
}

function firstMention(text: string, brand: string): number {
  return brand ? text.search(brandPattern(brand)) : -1;
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

export async function fetchAiShareOfMind(input: AiSoMInput): Promise<AiSoMResult> {
  const n = Math.min(input.questionCount ?? QUESTION_TEMPLATES.length, QUESTION_TEMPLATES.length);
  const runs = Math.max(1, input.runs ?? 2);
  const questions = Array.from({ length: runs }, (_, run) =>
    QUESTION_TEMPLATES.slice(0, n).map((t) => ({ run: run + 1, stage: t.stage, q: t.q.replace("{CAT}", input.category) }))).flat();
  const subject = input.subjectName.trim();
  const competitors = (input.competitors ?? []).map((s) => s.trim()).filter(Boolean);
  const allBrands = [subject, ...competitors];

  const perBrand: Record<string, number> = Object.fromEntries(allBrands.map((b) => [b, 0]));
  const perQuestion: AiSoMResult["perQuestion"] = [];

  let questionsFailed = 0;
  for (const { run, stage, q } of questions) {
    try {
      const answer = await callLLM({ system: SYSTEM, user: q, maxTokens: 300, temperature: 0.4 });
      const hitsByBrand: Record<string, number> = {};
      for (const b of allBrands) {
        hitsByBrand[b] = countMentions(answer, b);
        perBrand[b] += hitsByBrand[b];
      }
      const mentionOrder = allBrands
        .map((b) => [b, firstMention(answer, b)] as const)
        .filter(([, i]) => i >= 0)
        .sort((a, z) => a[1] - z[1])
        .map(([b]) => b);
      perQuestion.push({ run, stage, q, hitsByBrand, mentionOrder, answer });
    } catch (e) {
      questionsFailed++;
      const error = (e as Error).message.slice(0, 200);
      console.error(`[ai-visibility] question "${q.slice(0, 60)}" failed:`, error);
      perQuestion.push({ run, stage, q, hitsByBrand: {}, mentionOrder: [], answer: null, error });
    }
  }

  const subjectMentions = perBrand[subject] ?? 0;
  const totalBrandMentions = Object.values(perBrand).reduce((a, b) => a + b, 0);
  if (questionsFailed === questions.length) {
    throw new Error(`all ${questions.length} questions failed: ${perQuestion[0]?.error ?? "unknown error"}`);
  }
  if (totalBrandMentions === 0) {
    throw new Error(`no brand from [${allBrands.join(", ")}] was mentioned in ${questions.length - questionsFailed} answers`);
  }
  const shareOf = (mentions: number): number => Math.round((mentions / totalBrandMentions) * 1000) / 10;
  const subjectShare = shareOf(subjectMentions);
  const shareByBrand = Object.fromEntries(allBrands.map((b) => [b, shareOf(perBrand[b])]));
  const shareByRun = Array.from({ length: runs }, (_, r) => {
    const hits = Object.fromEntries(allBrands.map((b) => [b, perQuestion.filter((x) => x.run === r + 1).reduce((a, x) => a + (x.hitsByBrand[b] ?? 0), 0)]));
    const total = Object.values(hits).reduce((a, v) => a + v, 0);
    return Object.fromEntries(allBrands.map((b) => [b, total ? Math.round((hits[b] / total) * 1000) / 10 : 0]));
  });

  return {
    subjectShare,
    questionsAsked: questions.length,
    subjectMentions,
    totalBrandMentions,
    perBrand,
    shareByBrand,
    shareByRun,
    questionsFailed,
    perQuestion,
  };
}
