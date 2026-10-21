import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import { brandDailyPer100, brandOf, dateRange, daysOf, mean, median, niceDate, pct, per100, possessive, productLabel, r1, r2, signed, usd, type Ctx } from "./common";

const BASE = { from: "2025-10-01", to: "2025-11-13" };
const BF = { from: "2025-11-21", to: "2025-12-01", day: "2025-11-28" };
const CHART = { from: "2025-10-01", to: "2025-12-31" };

type BfRow = { brand: string; brandId: string; label: string; base: number; low: number; change: number; unitBf: number | null; inStock: number | null; markdowns: number; sellers: number | null };

function bfRows(ctx: Ctx): BfRow[] {
  const rows: BfRow[] = [];
  for (const p of Object.values(ctx.feed.products)) {
    const b = brandOf(ctx, p);
    if (!b) continue;
    const base = median(daysOf(ctx, p, BASE.from, BASE.to).map((d) => d.price));
    const week = daysOf(ctx, p, BF.from, BF.to);
    const prices = week.map((d) => d.price).filter((v): v is number => v != null);
    if (base == null || !prices.length) continue;
    const low = Math.min(...prices);
    const stock = week.filter((d) => d.inStock != null);
    const offers = week.map((d) => d.offers).filter((v): v is number => v != null);
    rows.push({
      brand: b.label, brandId: b.id, label: productLabel(p), base: r2(base), low: r2(low), change: r1((low / base - 1) * 100),
      unitBf: per100(p, low), inStock: stock.length ? (stock.filter((d) => d.inStock).length / stock.length) * 100 : null,
      markdowns: week.filter((d) => d.was != null && d.price != null && d.was > d.price).length, sellers: offers.length ? offers[offers.length - 1] : null,
    });
  }
  return rows.sort((a, z) => (a.brandId === ctx.subject.id ? -1 : z.brandId === ctx.subject.id ? 1 : a.brand.localeCompare(z.brand)) || a.change - z.change);
}

/**
 * Black Friday 2025 at Walmart: each tracked item's lowest Black Friday week price against
 * its October to mid-November median, stock and seller count, rolled up per brand.
 */
