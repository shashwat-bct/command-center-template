// Real AI Share of Mind for a brand. Asks Claude a battery of shopper
// questions in the brand's category, counts how often each brand (subject +
// competitors) appears in the answers, computes the subject's share of voice.
// This is a slimmed-down version of bravo-platform's AI Visibility capture —
// no multi-engine fan-out, no persona/scope config, no live warm cache. One
// model, a dozen questions, a single aggregated share %.

import { callLLM } from "./llm";

const QUESTION_TEMPLATES = [
  "What are the best {CAT} brands right now? Give me a short ranked list with a sentence per brand.",
  "If I'm shopping for a {CAT}, which brands should I consider? Rank them.",
  "What are the top-rated {CAT} brands?",
  "I want to buy a premium {CAT}. Which brands make the best ones?",
  "Compare the top {CAT} brands on quality, price, and features.",
  "Which {CAT} brand has the best reputation among consumers?",
  "What's the most popular {CAT} brand right now?",
  "If budget is no concern, what {CAT} should I buy?",
  "What are the newest {CAT} brands to watch?",
  "Which {CAT} brands have the best customer reviews?",
  "What {CAT} brands do you recommend for someone just starting out?",
  "What are the most innovative {CAT} brands?",
];

export type AiSoMInput = {
  subjectName: string;             // display name, e.g. "Dyson"
  category: string;                 // e.g. "cordless vacuum" or "wireless speakers"
  competitors?: string[];           // other brand names to look for
  questionCount?: number;           // defaults to 8 to keep latency sane
};

export type AiSoMResult = {
  subjectShare: number;             // 0-100
  questionsAsked: number;
  subjectMentions: number;
  totalBrandMentions: number;
  perBrand: Record<string, number>;
  perQuestion: Array<{ q: string; subjectHits: number; totalHits: number }>;
};

const SYSTEM = `You are a product research assistant. Answer the shopper's question briefly and concretely — focus on specific brand names. Be natural and conversational; do not refuse to recommend brands. Return just prose, no bullets, no formatting, one short paragraph of 2-4 sentences.`;

// Count mentions of a brand name in text, case-insensitive, whole-word.
function countMentions(text: string, brand: string): number {
  if (!brand) return 0;
  const escaped = brand.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const rx = new RegExp(`\\b${escaped}\\b`, "gi");
  return (text.match(rx) ?? []).length;
}

export async function fetchAiShareOfMind(input: AiSoMInput): Promise<AiSoMResult> {
  const n = Math.min(input.questionCount ?? 8, QUESTION_TEMPLATES.length);
  const questions = QUESTION_TEMPLATES.slice(0, n).map((t) => t.replace("{CAT}", input.category));
  const subject = input.subjectName.trim();
  const competitors = (input.competitors ?? []).map((s) => s.trim()).filter(Boolean);
  const allBrands = [subject, ...competitors];

  const perBrand: Record<string, number> = Object.fromEntries(allBrands.map((b) => [b, 0]));
  const perQuestion: AiSoMResult["perQuestion"] = [];

  // Serial calls — the LLM proxy is rate-limited and the token has to be fresh;
  // parallelising would just hit 429s. 8 calls × ~2s = ~16s typical latency.
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    try {
      const answer = await callLLM({ system: SYSTEM, user: q, maxTokens: 300, temperature: 0.4 });
      // Diagnostic: log just the first answer so we can confirm Claude returned
      // prose with brand names and our mention-counter is working.
      if (i === 0) console.log(`[ai-visibility] first answer sample (first 200 chars): ${answer.slice(0, 200)}`);
      let subjectHits = 0;
      let totalHits = 0;
      for (const b of allBrands) {
        const hits = countMentions(answer, b);
        perBrand[b] += hits;
        totalHits += hits;
        if (b === subject) subjectHits = hits;
      }
      perQuestion.push({ q, subjectHits, totalHits });
    } catch (e) {
      console.error(`[ai-visibility] question "${q.slice(0, 60)}" failed:`, (e as Error).message);
      perQuestion.push({ q, subjectHits: 0, totalHits: 0 });
    }
  }

  const subjectMentions = perBrand[subject] ?? 0;
  const totalBrandMentions = Object.values(perBrand).reduce((a, b) => a + b, 0);
  const subjectShare = totalBrandMentions > 0
    ? Math.round((subjectMentions / totalBrandMentions) * 1000) / 10
    : 0;

  return {
    subjectShare,
    questionsAsked: questions.length,
    subjectMentions,
    totalBrandMentions,
    perBrand,
    perQuestion,
  };
}
