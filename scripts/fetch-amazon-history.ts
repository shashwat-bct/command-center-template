import { readFileSync, writeFileSync } from "node:fs";
import { AMAZON_RETAIL_SELLER } from "../lib/amazon-series";
import { dailySeries, fetchKeepaAsin } from "../lib/keepa";
import type { AmazonHistory } from "./atlas/common";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
for (const k of ["slug", "payload", "from", "to"]) if (!args[k]) throw new Error(`--${k} is required`);

async function main(key: string): Promise<void> {
  const payload = JSON.parse(readFileSync(args.payload, "utf8")) as { dims: { models: Array<{ asin?: string }> } };
  const asins = [...new Set(payload.dims.models.map((m) => m.asin).filter((a): a is string => !!a))];
  const dates: string[] = [];
  for (let t = Date.parse(`${args.from}T00:00:00Z`); t <= Date.parse(`${args.to}T00:00:00Z`); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
  const out: AmazonHistory = { version: 1, fetchedOn: new Date().toISOString().slice(0, 10), from: args.from, listings: {} };
  for (const asin of asins) {
    const r = await fetchKeepaAsin(asin, key);
    if (!r.history) { console.log(`${asin}: ${r.error ?? "no history"}`); continue; }
    const d = dailySeries(r.history, dates);
    out.listings[asin] = {
      asin, title: r.title, dates, price: d.price, list: d.list, stock: d.stock, offers: d.offers, rating: d.rating, reviews: d.reviews,
      dealPrice: d.dealPrice, salesRank: d.salesRank, monthlySold: d.monthlySold,
      amazonBuyBox: d.buyBoxSeller.map((s) => (s == null ? null : s === AMAZON_RETAIL_SELLER ? 1 : 0)),
    };
    console.log(`${asin}: ${d.price.filter((v) => v != null).length} priced days`);
  }
  writeFileSync(args.out ?? `brand-data/${args.slug}.amazon-history.json`, JSON.stringify(out) + "\n");
}

const key = process.env.INS_KEEPA_KEY;
if (!key) throw new Error("INS_KEEPA_KEY is not set");
main(key).catch((e: unknown) => { console.error(e); process.exit(1); });
