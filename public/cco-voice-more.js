/* Voice of Customer: the charts below the aspect and rating cards — mention mix, gap to the
   best competitor, and the Walmart star mix and recommend rate */
(function () {
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const GOOD = "#1e8e3e", BAD = "#d93025";

function card(id, title, sub) {
  return `<div class="card"><div class="card-h"><div class="ct"><h3>${esc(title)}</h3><p>${esc(sub)}</p></div></div><div id="${id}"></div></div>`;
}

const STARS = [{ n: 5, color: "#1e8e3e" }, { n: 4, color: "#81c995" }, { n: 3, color: "#fdd663" }, { n: 2, color: "#f29900" }, { n: 1, color: "#d93025" }];

function walmartReviews(D) {
  const feed = D.retailFeed, sums = feed && feed.reviewSummary;
  if (!sums) return [];
  const brandOf = new Map((feed.products || []).map((p) => [p.id, p.brand]));
  return D.dims.brands.map((b) => {
    const own = Object.entries(sums).filter(([id]) => brandOf.get(id) === b.id).map(([, x]) => x);
    const stars = [0, 0, 0, 0, 0];
    for (const x of own) (x.stars || []).forEach((v, i) => { stars[i] += v || 0; });
    const rated = own.filter((x) => x.recommendedPct != null && x.total);
    const weight = rated.reduce((t, x) => t + x.total, 0);
    return { b, stars, total: stars.reduce((t, v) => t + v, 0), recommend: weight ? rated.reduce((t, x) => t + x.recommendedPct * x.total, 0) / weight : null, recommendBase: weight };
  }).filter((r) => r.total);
}

function drawStars(host, cc, D) {
  const rows = walmartReviews(D);
  if (!rows.length) return;
  const F = CC.fmt;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="grid g2" style="margin-top:14px">
    ${card("vmStars", "Star mix by brand", "Share of each brand's Walmart ratings at each star level, from Walmart's review summaries")}
    ${card("vmRec", "Would recommend", "Share of Walmart reviewers who say they would recommend the product, weighted by each listing's review count")}
  </div>`;
  host.append(...wrap.children);
  CC.bars(document.getElementById("vmStars"), { height: 250, stacked: true, max: 100, cats: rows.map((r) => r.b.label), fmtV: (v) => `${v.toFixed(1)}%`, fmtY: (v) => `${v}%`,
    catLabel: (c, i) => `${c} · ${F.k(rows[i].total)}`,
    series: STARS.map((st) => ({ id: `s${st.n}`, label: `${st.n}★`, color: st.color, data: rows.map((r) => (r.stars[st.n - 1] / r.total) * 100) })) });
  CC.hbars(document.getElementById("vmRec"), { max: 100, fmtV: (v) => `${v.toFixed(0)}%`,
    rows: rows.filter((r) => r.recommend != null).map((r) => ({ label: esc(r.b.label), value: r.recommend, color: r.b.color, subject: r.b.id === cc.S,
      note: `${F.n(r.recommendBase)} reviews · ${(((r.stars[0] + r.stars[1]) / r.total) * 100).toFixed(1)}% rate 1–2★` })).sort((x, y) => y.value - x.value) });
}

/**
 * Appends the extra Voice of Customer charts to the page: the aspect charts from the
 * aspect mention counts, and the star mix and recommend rate from Walmart's review summaries.
 */
function draw(host) {
  const cc = window.__CC, D = cc && cc.D;
  if (!D) return;
  drawAspects(host, cc, D);
  drawStars(host, cc, D);
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
