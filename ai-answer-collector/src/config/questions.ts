// The question bank. The reference bank is the Sony TV bank from the
// command-center-template AI Engine Visibility payload (sony-ai-visibility-data.json),
// 58 questions copied as they are, plus four promotion questions (q59–q62).
// Every other brand × category bank is this one adapted question for question
// (same id, stage and focus) by `npm run banks`; see src/banks.ts.

export type StageId = "awareness" | "consideration" | "evaluation" | "decision";

/** neutral: names no brand · subject: names the subject brand · vs: subject against one rival */
export type Focus = "neutral" | "subject" | "vs";

export type Question = { id: string; stage: StageId; focus: Focus; text: string; promo?: boolean };

export type Stage = { id: StageId; label: string; desc: string; aida: string };

// The reference's four stages; labels follow the funnel names we use.
export const STAGES: Stage[] = [
  { id: "awareness", label: "Attention", desc: "Broad category discovery — the shopper doesn't know what to buy yet.", aida: "Attention" },
  { id: "consideration", label: "Consideration", desc: "Narrowing by use case and features.", aida: "Interest" },
  { id: "evaluation", label: "Evaluation & Trust", desc: "Comparing brands, weighing reliability and whether the premium is worth it.", aida: "Desire" },
  { id: "decision", label: "Decision", desc: "Bottom-funnel — specific models, price ceilings, promotions, ready to buy.", aida: "Action" },
];

export const REFERENCE_BANK_KEY = "sony-tv";

