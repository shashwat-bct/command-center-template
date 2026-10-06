import { createHash, randomBytes } from "node:crypto";
import { type NextRequest } from "next/server";
import { bearerToken, isAdmin, tokenIsValid } from "@/lib/admin-auth";
import { availableEngines, type AiEngine } from "@/lib/ai-engines";
import { patternMentions, readAnswers } from "@/lib/ai-visibility";
import { checkShareToken } from "@/lib/share-response";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Brand = { id: string; label: string; aliases?: string[] };
type Body = { mode?: string; question?: string; engines?: string[]; subject?: string; brands?: Brand[]; persona?: string | null; answers?: Array<{ id: string; text: string }>; category?: string };

const CONSOLE_ID: Record<string, string> = { chatgpt: "gpt", gemini: "gemini", claude: "claude" };
const LIMIT_PER_HOUR = 30;
const runs = new Map<string, number[]>();

function allowed(key: string): boolean {
  const now = Date.now();
  const recent = (runs.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= LIMIT_PER_HOUR) { runs.set(key, recent); return false; }
  recent.push(now);
  runs.set(key, recent);
  return true;
}

function caller(req: NextRequest): string | null {
  if (isAdmin(req)) return "admin";
  const bearer = bearerToken(req);
  if (!bearer) return null;
  if (tokenIsValid(bearer)) return "admin";
  const check = checkShareToken(bearer);
  return check.ok ? `share:${check.claims.slug}:${check.claims.nonce}` : null;
}

const hostOf = (url: string, title: string): string => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h.includes("vertexaisearch") ? title.toLowerCase() : h;
  } catch {
    return title.toLowerCase();
  }
};

async function ask(engine: AiEngine, question: string, brands: Brand[]) {
  const t0 = Date.now();
  const id = CONSOLE_ID[engine.id];
  try {
    const a = await engine.ask(question);
    const order = patternMentions(a.text, brands.map((b) => b.label));
    const idOf = new Map(brands.map((b) => [b.label, b.id]));
    return {
      id, label: engine.label, model: engine.model, via: `${engine.model}${engine.webSearch ? " with web search" : ""}`,
      text: a.text,
      sources: a.sources.map((s) => ({ url: s.url, title: s.title, host: hostOf(s.url, s.title) })),
      brands: order.map((name, i) => ({ id: idOf.get(name) as string, rank: i + 1, recommended: false, sentiment: "neutral", product: "" })),
      topPick: "", subjectClaims: [], tMs: Date.now() - t0,
      sha256: createHash("sha256").update(a.text).digest("hex"),
    };
  } catch (e) {
    return { id, label: engine.label, model: engine.model, via: engine.model, text: "", sources: [], brands: [], topPick: "", subjectClaims: [], tMs: Date.now() - t0, error: (e as Error).message.slice(0, 200) };
  }
}

/**
 * POST /api/ai-live — the AI console's live run. mode "engines" asks the
 * chosen engines one question and returns their answers with brands found by
 * name; mode "extract" reads those answers for rank, sentiment, top pick and
 * claims. Open to admins and to holders of a valid share link, rate-limited.
 */
export async function POST(req: NextRequest) {
  const who = caller(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Body;
  const question = (body.question ?? "").trim().slice(0, 500);
  const brands = (body.brands ?? []).filter((b) => b && typeof b.id === "string" && typeof b.label === "string").slice(0, 10);
  if (question.length < 8 || !brands.length) return Response.json({ error: "bad request", message: "a question and the brand set are required" }, { status: 400 });

  if (body.mode === "extract") {
    const answers = (body.answers ?? []).filter((a) => a && typeof a.text === "string" && a.text.trim()).slice(0, 4);
    if (!answers.length) return Response.json({ engines: [] });
    const subject = brands.find((b) => b.id === body.subject) ?? brands[0];
    const idOf = new Map(brands.map((b) => [b.label.toLowerCase(), b.id]));
    try {
      const read = await readAnswers(question, answers.map((a) => a.text), brands.map((b) => b.label), subject.label, body.category ?? "products", []);
      return Response.json({
        engines: answers.map((a, i) => ({
          id: a.id,
          brands: read[i].brands.flatMap((b) => { const id = idOf.get(b.name.toLowerCase()); return id ? [{ id, rank: b.rank, recommended: b.recommended, sentiment: b.sentiment, product: b.product }] : []; }),
          topPick: read[i].topPick ? idOf.get(read[i].topPick!.toLowerCase()) ?? "" : "",
          subjectClaims: read[i].claims,
        })),
      });
    } catch (e) {
      return Response.json({ error: "extract failed", message: (e as Error).message.slice(0, 200) }, { status: 502 });
    }
  }

  if (!allowed(who)) return Response.json({ error: "rate limited", message: `live runs are limited to ${LIMIT_PER_HOUR} an hour per link` }, { status: 429 });
  const wanted = new Set(body.engines ?? []);
  const engines = availableEngines().filter((e) => !wanted.size || wanted.has(CONSOLE_ID[e.id]));
  const prompt = body.persona ? `${body.persona}\n\n${question}` : question;
  const t0 = Date.now();
  const out = await Promise.all(engines.map((e) => ask(e, prompt, brands)));
  return Response.json({ question, at: new Date().toISOString(), engines: out, path: "model APIs, live", runId: randomBytes(4).toString("hex"), elapsedMs: Date.now() - t0 });
}
