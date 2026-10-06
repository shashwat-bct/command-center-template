// LLM proxy client. Mirrors scripts/insights/lib-llm.mjs behaviour from
// bravo-platform — sign in anonymously to the Firebase project that hosts the
// Claude proxy, then call /api/llm with {system, user}. The server validates
// the Firebase ID token so the Claude key never leaves bravo-platform-bc.
//
// The Firebase web config below is PUBLIC — it's the same key the bravo-atlas
// bundle ships. Access is gated by the server's token verification + Firestore
// rules, not by hiding this.

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth, type User } from "firebase/auth";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDWw1rB68sh02LhXsTVup0Q6A6UakLXRl0",
  authDomain: "bravo-platform-bc.firebaseapp.com",
  projectId: "bravo-platform-bc",
  appId: "1:615581275552:web:0b5df9e2624b79889540c5",
};

const BASE = process.env.INS_API_BASE || "https://bravo-platform-bc.web.app";

let appCache: FirebaseApp | null = null;
let authCache: Auth | null = null;
let userPromise: Promise<User> | null = null;

function auth(): Auth {
  if (authCache) return authCache;
  if (!appCache) {
    appCache = getApps().length ? getApps()[0]! : initializeApp(FIREBASE_CONFIG);
  }
  authCache = getAuth(appCache);
  return authCache;
}

function signedInUser(): Promise<User> {
  userPromise ??= signInAnonymously(auth())
    .then((c) => c.user)
    .catch((e) => {
      userPromise = null;
      throw e;
    });
  return userPromise;
}

async function getIdToken(forceRefresh = false): Promise<string> {
  return (await signedInUser()).getIdToken(forceRefresh);
}

export type LLMArgs = {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
};

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function callLLM(args: LLMArgs): Promise<string> {
  let token = await getIdToken();
  let refreshed = false;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/api/llm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      // The proxy accepts Anthropic-style messages+system (not the OpenAI
      // chat-style single array). We send a single-turn user message.
      body: JSON.stringify({
        ...(args.system ? { system: args.system } : {}),
        ...(args.model ? { model: args.model } : {}),
        messages: [{ role: "user", content: args.user }],
        max_tokens: args.maxTokens ?? 800,
        temperature: args.temperature ?? 0.2,
      }),
    });
    if (res.ok) {
      const j = (await res.json()) as { text?: string; message?: string; content?: unknown };
      // The proxy returns various shapes depending on Claude's response format.
      // Common: { text: "..." }, { message: "..." }, { content: [{text: "..."}] }
      if (typeof j.text === "string") return j.text;
      if (typeof j.message === "string") return j.message;
      if (Array.isArray(j.content)) {
        const text = (j.content as Array<{ type?: string; text?: string }>).filter((b) => typeof b.text === "string").map((b) => b.text).join("");
        if (text) return text;
      }
      return JSON.stringify(j);
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      token = await getIdToken(true);
      continue;
    }
    if (!RETRYABLE.has(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM proxy ${res.status}: ${body.slice(0, 200)}`);
    }
    lastErr = `${res.status}`;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw new Error(`LLM proxy exhausted retries, last=${lastErr}`);
}
