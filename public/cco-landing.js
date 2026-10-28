/* Landing page: product-page content by model and retailer, built for a brand team deciding which pages to fix first */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC, F = CC.fmt;
const { B, RT, MD, kpi, metricKpi, card, intro, table, esc, mean, openDrawer, retailerScope, $$ } = U;
const el = (id) => document.getElementById(id);
const original = P.landing;
const ORDER = ["amazon", "walmart", "bestbuy", "target"];
const SIGNAL = { images: "Image gallery", video: "Product video", aplus: "A+ content", bullets: "Feature bullets", specs: "Spec table", reviews: "Reviews shown", titleKw: "Keywords in title" };
const SHORT = { images: "Images", video: "Video", aplus: "A+", bullets: "Bullets", specs: "Specs", reviews: "Reviews", titleKw: "Title" };
let tab = null, who = "subject";

const shortName = (m) => {
  const label = MD(m).label, brand = B(MD(m).brand).label;
  const tv = /BRAVIA \d+(?: II)?/i.exec(label) || (/\b65\b|65-Inch|65"/.test(label) && /\b([A-Z]{1,5}\d{1,4}[A-Z]{0,3})(\s+Pro)?\b/.exec(label));
  return tv ? tv[0] : label.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "");
};
const tone = (v) => (v == null ? "var(--mute)" : v >= 0.85 ? "var(--good)" : v >= 0.5 ? "var(--warn)" : "var(--risk)");
const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
const cover = (list, f) => (list.length ? list.filter((r) => r.fields[f.id]).length / list.length : null);

function show(x) {
  const d = U.D, cap = window.__CCCAPTURES ? window.__CCCAPTURES.latest(x.model, x.retailer) : null;
  openDrawer(`${B(MD(x.model).brand).label} ${shortName(x.model)} · ${RT(x.retailer).label}`, `Page content score ${x.score}/100${cap ? ` · read from the page captured ${F.date(cap.date)}` : ""}`,
    table([{ label: "Signal", lft: true, get: (f) => SIGNAL[f.id] || f.label },
           { label: "On the page", get: (f) => (x.fields[f.id] ? `<b style="color:var(--good)">${f.max === 1 ? "✓" : x.fields[f.id] + " of " + f.max}</b>` : `<span style="color:var(--risk)">missing</span>`) }], d.dims.pdpFields)
    + (readOf(x) && (readOf(x).collapsed.length || readOf(x).notes) ? `<p class="mini" style="margin:10px 0 0">${readOf(x).collapsed.length ? `<b>Collapsed on the page:</b> ${readOf(x).collapsed.map((k) => (SIGNAL[k] || k).toLowerCase()).join(", ")}, counted as a full list${readOf(x).read && readOf(x).read.bullets != null ? ` (${readOf(x).read.bullets} lines readable in the capture)` : ""}. ` : ""}${esc(readOf(x).notes || "")}</p>` : "")
    + (cap ? window.__CCCAPTURES.detail(cap) : ""));
  if (cap) window.__CCCAPTURES.bind(el("drBody"));
}

const readOf = (r) => ((U.D.captures && U.D.captures.reads) || {})[`${r.model}|${r.retailer}`] || null;

function cell(r, f) {
  const v = r.fields[f.id] || 0;
  const rd = readOf(r);
  if (rd && (rd.collapsed || []).includes(f.id)) return `<span class="tnum" style="color:var(--good)" title="The list is collapsed on the page (${rd.read ? rd.read[f.id] : "some"} lines readable), so the full list is counted">${v}/${f.max}▾</span>`;
  if (!v) return '<span style="color:var(--risk)" title="missing">✕</span>';
  if (f.max === 1) return '<span style="color:var(--good)">✓</span>';
  return `<span class="tnum" style="color:${v >= f.max ? "var(--good)" : "var(--warn)"}">${v}/${f.max}</span>`;
}

