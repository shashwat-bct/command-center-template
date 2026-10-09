import { brightDataBatch, DATASETS, type AnswerSource, type BrightDataEngineId, type RawRow } from "./brightdata";
import { callLLM } from "./llm";
import { COUNTRY } from "../config/brands";

export type EngineId = BrightDataEngineId | "claude";

export type EnginePath = "ui" | "api";

export type EngineInfo = { id: EngineId; label: string; path: EnginePath; model: string };

export type Answer = {
  text: string;
  markdown: string | null;
  html: string | null;
  sources: AnswerSource[];
  snapshotId: string | null;
  raw: RawRow | null;
};

export const ENGINES: Record<EngineId, EngineInfo> = {
  chatgpt: { id: "chatgpt", label: "ChatGPT", path: "ui", model: DATASETS.chatgpt.host },
  gemini: { id: "gemini", label: "Gemini", path: "ui", model: DATASETS.gemini.host },
  perplexity: { id: "perplexity", label: "Perplexity", path: "ui", model: DATASETS.perplexity.host },
  copilot: { id: "copilot", label: "Copilot", path: "ui", model: DATASETS.copilot.host },
  claude: { id: "claude", label: "Claude", path: "api", model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5" },
};

// ChatGPT and Gemini by default, as in the command-center-template. Perplexity
// and Copilot snapshots did not complete there, so they are opt-in.
export const DEFAULT_ENGINES: EngineId[] = ["chatgpt", "gemini", "claude"];

export const isBrightData = (id: EngineId): id is BrightDataEngineId => id !== "claude";

/** One batch of distinct prompts through a consumer app via Bright Data. */
export async function askBrightData(engine: BrightDataEngineId, key: string, prompts: string[]): Promise<{ snapshotId: string; rows: RawRow[]; answers: Array<Answer | Error> }> {
  return brightDataBatch(engine, key, prompts, { country: COUNTRY });
}

/** One prompt to Claude through the Atlas LLM proxy (API path, no web search). */
export async function askClaude(prompt: string): Promise<Answer> {
  const text = await callLLM({ user: prompt, model: ENGINES.claude.model, maxTokens: 1500, temperature: 0.7 });
  return { text, markdown: text, html: null, sources: [], snapshotId: null, raw: null };
}
