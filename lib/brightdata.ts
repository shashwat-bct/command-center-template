import type { AnswerSource, EngineAnswer } from "./ai-engines";

export type BrightDataEngineId = "chatgpt" | "perplexity" | "gemini" | "copilot";

type Dataset = { id: string; url: string; host: string; extra: Record<string, unknown> };

const DATASETS: Record<BrightDataEngineId, Dataset> = {
  chatgpt: { id: "gd_m7aof0k82r803d5bjm", url: "https://chatgpt.com/", host: "chatgpt.com", extra: { web_search: true } },
  perplexity: { id: "gd_m7dhdot1vw9a7gc1n", url: "https://www.perplexity.ai", host: "perplexity.ai", extra: {} },
  gemini: { id: "gd_mbz66arm2mf9cu856y", url: "https://gemini.google.com", host: "gemini.google.com", extra: {} },
  copilot: { id: "gd_m7di5jy6s9geokz8w", url: "https://copilot.microsoft.com/chats", host: "copilot.microsoft.com", extra: {} },
};

const API = "https://api.brightdata.com/datasets/v3";
const MAX_SOURCES = 8;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PROGRESS_ERRORS = 5;

type SourceLike = string | { url?: string; link?: string; title?: string } | null;

type Row = {
  prompt?: string;
  input?: { prompt?: string };
  answer_text?: string;
  answer_text_markdown?: string;
  answer_text_raw?: string;
  citations?: SourceLike[];
  sources?: SourceLike[];
  links_attached?: SourceLike[];
  search_sources?: SourceLike[];
  error?: string;
  error_code?: string;
};

type Progress = { status?: "starting" | "running" | "ready" | "failed"; error?: string };

export type BrightDataOptions = { country?: string; pollMs?: number; timeoutMs?: number; batchSize?: number };

export function brightDataKey(): string | null {
  return process.env.BRIGHTDATA_API_KEY || process.env.BRIGHTDATA_SERP_KEY || null;
}

export function brightDataHost(engine: BrightDataEngineId): string {
  return DATASETS[engine].host;
}

