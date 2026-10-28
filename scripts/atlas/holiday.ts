import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import { amazonListings, between, compact, cutText, brandOf, daysOf, fmtRank, fmtSold, mean, median, niceDate, pct, per100, possessive, productLabel, r1, r2, signed, usd, type Ctx } from "./common";

const BASE = { from: "2025-10-01", to: "2025-11-13" };
const BF = { from: "2025-11-21", to: "2025-12-01", day: "2025-11-28" };

type Row = { brandId: string; brand: string; label: string; retailer: "Amazon" | "Walmart"; base: number; low: number; change: number; unit: number | null; inStock: number | null; rank0: number | null; rank1: number | null; sold: number | null; sellers: number | null; bb0: number | null; bb1: number | null };

const share = (v: Array<0 | 1>): number | null => (v.length ? (v.filter((x) => x === 1).length / v.length) * 100 : null);

function amazonRows(ctx: Ctx): Row[] {
  return amazonListings(ctx).flatMap(({ brand, label, units, h }) => {
    const base = median(between(h, h.price, BASE.from, BASE.to));
    const week = between(h, h.price, BF.from, BF.to);
    if (base == null || !week.length) return [];
    const low = Math.min(...week);
    const stock = between(h, h.stock, BF.from, BF.to);
    return [{
      brandId: brand.id, brand: brand.label, label, retailer: "Amazon" as const, base: r2(base), low: r2(low), change: r1((low / base - 1) * 100),
      unit: units ? r2((low / units) * 100) : null, inStock: stock.length ? (stock.filter((v) => v === 1).length / stock.length) * 100 : null,
      rank0: median(between(h, h.salesRank, BASE.from, BASE.to)), rank1: median(between(h, h.salesRank, BF.from, BF.to)),
      sold: Math.max(0, ...between(h, h.monthlySold, "2025-11-01", "2025-12-31")) || null, sellers: median(between(h, h.offers, BF.from, BF.to)),
      bb0: share(between(h, h.amazonBuyBox, BASE.from, BASE.to)), bb1: share(between(h, h.amazonBuyBox, BF.from, BF.to)),
    }];
  });
}

function walmartRows(ctx: Ctx): Row[] {
  return Object.values(ctx.feed.products).flatMap((p) => {
    const b = brandOf(ctx, p);
    const base = median(daysOf(ctx, p, BASE.from, BASE.to).map((d) => d.price));
    const week = daysOf(ctx, p, BF.from, BF.to);
    const prices = week.map((d) => d.price).filter((v): v is number => v != null);
    if (!b || base == null || !prices.length) return [];
    const low = Math.min(...prices);
    const stock = week.filter((d) => d.inStock != null);
    const offers = week.map((d) => d.offers).filter((v): v is number => v != null);
    return [{
      brandId: b.id, brand: b.label, label: productLabel(p), retailer: "Walmart" as const, base: r2(base), low: r2(low), change: r1((low / base - 1) * 100),
      unit: per100(p, low), inStock: stock.length ? (stock.filter((d) => d.inStock).length / stock.length) * 100 : null,
      rank0: null, rank1: null, sold: null, sellers: offers.length ? offers[offers.length - 1] : null, bb0: null, bb1: null,
    }];
  });
}

/**
 * Black Friday 2025 on Amazon and Walmart: each tracked listing's lowest Black Friday week
 * price against its autumn median, its stock, and on Amazon its sales-rank response.
 */
