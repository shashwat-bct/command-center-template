/* Ask Atlas: answer blocks (KPIs, takeaway, what/why/when, moves, tables, bar and line charts, quotes) */
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
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
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
    return `<div class="atl-blk">${head}<div data-atl-table="${esc(key)}"></div></div>`;
  }
  if (b.type === "quotes") {
    return `<div class="atl-blk">${head}<div class="atl-q">${b.items.map((q) => `<blockquote data-tone="${esc(q.tone)}">“${esc(q.text)}”<cite>${esc(q.meta)}</cite></blockquote>`).join("")}</div></div>`;
  }
  return `<div class="atl-blk">${head}<div data-atl-chart="${esc(key)}"></div></div>`;
}

const FILTER_COLS = /^(brand|retailer|stage|engine)$/i;
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };

/**
 * A table with a search box, a chip filter for each brand, retailer or stage column, and
 * sortable headers; highlighted rows stay highlighted through filtering and sorting.
 */
function drawTable(host, b) {
  const hi = new Set(b.highlight || []);
  const rows = b.rows.map((r, i) => ({ r, hi: hi.has(i) }));
  const facets = b.columns.map((c, j) => (FILTER_COLS.test(c.label) ? { j, label: c.label, values: [...new Set(b.rows.map((r) => String(r[j])))] } : null)).filter((f) => f && f.values.length > 1);
  const st = { q: "", sort: null, dir: 1, pick: {} };
  host.innerHTML = `<div class="atl-tbar"><input type="search" class="atl-search" placeholder="Search ${b.rows.length} rows" aria-label="Search the table">
    ${facets.map((f) => `<div class="atl-chips" data-j="${f.j}"><span>${esc(f.label)}</span><button type="button" class="on" data-v="">All</button>${f.values.map((v) => `<button type="button" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div>`).join("")}
    <span class="atl-count"></span></div>
    <div class="dt-wrap"><table class="dt"><thead><tr>${b.columns.map((c, j) => `<th class="${c.align === "left" ? "lft" : ""}" data-j="${j}" tabindex="0" aria-sort="none">${esc(c.label)}<i></i></th>`).join("")}</tr></thead><tbody></tbody></table></div>`;
  const body = host.querySelector("tbody"), count = host.querySelector(".atl-count");
  const paint = () => {
    const q = st.q.toLowerCase();
    let list = rows.filter(({ r }) => (!q || r.some((v) => String(v).toLowerCase().includes(q))) && Object.entries(st.pick).every(([j, v]) => !v || String(r[j]) === v));
    if (st.sort != null) list = list.slice().sort((x, y) => { const a = x.r[st.sort], z = y.r[st.sort], na = num(a), nz = num(z);
      return (na != null && nz != null ? na - nz : String(a).localeCompare(String(z))) * st.dir; });
    body.innerHTML = list.map(({ r, hi }) => `<tr class="${hi ? "subj" : ""}">${r.map((v, j) => `<td class="${b.columns[j] && b.columns[j].align === "left" ? "lft" : "num"}">${esc(v == null ? "—" : v)}</td>`).join("")}</tr>`).join("")
      || `<tr><td colspan="${b.columns.length}" class="lft" style="color:var(--mute)">No rows match.</td></tr>`;
    count.textContent = `${list.length} of ${rows.length}`;
    host.querySelectorAll("th").forEach((th) => { const on = Number(th.dataset.j) === st.sort; th.setAttribute("aria-sort", on ? (st.dir > 0 ? "ascending" : "descending") : "none"); th.querySelector("i").textContent = on ? (st.dir > 0 ? " ↑" : " ↓") : ""; });
  };
  host.querySelector(".atl-search").addEventListener("input", (e) => { st.q = e.target.value; paint(); });
  host.querySelectorAll(".atl-chips").forEach((g) => g.addEventListener("click", (e) => { const btn = e.target.closest("button"); if (!btn) return;
    st.pick[g.dataset.j] = btn.dataset.v; g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === btn)); paint(); }));
  const sortBy = (th) => { const j = Number(th.dataset.j); st.dir = st.sort === j ? -st.dir : 1; st.sort = j; paint(); };
  host.querySelectorAll("th").forEach((th) => { th.addEventListener("click", () => sortBy(th)); th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(th); } }); });
  paint();
}

function insightHtml(a) {
  return `<div class="atl-ins"><h6>${svg("spark")}Business takeaway</h6><p>${esc(a.insight)}</p></div>`;
}

function actionsHtml(a) {
  return `<div class="atl-acts"><h6>Recommended moves</h6><ol>${a.actions.map((x) => `<li><b>${esc(x.title)}</b><p>${esc(x.detail)}</p><span>${esc(x.impact)}</span></li>`).join("")}</ol></div>`;
}

/**
 * Draws every chart and table placeholder inside `root` from the blocks it was rendered with.
 */
function drawCharts(root, blocks) {
  root.querySelectorAll("[data-atl-table]").forEach((host) => { const b = blocks[host.getAttribute("data-atl-table")]; if (b) drawTable(host, b); });
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

window.__ATLAS = { esc, svg, ICON, kpisHtml, wwwHtml, insightHtml, actionsHtml, blocksHtml, drawCharts };
})();
