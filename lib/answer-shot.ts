import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright-core";
import { bucket } from "./gcs";
import { browserEndpoint } from "./retail-browser";

const WIDTH = 900;
const BASE_HEIGHT = 1000;
const MAX_HEIGHT = 7000;
const RENDER_TIMEOUT_MS = 30_000;
const SESSIONS = 3;

const shotKey = (sha: string) => `evidence/v1/${sha}.jpg`;

/** The URL the dashboard loads an answer's screenshot from. */
export const shotUrl = (sha: string) => `/api/evidence/${sha}.jpg`;

export const answerSha = (text: string) => createHash("sha256").update(text).digest("hex");

let local: Promise<Browser | null> | null = null;
let active = 0;
const waiting: Array<() => void> = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= SESSIONS) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function localBrowser(): Promise<Browser | null> {
  local ??= chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }).catch(() => null);
  return local;
}

async function draw(page: Page, html: string): Promise<Buffer> {
  await page.route("**/*", (rt) => (rt.request().resourceType() === "image" ? rt.continue() : rt.abort())).catch(() => null);
  await page.setViewportSize({ width: WIDTH, height: BASE_HEIGHT });
  await page.setContent(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""), { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
  const extra = await page.evaluate(() => {
    let most = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight;
    for (const e of document.querySelectorAll("body *")) {
      const o = getComputedStyle(e).overflowY;
      if ((o === "auto" || o === "scroll") && e.clientWidth > 400) most = Math.max(most, e.scrollHeight - e.clientHeight);
    }
    return most;
  });
  await page.setViewportSize({ width: WIDTH, height: Math.min(BASE_HEIGHT + Math.max(0, extra), MAX_HEIGHT) });
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => null);
  return page.screenshot({ type: "jpeg", quality: 70, timeout: RENDER_TIMEOUT_MS });
}

async function render(html: string): Promise<Buffer> {
  const browser = await localBrowser();
  if (browser) {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    try {
      return await draw(await ctx.newPage(), html);
    } finally {
      await ctx.close();
    }
  }
  const key = process.env.BRIGHTDATA_API_KEY || process.env.BRIGHTDATA_SERP_KEY;
  if (!key) throw new Error("no local Chromium and no Bright Data key for the Scraping Browser");
  const remote = await chromium.connectOverCDP(await browserEndpoint(key), { timeout: 60_000 });
  try {
    return await draw(await remote.newPage(), html);
  } finally {
    await remote.close().catch(() => null);
  }
}

/**
 * Renders the page an engine's consumer app showed (scripts off, product images loaded)
 * and stores it under the answer's sha256. Returns the URL the dashboard loads it from,
 * or null when the page could not be rendered or stored.
 */
export async function storeAnswerShot(html: string, answerText: string): Promise<string | null> {
  if (!html) return null;
  const sha = answerSha(answerText);
  const file = bucket().file(shotKey(sha));
  try {
    const [exists] = await file.exists();
    if (exists) return shotUrl(sha);
    const jpg = await slot(() => render(html));
    await file.save(jpg, { contentType: "image/jpeg", resumable: false, metadata: { cacheControl: "public, max-age=31536000, immutable" } });
    return shotUrl(sha);
  } catch (e) {
    console.error(`[answer-shot] ${sha.slice(0, 12)}`, (e as Error).message.split("\n")[0]);
    return null;
  }
}

/** The stored screenshot for an answer, or null when none was stored. */
export async function readAnswerShot(sha: string): Promise<Buffer | null> {
  try {
    const [buf] = await bucket().file(shotKey(sha)).download();
    return buf;
  } catch {
    return null;
  }
}

/** Closes the local renderer so a one-off script can exit. */
export async function closeShots(): Promise<void> {
  const b = await (local ?? Promise.resolve(null));
  local = null;
  await b?.close().catch(() => null);
}
