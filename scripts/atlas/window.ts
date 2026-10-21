import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import { mean, median, niceDate, pct, possessive, r1, r2, signed, usd, type Ctx } from "./common";

const MEASURED = ["amazon", "walmart"];
const RETAILER: Record<string, string> = { amazon: "Amazon", walmart: "Walmart", target: "Target" };

const shortModel = (label: string, brand: string): string => label.replace(new RegExp(`^${brand}\\s+`, "i"), "").replace(/^DUDE Wipes\s+|^Dude Wipes\s+/i, "");

/**
 * Prime Big Deal Days in the window: each brand's Amazon and Walmart price on the event days
 * against the two weeks before, its measured price events and its stock on the days.
 */
export function bigDealDays(ctx: Ctx): AtlasAnswer {
  const P = ctx.payload, S = ctx.subject;
  const ev = P.dims.events.find((e) => e.id === "bigdeal") ?? P.dims.events[P.dims.events.length - 1];
  const di = (d: string) => P.dims.dates.indexOf(d);
  const a = di(ev.start), z = di(ev.end);
  const pre = [Math.max(0, a - 14), a - 1];
  const rows = P.dims.models.flatMap((m) => MEASURED.flatMap((rt) => {
    const s = P.pricing.price[`${m.id}|${rt}`];
    const st = P.availability.stock[`${m.id}|${rt}`];
    if (!s) return [];
    const before = median(s.slice(pre[0], pre[1] + 1));
    const during = s.slice(a, z + 1).filter((v): v is number => v != null);
    if (before == null || !during.length) return [];
    const low = Math.min(...during);
    const brand = ctx.brands.find((b) => b.id === m.brand)!;
    const inStock = st ? st.slice(a, z + 1).filter((v) => v === 1).length / (z - a + 1) * 100 : null;
    return [{ brand, model: shortModel(m.label, brand.label), rt, before: r2(before), low: r2(low), change: r1((low / before - 1) * 100), inStock }];
  }));
  const byBrand = ctx.brands.map((b) => {
    const mine = rows.filter((r) => r.brand.id === b.id);
    const events = P.promotions.events.filter((e) => e.brand === b.id && e.measured && MEASURED.includes(e.retailer) && e.start <= ev.end && e.end >= ev.start);
    return { b, n: mine.length, change: mean(mine.map((r) => r.change)), cut: mine.filter((r) => r.change <= -3).length, events, depth: mean(events.map((e) => e.depthPct)), stock: mean(mine.map((r) => r.inStock)) };
  }).filter((x) => x.n);
  const subj = byBrand.find((x) => x.b.id === S.id);
  const leader = byBrand.filter((x) => x.b.id !== S.id).sort((x, y) => (x.change ?? 0) - (y.change ?? 0))[0];
  const bars = {
    type: "hbars" as const, title: "Average price move on the event days", sub: `Lowest price ${niceDate(ev.start)} – ${niceDate(ev.end)} vs the median of the 14 days before · Amazon and Walmart`, unit: "signedPct" as const,
    rows: byBrand.map((x) => ({ label: x.b.label, value: r1(x.change ?? 0), color: x.b.color, subject: x.b.id === S.id, note: `${x.cut} of ${x.n} listings cut 3%+` })),
  };
  const sorted = rows.slice().sort((x, y) => x.change - y.change);
  const table = {
    type: "table" as const, title: "Every measured listing on the event", sub: "Amazon (Keepa) and Walmart readings only",
    columns: [{ label: "Brand", align: "left" as const }, { label: "Listing", align: "left" as const }, { label: "Retailer", align: "left" as const }, { label: "Before" }, { label: "Event low" }, { label: "Change" }, { label: "In stock" }],
    rows: sorted.map((r): AtlasCell[] => [r.brand.label, r.model, RETAILER[r.rt], usd(r.before), usd(r.low), signed(r.change), r.inStock == null ? "—" : pct(r.inStock, 0)]),
    highlight: sorted.map((r, i) => (r.brand.id === S.id ? i : -1)).filter((i) => i >= 0),
  };
  const dates = P.dims.dates.slice(Math.max(0, a - 21), Math.min(P.dims.dates.length, z + 5));
  const idx = dates.map(di);
  const line = {
    type: "line" as const, title: "Amazon and Walmart price index around the event", sub: "Each brand's listings indexed to 100 on the day before the event, then averaged", unit: "num" as const, x: dates,
    series: ctx.brands.map((b) => {
      const keys = P.dims.models.filter((m) => m.brand === b.id).flatMap((m) => MEASURED.map((rt) => `${m.id}|${rt}`)).filter((k) => P.pricing.price[k]?.[a - 1] != null);
      return { id: b.id, label: b.label, color: b.color, subject: b.id === S.id, data: idx.map((i) => { const v = mean(keys.map((k) => { const p = P.pricing.price[k][i]; return p == null ? null : (p / P.pricing.price[k][a - 1]!) * 100; })); return v == null ? null : r1(v); }) };
    }).filter((s) => s.data.some((v) => v != null)),
    bands: [{ start: ev.start, end: ev.end, label: ev.label }],
  };
  return {
    id: "big-deal-days",
    question: `Did ${S.label} compete on Prime Big Deal Days?`,
    chip: "Prime Big Deal Days, Oct 2026",
    steps: [
      `Pulling daily Amazon (Keepa) and Walmart prices for ${new Set(rows.map((r) => r.model + r.brand.id)).size} tracked listings`,
      `Comparing ${niceDate(ev.start)} – ${niceDate(ev.end)} against the 14 days before`,
      "Matching measured price events and stock on the event days",
    ],
    headline: `${S.label} ${(subj?.change ?? 0) <= -3 ? "cut" : "mostly held price"} on ${ev.label}: its listings moved ${signed(subj?.change ?? null)} on average against ${leader ? `${possessive(leader.b.label)} ${signed(leader.change)}` : "the set"}. ${subj?.cut ?? 0} of ${subj?.n ?? 0} ${S.label} listings cut 3% or more.`,
    what: `${byBrand.map((x) => `${x.b.label} ${signed(x.change)} (${x.cut}/${x.n} cut)`).join(" · ")}. ${S.label} ran ${subj?.events.length ?? 0} measured price event${(subj?.events.length ?? 0) === 1 ? "" : "s"} overlapping the event${subj?.depth != null ? ` at ${r1(subj.depth)}% mean depth` : ""}.`,
    why: (() => { const byRt = MEASURED.map((rt) => ({ rt, v: mean(rows.filter((r) => r.rt === rt).map((r) => r.change)) })); const sr = MEASURED.map((rt) => ({ rt, v: mean(rows.filter((r) => r.rt === rt && r.brand.id === S.id).map((r) => r.change)) }));
      return `Across the set, Amazon listings moved ${signed(byRt[0].v)} and Walmart listings ${signed(byRt[1].v)} on the event days; ${S.label} moved ${signed(sr[0].v)} on Amazon and ${signed(sr[1].v)} on Walmart. Its priced listings were ${pct(subj?.stock ?? null, 0)} in stock on the event days, so ${(subj?.stock ?? 0) >= 95 ? "price, not stock, decided what it sold" : "stock limited what it could sell"}.`; })(),
    when: `${ev.label}: ${niceDate(ev.start)} – ${niceDate(ev.end)}. Baseline: the 14 days before.`,
    kpis: [
      { label: `${S.label} price move`, value: signed(subj?.change ?? null), note: "event low vs 14 days before" },
      { label: "Listings cut 3%+", value: `${subj?.cut ?? 0} / ${subj?.n ?? 0}`, tone: (subj?.cut ?? 0) ? "good" : "watch" },
      { label: "Deepest rival move", value: leader ? signed(leader.change) : "—", note: leader?.b.label },
      { label: `${S.label} in stock`, value: pct(subj?.stock ?? null, 0), note: "on the event days", tone: (subj?.stock ?? 0) >= 95 ? "good" : "risk" },
    ],
    blocks: [bars, table],
    report: {
      title: `${S.label} · ${ev.label} ${ev.start.slice(0, 4)}`,
      summary: `How each brand priced its measured Amazon and Walmart listings over ${ev.label}, against the two weeks before.`,
      sections: [
        { title: "Who cut", text: "Average move per brand. A negative bar is a brand that cut for the event.", blocks: [bars] },
        { title: "Around the event", text: "Each brand's listings indexed to 100 the day before the event.", blocks: [line] },
        { title: "Listing by listing", text: `${S.label} rows are highlighted.`, blocks: [table] },
      ],
      method: [
        "Amazon prices are Keepa's daily price; Walmart prices are the Histomart, Kompy and RetailerAPI readings.",
        "Target is left out because its readings are partly modelled.",
        "A cut is an event-day low at least 3% below the median of the 14 days before.",
      ],
    },
  };
}

