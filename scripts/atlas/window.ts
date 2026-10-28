import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import { amazonListings, between, compact, cutText, fmtRank, fmtSold, mean, median, niceDate, pct, possessive, r1, r2, shortLabel, signed, usd, type Ctx } from "./common";

const MEASURED = ["amazon", "walmart"];
const RETAILER: Record<string, string> = { amazon: "Amazon", walmart: "Walmart", target: "Target" };
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Prime Big Deal Days in the window: each brand's Amazon and Walmart price on the event days
 * against the two weeks before, and on Amazon the sales-rank response to it.
 */
export function bigDealDays(ctx: Ctx): AtlasAnswer {
  const P = ctx.payload, S = ctx.subject;
  const ev = P.dims.events.find((e) => e.id === "bigdeal") ?? P.dims.events[P.dims.events.length - 1];
  const pre = { from: addDays(ev.start, -14), to: addDays(ev.start, -1) };
  const amz = amazonListings(ctx).flatMap(({ brand, label, h }) => {
    const before = median(between(h, h.price, pre.from, pre.to)), during = between(h, h.price, ev.start, ev.end);
    if (before == null || !during.length) return [];
    const low = Math.min(...during), stock = between(h, h.stock, ev.start, ev.end);
    return [{ brand, label, rt: "amazon", before: r2(before), low: r2(low), change: r1((low / before - 1) * 100), inStock: stock.length ? (stock.filter((v) => v === 1).length / stock.length) * 100 : null,
      rank0: median(between(h, h.salesRank, pre.from, pre.to)), rank1: median(between(h, h.salesRank, ev.start, addDays(ev.end, 2))), sold: Math.max(0, ...between(h, h.monthlySold, ev.start, addDays(ev.end, 6))) || null }];
  });
  const di = (d: string) => P.dims.dates.indexOf(d);
  const a = di(ev.start), z = di(ev.end);
  const readAtWalmart = new Set(Object.values(ctx.feed.products).filter((p) => p.retailer === "walmart" && p.asin).map((p) => p.asin));
  const wm = P.dims.models.filter((m) => m.asin && readAtWalmart.has(m.asin)).flatMap((m) => {
    const s = P.pricing.price[`${m.id}|walmart`], st = P.availability.stock[`${m.id}|walmart`];
    const brand = ctx.brands.find((b) => b.id === m.brand)!;
    const before = s ? median(s.slice(di(pre.from), di(pre.to) + 1)) : null, during = s ? s.slice(a, z + 1).filter((v): v is number => v != null) : [];
    if (before == null || !during.length) return [];
    const low = Math.min(...during);
    return [{ brand, label: shortLabel(m.label, brand.label), rt: "walmart", before: r2(before), low: r2(low), change: r1((low / before - 1) * 100), inStock: st ? (st.slice(a, z + 1).filter((v) => v === 1).length / (z - a + 1)) * 100 : null, rank0: null, rank1: null, sold: null }];
  });
  const rows = [...amz, ...wm];
  const rankMove = (r: { rank0: number | null; rank1: number | null }) => (r.rank0! / r.rank1! - 1) * 100;
  const byBrand = ctx.brands.map((b) => { const mine = rows.filter((r) => r.brand.id === b.id); return { b, n: mine.length, change: mean(mine.map((r) => r.change)), cut: mine.filter((r) => r.change <= -3).length }; }).filter((x) => x.n);
  const subj = byBrand.find((x) => x.b.id === S.id)!;
  const cutter = byBrand.filter((x) => x.b.id !== S.id).sort((x, y) => (x.change ?? 0) - (y.change ?? 0))[0];
  const ranked = amz.filter((r) => r.rank0 && r.rank1);
  const subjHero = ranked.filter((r) => r.brand.id === S.id).sort((x, y) => (y.sold ?? 0) - (x.sold ?? 0) || x.rank0! - y.rank0!)[0];
  const climber = ranked.filter((r) => r.brand.id !== S.id && r.change <= -3 && rankMove(r) > 10).sort((x, y) => rankMove(y) - rankMove(x))[0];
  const amzMove = mean(amz.map((r) => r.change)), wmMove = mean(wm.map((r) => r.change));
  const bars = { type: "hbars" as const, title: "Average price move on the event days", sub: `Lowest price ${niceDate(ev.start)} – ${niceDate(ev.end)} vs the 14 days before`, unit: "signedPct" as const,
    rows: ctx.brands.flatMap((b) => MEASURED.flatMap((rt) => { const mine = rows.filter((r) => r.brand.id === b.id && r.rt === rt); return mine.length ? [{ label: `${b.label} · ${RETAILER[rt]}`, value: r1(mean(mine.map((r) => r.change)) ?? 0), color: b.color, subject: b.id === S.id, note: `${mine.filter((r) => r.change <= -3).length} of ${mine.length} cut 3%+` }] : []; })) };
  const rankBars = { type: "hbars" as const, title: "Amazon sales-rank response", sub: "Best Sellers Rank on the event and two days after vs the 14 days before (positive = climbed)", unit: "signedPct" as const,
    rows: ranked.slice().sort((x, y) => rankMove(y) - rankMove(x)).map((r) => ({ label: `${r.brand.label} ${compact(r.label)}`, value: r1(rankMove(r)), color: r.brand.color, subject: r.brand.id === S.id, note: `${fmtRank(r.rank0)} → ${fmtRank(r.rank1)} · price ${signed(r.change)}` })) };
  const sorted = rows.slice().sort((x, y) => x.change - y.change);
  const table = { type: "table" as const, title: "Every measured listing on the event", sub: "Amazon daily price history and Walmart price readings",
    columns: [{ label: "Brand", align: "left" as const }, { label: "Retailer", align: "left" as const }, { label: "Listing", align: "left" as const }, { label: "Before" }, { label: "Event low" }, { label: "Change" }, { label: "In stock" }, { label: "Sales rank" }, { label: "Bought / month" }],
    rows: sorted.map((r): AtlasCell[] => [r.brand.label, RETAILER[r.rt], r.label, usd(r.before), usd(r.low), signed(r.change), r.inStock == null ? "—" : pct(r.inStock, 0), r.rank0 ? `${fmtRank(r.rank0)} → ${fmtRank(r.rank1)}` : "—", fmtSold(r.sold)]),
    highlight: sorted.map((r, i) => (r.brand.id === S.id ? i : -1)).filter((i) => i >= 0) };
  const heroHeld = subjHero && subjHero.rank1! <= subjHero.rank0!;
  return {
    id: "big-deal-days",
    question: `Prime Big Deal Days: who discounted, on which retailer, and did the cuts actually buy Amazon sales rank?`,
    chip: "Prime Big Deal Days · cut vs hold",
    steps: [
      `Pulling daily Amazon prices and Best Sellers Rank for ${amz.length} Amazon listings`,
      `Pulling Walmart prices for ${wm.length} listings from the Walmart feed`,
      `Comparing ${niceDate(ev.start)} – ${niceDate(ev.end)} with the 14 days before`,
      "Measuring each listing's sales-rank response to its own price move",
      "Separating the brands that cut and climbed from the ones that held",
    ],
    headline: `${S.label} largely held price on ${ev.label} (${signed(subj.change)} on average, ${subj.cut} of ${subj.n} listings cut 3%+) while ${cutter.b.label} moved ${signed(cutter.change)}. ${climber ? `The clearest payoff from cutting was ${possessive(climber.brand.label)} ${climber.label}: cut ${cutText(climber.change)} and ${fmtRank(climber.rank0)} → ${fmtRank(climber.rank1)} on Amazon.` : "No competitor that cut gained Amazon rank for it."}`,
    what: byBrand.map((x) => `${x.b.label} ${signed(x.change)} (${x.cut}/${x.n} cut)`).join(" · ") + ".",
    why: `${ev.label} is an Amazon event, so the cuts land on Amazon: across the set Amazon listings moved ${signed(amzMove)} and Walmart ${signed(wmMove)}. ${subjHero ? `${possessive(S.label)} lead Amazon listing (${subjHero.label}) moved ${signed(subjHero.change)} and ranked ${fmtRank(subjHero.rank0)} → ${fmtRank(subjHero.rank1)}.` : ""}`,
    when: `${ev.label}: ${niceDate(ev.start)} – ${niceDate(ev.end)}. Baseline: ${niceDate(pre.from)} – ${niceDate(pre.to)}. Rank read through ${niceDate(addDays(ev.end, 2))}.`,
    insight: heroHeld ? `Holding price on ${ev.label} cost ${S.label} nothing in rank: its lead listing held ${fmtRank(subjHero!.rank1)} without a deal, so the margin it kept was free.` : `${S.label} kept margin on ${ev.label} but its lead listing slipped (${fmtRank(subjHero?.rank0 ?? null)} → ${fmtRank(subjHero?.rank1 ?? null)}); the next event needs a targeted deal on that listing only.`,
    actions: [
      { title: "Run event deals on the lead listing only", detail: `Cut the listing that decides rank (${subjHero?.label ?? "the lead pack"}) and hold the rest.`, impact: `Keeps ${subj.n - 1} other listings at full price` },
      ...(climber ? [{ title: `Plan against ${possessive(climber.brand.label)} event playbook`, detail: `It cut ${cutText(climber.change)} on ${climber.label} and climbed ${fmtRank(climber.rank0)} → ${fmtRank(climber.rank1)}.`, impact: "The competitor most likely to take share on the next event" }] : []),
      { title: "Keep Walmart out of Amazon events", detail: `Walmart listings moved ${signed(wmMove)} on average over the event.`, impact: "Avoids margin loss where the event does not run" },
    ],
    kpis: [
      { label: `${S.label} price move`, value: signed(subj.change), note: "event low vs 14 days before" },
      { label: "Listings cut 3%+", value: `${subj.cut} / ${subj.n}` },
      { label: "Deepest rival move", value: signed(cutter.change), note: cutter.b.label },
      { label: "Lead listing rank", value: subjHero ? `${fmtRank(subjHero.rank0)} → ${fmtRank(subjHero.rank1)}` : "—", note: subjHero?.label, tone: heroHeld ? "good" : "risk" },
    ],
    blocks: [bars, { ...rankBars, title: `${rankBars.title}: biggest movers`, rows: rankBars.rows.slice().sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).slice(0, 8) }, table],
    link: { page: "calendar", label: "Promo Calendar" },
  };
}

