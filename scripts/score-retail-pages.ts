import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { callLLMVision } from "../lib/llm";
import { parseJsonObject } from "../lib/market-mechanics";

type Page = { capture: string; date: string; retailer: string; model: string; title: string | null; height: number; tiles: string[] };
type Fields = { images: number; video: number; aplus: number; bullets: number; specs: number; reviews: number; titleKw: number };
type Scored = { capture: string; date: string; fields: Fields; notes: string; model: string };

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
for (const k of ["slug", "manifest"]) if (!args[k]) throw new Error(`--${k} is required`);

const MAX: Fields = { images: 9, video: 3, aplus: 1, bullets: 7, specs: 1, reviews: 1, titleKw: 1 };
const RETAILER: Record<string, string> = { amazon: "Amazon", walmart: "Walmart", bestbuy: "Best Buy", target: "Target" };

const SYSTEM = `You audit retail product detail pages from screenshots. You are given one product page cut top to bottom into consecutive tiles. Count only what is visible in the screenshots; do not assume content that is not shown. Reply with one JSON object and nothing else.`;

const prompt = (p: Page): string => `Retailer: ${RETAILER[p.retailer] ?? p.retailer}
Listing title as read from the page: ${p.title ?? "unknown"}
The first image is the top of the page as a shopper first sees it; the ${p.tiles.length - 1} after it are the full page from the top down (its first part may render blank).

Return this JSON object:
{
  "images": number of product images in the main image gallery: the visible thumbnails, plus N for a "+N" or "View all N" indicator (a "+13" tile means 13 more images, not one),
  "video": number of product videos offered in the gallery or on the page,
  "aplus": true if the page carries brand-supplied rich content below the fold (an "About this item from the brand", "From the manufacturer", A+ or enhanced-content module with banner images), else false,
  "bullets": number of feature bullet points or key-feature lines in the highlights/about-this-item section,
  "specs": true if the page has a specifications section with technical attributes (resolution, refresh rate, HDR, ports, dimensions), including a collapsed "Specs" or "Specifications" section the shopper can expand, else false,
  "reviews": true if customer reviews are shown on the page with a star rating and at least one written review, else false,
  "titleKw": true if the listing title names the brand, the model or series, the 65-inch size and the display technology (for example OLED, Mini-LED, QLED, 4K), else false,
  "notes": one short sentence on anything that limited the read (cut-off page, pop-up, out-of-stock overlay)
}`;

const num = (v: unknown, max: number): number => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

async function score(p: Page): Promise<Scored> {
  const images = p.tiles.map((t) => readFileSync(t));
  const text = await callLLMVision({ system: SYSTEM, text: prompt(p), images, maxTokens: 1200 });
  const raw = parseJsonObject(text) as Record<string, unknown> | null;
  if (!raw) throw new Error(`no JSON for ${p.capture}: ${text.slice(0, 120)}`);
  const fields = Object.fromEntries(Object.entries(MAX).map(([k, max]) => [k, num(raw[k], max)])) as Fields;
  return { capture: p.capture, date: p.date, model: p.model, fields, notes: typeof raw.notes === "string" ? raw.notes : "" };
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8")) as Record<string, Page>;
  const out = `brand-data/${args.slug}.pdp.json`;
  const done = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { pages: Record<string, Scored> }).pages : {};
  const only = args.only ? new Set(args.only.split(",")) : null;
  const queue = Object.entries(manifest).filter(([key, p]) => (!only || only.has(key)) && done[key]?.capture !== p.capture);
  let failed = 0;
  for (let i = 0; i < queue.length; i += 4) {
    await Promise.all(queue.slice(i, i + 4).map(async ([key, p]) => {
      try {
        done[key] = await score(p);
        console.log(`${key}: ${JSON.stringify(done[key].fields)} ${done[key].notes}`);
      } catch (e) {
        failed += 1;
        console.log(`${key}: failed ${(e as Error).message.slice(0, 160)}`);
      }
    }));
    writeFileSync(out, JSON.stringify({ version: 1, source: "Retail page captures read by Claude Sonnet 5.5", pages: done }, null, 1) + "\n");
  }
  console.log(`${Object.keys(done).length} pages scored, ${failed} failed`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
