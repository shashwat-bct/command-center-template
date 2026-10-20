import { chromium } from "playwright-core";

const API = "https://api.brightdata.com";
const SESSIONS = 4;
const NAV_TIMEOUT_MS = 90_000;
const PRICE_WAIT_MS = 25_000;

let endpoint: Promise<string> | null = null;
let active = 0;
const waiting: Array<() => void> = [];

const scrub = (s: string): string => s.replace(/(zone-[\w-]+):[^@\s]+@/g, "$1:***@");

async function api<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Bright Data ${path.split("?")[0]} ${res.status}`);
  return (await res.json()) as T;
}

function browserEndpoint(key: string): Promise<string> {
  const zone = process.env.BRIGHTDATA_BROWSER_ZONE || "scraping_browser1";
  endpoint ??= (async () => {
    const [{ customer }, { passwords }] = await Promise.all([
      api<{ customer?: string }>("/status", key),
      api<{ passwords?: string[] }>(`/zone/passwords?zone=${zone}`, key),
    ]);
    if (!customer || !passwords?.[0]) throw new Error(`no credentials for Bright Data zone ${zone}`);
    return `wss://brd-customer-${customer}-zone-${zone}:${passwords[0]}@brd.superproxy.io:9222`;
  })().catch((e: unknown) => {
    endpoint = null;
    throw e;
  });
  return endpoint;
}

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

/**
 * Opens a page in Bright Data's Scraping Browser and returns each product tile
 * it shows (an element holding a link and a price) as "text <link>".
 */
export async function renderTiles(url: string, key: string): Promise<string[]> {
  const ws = await browserEndpoint(key);
  return slot(async () => {
    const browser = await chromium.connectOverCDP(ws, { timeout: 60_000 }).catch((e: unknown) => {
      throw new Error(scrub((e as Error).message).split("\n")[0]);
    });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await page.waitForFunction(() => (document.body.innerText.match(/\$\d+(\.\d\d)?/g) ?? []).length >= 3, null, { timeout: PRICE_WAIT_MS }).catch(() => null);
      return await page.evaluate(() => {
        const out: string[] = [];
        const kept: Element[] = [];
        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
          let el: Element | null = a;
          for (let i = 0; i < 7 && el; i++) {
            const t = (el as HTMLElement).innerText ?? "";
            if (/\$\d/.test(t) && t.length > 20 && t.length < 700) break;
            el = el.parentElement;
          }
          if (!el) continue;
          const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
          if (!/\$\d/.test(text) || text.length < 20 || text.length > 700) continue;
          if (kept.some((k) => k === el || k.contains(el as Element) || (el as Element).contains(k))) continue;
          kept.push(el);
          const href = (el.querySelector("a[href]") as HTMLAnchorElement | null)?.href ?? (a as HTMLAnchorElement).href;
          out.push(`${text.slice(0, 300)} <${href.split("?")[0]}>`);
          if (out.length >= 24) break;
        }
        return out;
      });
    } catch (e) {
      throw new Error(scrub((e as Error).message).split("\n")[0]);
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
}