/**
 * Availability over the window on Amazon and Walmart: in-stock rate per brand and per subject
 * listing, outages, and how much of the gap comes from listings with no buyable offer at all.
 */
export function availability(ctx: Ctx): AtlasAnswer {
  const P = ctx.payload, S = ctx.subject;
  const readAt = new Set(Object.values(ctx.feed.products).filter((p) => p.asin).map((p) => `${p.retailer}|${p.asin}`));
  const rate = (key: string): number | null => { const [mid, rt] = key.split("|"); const asin = P.dims.models.find((m) => m.id === mid)?.asin; if (rt !== "amazon" && !(asin && readAt.has(`${rt}|${asin}`))) return null; const s = P.availability.stock[key]; const c = P.distribution.carriage[key]; if (!s) return null; const live = s.filter((v, i) => v != null && (!c || c[i] === 1)); return live.length ? (live.filter((v) => v === 1).length / live.length) * 100 : null; };
  const byBrand = ctx.brands.map((b) => ({ b, rate: mean(P.dims.models.filter((m) => m.brand === b.id).flatMap((m) => MEASURED.map((rt) => rate(`${m.id}|${rt}`)))) })).filter((x) => x.rate != null).sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0));
  const subjRate = byBrand.find((x) => x.b.id === S.id)?.rate ?? null;
  const rank = byBrand.findIndex((x) => x.b.id === S.id) + 1;
  const cells = P.dims.models.filter((m) => m.brand === S.id).flatMap((m) => MEASURED.map((rt) => ({ m, rt, rate: rate(`${m.id}|${rt}`) }))).filter((x) => x.rate != null);
  const eps = P.availability.episodes.filter((e) => e.brand === S.id && MEASURED.includes(e.retailer)).sort((x, y) => y.days - x.days);
  const lost = eps.reduce((t, e) => t + e.days, 0);
  const days = P.dims.dates.length;
  const dead = cells.filter((c) => c.rate === 0);
  const short = eps.filter((e) => e.days < days);
  const withoutDead = mean(cells.filter((c) => c.rate !== 0).map((c) => c.rate));
  const best = byBrand[0];
  const window = { from: P.meta.window.start, to: P.meta.window.end };
  const deadRanks = dead.map((c) => { const l = amazonListings(ctx).find((x) => x.model.id === c.m.id); return { c, rank: l ? median(between(l.h, l.h.salesRank, window.from, window.to)) : null }; });
  const lead = amazonListings(ctx).filter((l) => l.brand.id === S.id).map((l) => ({ l, sold: Math.max(0, ...between(l.h, l.h.monthlySold, window.from, window.to)) })).sort((x, y) => y.sold - x.sold)[0];
  const bars = { type: "hbars" as const, title: "In-stock rate by brand", sub: `Amazon and Walmart listings, ${niceDate(window.from)} – ${niceDate(window.to)}`, unit: "pct" as const,
    rows: [...byBrand.map((x) => ({ label: x.b.label, value: r1(x.rate ?? 0), color: x.b.color, subject: x.b.id === S.id })), ...(dead.length ? [{ label: `${S.label} without dead listings`, value: r1(withoutDead ?? 0), color: "#9aa0a6", note: `${dead.length} listings excluded` }] : [])] };
  const table = { type: "table" as const, title: `${S.label} listings, in-stock rate`, sub: "Share of live days each listing could be bought",
    columns: [{ label: "Listing", align: "left" as const }, { label: "Amazon" }, { label: "Walmart" }],
    rows: P.dims.models.filter((m) => m.brand === S.id).map((m): AtlasCell[] => [shortLabel(m.label, S.label), ...MEASURED.map((rt) => { const v = rate(`${m.id}|${rt}`); return v == null ? "—" : pct(v, 0); })]) };
  const epTable = { type: "table" as const, title: `Every ${S.label} outage`, sub: "Longest first",
    columns: [{ label: "Listing", align: "left" as const }, { label: "Retailer", align: "left" as const }, { label: "From", align: "left" as const }, { label: "Days" }],
    rows: eps.map((e): AtlasCell[] => [shortLabel(P.dims.models.find((m) => m.id === e.model)?.label ?? e.model, S.label), RETAILER[e.retailer], niceDate(e.start), e.days]) };
  const deadNames = dead.map((c) => shortLabel(c.m.label, S.label));
  return {
    id: "availability",
    question: `How much of ${possessive(S.label)} in-stock gap comes from dead listings versus short outages, and what to fix first?`,
    chip: "Stock-outs · dead listings vs gaps",
    steps: [
      `Reading the daily buyable state of ${cells.length} ${S.label} listing–retailer pairs (Amazon daily history, Walmart readings)`,
      `Finding every continuous outage in ${niceDate(window.from)} – ${niceDate(window.to)}`,
      "Separating listings with no buyable offer all quarter from short gaps",
      `Comparing in-stock rate with ${byBrand.length - 1} competitors`,
      "Sizing each fix by the listing's Amazon demand",
    ],
    headline: `${S.label} was buyable ${pct(subjRate, 1)} of the time on Amazon and Walmart, #${rank} of ${byBrand.length} ${rank === 1 && byBrand[1] ? `ahead of ${possessive(byBrand[1].b.label)} ${pct(byBrand[1].rate, 1)}` : `against ${possessive(best.b.label)} ${pct(best.rate, 1)}`}. ${dead.length ? `${dead.length} Amazon listing${dead.length === 1 ? " has" : "s have"} had no buyable offer all quarter (${deadNames.join(", ")}); without them the rate is ${pct(withoutDead, 1)}.` : ""}`,
    what: `${eps.length} outages cost ${lost} listing-days, ${dead.length * days} of them on the dead listings. ${byBrand.map((x) => `${x.b.label} ${pct(x.rate, 1)}`).join(" · ")}.`,
    why: dead.length ? `The gap is mostly listing health, not supply: a listing with no buyable offer for all ${days} days is one Amazon is not selling (${deadRanks.map((d) => `${shortLabel(d.c.m.label, S.label)} ranks ${fmtRank(d.rank)}`).join(", ")}). The other ${short.length} outages are short replenishment gaps.` : "The gaps are short and spread across listings, which points at replenishment timing.",
    when: `${niceDate(window.from)} – ${niceDate(window.to)} (13 weeks).`,
    insight: dead.length ? `Fixing or retiring ${dead.length} dead Amazon listing${dead.length === 1 ? "" : "s"} lifts ${possessive(S.label)} in-stock rate from ${pct(subjRate, 1)} to ${pct(withoutDead, 1)}, ${withoutDead != null && best.rate != null && withoutDead >= best.rate - 2 ? "level with the category leader" : "closing most of the gap"}, without moving a single unit of inventory.` : `${possessive(S.label)} availability problems are short gaps; the fix is replenishment cadence on the listings that gap most.`,
    actions: [
      ...(dead.length ? [{ title: `Reinstate or retire ${deadNames.join(" and ")} on Amazon`, detail: "No buyable offer all quarter. Restore an offer or merge the ASIN into a live pack so shoppers stop landing on a dead page.", impact: `${pct(subjRate, 1)} → ${pct(withoutDead, 1)} in-stock` }] : []),
      ...(short[0] ? [{ title: "Tighten replenishment where gaps recur", detail: `The longest short outage was ${shortLabel(P.dims.models.find((m) => m.id === short[0].model)?.label ?? "", S.label)} on ${RETAILER[short[0].retailer]} for ${short[0].days} days.`, impact: `${short.reduce((t, e) => t + e.days, 0)} listing-days in short gaps` }] : []),
      ...(lead && lead.sold ? [{ title: `Protect ${lead.l.label} first`, detail: `${possessive(S.label)} biggest Amazon seller at ${fmtSold(lead.sold)} bought a month.`, impact: "Every day it is out costs the most" }] : []),
    ],
    kpis: [
      { label: "In-stock rate", value: pct(subjRate, 1), note: `#${rank} of ${byBrand.length}`, tone: rank === 1 ? "good" : rank === byBrand.length ? "risk" : "watch" },
      { label: "Without dead listings", value: pct(withoutDead, 1), tone: "good" },
      { label: "Dead listings", value: String(dead.length), note: "no buyable offer all quarter", tone: dead.length ? "risk" : "good" },
      { label: "Outage days", value: String(lost), note: `${eps.length} outages` },
    ],
    blocks: [bars, table, epTable],
    link: { page: "stock", label: "Availability" },
  };
}
