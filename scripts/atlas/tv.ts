import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import type { FeedProduct } from "../../lib/retail-feed";
import { amazonListings, between, daysOf, fmtRank, fmtSold, mean, median, niceDate, pct, possessive, r1, r2, shortLabel, signed, usd, type Ctx, type PayloadBrand, type PayloadModel } from "./common";
import { reviews } from "./voice-ai";

const BASE = { from: "2025-10-01", to: "2025-11-13" };
const BF = { from: "2025-11-21", to: "2025-12-01", day: "2025-11-28" };
const RETAILER: Record<string, string> = { amazon: "Amazon", walmart: "Walmart", bestbuy: "Best Buy", target: "Target", newegg: "Newegg", crutchfield: "Crutchfield" };
const MAIN = ["amazon", "walmart", "bestbuy", "target"];
const OUTLIER = 0.35;
const NOT_NEW = /open box|refurb|renewed|pre-owned/i;
const NEGATIVE = /\bnot\b|poor|bad|horrible|broke|junk|worse|going dark|don'?t|never|return|issue|problem|crackl|tinny|glare|hard to see|fail/i;

/**
 * The model name inside a TV listing title ("BRAVIA 8 II", "S90F", "U6 Pro").
 */
export function tvName(label: string): string {
  const m = /BRAVIA \d+(?: II)?/i.exec(label) ?? /\b([A-Z]{1,5}\d{1,4}[A-Z]{0,3})(\s+Pro)?\b/.exec(label);
  return m ? m[0] : label;
}

type Listing = { brand: PayloadBrand; model: PayloadModel; name: string };

function listingOf(ctx: Ctx, asin: string | null): Listing | null {
  const model = asin ? ctx.payload.dims.models.find((m) => m.asin === asin) : undefined;
  const brand = model ? ctx.brands.find((b) => b.id === model.brand) : undefined;
  return model && brand ? { brand, model, name: tvName(model.label) } : null;
}

const retailProducts = (ctx: Ctx, retailers: string[]): Array<{ p: FeedProduct; l: Listing }> =>
  Object.values(ctx.feed.products).flatMap((p) => {
    const l = listingOf(ctx, p.asin);
    return l && retailers.includes(p.retailer) && !NOT_NEW.test(p.title) ? [{ p, l }] : [];
  });

const offMsrp = (price: number | null, msrp: number | null | undefined): number | null => (price != null && msrp ? (1 - price / msrp) * 100 : null);

type BfRow = { l: Listing; rt: string; base: number; low: number; change: number; off: number | null; rank0: number | null; rank1: number | null; sold: number | null };

function bfRows(ctx: Ctx): BfRow[] {
  const amz = amazonListings(ctx).flatMap(({ brand, model, h }): BfRow[] => {
    const base = median(between(h, h.price, BASE.from, BASE.to)), week = between(h, h.price, BF.from, BF.to);
    if (base == null || !week.length) return [];
    const low = Math.min(...week);
    return [{ l: { brand, model, name: tvName(model.label) }, rt: "amazon", base: r2(base), low: r2(low), change: r1((low / base - 1) * 100), off: offMsrp(low, model.msrp),
      rank0: median(between(h, h.salesRank, BASE.from, BASE.to)), rank1: median(between(h, h.salesRank, BF.from, BF.to)), sold: Math.max(0, ...between(h, h.monthlySold, "2025-11-01", "2025-12-31")) || null }];
  });
  const shelf = retailProducts(ctx, ["walmart", "bestbuy", "target"]).flatMap(({ p, l }): BfRow[] => {
    const base = median(daysOf(ctx, p, BASE.from, BASE.to).map((d) => d.price));
    const week = daysOf(ctx, p, BF.from, BF.to).map((d) => d.price).filter((v): v is number => v != null);
    if (base == null || !week.length) return [];
    const low = Math.min(...week);
    return [{ l, rt: p.retailer, base: r2(base), low: r2(low), change: r1((low / base - 1) * 100), off: offMsrp(low, l.model.msrp), rank0: null, rank1: null, sold: null }];
  });
  return [...amz, ...shelf];
}

/**
 * Black Friday 2025 for TVs on Amazon, Walmart and Best Buy: each tracked model's lowest
 * Black Friday week price against its autumn median and its MSRP, and on Amazon the
 * sales-rank response.
 */
