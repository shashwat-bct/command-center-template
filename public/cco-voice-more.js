/* Voice of Customer: the charts below the aspect and rating cards — mention mix and gap to the
   best competitor */
(function () {
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const GOOD = "#1e8e3e", BAD = "#d93025";

function card(id, title, sub) {
  return `<div class="card"><div class="card-h"><div class="ct"><h3>${esc(title)}</h3><p>${esc(sub)}</p></div></div><div id="${id}"></div></div>`;
}


/**
 * Appends the extra Voice of Customer charts to the page: the aspect charts from the
 * aspect mention counts.
 */
function draw(host) {
  const cc = window.__CC, D = cc && cc.D;
  if (!D) return;
  drawAspects(host, cc, D);
}

function drawAspects(host, cc, D) {
  const counts = D.voice && D.voice.aspectCounts;
  if (!counts || !counts[cc.S]) return;
  const S = cc.S, F = CC.fmt;
  const brands = D.dims.brands.filter((b) => counts[b.id]);
  const aspects = D.dims.aspects.filter((a) => counts[S][a]);
  const share = (b, a) => { const c = counts[b] && counts[b][a]; return c && c.positive + c.negative ? (c.positive / (c.positive + c.negative)) * 100 : null; };
  const subj = brands.find((b) => b.id === S);
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="grid g2" style="margin-top:14px">
    ${card("vmMix", `${subj.label}: praise vs complaints by aspect`, "Positive and negative review mentions per aspect, Amazon and Walmart combined")}
    ${card("vmGap", `${subj.label} against the best competitor`, "Positive share minus the best rival's on each aspect, in points; below zero is a gap to close")}
  </div>`;
  host.append(...wrap.children);
  CC.bars(document.getElementById("vmMix"), { height: 250, stacked: true, cats: aspects, fmtV: F.n, fmtY: F.k,
    series: [{ id: "pos", label: "Positive", color: GOOD, data: aspects.map((a) => counts[S][a].positive) }, { id: "neg", label: "Negative", color: BAD, data: aspects.map((a) => counts[S][a].negative) }] });
  const gaps = aspects.map((a) => { const mine = share(S, a); const best = brands.filter((b) => b.id !== S).map((b) => ({ b, v: share(b.id, a) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v)[0];
    return { a, v: mine != null && best ? mine - best.v : null, best }; }).filter((x) => x.v != null).sort((x, y) => x.v - y.v);
  CC.hbars(document.getElementById("vmGap"), { rows: gaps.map((g) => ({ label: esc(g.a), value: Math.round(g.v), color: g.v < 0 ? BAD : GOOD, note: `best rival ${esc(g.best.b.label)} ${Math.round(g.best.v)}%` })),
    max: Math.max(...gaps.map((g) => Math.abs(g.v)), 1), fmtV: (v) => `${v > 0 ? "+" : ""}${v} pts` });
}

window.__CCVOICE = { draw };
})();
