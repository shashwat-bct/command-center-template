import { readFileSync, writeFileSync } from "node:fs";
import type { AtlasData } from "../lib/atlas";
import type { RetailFeed } from "../lib/retail-feed";
import type { AmazonHistory, Ctx, Payload } from "./atlas/common";
import { blackFriday } from "./atlas/holiday";
import { pricePerWipe } from "./atlas/price";
import { availability, bigDealDays } from "./atlas/window";
import { aiVisibility, reviews } from "./atlas/voice-ai";
import { blackFridayTv, retailerPriceGap, reviewsTv, withModelNames } from "./atlas/tv";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
for (const k of ["slug", "payload"]) if (!args[k]) throw new Error(`--${k} is required`);

const feed = JSON.parse(readFileSync(`brand-data/${args.slug}.feed.json`, "utf8")) as RetailFeed;
const payload = JSON.parse(readFileSync(args.payload, "utf8")) as Payload;
const amazon = JSON.parse(readFileSync(`brand-data/${args.slug}.amazon-history.json`, "utf8")) as AmazonHistory;
const brands = payload.dims.brands;
const subject = brands.find((b) => b.id === payload.meta.subject) ?? brands[0];
const ctx: Ctx = { feed, payload, amazon, subject, brands };

const tv = args.set === "tv";
const answers = tv
  ? [blackFridayTv(ctx), retailerPriceGap(ctx), bigDealDays(ctx), availability(ctx), reviewsTv(ctx), aiVisibility(ctx)].map((a) => withModelNames(ctx, a))
  : [blackFriday(ctx), pricePerWipe(ctx), bigDealDays(ctx), availability(ctx), reviews(ctx), aiVisibility(ctx)];
const atlas: AtlasData = {
  version: 1,
  brand: subject.label,
  generatedOn: new Date().toISOString().slice(0, 10),
  sources: [tv ? "Amazon (price, stock, sales rank and bought-in-past-month history)" : "Amazon (Keepa price, stock, sales rank and bought-in-past-month history)", tv ? "Retailer price and stock readings" : feed.label, "Amazon and Walmart reviews", "AI answers from ChatGPT, Gemini and Claude"],
  answers,
};
const out = args.out ?? `brand-data/${args.slug}.atlas.json`;
writeFileSync(out, JSON.stringify(atlas, null, 2) + "\n");
for (const a of answers) console.log(`── ${a.question}\n${a.headline}\n`);