export function blackFriday(ctx: Ctx): AtlasAnswer {
  const rows = bfRows(ctx);
  const S = ctx.subject;
  const byBrand = ctx.brands.map((b) => {
    const mine = rows.filter((r) => r.brandId === b.id);
    return { b, n: mine.length, change: mean(mine.map((r) => r.change)), cut: mine.filter((r) => r.change < -1).length, unit: median(mine.map((r) => r.unitBf)), stock: mean(mine.map((r) => r.inStock)) };
  }).filter((x) => x.n);
  const subj = byBrand.find((x) => x.b.id === S.id);
  const rivals = byBrand.filter((x) => x.b.id !== S.id);
  const rivalChange = mean(rows.filter((r) => r.brandId !== S.id).map((r) => r.change));
  const deepest = rows.filter((r) => r.brandId !== S.id).sort((a, z) => a.change - z.change)[0];
  const subjRows = rows.filter((r) => r.brandId === S.id);
  const raised = subjRows.filter((r) => r.change > 1).length;
  const dates = dateRange(CHART.from, CHART.to);
  const series = ctx.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.id === S.id, data: brandDailyPer100(ctx, b, dates) })).filter((s) => s.data.some((v) => v != null));
  const markdowns = rows.reduce((a, r) => a + r.markdowns, 0);
  const table = {
    type: "table" as const, title: "Every tracked item, Black Friday week vs its autumn price",
    sub: `Lowest price Nov 21 – Dec 1, 2025 against the median Oct 1 – Nov 13, 2025 · Walmart`,
    columns: [{ label: "Brand", align: "left" as const }, { label: "Item", align: "left" as const }, { label: "Autumn median" }, { label: "Black Friday low" }, { label: "Change" }, { label: "Per 100 wipes" }, { label: "In stock" }, { label: "Sellers" }],
    rows: rows.map((r): AtlasCell[] => [r.brand, r.label, usd(r.base), usd(r.low), signed(r.change), usd(r.unitBf), r.inStock == null ? "—" : pct(r.inStock, 0), r.sellers]),
    highlight: rows.map((r, i) => (r.brandId === S.id ? i : -1)).filter((i) => i >= 0),
  };
  const bars = {
    type: "hbars" as const, title: "Average Black Friday price move by brand", sub: "Mean change of each brand's items, lowest Black Friday price vs autumn median", unit: "signedPct" as const,
    rows: byBrand.map((x) => ({ label: x.b.label, value: r1(x.change ?? 0), color: x.b.color, subject: x.b.id === S.id, note: `${x.n} item${x.n === 1 ? "" : "s"} · ${x.cut} cut` })),
  };
  const line = {
    type: "line" as const, title: "Price per 100 wipes through the holiday season", sub: "Median across each brand's Walmart items, Oct – Dec 2025", unit: "usd" as const,
    x: dates, series, bands: [{ start: BF.from, end: BF.to, label: "Black Friday week" }],
  };
  return {
    id: "black-friday",
    question: `How did ${S.label} perform over Black Friday 2025?`,
    chip: "Black Friday 2025 performance",
    steps: [
      `Reading ${Object.values(ctx.feed.daily).flat().length.toLocaleString("en-US")} Walmart product-days from Histomart, Kompy and RetailerAPI`,
      `Isolating Black Friday week (Nov 21 – Dec 1, 2025) against the Oct 1 – Nov 13 baseline`,
      `Comparing ${rows.length} items across ${byBrand.length} brands on price, crossed-out markdowns, stock and sellers`,
      "Ranking the price moves and checking which brands cut",
    ],
    headline: `${S.label} did not discount for Black Friday 2025 at Walmart: its items moved ${signed(subj?.change ?? null)} on average (${raised} of ${subjRows.length} went up), while the rest of the set moved ${signed(rivalChange)}. It held price and stayed ${pct(subj?.stock ?? null, 0)} in stock${(rivalChange ?? 0) >= 0 ? "; nobody in the set ran a broad Black Friday cut at Walmart" : ", while competitors cut"}.`,
    what: `${S.label} held or raised price on every item through Black Friday week. ${deepest && deepest.change < 0 ? `The deepest cut in the set was ${deepest.brand} ${deepest.label} at ${signed(deepest.change)}${deepest.inStock != null && deepest.inStock < 50 ? `, while it was out of stock most of the week (${pct(deepest.inStock, 0)} in stock)` : ""}.` : ""} No tracked item showed a crossed-out Walmart markdown during the week (${markdowns} markdown readings).`,
    why: `There was no deal to follow: no ${S.label} item showed a crossed-out Walmart markdown, and its median item had ${median(subjRows.map((r) => r.sellers)) ?? "—"} seller${median(subjRows.map((r) => r.sellers)) === 1 ? "" : "s"}, so no reseller undercut the shelf. Without brand-funded promotion the shelf price simply followed Walmart's own pricing, which drifted up into the holidays.`,
    when: `Black Friday was ${niceDate(BF.day)}. Prices were read from Nov 21 to Dec 1, 2025 against Oct 1 – Nov 13. The holiday chart runs to Dec 31, 2025.`,
    kpis: [
      { label: `${S.label} price move`, value: signed(subj?.change ?? null), note: "Black Friday low vs autumn median", tone: (subj?.change ?? 0) > 0 ? "watch" : "good" },
      { label: "Rest of the set", value: signed(rivalChange), note: `${rivals.length} competitors` },
      { label: `${S.label} in stock`, value: pct(subj?.stock ?? null, 0), note: "Black Friday week readings", tone: (subj?.stock ?? 0) >= 95 ? "good" : "risk" },
      { label: "Per 100 wipes", value: usd(subj?.unit ?? null), note: `${S.label} median on Black Friday` },
    ],
    blocks: [bars, table],
    report: {
      title: `${S.label} · Black Friday 2025 at Walmart`,
      summary: `Black Friday 2025 was a hold-price event for ${S.label}: its items stayed at or above their autumn price while staying in stock, with no crossed-out markdowns. Competitors moved ${signed(rivalChange)} on average, with ${rows.filter((r) => r.brandId !== S.id && r.change < -1).length} of ${rows.filter((r) => r.brandId !== S.id).length} competitor items cut and ${rows.filter((r) => r.brandId !== S.id && r.change > 1).length} raised.`,
      sections: [
        { title: "The brand view", text: `Average move per brand between the autumn median and the lowest Black Friday week price. A negative bar is a brand that cut.`, blocks: [bars] },
        { title: "Through the season", text: `Median price per 100 wipes per brand, carried forward up to 21 days between readings. The shaded band is Black Friday week.`, blocks: [line] },
        { title: "Item by item", text: `Every tracked Walmart item with readings in both windows. ${S.label} rows are highlighted.`, blocks: [table] },
      ],
      method: [
        "Source: Walmart readings from Histomart, Kompy and RetailerAPI, cleaned and merged per item per day (latest reading wins).",
        "Autumn price is the median of Oct 1 – Nov 13, 2025; Black Friday price is the lowest reading Nov 21 – Dec 1, 2025.",
        "A markdown is a day where Walmart showed a crossed-out price above the selling price.",
        "Price per 100 wipes uses the item's own count read from its Walmart title.",
      ],
    },
  };
}

