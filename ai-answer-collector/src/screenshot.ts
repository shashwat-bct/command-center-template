// Renders the image behind "show the real session" on the dashboard, as the
// command-center-template does: the page source the consumer-app session
// returned (Bright Data's answer_html), drawn offline in headless Chromium with
// scripts and network disabled. Answers without page source (the API path)
// are drawn from their markdown in a plain answer card.

import { marked } from "marked";
import { chromium, type Browser } from "playwright";
import type { ResponseRecord } from "./store";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const stripScripts = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+="[^"]*"/gi, "");

function answerCard(r: ResponseRecord): string {
  const body = marked.parse(r.answer?.markdown || r.answer?.text || "", { async: false });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f1f1f}
.wrap{max-width:780px;margin:0 auto;padding:28px 24px}
.q{margin:0 0 20px auto;max-width:80%;width:fit-content;padding:10px 16px;background:#f1f3f4;border-radius:18px}
.meta{font-size:12px;color:#5f6368;margin-bottom:16px}
table{border-collapse:collapse}td,th{border:1px solid #e3e3e3;padding:4px 8px}
</style></head><body><div class="wrap"><div class="meta">${esc(r.engineLabel)} · ${esc(r.model)} · ${esc(r.answeredAt)}</div><div class="q">${esc(r.prompt)}</div>${body}</div></body></html>`;
}

let browser: Promise<Browser> | null = null;

export async function renderScreenshot(r: ResponseRecord): Promise<Buffer> {
  browser ??= chromium.launch();
  const ctx = await (await browser).newContext({ javaScriptEnabled: false, viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  try {
    await ctx.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    const p = await ctx.newPage();
    await p.setContent(r.answer?.html ? stripScripts(r.answer.html) : answerCard(r), { waitUntil: "load", timeout: 30_000 });
    return await p.screenshot({ fullPage: true, type: "jpeg", quality: 72 });
  } finally {
    await ctx.close();
  }
}

export async function closeRenderer(): Promise<void> {
  if (browser) await (await browser).close();
  browser = null;
}
