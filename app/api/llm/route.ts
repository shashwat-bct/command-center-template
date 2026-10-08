import { type NextRequest } from "next/server";
import { bearerToken, isAdmin, tokenIsValid } from "@/lib/admin-auth";
import { callLLMChat, type ChatMessage } from "@/lib/llm";
import { checkShareToken } from "@/lib/share-response";
import { isShareId, slugForShareId } from "@/lib/share-id";

export const dynamic = "force-dynamic";

const LIMIT_PER_HOUR = 60;
const MAX_SYSTEM = 60_000;
const MAX_MESSAGES = 10;
const MAX_MESSAGE = 4_000;
const calls = new Map<string, number[]>();

function allowed(key: string): boolean {
  const now = Date.now();
  const recent = (calls.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= LIMIT_PER_HOUR) { calls.set(key, recent); return false; }
  recent.push(now);
  calls.set(key, recent);
  return true;
}

async function caller(req: NextRequest): Promise<string | null> {
  if (isAdmin(req)) return "admin";
  const bearer = bearerToken(req);
  if (!bearer) return null;
  if (tokenIsValid(bearer)) return "admin";
  if (isShareId(bearer)) return (await slugForShareId(bearer)) ? `share:${bearer}` : null;
  const check = checkShareToken(bearer);
  return check.ok ? `share:${check.claims.slug}:${check.claims.nonce}` : null;
}

type Body = { system?: unknown; messages?: unknown; max_tokens?: unknown; temperature?: unknown };

const isMessage = (m: unknown): m is ChatMessage =>
  !!m && typeof m === "object" && ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") && typeof (m as ChatMessage).content === "string";

/**
 * POST /api/llm — the dashboard's "Ask about this card" chat, relayed to Claude through the
 * Atlas proxy. Open to admins and holders of a valid share link, rate-limited per link.
 */
export async function POST(req: NextRequest) {
  const who = await caller(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!allowed(who)) return Response.json({ error: "rate limited", message: `card questions are limited to ${LIMIT_PER_HOUR} an hour per link` }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as Body;
  const messages = Array.isArray(body.messages) ? body.messages.filter(isMessage).slice(-MAX_MESSAGES).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) })) : [];
  if (!messages.length || messages[messages.length - 1].role !== "user") return Response.json({ error: "bad request", message: "messages must end with a user turn" }, { status: 400 });
  const system = typeof body.system === "string" ? body.system.slice(0, MAX_SYSTEM) : undefined;
  const maxTokens = Math.min(1200, Math.max(64, Number(body.max_tokens) || 700));
  const temperature = Math.min(1, Math.max(0, Number(body.temperature) || 0.2));
  try {
    const text = await callLLMChat({ system, messages, maxTokens, temperature });
    return Response.json({ content: [{ type: "text", text }] });
  } catch (e) {
    return Response.json({ error: "llm failed", message: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
