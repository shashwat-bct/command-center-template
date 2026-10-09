// Bright Data AI-scraper client, adapted from command-center-template
// lib/brightdata.ts: same datasets, trigger / progress / download calls and
// prompt matching. Changes for bulk collection: each batch has its own
// deadline, batches run with a concurrency limit instead of all at once, and
// every answer keeps the full raw row so nothing Bright Data returns is lost.

export type BrightDataEngineId = "chatgpt" | "perplexity" | "gemini" | "copilot";

export type AnswerSource = { url: string; title: string };

export type RawRow = Record<string, unknown> & {
  prompt?: string;
  input?: { prompt?: string };
  answer_text?: string;
  answer_text_markdown?: string;
  answer_text_raw?: string;
  answer_html?: string;
  citations?: SourceLike[];
  sources?: SourceLike[];
  links_attached?: SourceLike[];
  search_sources?: SourceLike[];
  error?: string;
  error_code?: string;
};

export type BrightDataAnswer = {
  text: string;
  markdown: string | null;
  html: string | null;
  sources: AnswerSource[];
  snapshotId: string;
  raw: RawRow;
};

type Dataset = { id: string; url: string; host: string; extra: Record<string, unknown> };

export const DATASETS: Record<BrightDataEngineId, Dataset> = {
  chatgpt: { id: "gd_m7aof0k82r803d5bjm", url: "https://chatgpt.com/", host: "chatgpt.com", extra: { web_search: true } },
  perplexity: { id: "gd_m7dhdot1vw9a7gc1n", url: "https://www.perplexity.ai", host: "perplexity.ai", extra: {} },
  gemini: { id: "gd_mbz66arm2mf9cu856y", url: "https://gemini.google.com", host: "gemini.google.com", extra: {} },
  copilot: { id: "gd_m7di5jy6s9geokz8w", url: "https://copilot.microsoft.com/chats", host: "copilot.microsoft.com", extra: {} },
};

const API = "https://api.brightdata.com/datasets/v3";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PROGRESS_ERRORS = 5;

type SourceLike = string | { url?: string; link?: string; title?: string } | null;

type Progress = { status?: "starting" | "running" | "ready" | "failed"; error?: string };

export type BrightDataOptions = { country?: string; pollMs?: number; batchTimeoutMs?: number };

function sourcesOf(row: RawRow): AnswerSource[] {
  const seen = new Set<string>();
  const out: AnswerSource[] = [];
  for (const s of [row.citations, row.sources, row.links_attached, row.search_sources].filter(Array.isArray).flat() as SourceLike[]) {
    const url = typeof s === "string" ? s : s?.url || s?.link || "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof s === "string" ? "" : s?.title || "";
    out.push({ url, title: (title || url.split("/")[2]?.replace(/^www\./, "") || "").slice(0, 160) });
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
      if (p.status === "ready") return;
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

async function download(snapshot: string, key: string): Promise<RawRow[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}/snapshot/${snapshot}?format=json`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5 * 60_000) });
      if (!res.ok) throw new Error(`snapshot download ${res.status}`);
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) throw new Error(`snapshot ${snapshot} not ready to download`);
      return body as RawRow[];
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(4000);
    }
  }
}

function rowError(row: RawRow): string {
  const detail = [row.error, row.error_code, row.warning, row.warning_code].filter((x) => typeof x === "string" && x).join(" · ");
  return detail || `no answer (fields: ${Object.keys(row).slice(0, 12).join(", ")})`;
}

export type BatchResult = { snapshotId: string; rows: RawRow[]; answers: Array<BrightDataAnswer | Error> };

/**
 * Runs one Bright Data snapshot for a batch of distinct prompts. Returns the
 * raw rows and one entry per prompt, in order: the answer, or its error.
 */
export async function brightDataBatch(engine: BrightDataEngineId, key: string, prompts: string[], opts: BrightDataOptions = {}): Promise<BatchResult> {
  const t0 = Date.now();
  const trimmed = prompts.map((p) => p.trim());
  if (new Set(trimmed).size !== trimmed.length) throw new Error("a Bright Data batch must not repeat a prompt");
  const snapshotId = await trigger(DATASETS[engine], key, trimmed, opts.country ?? "US");
  await waitReady(engine, snapshotId, key, opts.pollMs ?? 10_000, Date.now() + (opts.batchTimeoutMs ?? 15 * 60_000));
  const rows = await download(snapshotId, key);
  const byPrompt = new Map<string, Array<BrightDataAnswer | Error>>();
  const errors: string[] = [];
  for (const row of rows) {
    const prompt = String(row.prompt ?? row.input?.prompt ?? "").trim();
    const text = row.answer_text || row.answer_text_markdown || row.answer_text_raw || "";
    if (!text.trim()) errors.push(rowError(row));
    if (!prompt) continue;
    const entry = text.trim()
      ? { text, markdown: row.answer_text_markdown || null, html: typeof row.answer_html === "string" ? row.answer_html : null, sources: sourcesOf(row), snapshotId, raw: row }
      : new Error(rowError(row));
    byPrompt.set(prompt, [...(byPrompt.get(prompt) ?? []), entry]);
  }
  for (const list of byPrompt.values()) list.sort((x, y) => Number(x instanceof Error) - Number(y instanceof Error));
  const answers = trimmed.map((p) => byPrompt.get(p)?.shift() ?? new Error(errors[0] ?? `no answer in snapshot ${snapshotId}`));
  const ok = answers.filter((x) => !(x instanceof Error)).length;
  console.log(`[brightdata] ${engine} ${snapshotId} ${ok}/${trimmed.length} answered in ${Math.round((Date.now() - t0) / 1000)}s`);
  return { snapshotId, rows, answers };
}