export function blackFridayTv(ctx: Ctx): AtlasAnswer {
  const S = ctx.subject;
  const rows = bfRows(ctx).sort((a, z) => Number(z.l.brand.id === S.id) - Number(a.l.brand.id === S.id) || a.rt.localeCompare(z.rt) || a.change - z.change);
  const of = (brandId: string, rt?: string) => rows.filter((r) => r.l.brand.id === brandId && (!rt || r.rt === rt));
  const retailers = MAIN.filter((rt) => rows.some((r) => r.rt === rt));
  const subjBy = Object.fromEntries(retailers.map((rt) => [rt, mean(of(S.id, rt).map((r) => r.change))]));
  const subjOff = mean(of(S.id).map((r) => r.off)), rivalOff = mean(rows.filter((r) => r.l.brand.id !== S.id).map((r) => r.off));
  const offByBrand = ctx.brands.map((b) => ({ b, v: mean(of(b.id).map((r) => r.off)), n: of(b.id).length })).filter((x) => x.v != null).sort((x, y) => (y.v ?? 0) - (x.v ?? 0));
  const offRank = offByBrand.findIndex((x) => x.b.id === S.id) + 1;
  const deepest = offByBrand.find((x) => x.b.id !== S.id);
  const ranked = rows.filter((r) => r.rt === "amazon" && r.rank0 && r.rank1);
  const rankMove = (r: BfRow) => (r.rank0! / r.rank1! - 1) * 100;
  const hero = ranked.filter((r) => r.l.brand.id === S.id).sort((x, y) => (y.sold ?? 0) - (x.sold ?? 0) || x.rank0! - y.rank0!)[0];
  const climber = ranked.filter((r) => r.l.brand.id !== S.id && r.change <= -5).sort((x, y) => rankMove(y) - rankMove(x))[0];
  const matched = of(S.id).reduce((m, r) => m.set(r.l.name, [...(m.get(r.l.name) ?? []), r]), new Map<string, BfRow[]>());
  const spread = [...matched.entries()].filter(([, rs]) => rs.length > 1).map(([name, rs]) => ({ name, lo: rs.reduce((a, z) => (z.low < a.low ? z : a)), hi: rs.reduce((a, z) => (z.low > a.low ? z : a)) })).sort((x, y) => (y.hi.low - y.lo.low) - (x.hi.low - x.lo.low))[0];
  const bars = { type: "hbars" as const, title: "Black Friday price move by brand and retailer", sub: `Mean of each model's lowest ${niceDate(BF.from)} – ${niceDate(BF.to)} price vs its ${niceDate(BASE.from)} – ${niceDate(BASE.to)} median`, unit: "signedPct" as const,
    rows: ctx.brands.flatMap((b) => retailers.flatMap((rt) => { const mine = of(b.id, rt); return mine.length ? [{ label: `${b.label} · ${RETAILER[rt]}`, value: r1(mean(mine.map((r) => r.change)) ?? 0), color: b.color, subject: b.id === S.id, note: `${mine.length} model${mine.length === 1 ? "" : "s"} · ${mine.filter((r) => r.change <= -5).length} cut 5%+` }] : []; })) };
  const offBars = { type: "hbars" as const, title: "Black Friday low as % off MSRP", sub: "Mean across every tracked model and retailer", unit: "pct" as const,
    rows: offByBrand.map((x) => ({ label: x.b.label, value: r1(x.v ?? 0), color: x.b.color, subject: x.b.id === S.id, note: `${x.n} model-retailer readings` })) };
  const table = { type: "table" as const, title: "Every tracked TV through Black Friday week", sub: "Amazon daily price history; Walmart and Best Buy from retailer price readings",
    columns: [{ label: "Brand", align: "left" as const }, { label: "Model", align: "left" as const }, { label: "Retailer", align: "left" as const }, { label: "Autumn median" }, { label: "Black Friday low" }, { label: "Change" }, { label: "Off MSRP" }, { label: "Sales rank" }, { label: "Bought / month" }],
    rows: rows.map((r): AtlasCell[] => [r.l.brand.label, r.l.name, RETAILER[r.rt], usd(r.base), usd(r.low), signed(r.change), r.off == null ? "—" : pct(r.off, 0), r.rank0 ? `${fmtRank(r.rank0)} → ${fmtRank(r.rank1)}` : "—", fmtSold(r.sold)]),
    highlight: rows.map((r, i) => (r.l.brand.id === S.id ? i : -1)).filter((i) => i >= 0) };
  const heroClimbed = !!hero && hero.rank1! < hero.rank0!;
  const retailerLine = retailers.map((rt) => `${signed(subjBy[rt] ?? null)} on ${RETAILER[rt]}`).join(", ");
  return {
    id: "black-friday",
    question: `Black Friday 2025: how deep did ${S.label} cut its 65" TVs on Amazon, Walmart and Best Buy against rivals, and did it buy Amazon rank?`,
    chip: "Black Friday 2025 · Amazon + Walmart + Best Buy",
    steps: [
      `Loading ${amazonListings(ctx).length} Amazon listings' daily history (price, stock, Best Sellers Rank, bought-in-past-month)`,
      `Loading Walmart and Best Buy daily readings from the retailer feed`,
      `Setting the baseline (${niceDate(BASE.from)} – ${niceDate(BASE.to)}) and Black Friday week (${niceDate(BF.from)} – ${niceDate(BF.to)})`,
      `Comparing ${rows.length} model–retailer pairs on lowest price, autumn change and discount off MSRP`,
      "Reading the Amazon sales-rank response to each price move",
      "Ranking the movers and drafting the recommended moves",
    ],
    headline: `${S.label} cut ${retailerLine} for Black Friday 2025, landing ${pct(subjOff, 0)} off MSRP on average, #${offRank} of ${offByBrand.length} brands for depth${deepest ? `; ${deepest.b.label} went deepest at ${pct(deepest.v, 0)} off` : ""}.${hero ? ` On Amazon, ${hero.l.name} went ${usd(hero.base)} → ${usd(hero.low)} and ranked ${fmtRank(hero.rank0)} → ${fmtRank(hero.rank1)}.` : ""}`,
    what: `${offByBrand.map((x) => `${x.b.label} ${pct(x.v, 0)} off MSRP`).join(" · ")}. ${of(S.id).filter((r) => r.change <= -5).length} of ${of(S.id).length} ${S.label} model–retailer pairs were cut 5% or more.`,
    why: `Black Friday is a price-match week for TVs: the same model lands within a few dollars across retailers.${spread ? ` ${possessive(S.label)} widest gap was ${spread.name}: ${usd(spread.lo.low)} at ${RETAILER[spread.lo.rt]} vs ${usd(spread.hi.low)} at ${RETAILER[spread.hi.rt]}.` : ""} Rivals averaged ${pct(rivalOff, 0)} off MSRP against ${possessive(S.label)} ${pct(subjOff, 0)}, so ${(subjOff ?? 0) < (rivalOff ?? 0) ? `${S.label} stayed the premium shelf` : `${S.label} matched the market on depth`}.`,
    when: `Black Friday was ${niceDate(BF.day)}. Black Friday week: ${niceDate(BF.from)} – ${niceDate(BF.to)}. Baseline: ${niceDate(BASE.from)} – ${niceDate(BASE.to)}. 2026 models launched after Black Friday 2025 are not in this comparison.`,
    insight: heroClimbed ? `${possessive(S.label)} Black Friday cuts bought rank: ${hero!.l.name} climbed ${fmtRank(hero!.rank0)} → ${fmtRank(hero!.rank1)} on Amazon at ${pct(hero!.off, 0)} off MSRP. The question for 2026 is depth, not whether to play.` : hero ? `${S.label} cut but did not win the rank race: ${hero.l.name} moved ${fmtRank(hero.rank0)} → ${fmtRank(hero.rank1)} on Amazon while ${climber ? `${possessive(climber.l.brand.label)} ${climber.l.name} cut ${pct(-climber.change, 0)} and climbed ${fmtRank(climber.rank0)} → ${fmtRank(climber.rank1)}` : "rivals cut deeper"}.` : `${S.label} kept Black Friday depth at ${pct(subjOff, 0)} off MSRP against rivals' ${pct(rivalOff, 0)}.`,
    actions: [
      ...(hero ? [{ title: `Set the 2026 Black Friday price for ${hero.l.name} early`, detail: `It went ${usd(hero.base)} → ${usd(hero.low)} (${signed(hero.change)}) in Black Friday week 2025 and sold ${fmtSold(hero.sold)} a month on Amazon.`, impact: `${possessive(S.label)} highest-volume Amazon TV in the set` }] : []),
      ...(spread ? [{ title: `Align ${spread.name} across retailers for Black Friday week`, detail: `${usd(spread.lo.low)} at ${RETAILER[spread.lo.rt]} vs ${usd(spread.hi.low)} at ${RETAILER[spread.hi.rt]} in 2025.`, impact: `A ${usd(r2(spread.hi.low - spread.lo.low))} gap a price-matching shopper sees` }] : []),
      ...(climber ? [{ title: `Plan against ${possessive(climber.l.brand.label)} ${climber.l.name}`, detail: `It cut ${pct(-climber.change, 0)} and climbed ${fmtRank(climber.rank0)} → ${fmtRank(climber.rank1)} on Amazon in the same week.`, impact: "The rival most likely to take Black Friday share" }] : []),
    ],
    kpis: [
      ...retailers.slice(0, 3).map((rt) => ({ label: `${S.label} on ${RETAILER[rt]}`, value: signed(subjBy[rt] ?? null), note: "Black Friday low vs autumn", tone: (subjBy[rt] ?? 0) <= -5 ? "good" as const : "watch" as const })),
      { label: "Off MSRP", value: pct(subjOff, 0), note: `#${offRank} of ${offByBrand.length} for depth`, tone: "neutral" },
    ],
    blocks: [bars, offBars, table],
    link: { page: "pricing", label: "Pricing" },
  };
}

