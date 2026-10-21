/* Ask Atlas: answer blocks (KPIs, what/why/when, tables, bar and line charts, quotes) and the full report page */
(function () {
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const F = () => CC.fmt;
const SVG = {
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="currentColor"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z" fill="currentColor"/>',
  chart: '<path d="M4 19h16M7 16V10M12 16V6M17 16v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  box: '<path d="M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k] || SVG.spark}</svg>`;
const ICON = { "black-friday": "tag", "price-per-wipe": "chart", "big-deal-days": "bolt", availability: "box", reviews: "star", "ai-visibility": "ai" };

const fmtFor = (unit) => ({
  usd: (v) => (v == null ? "—" : `$${Number(v).toFixed(2)}`),
  pct: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`),
  signedPct: (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`),
  num: (v) => (v == null ? "—" : Number(v).toFixed(1)),
})[unit] || ((v) => String(v));

function kpisHtml(kpis) {
  return `<div class="atl-kpis">${kpis.map((k) => `<div class="atl-k" data-tone="${esc(k.tone || "neutral")}"><span>${esc(k.label)}</span><b>${esc(k.value)}</b>${k.note ? `<em title="${esc(k.note)}">${esc(k.note)}</em>` : ""}</div>`).join("")}</div>`;
}

function wwwHtml(a) {
  return `<div class="atl-www">${[["What", a.what], ["Why", a.why], ["When", a.when]].map(([h, t]) => `<div class="atl-w"><h6>${h}</h6><p>${esc(t)}</p></div>`).join("")}</div>`;
}

function blockHtml(b, key) {
  const head = `<h5>${esc(b.title)}</h5>${b.sub ? `<p class="sub">${esc(b.sub)}</p>` : `<p class="sub"></p>`}`;
  if (b.type === "table") {
    const hi = new Set(b.highlight || []);
    return `<div class="atl-blk">${head}<div class="dt-wrap"><table class="dt"><thead><tr>${b.columns.map((c) => `<th class="${c.align === "left" ? "lft" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${b.rows.map((r, i) => `<tr class="${hi.has(i) ? "subj" : ""}">${r.map((v, j) => `<td class="${b.columns[j] && b.columns[j].align === "left" ? "lft" : "num"}">${esc(v == null ? "—" : v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  }
  if (b.type === "quotes") {
    return `<div class="atl-blk">${head}<div class="atl-q">${b.items.map((q) => `<blockquote data-tone="${esc(q.tone)}">“${esc(q.text)}”<cite>${esc(q.meta)}</cite></blockquote>`).join("")}</div></div>`;
  }
  return `<div class="atl-blk">${head}<div data-atl-chart="${esc(key)}"></div></div>`;
}

/**
 * Draws every chart placeholder inside `root` from the blocks it was rendered with.
 */
function drawCharts(root, blocks) {
  root.querySelectorAll("[data-atl-chart]").forEach((host) => {
    const b = blocks[host.getAttribute("data-atl-chart")];
    if (!b) return;
    const f = fmtFor(b.unit);
    if (b.type === "hbars") {
      CC.hbars(host, { rows: b.rows.map((r) => ({ label: esc(r.label), value: r.value, color: r.color, subject: r.subject, note: r.note ? esc(r.note) : "" })), fmtV: f,
        max: b.unit === "signedPct" ? Math.max(...b.rows.map((r) => Math.abs(r.value)), 1) : undefined });
    } else if (b.type === "line") {
      CC.line(host, { height: 260, x: b.x, zero: false, fmtV: f, fmtY: f,
        bands: (b.bands || []).map((x) => ({ start: x.start, end: x.end, label: x.label, color: "#1a73e8" })),
        series: b.series.map((s) => ({ id: s.id, label: s.label, color: s.color, subject: s.subject, data: s.data })) });
    }
  });
}

/**
 * Renders a list of blocks into HTML, returning the HTML and the keyed blocks drawCharts needs.
 */
function blocksHtml(list, prefix) {
  const keyed = {};
  const html = list.map((b, i) => { const k = `${prefix}-${i}`; keyed[k] = b; return blockHtml(b, k); }).join("");
  return { html, keyed };
}

function reportHtml(a, atlas, brand) {
  const keyed = {};
  const sections = a.report.sections.map((s, si) => {
    const r = blocksHtml(s.blocks, `rep-${a.id}-${si}`);
    Object.assign(keyed, r.keyed);
    return `<section class="atl-sec"><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${r.html}</section>`;
  }).join("");
  const html = `<div class="atl-rep">
    <a class="atl-back" href="#atlas">← Back to Ask Atlas</a>
    <header class="atl-rep-h"><small>Atlas report · ${esc(brand)}</small><h2>${esc(a.report.title)}</h2>
      <p class="atl-rep-q">${esc(a.question)}</p><p>${esc(a.headline)}</p><p>${esc(a.report.summary)}</p></header>
    ${kpisHtml(a.kpis)}${wwwHtml(a)}${sections}
    <div class="atl-method"><h3>How this was worked out</h3><ul>${a.report.method.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
      <p class="atl-src" style="margin:10px 0 0">Sources: ${esc(atlas.sources.join(" · "))} · prepared ${esc(F().date ? F().date(atlas.generatedOn) : atlas.generatedOn)}</p></div>
  </div>`;
  return { html, keyed };
}

window.__ATLAS = { esc, svg, ICON, kpisHtml, wwwHtml, blocksHtml, drawCharts, reportHtml };
})();