export const REFERENCE_BANK: Question[] = [
  { id: "q01", stage: "awareness", focus: "neutral", text: "What are the best TVs to buy in 2026?" },
  { id: "q02", stage: "awareness", focus: "neutral", text: "What is the best OLED TV in 2026?" },
  { id: "q03", stage: "awareness", focus: "neutral", text: "What's the best 65 inch TV right now?" },
  { id: "q04", stage: "awareness", focus: "neutral", text: "Best premium TV to buy in 2026" },
  { id: "q05", stage: "awareness", focus: "neutral", text: "Which TV brands are the best in 2026?" },
  { id: "q06", stage: "awareness", focus: "neutral", text: "Best 4K TV for the money" },
  { id: "q07", stage: "awareness", focus: "neutral", text: "Best TV for picture quality" },
  { id: "q08", stage: "awareness", focus: "neutral", text: "Best big screen 75 inch TV" },
  { id: "q09", stage: "awareness", focus: "neutral", text: "Best TV for most people in 2026" },
  { id: "q10", stage: "awareness", focus: "neutral", text: "Best Mini LED TV in 2026" },
  { id: "q11", stage: "awareness", focus: "neutral", text: "Best 55 inch TV in 2026" },
  { id: "q12", stage: "awareness", focus: "neutral", text: "Best QLED TV in 2026" },
  { id: "q13", stage: "consideration", focus: "neutral", text: "Best TV for gaming with low input lag" },
  { id: "q14", stage: "consideration", focus: "neutral", text: "Best TV for PS5 and Xbox Series X" },
  { id: "q15", stage: "consideration", focus: "neutral", text: "Best TV for watching movies in a dark room" },
  { id: "q16", stage: "consideration", focus: "neutral", text: "Best TV for sports and fast motion" },
  { id: "q17", stage: "consideration", focus: "neutral", text: "Best TV for a bright sunlit room with anti-glare" },
  { id: "q18", stage: "consideration", focus: "neutral", text: "Best TV with the best smart platform and apps" },
  { id: "q19", stage: "consideration", focus: "neutral", text: "Best OLED TV for HDR movies" },
  { id: "q20", stage: "consideration", focus: "neutral", text: "QLED vs OLED — which should I buy in 2026?" },
  { id: "q21", stage: "consideration", focus: "neutral", text: "Best TV for a home theater setup" },
  { id: "q22", stage: "consideration", focus: "neutral", text: "Best TV for streaming Netflix and Disney+" },
  { id: "q23", stage: "consideration", focus: "neutral", text: "Best TV with Dolby Vision and Dolby Atmos" },
  { id: "q24", stage: "consideration", focus: "neutral", text: "Best 120Hz TV for gaming in 2026" },
  { id: "q25", stage: "consideration", focus: "neutral", text: "Best TV with the best sound without a soundbar" },
  { id: "q26", stage: "consideration", focus: "neutral", text: "Mini LED vs OLED — which is better for a bright room?" },
  { id: "q27", stage: "evaluation", focus: "vs", text: "Sony vs Samsung TV — which is better in 2026?" },
  { id: "q28", stage: "evaluation", focus: "subject", text: "Is a Sony Bravia worth the money?" },
  { id: "q29", stage: "evaluation", focus: "vs", text: "Sony vs LG OLED — which should I buy?" },
  { id: "q30", stage: "consideration", focus: "neutral", text: "Which TV brand is the most reliable?" },
  { id: "q31", stage: "evaluation", focus: "subject", text: "Are Sony TVs good?" },
  { id: "q32", stage: "consideration", focus: "neutral", text: "Best TV brand for longevity and reliability" },
  { id: "q33", stage: "evaluation", focus: "vs", text: "Sony Bravia vs Samsung — is Sony worth the premium?" },
  { id: "q34", stage: "evaluation", focus: "neutral", text: "Samsung vs LG vs Sony premium TV — full comparison" },
  { id: "q35", stage: "evaluation", focus: "subject", text: "Do Sony TVs last longer than other brands?" },
  { id: "q36", stage: "consideration", focus: "neutral", text: "Which TV brand has the best warranty and support?" },
  { id: "q37", stage: "evaluation", focus: "vs", text: "Is Sony or Samsung better for picture quality?" },
  { id: "q38", stage: "consideration", focus: "neutral", text: "Are premium TVs worth it over budget brands like TCL and Hisense?" },
  { id: "q39", stage: "evaluation", focus: "subject", text: "Is Sony still the best for picture processing?" },
  { id: "q40", stage: "evaluation", focus: "vs", text: "Sony vs TCL — is the premium justified?" },
  { id: "q41", stage: "evaluation", focus: "subject", text: "What are the downsides of Sony TVs?" },
  { id: "q42", stage: "evaluation", focus: "vs", text: "Sony vs Samsung for gaming — which wins?" },
  { id: "q43", stage: "decision", focus: "subject", text: "Best Sony TV under $2000" },
  { id: "q44", stage: "consideration", focus: "neutral", text: "Best 65 inch OLED TV under $1500" },
  { id: "q45", stage: "decision", focus: "vs", text: "Sony Bravia 9 II vs Samsung QN90F — which to buy?" },
  { id: "q46", stage: "awareness", focus: "neutral", text: "Best value OLED TV in 2026" },
  { id: "q47", stage: "decision", focus: "subject", text: "Is the Sony Bravia 7 II worth buying over the LG C5?" },
  { id: "q48", stage: "awareness", focus: "neutral", text: "Best TV under $1000 in 2026" },
  { id: "q49", stage: "decision", focus: "subject", text: "Best Sony TV for the price" },
  { id: "q50", stage: "awareness", focus: "neutral", text: "Which 65 inch TV is the best deal right now?" },
  { id: "q51", stage: "awareness", focus: "neutral", text: "Best 77 inch OLED TV to buy in 2026" },
  { id: "q52", stage: "decision", focus: "vs", text: "Sony Bravia 9 II vs LG G5 — which is the better buy?" },
  { id: "q53", stage: "consideration", focus: "neutral", text: "Best TV to buy on a $1500 budget" },
  { id: "q54", stage: "decision", focus: "subject", text: "Is the Sony Bravia 7 II worth it over the TCL QM8?" },
  { id: "q55", stage: "decision", focus: "vs", text: "Sony Bravia 9 II vs Sony Bravia 7 II — which model?" },
  { id: "q56", stage: "decision", focus: "vs", text: "Sony Bravia 7 II vs Samsung S90F — which is better value?" },
  { id: "q57", stage: "decision", focus: "subject", text: "Should I buy the Sony Bravia 9 II or wait?" },
  { id: "q58", stage: "decision", focus: "vs", text: "Sony Bravia 9 II vs Hisense U8QG — is it worth 2x the price?" },
  { id: "q59", stage: "decision", focus: "neutral", text: "What are the best TV deals right now?", promo: true },
  { id: "q60", stage: "decision", focus: "subject", text: "Are there any discounts or promotions on Sony BRAVIA TVs right now?", promo: true },
  { id: "q61", stage: "decision", focus: "neutral", text: "Which TV brand has the best Black Friday deals in 2026?", promo: true },
  { id: "q62", stage: "decision", focus: "neutral", text: "Which retailer has the best price on a 65 inch TV this week?", promo: true },
];

// Sony TV's attributes and catalogue, also from the reference payload.
export const REFERENCE_ATTRIBUTES = ["picture quality", "brightness", "black levels / contrast", "colour accuracy", "motion / sports", "gaming features", "sound", "smart platform", "design", "price / value", "reliability", "warranty / support", "availability / stock", "processing / upscaling"];

export const REFERENCE_CATALOG = [{"id": "bravia_9", "label": "BRAVIA 9", "family": "Mini-LED", "msrp": 3299}, {"id": "bravia_8_ii", "label": "BRAVIA 8 II", "family": "OLED", "msrp": 3499}, {"id": "bravia_8", "label": "BRAVIA 8", "family": "OLED", "msrp": 1999}, {"id": "bravia_7", "label": "BRAVIA 7", "family": "Mini-LED", "msrp": 1999}, {"id": "bravia_5", "label": "BRAVIA 5", "family": "Mini-LED", "msrp": 1799}, {"id": "bravia_3", "label": "BRAVIA 3", "family": "LED", "msrp": 799}, {"id": "bravia_2_ii", "label": "BRAVIA 2 II", "family": "LED", "msrp": 699}];
