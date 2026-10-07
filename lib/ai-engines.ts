import { brightDataAsk, brightDataHost, brightDataKey, type BrightDataEngineId } from "./brightdata";
import { callLLM } from "./llm";

export type EngineId = "chatgpt" | "perplexity" | "gemini" | "copilot" | "claude";

export type AnswerSource = { url: string; title: string };

export type EngineAnswer = { text: string; sources: AnswerSource[] };

export type EnginePath = "ui" | "api";

export type AiEngine = {
  id: EngineId;
  label: string;
  model: string;
  webSearch: boolean;
  path: EnginePath;
  ask: (question: string) => Promise<EngineAnswer>;
  askMany?: (questions: string[]) => Promise<Array<EngineAnswer | Error>>;
};

const LIVE_TIMEOUT_MS = 4 * 60_000;
const LIVE_POLL_MS = 5_000;

function consumerApp(id: BrightDataEngineId, label: string, key: string): AiEngine {
  return {
    id,
    label,
    model: brightDataHost(id),
    webSearch: true,
    path: "ui",
    ask: async (question) => {
      const [a] = await brightDataAsk(id, key, [question], { timeoutMs: LIVE_TIMEOUT_MS, pollMs: LIVE_POLL_MS });
      if (a instanceof Error) throw a;
      return a;
    },
    askMany: (questions) => brightDataAsk(id, key, questions),
  };
}

function claude(): AiEngine {
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  return {
    id: "claude",
    label: "Claude",
    model,
    webSearch: false,
    path: "api",
    ask: async (question) => ({ text: await callLLM({ user: question, model, maxTokens: 1500, temperature: 0.7 }), sources: [] }),
  };
}

/**
 * The AI engines this server can query: ChatGPT and Gemini through
 * their consumer apps via Bright Data when BRIGHTDATA_API_KEY (or
 * BRIGHTDATA_SERP_KEY) is set, and Claude through the Atlas LLM proxy unless
 * CLAUDE_DISABLED is set.
 */
export function availableEngines(): AiEngine[] {
  const engines: AiEngine[] = [];
  const key = brightDataKey();
  if (key) {
    engines.push(consumerApp("chatgpt", "ChatGPT", key));
    engines.push(consumerApp("gemini", "Gemini", key));
  }
  if (!process.env.CLAUDE_DISABLED) engines.push(claude());
  return engines;
}
