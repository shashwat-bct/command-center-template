/* Landing page: product-page content by model and retailer, built for a brand team deciding which pages to fix first */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC, F = CC.fmt;
const { B, RT, MD, kpi, metricKpi, card, intro, table, esc, mean, openDrawer, retailerScope, $$ } = U;
const el = (id) => document.getElementById(id);
const original = P.landing;
const ORDER = ["amazon", "walmart", "bestbuy", "target"];
const SIGNAL = { images: "Image gallery", video: "Product video", aplus: "A+ content", bullets: "Feature bullets", specs: "Spec table", reviews: "Reviews shown", titleKw: "Keywords in title" };
const SHORT = { images: "images", video: "video", aplus: "A+", bullets: "bullets", specs: "specs", reviews: "reviews", titleKw: "title keywords" };

const shortName = (m) => {
  const label = MD(m).label, brand = B(MD(m).brand).label;
  const tv = /BRAVIA \d+(?: II)?/i.exec(label) || (/\b65\b|65-Inch|65"/.test(label) && /\b([A-Z]{1,5}\d{1,4}[A-Z]{0,3})(\s+Pro)?\b/.exec(label));
  return tv ? tv[0] : label.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "");
};
const AXIS = { images: "Image", video: "Video", aplus: "Enhanced", bullets: "Feature", specs: "Spec", reviews: "Reviews", titleKw: "Title" };
const fill = (r, f) => Math.min(1, (r.fields[f.id] || 0) / (f.max || 1));

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

const listingName = (r, S) => (r.brand === S ? shortName(r.model) : `${B(r.brand).label} ${shortName(r.model)}`);

