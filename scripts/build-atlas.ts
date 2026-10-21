import { readFileSync, writeFileSync } from "node:fs";
import type { AtlasData } from "../lib/atlas";
import type { RetailFeed } from "../lib/retail-feed";
import type { Ctx, Payload } from "./atlas/common";
import { blackFriday, pricePerWipe } from "./atlas/walmart";
import { availability, bigDealDays } from "./atlas/window";
import { aiVisibility, reviews } from "./atlas/voice-ai";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
for (const k of ["slug", "payload"]) if (!args[k]) throw new Error(`--${k} is required`);

const feed = JSON.parse(readFileSync(`brand-data/${args.slug}.feed.json`, "utf8")) as RetailFeed;
const payload = JSON.parse(readFileSync(args.payload, "utf8")) as Payload;
const brands = payload.dims.brands;
const subject = brands.find((b) => b.id === payload.meta.subject) ?? brands[0];
const ctx: Ctx = { feed, payload, subject, brands };

const answers = [blackFriday(ctx), pricePerWipe(ctx), bigDealDays(ctx), availability(ctx), reviews(ctx), aiVisibility(ctx)];
const atlas: AtlasData = {
  version: 1,
  brand: subject.label,
  generatedOn: new Date().toISOString().slice(0, 10),
  sources: [feed.label, "Amazon via Keepa and Apify", "AI answers from ChatGPT, Gemini and Claude"],
  answers,
};
const out = args.out ?? `brand-data/${args.slug}.atlas.json`;
writeFileSync(out, JSON.stringify(atlas, null, 2) + "\n");
for (const a of answers) console.log(`── ${a.question}\n${a.headline}\n`);