/**
 * Availability over the window on the measured retailers: in-stock rate per brand and per
 * subject listing, and every outage the subject had.
 */
export function availability(ctx: Ctx): AtlasAnswer {
  const P = ctx.payload, S = ctx.subject;
  const rate = (key: string): number | null => { const s = P.availability.stock[key]; const c = P.distribution.carriage[key]; if (!s) return null; const live = s.filter((v, i) => v != null && (!c || c[i] === 1)); return live.length ? (live.filter((v) => v === 1).length / live.length) * 100 : null; };
  const byBrand = ctx.brands.map((b) => {
    const keys = P.dims.models.filter((m) => m.brand === b.id).flatMap((m) => MEASURED.map((rt) => `${m.id}|${rt}`));
    return { b, rate: mean(keys.map(rate)) };
  }).filter((x) => x.rate != null).sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0));
  const subjRate = byBrand.find((x) => x.b.id === S.id)?.rate ?? null;
  const rank = byBrand.findIndex((x) => x.b.id === S.id) + 1;
  const cells = P.dims.models.filter((m) => m.brand === S.id).flatMap((m) => MEASURED.map((rt) => ({ m, rt, rate: rate(`${m.id}|${rt}`) }))).filter((x) => x.rate != null);
  const eps = P.availability.episodes.filter((e) => e.brand === S.id && MEASURED.includes(e.retailer)).sort((x, y) => y.days - x.days);
  const lost = eps.reduce((t, e) => t + e.days, 0);
  const worst = cells.slice().sort((x, y) => (x.rate ?? 0) - (y.rate ?? 0))[0];
  const full = cells.filter((c) => c.rate === 0);
  const withoutDead = mean(cells.filter((c) => c.rate !== 0).map((c) => c.rate));
  const bars = { type: "hbars" as const, title: "In-stock rate by brand", sub: `Amazon and Walmart listings, ${niceDate(P.meta.window.start)} – ${niceDate(P.meta.window.end)}`, unit: "pct" as const,
    rows: byBrand.map((x) => ({ label: x.b.label, value: r1(x.rate ?? 0), color: x.b.color, subject: x.b.id === S.id })) };
  const table = { type: "table" as const, title: `${S.label} listings, in-stock rate`, sub: "Share of days each listing could be bought",
    columns: [{ label: "Listing", align: "left" as const }, { label: "Amazon" }, { label: "Walmart" }],
    rows: P.dims.models.filter((m) => m.brand === S.id).map((m): AtlasCell[] => [shortModel(m.label, S.label), ...MEASURED.map((rt) => { const v = rate(`${m.id}|${rt}`); return v == null ? "—" : pct(v, 0); })]) };
  const epTable = { type: "table" as const, title: `Every ${S.label} outage`, sub: "Longest first",
    columns: [{ label: "Listing", align: "left" as const }, { label: "Retailer", align: "left" as const }, { label: "From", align: "left" as const }, { label: "Days" }],
    rows: eps.map((e): AtlasCell[] => [shortModel(P.dims.models.find((m) => m.id === e.model)?.label ?? e.model, S.label), RETAILER[e.retailer], niceDate(e.start), e.days]) };
  return {
    id: "availability",
    question: `Where is ${S.label} losing sales to stock-outs?`,
    chip: "Stock-outs and availability",
    steps: [
      `Reading daily buyable state for ${cells.length} ${S.label} listing-retailer pairs (Keepa for Amazon, Walmart feed)`,
      `Finding every continuous outage in ${niceDate(P.meta.window.start)} – ${niceDate(P.meta.window.end)}`,
      `Comparing in-stock rate with ${byBrand.length - 1} competitors`,
    ],
    headline: `${S.label} was in stock ${pct(subjRate, 1)} of the time on Amazon and Walmart, #${rank} of ${byBrand.length}. ${full.length ? `${full.length} listing${full.length === 1 ? " was" : "s were"} unavailable the whole quarter (${full.map((c) => `${shortModel(c.m.label, S.label)} on ${RETAILER[c.rt]}`).join(", ")}); without them the rate is ${pct(withoutDead, 1)}.` : `The worst listing was ${worst ? `${shortModel(worst.m.label, S.label)} on ${RETAILER[worst.rt]} at ${pct(worst.rate, 0)}` : "—"}.`}`,
    what: `${eps.length} outages cost ${lost} listing-days. ${byBrand.map((x) => `${x.b.label} ${pct(x.rate, 1)}`).join(" · ")}.`,
    why: full.length ? `A listing with no buyable offer for the whole ${P.dims.dates.length} days is not a short stock-out: it is a listing Amazon is not selling. Fixing those listings, or retiring them, moves the rate more than any replenishment change.` : `The gaps are short and spread across listings, which points at replenishment timing rather than a dead listing.`,
    when: `${niceDate(P.meta.window.start)} – ${niceDate(P.meta.window.end)} (13 weeks).`,
    kpis: [
      { label: "In-stock rate", value: pct(subjRate, 1), note: `#${rank} of ${byBrand.length}`, tone: rank === 1 ? "good" : rank === byBrand.length ? "risk" : "watch" },
      { label: "Outages", value: String(eps.length), note: `${lost} listing-days lost` },
      { label: "Dead listings", value: String(full.length), note: "unavailable all quarter", tone: full.length ? "risk" : "good" },
      { label: "Longest outage", value: eps[0] ? `${eps[0].days}d` : "—", note: eps[0] ? `${shortModel(P.dims.models.find((m) => m.id === eps[0].model)?.label ?? "", S.label)} · ${RETAILER[eps[0].retailer]}` : undefined },
    ],
    blocks: [bars, table],
    report: {
      title: `${S.label} · Availability, ${niceDate(P.meta.window.start)} – ${niceDate(P.meta.window.end)}`,
      summary: `Where ${S.label} could not be bought on Amazon and Walmart over the quarter, and how that compares with the set.`,
      sections: [
        { title: "Against the set", text: "Share of live listing-days each brand could be bought.", blocks: [bars] },
        { title: "Listing by listing", text: "A 0% cell is a listing that never had a buyable offer in the quarter.", blocks: [table] },
        { title: "Every outage", text: "Continuous runs of unbuyable days.", blocks: [epTable] },
      ],
      method: ["Amazon availability is Keepa's buyable state; Walmart availability is the Walmart feed's stock reading, with a day without a reading counted as in stock.", "Target is left out because its readings are partly modelled."],
    },
  };
}