const WINDOW = { from: "2026-07-20", to: "2026-10-18" };
const YEAR = { from: "2025-10-19", to: "2026-10-18" };

/**
 * Price per 100 wipes at Walmart over the dashboard window: each item's median, each
 * brand's cheapest and median item, and the monthly trend over the last twelve months.
 */
export function pricePerWipe(ctx: Ctx): AtlasAnswer {
  const S = ctx.subject;
  const items = Object.values(ctx.feed.products).flatMap((p) => {
    const b = brandOf(ctx, p);
    const m = median(daysOf(ctx, p, WINDOW.from, WINDOW.to).map((d) => per100(p, d.price)));
    return b && m != null ? [{ b, p, unit: r2(m), price: median(daysOf(ctx, p, WINDOW.from, WINDOW.to).map((d) => d.price)) }] : [];
  }).sort((a, z) => a.unit - z.unit);
  const byBrand = ctx.brands.map((b) => {
    const mine = items.filter((x) => x.b.id === b.id);
    return { b, n: mine.length, med: median(mine.map((x) => x.unit)), min: mine.length ? mine[0] : null };
  }).filter((x) => x.n).sort((a, z) => (a.med ?? 0) - (z.med ?? 0));
  const rank = byBrand.findIndex((x) => x.b.id === S.id) + 1;
  const subj = byBrand.find((x) => x.b.id === S.id);
  const cheapest = byBrand[0];
  const months = dateRange(YEAR.from, YEAR.to).filter((d) => d.endsWith("-15"));
  const trend = ctx.brands.map((b) => {
    const daily = brandDailyPer100(ctx, b, dateRange(YEAR.from, YEAR.to));
    const dates = dateRange(YEAR.from, YEAR.to);
    return { id: b.id, label: b.label, color: b.color, subject: b.id === S.id, data: months.map((m) => { const mm = m.slice(0, 7); const v = median(daily.filter((_, i) => dates[i].startsWith(mm))); return v == null ? null : r2(v); }) };
  }).filter((s) => s.data.some((v) => v != null));
  const premium = subj?.med != null && cheapest.med != null ? ((subj.med / cheapest.med) - 1) * 100 : null;
  const bars = {
    type: "hbars" as const, title: "Median price per 100 wipes by brand", sub: `Walmart, ${niceDate(WINDOW.from)} – ${niceDate(WINDOW.to)}`, unit: "usd" as const,
    rows: byBrand.map((x) => ({ label: x.b.label, value: x.med ?? 0, color: x.b.color, subject: x.b.id === S.id, note: `${x.n} item${x.n === 1 ? "" : "s"}` })),
  };
  const table = {
    type: "table" as const, title: "Every Walmart item, cheapest per wipe first", sub: "Median over the 13-week window",
    columns: [{ label: "Brand", align: "left" as const }, { label: "Item", align: "left" as const }, { label: "Shelf price" }, { label: "Per 100 wipes" }],
    rows: items.map((x): AtlasCell[] => [x.b.label, productLabel(x.p), usd(x.price), usd(x.unit)]),
    highlight: items.map((x, i) => (x.b.id === S.id ? i : -1)).filter((i) => i >= 0),
  };
  const line = { type: "line" as const, title: "Twelve months of price per 100 wipes", sub: "Monthly median of each brand's Walmart items", unit: "usd" as const, x: months, series: trend };
  return {
    id: "price-per-wipe",
    question: `Is ${S.label} the premium or the value choice per wipe?`,
    chip: "Price per wipe vs competitors",
    steps: [
      `Restating ${items.length} Walmart items to price per 100 wipes from their own pack counts`,
      `Taking each item's median over ${niceDate(WINDOW.from)} – ${niceDate(WINDOW.to)}`,
      `Ranking ${byBrand.length} brands and tracing twelve months of the same measure`,
    ],
    headline: `${S.label} is the ${rank === byBrand.length ? "most expensive" : rank === 1 ? "cheapest" : rank > byBrand.length / 2 ? `${["", "", "second", "third"][byBrand.length - rank + 1] ?? `#${byBrand.length - rank + 1}`} most expensive` : `${["", "", "second", "third"][rank] ?? `#${rank}`} cheapest`} of ${byBrand.length} brands per wipe at Walmart: ${usd(subj?.med ?? null)} per 100 wipes on its median item, ${premium != null ? `${r1(premium)}% above` : "against"} ${cheapest.b.label} at ${usd(cheapest.med)}. ${rank > byBrand.length / 2 ? "It is priced as a premium wipe, not the value one." : "It competes as a value wipe."}`,
    what: `Median price per 100 wipes: ${byBrand.map((x) => `${x.b.label} ${usd(x.med)}`).join(", ")}. The cheapest single item is ${items[0].b.label} ${productLabel(items[0].p)} at ${usd(items[0].unit)}.`,
    why: (() => { const own = items.filter((x) => x.b.id === S.id).sort((x, z) => (x.p.units ?? 0) - (z.p.units ?? 0)); const small = own[0], big = own[own.length - 1];
      return small && big && small !== big ? `Pack size drives it: ${S.label} sells ${own.map((x) => x.p.units).join(", ")}-count packs, and its smallest (${small.p.units} ct) costs ${usd(small.unit)} per 100 wipes against ${usd(big.unit)} for its largest (${big.p.units} ct). ${cheapest.b.label}'s median item is ${usd(cheapest.med)}.` : `${S.label} has one item at Walmart, so its price per wipe is that pack's.`; })(),
    when: `${niceDate(WINDOW.from)} to ${niceDate(WINDOW.to)} for the ranking; the trend covers ${niceDate(YEAR.from)} to ${niceDate(YEAR.to)}.`,
    kpis: [
      { label: `${S.label} per 100 wipes`, value: usd(subj?.med ?? null), note: "median item", tone: "neutral" },
      { label: "Rank (cheapest first)", value: `#${rank} of ${byBrand.length}` },
      { label: `Premium vs ${cheapest.b.label}`, value: premium == null ? "—" : `${r1(premium)}%`, tone: (premium ?? 0) > 50 ? "watch" : "neutral" },
      { label: `Cheapest ${S.label} item`, value: usd(subj?.min?.unit ?? null), note: subj?.min ? productLabel(subj.min.p) : undefined },
    ],
    blocks: [bars, table],
    report: {
      title: `${S.label} · Price per wipe at Walmart`,
      summary: `Per wipe, ${S.label} is ranked #${rank} of ${byBrand.length} (cheapest first) at Walmart. The gap is structural: pack sizes and XL sheets, not discounting.`,
      sections: [
        { title: "Where each brand sits", text: "Median of each brand's items over the dashboard window.", blocks: [bars] },
        { title: "The last twelve months", text: "Monthly median of the same measure. A flat line is a brand that holds price.", blocks: [line] },
        { title: "Every item", text: `All Walmart items with readings in the window. ${S.label} rows are highlighted.`, blocks: [table] },
      ],
      method: [
        "Source: Walmart readings from Histomart, Kompy and RetailerAPI.",
        "Price per 100 wipes = shelf price ÷ the item's wipe count × 100, using the count read from its Walmart title.",
        "Brand figures are the median of its items, so one odd pack does not move the brand.",
      ],
    },
  };
}
