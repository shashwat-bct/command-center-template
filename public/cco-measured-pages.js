/* ===========================================================================
   MEASURED-ONLY PAGES — Amazon demand, Amazon shelf, effective price
   Used when a payload carries the measured sections; otherwise the original
   page renders unchanged.
   =========================================================================== */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC, F = CC.fmt;
const { B, MD, kpi, metricKpi, card, intro, table, esc, slice, mean, sum, readsBlock, winDates } = U;
const D = () => U.D;
const el = (id) => document.getElementById(id);
const original = { traffic: P.traffic, shelf: P.shelf, tco: P.tco };

const nums = (arr) => (arr || []).filter((v) => v != null);
const last = (arr) => { const v = nums(arr); return v.length ? v[v.length - 1] : null; };
const modelsOf = (b) => D().dims.models.filter((m) => m.brand === b);
const series = (get) => D().dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: get(b.id) }))
  .filter((s) => s.data && s.data.some((v) => v != null));
const dailyAcross = (ids, get, combine) => winDates().map((_, i) => {
  const vals = ids.map((id) => slice(get(id) || [])[i]).filter((v) => v != null);
  return vals.length ? combine(vals) : null;
});

P.traffic = (host) => {
  const d = D(), dm = d.demand;
  if (!dm) return original.traffic(host);
  const S = U.S, SUBJ = U.SUBJ;
  const soldOf = (b) => modelsOf(b).reduce((n, m) => n + (last((dm.listings[m.id] || {}).monthlySold) || 0), 0);
  const total = d.dims.brands.reduce((n, b) => n + soldOf(b.id), 0);
  const bestRank = (b) => { const r = modelsOf(b).map((m) => last((dm.listings[m.id] || {}).rank)).filter((v) => v != null); return r.length ? Math.min(...r) : null; };
  const rankNote = dm.rankCategoryName ? `Amazon's "${esc(dm.rankCategoryName)}" category, which every compared listing shares` : dm.rankCategory ? `Amazon category ${esc(dm.rankCategory)}, which the compared listings share` : "each listing's top-level Amazon category";
  host.innerHTML = `
  ${intro(`Website visits are not measured. What is measured is demand on Amazon: how many units each tracked listing sold
    in the past month (Amazon's own "bought in past month" figure, which is a floor — 1K+ means at least 1,000) and its
    daily sales rank in ${rankNote}. Lower rank means more sales.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Bought in past month", dot: B(S).color, value: F.k(soldOf(S)), note: `At least, across ${modelsOf(S).length} ${SUBJ} listings` })}
    ${kpi({ label: "Share of tracked purchases", dot: B(S).color, value: total ? F.pct((soldOf(S) / total) * 100) : "—", note: `Of ${F.k(total)} across every tracked listing` })}
    ${kpi({ label: "Best sales rank", dot: B(S).color, value: bestRank(S) == null ? "—" : "#" + F.n(bestRank(S)), note: "Latest reading, best of the brand's listings" })}
    ${kpi({ label: "Listings tracked", dot: "#80868b", value: String(d.dims.models.length), note: `Across ${d.dims.brands.filter((b) => modelsOf(b.id).length).length} brands` })}
  </div>
  <div class="grid g2">
    ${card({ title: "Bought in past month", help: "Amazon's \"bought in past month\" figure for each brand's tracked listings, summed, as Keepa recorded it. Amazon shows it in buckets (50+, 100+, 1K+), so each value is a floor.", sub: "Summed across each brand's tracked listings. A floor, not an exact count.", slot: "dmSold" })}
    ${card({ title: "Sales rank through the quarter", help: "The best (lowest) daily Amazon sales rank among each brand's tracked listings, in one shared category so brands are comparable. Lower is better.", sub: "Best daily rank among each brand's listings. Lower is better.", slot: "dmRank" })}
  </div>
  <div style="margin-top:14px">${card({ title: "Every tracked listing", help: "Latest readings per listing.", html: table([
    { label: "Listing", lft: true, get: (m) => `<span class="dot" style="background:${B(m.brand).color}"></span>${esc(m.label)}` },
    { label: "Brand", lft: true, get: (m) => esc(B(m.brand).label) },
    { label: "Bought in past month", get: (m) => { const v = last((dm.listings[m.id] || {}).monthlySold); return v == null ? "—" : F.n(v) + "+"; } },
    { label: "Sales rank", get: (m) => { const v = last((dm.listings[m.id] || {}).rank); return v == null ? "—" : "#" + F.n(v); } },
  ], d.dims.models.map((m) => ({ ...m, _subject: m.brand === S }))) })}</div>
  <h2 class="sec">What the demand says</h2>${readsBlock("demand")}`;
  const ds = winDates();
  CC.line(el("dmSold"), { height: 240, x: ds, series: series((b) => dailyAcross(modelsOf(b).map((m) => m.id), (id) => (dm.listings[id] || {}).monthlySold, (v) => sum(v))), fmtV: F.k, fmtY: F.k });
  CC.line(el("dmRank"), { height: 240, x: ds, zero: false, series: series((b) => dailyAcross(modelsOf(b).map((m) => m.id), (id) => (dm.listings[id] || {}).rank, (v) => Math.min(...v))), fmtV: (v) => "#" + F.n(v), fmtY: F.k });
};

P.shelf = (host) => {
  const d = D(), sh = d.shelf && d.shelf.measured;
  if (!sh) return original.shelf(host);
  const S = U.S, SUBJ = U.SUBJ;
  const other = sh.results.filter((r) => !r.brand).length;
  const first = (sh.firstPosition || {})[S];
  host.innerHTML = `
  ${intro(`The first ${sh.depth} organic Amazon search results for <b>"${esc(sh.term)}"</b> on ${esc(sh.capturedAt)}, each attributed to a
    brand by its title. One reading per build. Sponsored placements are not identified by the crawler, so this is the organic grid only.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("shelfSov", S)}
    ${kpi({ label: "Best position", dot: B(S).color, value: first == null ? "—" : "#" + first, note: first == null ? `No ${SUBJ} listing in the first ${sh.depth}` : `Of the first ${sh.depth} results` })}
    ${kpi({ label: `${SUBJ} results`, dot: B(S).color, value: String(sh.results.filter((r) => r.brand === S).length), note: `Of ${sh.depth} read` })}
    ${kpi({ label: "Held by other brands", dot: "#80868b", value: F.pct((other / Math.max(1, sh.depth)) * 100), note: "Brands outside the tracked set" })}
  </div>
  <div class="grid g2">
    ${card({ title: "Share of the first results", help: "Each brand's share of the organic result positions read.", sub: `Share of the first ${sh.depth} organic results for "${esc(sh.term)}".`, slot: "shBars" })}
    ${card({ title: "The results, in order", help: "Every result read, with the brand it was attributed to. A result whose title names none of the tracked brands is counted as another brand.", html: table([
      { label: "#", get: (r) => String(r.position) },
      { label: "Listing", lft: true, get: (r) => esc(r.title.slice(0, 80)) },
      { label: "Brand", lft: true, get: (r) => r.brand ? `<span class="dot" style="background:${B(r.brand).color}"></span>${esc(B(r.brand).label)}` : "other" },
      { label: "Price", get: (r) => r.price == null ? "—" : F.usd(r.price) },
    ], sh.results.map((r) => ({ ...r, _subject: r.brand === S })), { maxH: "420px" }) })}
  </div>
  <h2 class="sec">What the shelf says</h2>${readsBlock("shelf")}`;
  CC.hbars(el("shBars"), { rows: d.dims.brands.map((b) => ({ label: b.label, value: sh.share[b.id] || 0, color: b.color }))
    .concat([{ label: "Other brands", value: (other / Math.max(1, sh.depth)) * 100, color: "#9aa0a6" }]), fmtV: (v) => F.pct(v) });
};

P.tco = (host) => {
  const d = D(), ep = d.effectivePrice;
  if (!ep) return original.tco(host);
  const S = U.S, SUBJ = U.SUBJ;
  const ids = (b) => modelsOf(b).map((m) => m.id).filter((id) => ep.listings[id]);
  const avg = (b, get) => mean(ids(b).flatMap((id) => nums(slice(get(id)))));
  const effOf = (b) => avg(b, (id) => ep.listings[id].effective);
  const priceOf = (b) => avg(b, (id) => d.pricing.price[`${id}|amazon`]);
  const days = (b, test) => ids(b).reduce((n, id) => n + slice(test(id)).filter(Boolean).length, 0);
  const couponDays = (b) => days(b, (id) => ep.listings[id].couponOff.map((v) => (v || 0) > 0));
  const dealDays = (b) => days(b, (id) => ep.listings[id].deal.map((v) => v === 1));
  host.innerHTML = `
  ${intro(`What a shopper pays at checkout on Amazon, before tax: the day's price, the lightning-deal price when a deal was live,
    less any one-time clip coupon. Protection plans, card offers and how many buyers take them are not measured and not included.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Average effective price", dot: B(S).color, value: effOf(S) == null ? "—" : F.usd(effOf(S)), note: `${SUBJ} listings, selected window` })}
    ${kpi({ label: "Saved at checkout", dot: B(S).color, value: effOf(S) == null || !priceOf(S) ? "—" : F.pct((1 - effOf(S) / priceOf(S)) * 100), note: priceOf(S) ? `Against an average ${F.usd(priceOf(S))} Amazon price` : "" })}
    ${kpi({ label: "Coupon days", dot: B(S).color, value: String(couponDays(S)), note: "Listing-days with a clip coupon" })}
    ${kpi({ label: "Lightning-deal days", dot: B(S).color, value: String(dealDays(S)), note: "Listing-days with a live deal" })}
  </div>
  ${card({ title: "Effective price as a share of list", help: "Each brand's average checkout price (after deals and coupons) divided by list price, daily, across its tracked listings.", sub: "Daily, averaged across each brand's tracked listings. 100% means paying list price.", slot: "epLine" })}
  <div style="margin-top:14px">${card({ title: "By brand", help: "Averages over the selected window.", html: table([
    { label: "Brand", lft: true, get: (r) => `<span class="dot" style="background:${B(r.b).color}"></span>${esc(B(r.b).label)}` },
    { label: "Listings", get: (r) => String(ids(r.b).length) },
    { label: "Amazon price", get: (r) => priceOf(r.b) == null ? "—" : F.usd(priceOf(r.b)) },
    { label: "Effective price", get: (r) => effOf(r.b) == null ? "—" : F.usd(effOf(r.b)) },
    { label: "Coupon days", get: (r) => String(couponDays(r.b)) },
    { label: "Deal days", get: (r) => String(dealDays(r.b)) },
  ], d.dims.brands.filter((b) => ids(b.id).length).map((b) => ({ b: b.id, _subject: b.id === S }))) })}</div>
  <h2 class="sec">What checkout prices say</h2>${readsBlock("tco")}`;
  const ds = winDates();
  CC.line(el("epLine"), { height: 250, x: ds, zero: false, series: series((b) => dailyAcross(ids(b), (id) => ep.listings[id].effective.map((v, i) => (v == null || !ep.listings[id].list[i] ? null : (v / ep.listings[id].list[i]) * 100)), (v) => mean(v))), fmtV: (v) => F.pct(v), fmtY: (v) => v.toFixed(1) + "%" });
};
})();