function sourcesOf(row: Row): AnswerSource[] {
  const seen = new Set<string>();
  const out: AnswerSource[] = [];
  for (const s of [row.citations, row.sources, row.links_attached, row.search_sources].filter(Array.isArray).flat() as SourceLike[]) {
    const url = typeof s === "string" ? s : s?.url || s?.link || "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof s === "string" ? "" : s?.title || "";
    out.push({ url, title: (title || url.split("/")[2]?.replace(/^www\./, "") || "").slice(0, 160) });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function trigger(dataset: Dataset, key: string, prompts: string[], country: string): Promise<string> {
  const res = await fetch(`${API}/trigger?dataset_id=${dataset.id}&include_errors=true`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(prompts.map((prompt) => ({ url: dataset.url, prompt, country, ...dataset.extra }))),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { snapshot_id?: string; message?: string; error?: string };
  if (!res.ok || !body.snapshot_id) throw new Error(`Bright Data trigger ${res.status}: ${body.message || body.error || "no snapshot_id"}`);
  return body.snapshot_id;
}

async function waitReady(engine: string, snapshot: string, key: string, pollMs: number, deadline: number): Promise<void> {
  let last = "", errors = 0;
  for (;;) {
    await sleep(pollMs);
    let status = "";
    try {
      const res = await fetch(`${API}/progress/${snapshot}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const p = (await res.json().catch(() => ({}))) as Progress;
      status = res.ok ? p.status ?? "unknown" : `http ${res.status}`;
      if (p.status === "ready") { console.log(`[brightdata] ${engine} ${snapshot} ready`); return; }
      if (p.status === "failed") throw new Error(`Bright Data snapshot ${snapshot} failed${p.error ? `: ${p.error}` : ""}`);
      errors = res.ok ? 0 : errors + 1;
    } catch (e) {
      if ((e as Error).message.startsWith("Bright Data snapshot")) throw e;
      status = `error ${(e as Error).message}`;
      errors++;
    }
    if (status !== last) { console.log(`[brightdata] ${engine} ${snapshot} ${status}`); last = status; }
    if (errors >= MAX_PROGRESS_ERRORS) throw new Error(`Bright Data progress for ${snapshot} kept failing (${status})`);
    if (Date.now() > deadline) throw new Error(`Bright Data snapshot ${snapshot} still ${status} after the timeout`);
  }
}

async function download(snapshot: string, key: string): Promise<Row[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}/snapshot/${snapshot}?format=jsonl`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`snapshot download ${res.status}`);
      const rows: Row[] = [];
      const decoder = new TextDecoder();
      let buf = "";
      const take = (line: string) => {
        if (!line.trim()) return;
        try {
          rows.push(JSON.parse(line) as Row);
        } catch {
          return;
        }
      };
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          take(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
      take(buf + decoder.decode());
      return rows;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(4000);
    }
  }
}

function rowError(row: Row): string {
  const extra = row as Record<string, unknown>;
  const detail = [row.error, row.error_code, extra.warning, extra.warning_code].filter((x) => typeof x === "string" && x).join(" · ");
  return detail || `no answer (fields: ${Object.keys(row).slice(0, 12).join(", ")})`;
}

async function runBatch(engine: BrightDataEngineId, key: string, prompts: string[], country: string, pollMs: number, deadline: number): Promise<Array<EngineAnswer | Error>> {
  const t0 = Date.now();
  const snapshot = await trigger(DATASETS[engine], key, prompts, country);
  await waitReady(engine, snapshot, key, pollMs, deadline);
  const rows = await download(snapshot, key);
  const byPrompt = new Map<string, Array<EngineAnswer | Error>>();
  const errors: string[] = [];
  for (const row of rows) {
    const prompt = (row.prompt ?? row.input?.prompt ?? "").trim();
    const text = row.answer_text || row.answer_text_markdown || row.answer_text_raw || "";
    if (!text.trim()) errors.push(rowError(row));
    if (!prompt) continue;
    const entry = text.trim() ? { text, sources: sourcesOf(row) } : new Error(rowError(row));
    byPrompt.set(prompt, [...(byPrompt.get(prompt) ?? []), entry]);
  }
  for (const list of byPrompt.values()) list.sort((x, y) => Number(x instanceof Error) - Number(y instanceof Error));
  const out = prompts.map((p) => byPrompt.get(p)?.shift() ?? new Error(errors[0] ?? `no answer in snapshot ${snapshot}`));
  const ok = out.filter((x) => !(x instanceof Error)).length;
  console.log(`[brightdata] ${engine} ${snapshot} ${ok}/${prompts.length} answered in ${Math.round((Date.now() - t0) / 1000)}s${errors.length ? ` · errors: ${[...new Set(errors)].slice(0, 3).join(" | ").slice(0, 300)}` : ""}`);
  return out;
}

/**
 * Asks an AI engine's consumer app (not its API) every prompt, in small Bright
 * Data snapshots run in parallel. Returns one entry per prompt, in order: the
 * answer, or the error for that prompt.
 */
export async function brightDataAsk(engine: BrightDataEngineId, key: string, prompts: string[], opts: BrightDataOptions = {}): Promise<Array<EngineAnswer | Error>> {
  if (!prompts.length) return [];
  const deadline = Date.now() + (opts.timeoutMs ?? 13 * 60_000);
  const size = Math.max(1, opts.batchSize ?? 3);
  const trimmed = prompts.map((p) => p.trim());
  const batches: string[][] = [];
  for (let i = 0; i < trimmed.length; i += size) batches.push(trimmed.slice(i, i + size));
  console.log(`[brightdata] ${engine} ${trimmed.length} prompts in ${batches.length} snapshots`);
  const settled = await Promise.allSettled(batches.map((b) => runBatch(engine, key, b, opts.country ?? "US", opts.pollMs ?? 10_000, deadline)));
  const out = settled.flatMap((r, i) => (r.status === "fulfilled" ? r.value : batches[i].map(() => (r.reason instanceof Error ? r.reason : new Error(String(r.reason))))));
  const ok = out.filter((x) => !(x instanceof Error)).length;
  console.log(`[brightdata] ${engine} total ${ok}/${trimmed.length} answered`);
  if (!ok) throw out.find((x) => x instanceof Error) ?? new Error("no answers");
  return out;
}
