import { GoogleAuth } from "google-auth-library";
import { callLLM } from "./llm";

export type EngineId = "chatgpt" | "gemini" | "claude";

export type AnswerSource = { url: string; title: string };

export type EngineAnswer = { text: string; sources: AnswerSource[] };

export type AiEngine = {
  id: EngineId;
  label: string;
  model: string;
  webSearch: boolean;
  ask: (question: string) => Promise<EngineAnswer>;
};

const TIMEOUT_MS = 120_000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return res.json();
    last = `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
    if (!RETRYABLE.has(res.status)) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(last);
}

type OpenAiOutput = { type: string; content?: Array<{ text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }> };

function chatgpt(apiKey: string): AiEngine {
  const model = process.env.OPENAI_MODEL || "gpt-5.5";
  return {
    id: "chatgpt",
    label: "ChatGPT",
    model,
    webSearch: true,
    ask: async (question) => {
      const j = (await postJson("https://api.openai.com/v1/responses", { authorization: `Bearer ${apiKey}` }, {
        model,
        input: question,
        tools: [{ type: "web_search" }],
      })) as { output?: OpenAiOutput[] };
      const parts = (j.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
      return {
        text: parts.map((c) => c.text ?? "").join(""),
        sources: parts.flatMap((c) => (c.annotations ?? []).filter((a) => a.type === "url_citation" && a.url).map((a) => ({ url: a.url as string, title: a.title ?? "" }))),
      };
    },
  };
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
};

function gemini(): AiEngine {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const project = process.env.GOOGLE_CLOUD_PROJECT || "bravo-platform-bc";
  const location = process.env.GEMINI_LOCATION || "global";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return {
    id: "gemini",
    label: "Gemini",
    model,
    webSearch: true,
    ask: async (question) => {
      const token = await auth.getAccessToken();
      if (!token) throw new Error("no Google credentials (application default credentials)");
      const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
      const j = (await postJson(url, { authorization: `Bearer ${token}` }, {
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [{ googleSearch: {} }],
      })) as GeminiResponse;
      const c = j.candidates?.[0];
      return {
        text: (c?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
        sources: (c?.groundingMetadata?.groundingChunks ?? []).filter((g) => g.web?.uri || g.web?.title).map((g) => ({ url: g.web?.uri ?? "", title: g.web?.title ?? "" })),
      };
    },
  };
}

function claude(): AiEngine {
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  return {
    id: "claude",
    label: "Claude",
    model,
    webSearch: false,
    ask: async (question) => ({ text: await callLLM({ user: question, model, maxTokens: 1500, temperature: 0.7 }), sources: [] }),
  };
}

/**
 * The AI engines this server can query: ChatGPT when OPENAI_API_KEY is set,
 * Gemini through Vertex AI with application default credentials unless
 * GEMINI_DISABLED is set, and Claude through the Atlas LLM proxy.
 */
export function availableEngines(): AiEngine[] {
  const engines: AiEngine[] = [];
  if (process.env.OPENAI_API_KEY) engines.push(chatgpt(process.env.OPENAI_API_KEY));
  if (!process.env.GEMINI_DISABLED) engines.push(gemini());
  engines.push(claude());
  return engines;
}