function drawTable(rows, S) {
  const d = U.D, fields = d.dims.pdpFields;
  const list = rows.filter((r) => r.retailer === tab && (who === "all" || r.brand === S)).sort((a, z) => (z.brand === S) - (a.brand === S) || a.score - z.score);
  $$("#lpTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
  $$("#lpWho button").forEach((b) => b.classList.toggle("on", b.dataset.w === who));
  el("lpMatrix").innerHTML = list.length ? table([
    { label: "", lft: true, get: (r) => { const c = window.__CCCAPTURES && window.__CCCAPTURES.latest(r.model, r.retailer); return c && c.top ? `<img src="${esc(c.top)}" alt="" loading="lazy" style="display:block;width:56px;height:36px;object-fit:cover;object-position:top;border:1px solid var(--line2);border-radius:4px">` : ""; } },
    { label: "Model", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span><b style="font-weight:500">${esc(shortName(r.model))}</b>${who === "all" ? ` <span class="mini">${esc(B(r.brand).label)}</span>` : ""}` },
    ...fields.map((f) => ({ label: `<span title="${esc(SIGNAL[f.id] || f.label)}">${SHORT[f.id] || f.label}</span>`, get: (r) => cell(r, f) })),
    { label: "Score", get: (r) => `<b class="tnum" style="color:${tone(r.score / 100)}">${r.score}</b>` },
  ], list.map((r) => ({ ...r, _subject: r.brand === S }))) : `<p class="mini">No ${who === "all" ? "" : U.SUBJ + " "}pages read at ${RT(tab).label}.</p>`;
  $$("#lpMatrix tbody tr").forEach((tr, i) => { tr.style.cursor = "pointer"; tr.onclick = () => show(list[i]); });
}

P.landing = (host) => {
  const d = U.D, S = U.S, SUBJ = U.SUBJ, rts = retailerScope();
  const rows = (d.pdpScores || []).filter((p) => rts.includes(p.retailer));
  const mine = rows.filter((r) => r.brand === S);
  if (!mine.length) return original(host);
  const fields = d.dims.pdpFields;
  const retailers = ORDER.filter((r) => rows.some((x) => x.retailer === r)).concat([...new Set(rows.map((x) => x.retailer))].filter((r) => !ORDER.includes(r)));
  if (!tab || !retailers.includes(tab)) tab = retailers.find((r) => mine.some((x) => x.retailer === r)) || retailers[0];
  const byRt = retailers.map((rt) => ({ rt, v: mean(mine.filter((x) => x.retailer === rt).map((x) => x.score)) })).filter((x) => x.v != null).sort((a, z) => a.v - z.v);
  const missing = fields.map((f) => ({ f, n: mine.filter((r) => !r.fields[f.id]).length })).sort((a, z) => z.n - a.n)[0];
  const models = [...new Set(mine.map((r) => r.model))];
  host.innerHTML = `
  ${intro(`Seven content signals on every product page, at every retailer: image gallery, video, A+ content, feature bullets, spec table, reviews and title keywords. Scored the same way everywhere, so a gap is a real gap. A feature list collapsed behind \"See all\" counts as a full list and is marked ▾. Start with the weakest cells and the signals ${SUBJ} misses most.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("pdpScore", S)}
    ${kpi({ label: "Weakest retailer", dot: "#d93025", value: byRt[0] ? `${Math.round(byRt[0].v)}<small> /100</small>` : "—", note: byRt[0] ? `${RT(byRt[0].rt).label}; best is ${RT(byRt[byRt.length - 1].rt).label} at ${Math.round(byRt[byRt.length - 1].v)}` : "" })}
    ${kpi({ label: missing && missing.n ? `Most often missing: ${(SIGNAL[missing.f.id] || missing.f.label).toLowerCase()}` : "Most often missing", dot: missing && missing.n ? "#e37400" : "#1e8e3e", value: missing ? `${missing.n}<small> / ${mine.length}</small>` : "0", note: `${SUBJ} pages without it` })}
    ${kpi({ label: "Pages read", dot: B(S).color, value: String(rows.length), note: `${mine.length} ${SUBJ} pages across ${retailers.length} retailers` })}
  </div>
  <div class="grid g2" style="margin-bottom:14px">
    ${card({ title: `${SUBJ} page score by model and retailer`, help: "The content score of each model's product page at each retailer, out of 100. A pale cell is a page to fix first.", sub: "Out of 100. Click a cell to open the page and what it is missing.", slot: "lpHeat" })}
    ${card({ title: `What ${SUBJ}'s pages carry, by retailer`, help: "For each content signal, the share of the brand's pages at each retailer that carry it, with the best competitor at that retailer for comparison.", sub: `Share of ${SUBJ} pages with each signal. Best competitor at that retailer underneath.`, slot: "lpCover" })}
  </div>
  ${card({ title: "Every page", help: "Each product page read, with the seven signals and its score. Pick a retailer; switch to all brands to compare with competitors.", sub: "Weakest first. Click a row for the page screenshot and everything read from it.",
    html: `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px"><div class="seg mini" id="lpTabs">${retailers.map((r) => `<button data-t="${r}">${RT(r).label}</button>`).join("")}</div><div class="seg mini" id="lpWho"><button data-w="subject">${esc(SUBJ)}</button><button data-w="all">All brands</button></div></div><div id="lpMatrix"></div>` })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: `Where ${SUBJ} trails`, help: "For each signal, the share of the subject's pages that carry it against the best competitor, biggest gap first.", sub: `Each signal, ${SUBJ}'s coverage against the best competitor across all retailers.`, slot: "lpGaps" })}
    ${card({ title: "Mean page score", help: "Each brand's average page score across its pages in scope.", sub: "Every brand, across the retailers in scope.", slot: "lpBars" })}
  </div>`;

  const score = (m, rt) => { const x = mine.find((r) => r.model === m && r.retailer === rt); return x ? x.score : null; };
  CC.heatmap(el("lpHeat"), { rows: models.map((m) => ({ id: m })), cols: retailers.map((r) => ({ id: r, label: RT(r).label })), corner: "Model ╲ Retailer", min: 40, max: 100, ramp: "red", invert: true,
    rowLabel: (r) => esc(shortName(r.id)), rowDot: () => B(S).color, colLabel: (c) => c.label, fmtCell: (r, c, v) => String(v), scaleNote: "Page score",
    value: (r, c) => score(r.id, c.id), onPick: (r, c) => { const x = mine.find((p) => p.model === r.id && p.retailer === c.id); if (x) show(x); } });

  el("lpCover").innerHTML = `<div style="overflow-x:auto"><table class="cc-heat-t" style="width:100%;font-size:12.5px"><thead><tr><th style="text-align:left">Signal</th>${retailers.map((r) => `<th>${RT(r).label}</th>`).join("")}</tr></thead><tbody>${fields.map((f) => `<tr><th style="text-align:left;font-weight:500;padding:6px 8px 6px 0">${SIGNAL[f.id] || f.label}</th>${retailers.map((rt) => {
    const own = cover(mine.filter((r) => r.retailer === rt), f);
    const rivals = [...new Set(rows.filter((r) => r.retailer === rt && r.brand !== S).map((r) => r.brand))].map((b) => ({ b, v: cover(rows.filter((r) => r.retailer === rt && r.brand === b), f) })).sort((a, z) => z.v - a.v)[0];
    return `<td style="text-align:center;padding:6px 4px"><b class="tnum" style="color:${tone(own)}">${pct(own)}</b>${rivals ? `<div class="mini" style="color:var(--mute)">${esc(B(rivals.b).label)} ${pct(rivals.v)}</div>` : ""}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;

  $$("#lpTabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; drawTable(rows, S); }));
  $$("#lpWho button").forEach((b) => (b.onclick = () => { who = b.dataset.w; drawTable(rows, S); }));
  drawTable(rows, S);

  const rivals = [...new Set(rows.filter((r) => r.brand !== S).map((r) => r.brand))];
  const gaps = fields.map((f) => { const own = cover(mine, f); const best = rivals.map((b) => ({ b, v: cover(rows.filter((r) => r.brand === b), f) })).sort((a, z) => z.v - a.v)[0]; return { f, own, best, gap: best ? best.v - own : 0 }; }).sort((a, z) => z.gap - a.gap);
  el("lpGaps").innerHTML = `<div style="display:flex;flex-direction:column">${gaps.map((g) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line2)"><div><b style="font-weight:500">${SIGNAL[g.f.id] || g.f.label}</b><div class="mini">${SUBJ} ${pct(g.own)}${g.best ? ` · ${esc(B(g.best.b).label)} ${pct(g.best.v)}` : ""}</div></div>${g.gap > 0.001 ? `<span class="tag risk">${SUBJ} trails</span>` : '<span class="tag good">level or ahead</span>'}</div>`).join("")}</div>`;
  const means = d.dims.brands.map((b) => ({ b, v: mean(rows.filter((r) => r.brand === b.id).map((r) => r.score)) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v);
  CC.hbars(el("lpBars"), { rows: means.map(({ b, v }) => ({ label: b.label, value: v, color: b.color, subject: b.id === S })), fmtV: (v) => Math.round(v) + " /100" });
};
})();
