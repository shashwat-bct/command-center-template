import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import { amazonListings, between, ordinalRank, brandOf, daysOf, fmtRank, fmtSold, median, niceDate, per100, possessive, productLabel, r1, r2, usd, type Ctx } from "./common";

const WINDOW = { from: "2026-07-20", to: "2026-10-18" };

type Item = { brandId: string; brand: string; color: string; retailer: "Amazon" | "Walmart"; label: string; units: number; price: number; unit: number; rank: number | null; sold: number | null };

function items(ctx: Ctx): Item[] {
  const amz = amazonListings(ctx).flatMap(({ brand, label, units, h }) => {
    const price = median(between(h, h.price, WINDOW.from, WINDOW.to));
    return units && price != null ? [{ brandId: brand.id, brand: brand.label, color: brand.color, retailer: "Amazon" as const, label, units, price: r2(price), unit: r2((price / units) * 100),
      rank: median(between(h, h.salesRank, WINDOW.from, WINDOW.to)), sold: Math.max(0, ...between(h, h.monthlySold, WINDOW.from, WINDOW.to)) || null }] : [];
  });
  const wm = Object.values(ctx.feed.products).flatMap((p) => {
    const b = brandOf(ctx, p);
    const days = daysOf(ctx, p, WINDOW.from, WINDOW.to);
    const price = median(days.map((d) => d.price));
    return b && p.units && price != null ? [{ brandId: b.id, brand: b.label, color: b.color, retailer: "Walmart" as const, label: productLabel(p), units: p.units, price: r2(price), unit: r2(per100(p, price)!), rank: null, sold: null }] : [];
  });
  return [...amz, ...wm].sort((a, z) => a.unit - z.unit);
}

/**
 * Price per 100 wipes on Amazon and Walmart over the window: where the subject sits by
 * retailer and pack, its premium over the cheapest brand, cross-retailer gaps on the same
 * pack, and how the best sellers are priced.
 */