P.landing = (host) => {
  const d = U.D, S = U.S, SUBJ = U.SUBJ, rts = retailerScope();
  const rows = (d.pdpScores || []).filter((p) => rts.includes(p.retailer));
  const mine = rows.filter((r) => r.brand === S);
  if (!mine.length) return original(host);
  const fields = d.dims.pdpFields;
  const retailers = ORDER.filter((r) => rows.some((x) => x.retailer === r)).concat([...new Set(rows.map((x) => x.retailer))].filter((r) => !ORDER.includes(r)));
  const models = [...new Set(mine.map((r) => r.model))];
  const weakest = [...mine].sort((a, z) => a.score - z.score)[0];
  const gap = fields.map((f) => ({ f, n: mine.filter((r) => !r.fields[f.id]).length })).sort((a, z) => z.n - a.n)[0];
  const brands = d.dims.brands.filter((b) => rows.some((r) => r.brand === b.id));
  const ranked = [...rows].sort((a, z) => z.score - a.score);

  host.innerHTML = `
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("pdpScore", S)}
    ${kpi({ label: "Listings scored", dot: B(S).color, value: String(mine.length), note: `Across ${new Set(mine.map((r) => r.retailer)).size} retailers` })}
    ${kpi({ label: `Weakest ${SUBJ} page`, dot: "#d93025", value: String(weakest.score), note: `${esc(shortName(weakest.model))} at ${RT(weakest.retailer).label}` })}
    ${kpi({ label: "Most common gap", dot: "#e37400", value: String(gap.n), note: gap.n ? `${esc((SIGNAL[gap.f.id] || gap.f.label).replace(/^[A-Z][a-z]/, (w) => w.toLowerCase()))} missing on ${gap.n} of ${mine.length} ${SUBJ} listings, the widest single gap` : `every ${SUBJ} listing carries every signal` })}
  </div>
  <div class="grid g2" style="margin-bottom:14px;align-items:start">
    ${card({ title: "Page score by model and retailer", help: "The content score of each model's product page at each retailer, out of 100. A pale cell is a page to fix first; a dash is a retailer where the model was not read.", sub: `${SUBJ} listings only. A pale cell is a page a shopper reaches and leaves.`, slot: "lpHeat" })}
    ${card({ title: "Mean page score", help: "Each brand's average page score across its pages in scope.", sub: "Every brand, across the retailers in scope.", slot: "lpBars" })}
  </div>
  <div class="grid g2" style="align-items:start">
    ${card({ title: "Signal completeness by brand", help: "For each brand, how complete each content signal is across its listings, over the grey average of the set.", sub: "One shape per brand over the same grey category average. The shape shows what each brand systematically does and does not ship.", slot: "lpRadar" })}
    ${card({ title: "Every listing, ranked", help: "Every product page read, best first, with the signals it is missing. Click a row for the signal-by-signal breakdown and the page screenshot.", sub: "Click a row for the signal-by-signal breakdown of that page.", slot: "lpRank" })}
  </div>`;

  const score = (m, rt) => { const x = mine.find((r) => r.model === m && r.retailer === rt); return x ? x.score : null; };
  CC.heatmap(el("lpHeat"), { rows: models.map((m) => ({ id: m })), cols: retailers.map((r) => ({ id: r, label: RT(r).label })), corner: "Model ╲ Retailer",
    rowLabel: (r) => esc(shortName(r.id)), colLabel: (c) => c.label, fmtCell: (r, c, v) => String(v), scaleNote: "Page content score /100",
    value: (r, c) => score(r.id, c.id), onPick: (r, c) => { const x = mine.find((p) => p.model === r.id && p.retailer === c.id); if (x) show(x); } });

  const axes = fields.map((f) => ({ id: f.id, label: AXIS[f.id] || f.label }));
  const shapeOf = (b) => fields.map((f) => mean(rows.filter((r) => r.brand === b).map((r) => fill(r, f))));
  const shapes = brands.map((b) => shapeOf(b.id));
  const avg = fields.map((f, i) => mean(shapes.map((s) => s[i]).filter((v) => v != null)));
  el("lpRadar").innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px">${brands.map((b) => `<div><div style="font-size:11px;font-weight:700;text-align:center;color:${b.color};margin-bottom:2px">${esc(b.label)}</div><div id="lpr-${b.id}"></div></div>`).join("")}</div>
    <p class="mini" style="margin:8px 0 0">Grey outline is the ${brands.length}-brand average. Each axis is how complete that signal is across the brand's listings, so a full shape is a brand that ships complete pages everywhere.</p>`;
  brands.forEach((b, i) => CC.radar(el("lpr-" + b.id), { size: 170, legend: false, axes,
    series: [{ id: "avg", label: "Category average", color: "#bdc1c6", values: avg, raw: avg.map((v) => (v == null ? null : Math.round(v * 100))) },
             { id: b.id, label: b.label, color: b.color, subject: true, values: shapes[i], raw: shapes[i].map((v) => (v == null ? null : Math.round(v * 100))) }] }));

  const means = brands.map((b) => ({ b, v: mean(rows.filter((r) => r.brand === b.id).map((r) => r.score)) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v);
  CC.hbars(el("lpBars"), { rows: means.map(({ b, v }) => ({ label: b.label, value: v, color: b.color, subject: b.id === S })), fmtV: (v) => Math.round(v) + " /100" });

  el("lpRank").innerHTML = `<div style="max-height:620px;overflow-y:auto">${table([
    { label: "Listing", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span>${esc(listingName(r, S))}` },
    { label: "Retailer", lft: true, get: (r) => RT(r.retailer).label },
    { label: "Score", get: (r) => `<b class="tnum">${r.score}</b>` },
    { label: "Missing", get: (r) => { const miss = fields.filter((f) => !r.fields[f.id]).map((f) => SHORT[f.id] || f.label); return miss.length ? `<span class="mini" style="color:var(--risk)">${esc(miss.join(", "))}</span>` : '<span class="mini">—</span>'; } },
  ], ranked.map((r) => ({ ...r, _subject: r.brand === S })))}</div>`;
  $$("#lpRank tbody tr").forEach((tr, i) => { tr.style.cursor = "pointer"; tr.onclick = () => show(ranked[i]); });
};
})();