/**
 * The same TV across retailers over the window: each model's median price per retailer,
 * the gap between its cheapest and dearest retailer, and each brand's discount off MSRP.
 */
export function retailerPriceGap(ctx: Ctx): AtlasAnswer {
  const S = ctx.subject, W = ctx.payload.meta.window;
  const prices = new Map<string, { l: Listing; by: Record<string, number> }>();
  const put = (l: Listing, rt: string, v: number | null) => { if (v == null) return; const e = prices.get(l.model.id) ?? { l, by: {} }; e.by[rt] = r2(v); prices.set(l.model.id, e); };
  for (const { brand, model, h } of amazonListings(ctx)) put({ brand, model, name: tvName(model.label) }, "amazon", median(between(h, h.price, W.start, W.end)));
  for (const { p, l } of retailProducts(ctx, MAIN.filter((r) => r !== "amazon"))) put(l, p.retailer, median(daysOf(ctx, p, W.start, W.end).map((d) => d.price)));
  const dropped: string[] = [];
  for (const e of prices.values()) {
    const mid = median(Object.values(e.by));
    for (const [rt, v] of Object.entries(e.by)) if (mid && Math.abs(v / mid - 1) > OUTLIER) { dropped.push(`${e.l.brand.label} ${e.l.name} at ${RETAILER[rt]} (${usd(v)})`); delete e.by[rt]; }
  }
  const models = [...prices.values()].map((e) => {
    const entries = Object.entries(e.by).sort((a, z) => a[1] - z[1]);
    const [loRt, lo] = entries[0], [hiRt, hi] = entries[entries.length - 1];
    return { ...e, n: entries.length, lo, loRt, hi, hiRt, gap: entries.length > 1 ? r1((hi / lo - 1) * 100) : null, off: offMsrp(median(Object.values(e.by)), e.l.model.msrp) };
  }).sort((x, y) => Number(y.l.brand.id === S.id) - Number(x.l.brand.id === S.id) || (y.gap ?? -1) - (x.gap ?? -1));
  const offByBrand = ctx.brands.map((b) => ({ b, v: mean(models.filter((m) => m.l.brand.id === b.id).map((m) => m.off)) })).filter((x) => x.v != null).sort((x, y) => (y.v ?? 0) - (x.v ?? 0));
  const rank = offByBrand.findIndex((x) => x.b.id === S.id) + 1;
  const subj = models.filter((m) => m.l.brand.id === S.id);
  const subjOff = offByBrand.find((x) => x.b.id === S.id)?.v ?? null;
  const widest = subj.filter((m) => m.gap != null).sort((x, y) => (y.gap ?? 0) - (x.gap ?? 0))[0];
  const cheapCount = MAIN.map((rt) =>({ rt, n: subj.filter((m) => m.n > 1 && m.loRt === rt).length })).sort((x, y) => y.n - x.n);
  const gapBrand = ctx.brands.map((b) => ({ b, v: mean(models.filter((m) => m.l.brand.id === b.id && m.gap != null).map((m) => m.gap)) })).filter((x) => x.v != null);
  const cols = MAIN.filter((rt) => models.some((m) => m.by[rt] != null));
  const offBars = { type: "hbars" as const, title: "Median street price as % off MSRP", sub: `Every tracked model, median across retailers, ${niceDate(W.start)} – ${niceDate(W.end)}`, unit: "pct" as const,
    rows: offByBrand.map((x) => ({ label: x.b.label, value: r1(x.v ?? 0), color: x.b.color, subject: x.b.id === S.id })) };
  const gapBars = { type: "hbars" as const, title: `${possessive(S.label)} cheapest-to-dearest retailer gap`, sub: "Median price at the dearest retailer vs the cheapest, per model", unit: "pct" as const,
    rows: subj.filter((m) => m.gap != null).map((m) => ({ label: m.l.name, value: m.gap!, color: S.color, subject: true, note: `${RETAILER[m.loRt]} ${usd(m.lo)} → ${RETAILER[m.hiRt]} ${usd(m.hi)}` })) };
  const table = { type: "table" as const, title: "Median price by model and retailer", sub: `${niceDate(W.start)} – ${niceDate(W.end)}; Amazon daily price history and retailer price readings`,
    columns: [{ label: "Brand", align: "left" as const }, { label: "Model", align: "left" as const }, { label: "MSRP" }, ...cols.map((rt) => ({ label: RETAILER[rt] })), { label: "Gap" }, { label: "Cheapest", align: "left" as const }],
    rows: models.map((m): AtlasCell[] => [m.l.brand.label, m.l.name, usd(m.l.model.msrp ?? null), ...cols.map((rt) => usd(m.by[rt] ?? null)), m.gap == null ? "—" : pct(m.gap, 1), m.n > 1 ? RETAILER[m.loRt] : "—"]),
    highlight: models.map((m, i) => (m.l.brand.id === S.id ? i : -1)).filter((i) => i >= 0) };
  const subjGap = mean(subj.map((m) => m.gap)), rivalGap = mean(gapBrand.filter((x) => x.b.id !== S.id).map((x) => x.v));
  return {
    id: "retailer-price-gap",
    question: `Is the same ${S.label} TV priced the same at Amazon, Walmart, Best Buy and Target, and how deep does ${S.label} discount off MSRP against rivals?`,
    chip: "Channel pricing · same TV, every retailer",
    steps: [
      `Taking each model's median price over ${niceDate(W.start)} – ${niceDate(W.end)} at every retailer that sells it`,
      `Matching ${models.length} models across Amazon, Walmart, Best Buy and Target by model number`,
      `Setting aside ${dropped.length} retailer price${dropped.length === 1 ? "" : "s"} more than ${OUTLIER * 100}% from the model's median (a different variant or a list price, not a street price)`,
      "Measuring the gap between each model's cheapest and dearest retailer",
      "Restating every price as a discount off MSRP",
      `Ranking ${offByBrand.length} brands on discount depth`,
    ],
    headline: `${S.label} sells ${pct(subjOff, 0)} below MSRP at the median, #${rank} of ${offByBrand.length} brands for discount depth (${offByBrand[0].b.label} deepest at ${pct(offByBrand[0].v, 0)}).${widest ? ` Its widest channel gap is ${widest.l.name}: ${RETAILER[widest.loRt]} ${usd(widest.lo)} vs ${RETAILER[widest.hiRt]} ${usd(widest.hi)} (${pct(widest.gap, 1)}).` : ""}`,
    what: `${offByBrand.map((x) => `${x.b.label} ${pct(x.v, 0)} off`).join(" · ")}. ${S.label} is cheapest at ${RETAILER[cheapCount[0].rt]} on ${cheapCount[0].n} of ${subj.filter((m) => m.n > 1).length} models sold at more than one retailer.`,
    why: `${possessive(S.label)} channel gaps average ${pct(subjGap, 1)} against ${pct(rivalGap, 1)} for rivals. A gap that wide is visible to any shopper with two tabs open, and on TVs it is usually a retailer holding last month's price after a rival cut.`,
    when: `${niceDate(W.start)} – ${niceDate(W.end)} (13 weeks). Medians use only days a retailer price was read.${dropped.length ? ` Set aside: ${dropped.join("; ")}.` : ""}`,
    insight: (subjGap ?? 0) > (rivalGap ?? 0) ? `${possessive(S.label)} pricing is less consistent across retailers than its rivals', so the first price fix is channel alignment, not a deeper cut: closing the ${widest?.l.name ?? "widest"} gap moves the price shoppers compare without touching MSRP.` : `${S.label} holds a tighter price across retailers than its rivals, so its pricing lever is depth: it sits ${pct(subjOff, 0)} off MSRP against ${possessive(offByBrand[0].b.label)} ${pct(offByBrand[0].v, 0)}.`,
    actions: [
      ...(widest ? [{ title: `Close the ${widest.l.name} gap at ${RETAILER[widest.hiRt]}`, detail: `${usd(widest.hi)} at ${RETAILER[widest.hiRt]} vs ${usd(widest.lo)} at ${RETAILER[widest.loRt]} over the quarter.`, impact: `${pct(widest.gap, 1)} price gap on one model` }] : []),
      { title: `Use ${RETAILER[cheapCount[0].rt]} as the price reference`, detail: `It is ${possessive(S.label)} cheapest retailer on ${cheapCount[0].n} models; other retailers' prices are read against it.`, impact: "One reference price for retailer conversations" },
      { title: "Hold MSRP discipline on the premium models", detail: `${S.label} discounts ${pct(subjOff, 0)} off MSRP at the median; ${offByBrand[0].b.label} discounts ${pct(offByBrand[0].v, 0)}.`, impact: "Margin the brand keeps by not following the deepest rival" },
    ],
    kpis: [
      { label: "Off MSRP", value: pct(subjOff, 0), note: `#${rank} of ${offByBrand.length} for depth` },
      { label: "Channel gap", value: pct(subjGap, 1), note: `rivals ${pct(rivalGap, 1)}`, tone: (subjGap ?? 0) > (rivalGap ?? 0) ? "watch" : "good" },
      { label: "Widest gap", value: widest ? pct(widest.gap, 1) : "—", note: widest?.l.name, tone: (widest?.gap ?? 0) >= 10 ? "risk" : "neutral" },
      { label: "Cheapest retailer", value: RETAILER[cheapCount[0].rt], note: `${cheapCount[0].n} ${S.label} models` },
    ],
    blocks: [offBars, gapBars, table],
    link: { page: "pricing", label: "Pricing" },
  };
}