export function pricePerWipe(ctx: Ctx): AtlasAnswer {
  const S = ctx.subject;
  const all = items(ctx);
  const brandMed = (id: string, rt?: string) => median(all.filter((x) => x.brandId === id && (!rt || x.retailer === rt)).map((x) => x.unit));
  const ranked = ctx.brands.map((b) => ({ b, v: brandMed(b.id) })).filter((x) => x.v != null).sort((a, z) => a.v! - z.v!);
  const rank = ranked.findIndex((x) => x.b.id === S.id) + 1;
  const cheapest = ranked[0];
  const subj = ranked.find((x) => x.b.id === S.id)!;
  const premium = cheapest.b.id === S.id ? 0 : (subj.v! / cheapest.v! - 1) * 100;
  const own = all.filter((x) => x.brandId === S.id);
  const gaps = own.filter((x) => x.retailer === "Amazon").flatMap((a) => { const w = own.find((x) => x.retailer === "Walmart" && x.units === a.units && x.label.split(" ")[0] === a.label.split(" ")[0]) ?? own.find((x) => x.retailer === "Walmart" && x.units === a.units);
    return w ? [{ a, w, gap: r1((a.unit / w.unit - 1) * 100) }] : []; }).sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));
  const small = own.slice().sort((a, z) => a.units - z.units)[0], big = own.slice().sort((a, z) => z.units - a.units)[0];
  const best = all.filter((x) => x.retailer === "Amazon" && x.rank).sort((a, z) => a.rank! - z.rank!).slice(0, 6);
  const bars = { type: "hbars" as const, title: "Median price per 100 wipes by brand and retailer", sub: `${niceDate(WINDOW.from)} – ${niceDate(WINDOW.to)}`, unit: "usd" as const,
    rows: ctx.brands.flatMap((b) => (["Amazon", "Walmart"] as const).flatMap((rt) => { const v = brandMed(b.id, rt); return v == null ? [] : [{ label: `${b.label} · ${rt}`, value: r2(v), color: b.color, subject: b.id === S.id, note: `${all.filter((x) => x.brandId === b.id && x.retailer === rt).length} listings` }]; })) };
  const ladder = { type: "hbars" as const, title: `${possessive(S.label)} price ladder per 100 wipes`, sub: "Every pack on both retailers, cheapest per wipe first", unit: "usd" as const,
    rows: own.map((x) => ({ label: `${x.label} · ${x.retailer}`, value: x.unit, color: x.retailer === "Amazon" ? "#ff9900" : "#0071dc", subject: true, note: `${usd(x.price)} for ${x.units}` })) };
  const table = { type: "table" as const, title: "Every listing, cheapest per wipe first", sub: "Median over the window; sales rank and bought-per-month on Amazon",
    columns: [{ label: "Brand", align: "left" as const }, { label: "Retailer", align: "left" as const }, { label: "Listing", align: "left" as const }, { label: "Wipes" }, { label: "Shelf price" }, { label: "Per 100 wipes" }, { label: "Sales rank" }, { label: "Bought / month" }],
    rows: all.map((x): AtlasCell[] => [x.brand, x.retailer, x.label, x.units, usd(x.price), usd(x.unit), fmtRank(x.rank), fmtSold(x.sold)]),
    highlight: all.map((x, i) => (x.brandId === S.id ? i : -1)).filter((i) => i >= 0) };
  const topGap = gaps[0];
  return {
    id: "price-per-wipe",
    question: `Is ${S.label} priced as the premium or the value wipe once you normalise to price per 100 wipes, how does that change by retailer and pack size, and where is the same ${S.label} pack priced differently on Amazon and Walmart in a way a comparison shopper would notice?`,
    chip: "Per-wipe pricing · packs × retailers",
    steps: [
      `Restating ${all.length} Amazon and Walmart listings to price per 100 wipes from their own pack counts`,
      `Taking each listing's median over ${niceDate(WINDOW.from)} – ${niceDate(WINDOW.to)}`,
      `Ranking ${ranked.length} brands on each retailer and building ${possessive(S.label)} pack ladder`,
      "Pairing the same pack across Amazon and Walmart to find cross-retailer gaps",
      "Reading Amazon sales rank against price to see what the best sellers charge",
    ],
    headline: `${S.label} is the ${ordinalRank(rank, ranked.length)} of ${ranked.length} brands per wipe at ${usd(subj.v)} per 100 wipes, ${r1(premium)}% above ${cheapest.b.label} (${usd(cheapest.v)}). Its own ladder runs from ${usd(big.unit)} (${big.label}, ${big.retailer}) to ${usd(small.unit)} (${small.label}, ${small.retailer}).`,
    what: `Per 100 wipes on Amazon: ${ctx.brands.map((b) => `${b.label} ${usd(brandMed(b.id, "Amazon"))}`).join(", ")}. On Walmart: ${ctx.brands.map((b) => `${b.label} ${usd(brandMed(b.id, "Walmart"))}`).join(", ")}.`,
    why: `The premium is structural: XL sheets in packs of ${[...new Set(own.map((x) => x.units))].sort((a, z) => a - z).join(", ")}, against competitors' bulk packs. ${topGap && Math.abs(topGap.gap) >= 3 ? `The biggest cross-retailer gap is ${topGap.a.label}: ${usd(topGap.a.price)} on Amazon vs ${usd(topGap.w.price)} on Walmart (${topGap.gap > 0 ? "+" : ""}${topGap.gap}%).` : gaps.length ? `Packs sold on both retailers are priced within 3% of each other, so the premium is the same wherever the shopper looks.` : ""}`,
    when: `${niceDate(WINDOW.from)} – ${niceDate(WINDOW.to)} (13 weeks).`,
    insight: `Shoppers pay a ${r1(premium)}% per-wipe premium for ${S.label} and still make its ${best.find((x) => x.brandId === S.id)?.label ?? "lead pack"} one of the category's best sellers on Amazon (${fmtRank(best.find((x) => x.brandId === S.id)?.rank ?? null)}), so the brand has pricing power. The risk is the per-wipe price on small packs, which is what a value shopper compares.`,
    actions: [
      { title: `Lead with the ${big.units}-count pack in value messaging`, detail: `At ${usd(big.unit)} per 100 wipes it is ${r1((small.unit / big.unit - 1) * 100)}% cheaper per wipe than the ${small.units}-count.`, impact: `Narrows the per-wipe gap to ${cheapest.b.label} without a price cut` },
      ...(topGap && Math.abs(topGap.gap) >= 5 ? [{ title: `Align ${topGap.a.label} across Amazon and Walmart`, detail: `It is ${usd(topGap.a.price)} on Amazon and ${usd(topGap.w.price)} on Walmart.`, impact: `A ${Math.abs(topGap.gap)}% gap a comparison shopper sees` }] : []),
      { title: "Keep the premium where rank holds", detail: `${possessive(S.label)} best-ranked Amazon listing sells at ${usd(best.find((x) => x.brandId === S.id)?.unit ?? null)} per 100 wipes and still ranks ${fmtRank(best.find((x) => x.brandId === S.id)?.rank ?? null)}.`, impact: "Margin the brand is not giving away" },
    ],
    kpis: [
      { label: "Per 100 wipes", value: usd(subj.v), note: `${ordinalRank(rank, ranked.length)} of ${ranked.length}` },
      { label: `Premium vs ${cheapest.b.label}`, value: `${r1(premium)}%`, tone: premium > 50 ? "watch" : "neutral" },
      { label: "Own ladder", value: `${usd(big.unit)}–${usd(small.unit)}`, note: `${big.units} ct → ${small.units} ct` },
      { label: "Largest Amazon–Walmart gap", value: topGap ? `${topGap.gap > 0 ? "+" : ""}${topGap.gap}%` : "—", note: topGap?.a.label, tone: topGap && Math.abs(topGap.gap) >= 10 ? "risk" : "neutral" },
    ],
    blocks: [bars, ladder, table],
    link: { page: "pricing", label: "Pricing" },
  };
}
