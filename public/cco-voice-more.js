/* Voice of Customer: the charts below the aspect and rating cards — mention mix, gap to the
   best competitor, where each brand's review mentions come from, and positive share by brand */
(function () {
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const GOOD = "#1e8e3e", BAD = "#d93025";
const RETAIL_COLOR = { amazon: "#ff9900", walmart: "#0071dc", target: "#cc0000" };

function card(id, title, sub) {
  return `<div class="card"><div class="card-h"><div class="ct"><h3>${esc(title)}</h3><p>${esc(sub)}</p></div></div><div id="${id}"></div></div>`;
}

/**
 * Appends the extra Voice of Customer charts to the page, from the aspect mention counts
 * the payload already carries; does nothing when no brand has aspect counts.
 */
function draw(host) {
  const cc = window.__CC, D = cc && cc.D;
  const counts = D && D.voice && D.voice.aspectCounts;
  if (!counts || !counts[cc.S]) return;
  const S = cc.S, F = CC.fmt;
  const brands = D.dims.brands.filter((b) => counts[b.id]);
  const aspects = D.dims.aspects.filter((a) => counts[S][a]);
  const share = (b, a) => { const c = counts[b] && counts[b][a]; return c && c.positive + c.negative ? (c.positive / (c.positive + c.negative)) * 100 : null; };
  const total = (b) => aspects.reduce((t, a) => { const c = counts[b][a]; return t + (c ? c.positive + c.negative : 0); }, 0);
  const pos = (b) => aspects.reduce((t, a) => t + ((counts[b][a] || {}).positive || 0), 0);
  const subj = brands.find((b) => b.id === S);
  const retailers = [...new Set(brands.flatMap((b) => aspects.flatMap((a) => Object.keys((counts[b.id][a] || {}).byRetailer || {}))))];
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="grid g2" style="margin-top:14px">
    ${card("vmMix", `${subj.label}: praise vs complaints by aspect`, "Positive and negative review mentions per aspect, Amazon and Walmart combined")}
    ${card("vmGap", `${subj.label} against the best competitor`, "Positive share minus the best rival's on each aspect, in points; below zero is a gap to close")}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card("vmSrc", "Where the review mentions come from", "Each brand's aspect mentions by retailer")}
    ${card("vmPos", "Positive share across all aspects", "Share of every aspect mention that is positive, by brand")}
  </div>`;
  host.append(...wrap.children);
  CC.bars(document.getElementById("vmMix"), { height: 250, stacked: true, cats: aspects, fmtV: F.n, fmtY: F.k,
    series: [{ id: "pos", label: "Positive", color: GOOD, data: aspects.map((a) => counts[S][a].positive) }, { id: "neg", label: "Negative", color: BAD, data: aspects.map((a) => counts[S][a].negative) }] });
  const gaps = aspects.map((a) => { const mine = share(S, a); const best = brands.filter((b) => b.id !== S).map((b) => ({ b, v: share(b.id, a) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v)[0];
    return { a, v: mine != null && best ? mine - best.v : null, best }; }).filter((x) => x.v != null).sort((x, y) => x.v - y.v);
  CC.hbars(document.getElementById("vmGap"), { rows: gaps.map((g) => ({ label: esc(g.a), value: Math.round(g.v), color: g.v < 0 ? BAD : GOOD, note: `best rival ${esc(g.best.b.label)} ${Math.round(g.best.v)}%` })),
    max: Math.max(...gaps.map((g) => Math.abs(g.v)), 1), fmtV: (v) => `${v > 0 ? "+" : ""}${v} pts` });
  CC.bars(document.getElementById("vmSrc"), { height: 250, stacked: true, cats: brands.map((b) => b.label), fmtV: F.n, fmtY: F.k,
    series: retailers.map((rt) => ({ id: rt, label: (cc.RT && cc.RT(rt) ? cc.RT(rt).label : rt), color: RETAIL_COLOR[rt] || "#9aa0a6", data: brands.map((b) => aspects.reduce((t, a) => { const r = ((counts[b.id][a] || {}).byRetailer || {})[rt]; return t + (r ? r.positive + r.negative : 0); }, 0)) })) });
  CC.hbars(document.getElementById("vmPos"), { rows: brands.map((b) => ({ label: esc(b.label), value: total(b.id) ? Math.round((pos(b.id) / total(b.id)) * 1000) / 10 : 0, color: b.color, subject: b.id === S, note: `${F.n(total(b.id))} mentions` })).sort((x, y) => y.value - x.value),
    max: 100, fmtV: (v) => `${v.toFixed(1)}%` });
}

window.__CCVOICE = { draw };
})();
