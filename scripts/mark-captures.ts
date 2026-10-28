import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callLLMVision } from "../lib/llm";
import { parseJsonObject } from "../lib/market-mechanics";

type Mark = { kind: string; label: string; text: string; x: number; y: number; w: number; h: number };
type Marked = { w: number; h: number; marks: Mark[] };

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
for (const k of ["slug", "images"]) if (!args[k]) throw new Error(`--${k} is required`);

const BATCH = Number(args.batch ?? 5);
const KINDS = ["title", "rating", "price", "was", "saving", "promotion", "delivery", "stock", "seller"];
const SYSTEM = "You locate elements on retail product page screenshots. Report only what is visible. Coordinates are in pixels of the image as given, origin top-left. Reply with one JSON object and nothing else.";

const prompt = (w: number, h: number): string => `This screenshot of a retail product page is ${w} pixels wide and ${h} pixels tall.

Find each of these on the page and draw a tight box around it:
- "title": the product title
- "rating": the star rating and review count
- "price": the current selling price
- "was": a crossed-out, list or "was" price, if shown
- "saving": a savings line or discount badge ("Save $200", "-24%"), if shown
- "promotion": each offer shown (card offers, financing, gift cards, free items, bundles, protection plans, trade-in, "Top Deal" or event badges); one box per offer
- "delivery": the delivery or pickup promise
- "stock": the stock or availability message ("In Stock", "Only 3 left", "Sold out")
- "seller": who sells or ships it, if shown

Return {"marks": [{"kind": one of ${KINDS.map((k) => `"${k}"`).join(", ")}, "text": the words inside the box, exactly as shown and shortened to 90 characters, "x": left, "y": top, "w": width, "h": height}]}.
Leave out anything not on the page. Do not box the same text twice.`;

const clampBox = (m: Mark, w: number, h: number): Mark | null => {
  const x = Math.max(0, Math.round(m.x)), y = Math.max(0, Math.round(m.y));
  const bw = Math.min(w - x, Math.round(m.w)), bh = Math.min(h - y, Math.round(m.h));
  return bw > 4 && bh > 4 ? { ...m, x, y, w: bw, h: bh } : null;
};

const LABEL: Record<string, string> = { title: "Title", rating: "Rating", price: "Price", was: "Reference price", saving: "Saving", promotion: "Offer", delivery: "Delivery promise", stock: "Stock line", seller: "Seller" };

async function mark(id: string, w: number, h: number): Promise<Marked> {
  const img = readFileSync(join(args.images, `${id}.read.jpg`));
  const text = await callLLMVision({ system: SYSTEM, text: prompt(w, h), images: [img], maxTokens: 2000 });
  const raw = parseJsonObject(text) as { marks?: Array<Record<string, unknown>> } | null;
  if (!raw || !Array.isArray(raw.marks)) throw new Error(`no JSON: ${text.slice(0, 120)}`);
  const marks = raw.marks.flatMap((m): Mark[] => {
    const kind = String(m.kind ?? "");
    if (!KINDS.includes(kind)) return [];
    const box = clampBox({ kind, label: LABEL[kind], text: String(m.text ?? "").slice(0, 90), x: Number(m.x), y: Number(m.y), w: Number(m.w), h: Number(m.h) }, w, h);
    return box ? [box] : [];
  });
  return { w, h, marks };
}

async function main(): Promise<void> {
  const sizes = JSON.parse(readFileSync(join(args.images, "sizes.json"), "utf8")) as Record<string, [number, number]>;
  const out = `brand-data/${args.slug}.marks.json`;
  const done = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { captures: Record<string, Marked> }).captures : {};
  const only = args.only ? new Set(args.only.split(",")) : null;
  const queue = Object.entries(sizes).filter(([id]) => (!only || only.has(id)) && !done[id]);
  let failed = 0;
  for (let i = 0; i < queue.length; i += BATCH) {
    await Promise.all(queue.slice(i, i + BATCH).map(async ([id, [w, h]]) => {
      try {
        done[id] = await mark(id, w, h);
        console.log(`${id}: ${done[id].marks.map((m) => m.kind).join(", ")}`);
      } catch (e) {
        failed += 1;
        console.log(`${id}: failed ${(e as Error).message.slice(0, 140)}`);
      }
    }));
    writeFileSync(out, JSON.stringify({ version: 1, source: "Retail page captures marked by Claude Sonnet 5.5", captures: done }) + "\n");
  }
  console.log(`${Object.keys(done).length} captures marked, ${failed} failed`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