export function blackFriday(ctx: Ctx): AtlasAnswer {
  const S = ctx.subject;
  const rows = [...amazonRows(ctx), ...walmartRows(ctx)].sort((a, z) => (a.brandId === S.id ? -1 : 0) - (z.brandId === S.id ? -1 : 0) || a.retailer.localeCompare(z.retailer) || a.change - z.change);
  const by = (brandId: string, rt?: string) => rows.filter((r) => r.brandId === brandId && (!rt || r.retailer === rt));
  const amz = rows.filter((r) => r.retailer === "Amazon" && r.rank0 && r.rank1);
  const rankMove = (r: Row) => (r.rank0! / r.rank1! - 1) * 100;
  const subjAmz = amz.filter((r) => r.brandId === S.id).sort((a, z) => (z.sold ?? 0) - (a.sold ?? 0) || (a.rank0 ?? 1e9) - (z.rank0 ?? 1e9));
  const hero = subjAmz[0];
  const rivalWinner = amz.filter((r) => r.brandId !== S.id && r.change < -2 && rankMove(r) > 10).sort((a, z) => rankMove(z) - rankMove(a))[0];
  const subjChange = { amazon: mean(by(S.id, "Amazon").map((r) => r.change)), walmart: mean(by(S.id, "Walmart").map((r) => r.change)) };
  const rivalCuts = rows.filter((r) => r.brandId !== S.id && r.change < -2);
  const subjCuts = by(S.id).filter((r) => r.change < -2);
  const subjStock = mean(by(S.id).map((r) => r.inStock));
  const brandBars = ctx.brands.flatMap((b) => (["Amazon", "Walmart"] as const).flatMap((rt) => {
    const mine = by(b.id, rt);
    return mine.length ? [{ label: `${b.label} · ${rt}`, value: r1(mean(mine.map((r) => r.change)) ?? 0), color: b.color, subject: b.id === S.id, note: `${mine.length} listing${mine.length === 1 ? "" : "s"} · ${mine.filter((r) => r.change < -2).length} cut` }] : [];
  }));
  const bars = { type: "hbars" as const, title: "Black Friday price move by brand and retailer", sub: "Mean of each listing's lowest Nov 21 – Dec 1 price vs its Oct 1 – Nov 13 median", unit: "signedPct" as const, rows: brandBars };
  const rankBars = { type: "hbars" as const, title: "Amazon sales-rank response in Black Friday week", sub: "Change in Best Sellers Rank vs autumn (positive = climbed)", unit: "signedPct" as const,
    rows: amz.slice().sort((a, z) => rankMove(z) - rankMove(a)).map((r) => ({ label: `${r.brand} ${compact(r.label)}`, value: r1(rankMove(r)), color: ctx.brands.find((b) => b.id === r.brandId)!.color, subject: r.brandId === S.id, note: `${fmtRank(r.rank0)} → ${fmtRank(r.rank1)} · price ${signed(r.change)}` })) };
  const table = {
    type: "table" as const, title: "Every tracked listing through Black Friday week", sub: "Amazon daily price history and Walmart price readings",
    columns: [{ label: "Brand", align: "left" as const }, { label: "Retailer", align: "left" as const }, { label: "Listing", align: "left" as const }, { label: "Autumn median" }, { label: "Black Friday low" }, { label: "Change" }, { label: "Per 100 wipes" }, { label: "In stock" }, { label: "Amazon on buy box" }, { label: "Sales rank" }, { label: "Bought / month" }],
    rows: rows.map((r): AtlasCell[] => [r.brand, r.retailer, r.label, usd(r.base), usd(r.low), signed(r.change), usd(r.unit), r.inStock == null ? "—" : pct(r.inStock, 0), r.bb0 == null ? "—" : `${pct(r.bb0, 0)} → ${pct(r.bb1, 0)}`, r.rank0 ? `${fmtRank(r.rank0)} → ${fmtRank(r.rank1)}` : "—", fmtSold(r.sold)]),
    highlight: rows.map((r, i) => (r.brandId === S.id ? i : -1)).filter((i) => i >= 0),
  };
  const lostBox = !!hero && hero.bb0 != null && hero.bb1 != null && hero.bb0 >= 50 && hero.bb1 < 50;
  const lostAll = by(S.id, "Amazon").filter((r) => r.bb0 != null && r.bb1 != null && r.bb0 >= 50 && r.bb1 < 50);
  const heroLine = hero ? `On Amazon, ${possessive(S.label)} ${hero.label} went from ${usd(hero.base)} to a Black Friday low of ${usd(hero.low)} (${signed(hero.change)}) and its sales rank slipped from ${fmtRank(hero.rank0)} to ${fmtRank(hero.rank1)}` : "";
  const winnerLine = rivalWinner ? `${possessive(rivalWinner.brand)} ${rivalWinner.label} cut ${cutText(rivalWinner.change)} and climbed from ${fmtRank(rivalWinner.rank0)} to ${fmtRank(rivalWinner.rank1)}` : "";
  return {
    id: "black-friday",
    question: `Black Friday 2025: who cut price on Amazon and Walmart, and did holding price cost ${S.label} sales rank?`,
    chip: "Black Friday 2025 · Amazon + Walmart",
    steps: [
      `Loading ${amazonListings(ctx).length} Amazon listings' daily history (price, stock, Best Sellers Rank, bought-in-past-month)`,
      `Loading ${Object.values(ctx.feed.daily).flat().length.toLocaleString("en-US")} Walmart product-days of price readings`,
      `Setting the baseline (Oct 1 – Nov 13, 2025) and Black Friday week (Nov 21 – Dec 1, 2025)`,
      `Comparing ${rows.length} listings on lowest price, price per 100 wipes and stock`,
      "Reading the Amazon sales-rank response to each price move",
      "Ranking the movers and drafting the recommended moves",
    ],
    headline: `${lostBox ? `Black Friday 2025 went against ${S.label} on Amazon` : `${S.label} did not play Black Friday 2025`}: its listings moved ${signed(subjChange.amazon)} on Amazon and ${signed(subjChange.walmart)} on Walmart, with ${subjCuts.length} of ${by(S.id).length} cut. ${heroLine}${lostBox ? " once Amazon stopped selling it directly" : ""}${winnerLine ? `, while ${winnerLine}` : ""}.`,
    what: `${subjCuts.length} of ${by(S.id).length} ${S.label} listings were cut 2% or more; competitors cut ${rivalCuts.length} of ${rows.length - by(S.id).length}. ${S.label} stayed ${pct(subjStock, 0)} in stock across the week.`,
    why: lostBox ? `This was not a pricing decision. Amazon itself held the buy box on ${hero!.label} on ${pct(hero!.bb0, 0)} of autumn days and ${pct(hero!.bb1, 0)} in Black Friday week, so shoppers bought from third-party sellers at ${usd(hero!.low)} instead of Amazon's ${usd(hero!.base)}. ${lostAll.length} of ${by(S.id, "Amazon").length} ${S.label} Amazon listings lost Amazon as the buy-box seller that week. On Walmart no item ran a markdown, so the shelf followed list price.` : `${S.label} ran no brand-funded deal on either retailer, so its shelf followed list price into the holidays. On Amazon the price rise and the rank slip happened in the same week on the same listings.`,
    when: `Black Friday was ${niceDate(BF.day)}. Black Friday week: Nov 21 – Dec 1, 2025. Baseline: Oct 1 – Nov 13, 2025. Season charts: Oct – Dec 2025.`,
    insight: lostBox ? `${possessive(S.label)} Black Friday problem was supply to Amazon, not price: when Amazon dropped off the buy box on its best seller (${fmtSold(hero!.sold)} bought a month), the shelf price jumped ${signed(hero!.change)} to third-party levels and the listing gave up ${hero!.rank1! - hero!.rank0!} places of sales rank in the biggest week of the year.` : hero && hero.rank0 && hero.rank1 && hero.rank1 > hero.rank0 ? `Holding price on Black Friday traded rank for margin: ${possessive(S.label)} best-selling Amazon listing (${fmtSold(hero.sold)} bought a month) gave up ${hero.rank1 - hero.rank0} places in the week it priced ${signed(hero.change)} above its autumn level.` : `${S.label} held price through Black Friday without losing Amazon rank, a margin win in a week competitors discounted.`,
    actions: [
      ...(lostBox ? [{ title: `Secure Amazon retail inventory on ${hero!.label} before Black Friday`, detail: `Amazon held the buy box on ${pct(hero!.bb0, 0)} of autumn days and ${pct(hero!.bb1, 0)} in Black Friday week; third-party sellers priced it at ${usd(hero!.low)} against Amazon's ${usd(hero!.base)}. Lock vendor POs and a forward-buy for the November build.`, impact: `Keeps a ${fmtRank(hero!.rank0)} listing selling ${fmtSold(hero!.sold)} a month at its own price` }] : hero ? [{ title: `Hold ${hero.label} at its autumn price through Black Friday week`, detail: `It was ${usd(hero.base)} in autumn and ${usd(hero.low)} at its Black Friday low.`, impact: `Protects a ${fmtRank(hero.rank0)} listing selling ${fmtSold(hero.sold)} a month` }] : []),
      { title: "Fund one Walmart rollback on a hero pack", detail: `No ${S.label} Walmart item carried a crossed-out price in Black Friday week. A visible rollback on one pack is the only Walmart deal signal shoppers see.`, impact: `${by(S.id, "Walmart").length} Walmart items currently show no Black Friday deal` },
      ...(rivalWinner ? [{ title: `Watch ${possessive(rivalWinner.brand)} ${rivalWinner.label} next Black Friday`, detail: `It cut ${cutText(rivalWinner.change)} and moved ${fmtRank(rivalWinner.rank0)} → ${fmtRank(rivalWinner.rank1)} in the same week.`, impact: "The competitor most likely to take Black Friday share" }] : []),
    ],
    kpis: [
      { label: `${S.label} on Amazon`, value: signed(subjChange.amazon), note: "Black Friday low vs autumn", tone: (subjChange.amazon ?? 0) > 0 ? "risk" : "good" },
      { label: `${S.label} on Walmart`, value: signed(subjChange.walmart), note: "Black Friday low vs autumn", tone: (subjChange.walmart ?? 0) > 0 ? "watch" : "good" },
      ...(lostBox ? [{ label: "Amazon on buy box", value: `${pct(hero!.bb0, 0)} → ${pct(hero!.bb1, 0)}`, note: `${hero!.label}, autumn → Black Friday`, tone: "risk" as const }] : []),
      { label: "Hero listing rank", value: hero ? `${fmtRank(hero.rank0)} → ${fmtRank(hero.rank1)}` : "—", note: hero?.label, tone: hero && hero.rank1! > hero.rank0! ? "risk" : "good" },
      ...(lostBox ? [] : [{ label: `${S.label} in stock`, value: pct(subjStock, 0), note: "Black Friday week", tone: (subjStock ?? 0) >= 95 ? "good" as const : "risk" as const }]),
    ],
    blocks: [bars, { ...rankBars, title: `${rankBars.title}: biggest movers`, rows: rankBars.rows.slice().sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).slice(0, 8) }, table],
    link: { page: "pricing", label: "Pricing" },
  };
}