/**
 * The review drivers answer with Amazon reviewers' own words in place of retailer review text.
 */
export function reviewsTv(ctx: Ctx): AtlasAnswer {
  const S = ctx.subject;
  const base = reviews(ctx);
  const counts = ctx.payload.voice.aspectCounts[S.id] ?? {};
  const share = (a: string): number => { const c = counts[a]; return c && c.positive + c.negative ? c.positive / (c.positive + c.negative) : 1; };
  const aspects = Object.keys(counts).sort((a, z) => share(a) - share(z));
  const weakest = aspects[0], strongest = aspects[aspects.length - 1];
  const quotesOf = (a: string | undefined): Array<{ text: string }> => (a ? ((counts[a] as unknown as { quotes?: Array<{ text: string }> }).quotes ?? []) : []);
  const items = [...quotesOf(weakest), ...quotesOf(strongest)].map((q) => ({ text: q.text.slice(0, 260), meta: "Amazon review", tone: NEGATIVE.test(q.text) ? "negative" as const : "positive" as const }));
  return {
    ...base,
    question: `What drives ${possessive(S.label)} praise and complaints, and is ${weakest?.toLowerCase() ?? "its weakest aspect"} a ${S.label} problem or the category's?`,
    steps: base.steps.map((s) => (/Walmart reviews/.test(s) ? `Reading Amazon reviewers' quotes on ${weakest} and ${strongest}` : s)),
    when: "Amazon review summaries and aspect mentions as read on the build date.",
    actions: base.actions.filter((a) => !/Walmart review/.test(a.title)),
    blocks: base.blocks.map((b) => (b.type === "quotes" ? { ...b, title: `What Amazon reviewers wrote about ${S.label}`, sub: `On ${weakest} and ${strongest}`, items } : b)).filter((b) => b.type !== "quotes" || b.items.length),
  };
}

/**
 * The answer with every long listing title replaced by its model name.
 */
export function withModelNames(ctx: Ctx, a: AtlasAnswer): AtlasAnswer {
  let s = JSON.stringify(a);
  for (const m of ctx.payload.dims.models.slice().sort((x, y) => y.label.length - x.label.length)) {
    const b = ctx.brands.find((x) => x.id === m.brand);
    for (const long of [m.label, b ? shortLabel(m.label, b.label) : m.label]) s = s.split(JSON.stringify(long).slice(1, -1)).join(tvName(m.label));
  }
  return JSON.parse(s) as AtlasAnswer;
}
