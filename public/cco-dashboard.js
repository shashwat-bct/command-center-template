/* ===========================================================================
   COMMERCIAL COMMAND CENTER — the shell, shared by every subject
   ---------------------------------------------------------------------------
   Reads the payload named on the page's own <body data-payload> and paints
   fifteen driver pages behind a collapsible rail. One dashboard serves every
   subject: nothing here knows which brand it is showing. Every figure on screen
   comes out of the payload;
   nothing is written into the markup by hand, so a regenerated dataset moves
   the copy with it. Ranks and superlatives are computed at build time and read
   from `reads`, never typed here.
   =========================================================================== */
(function () {
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let D = null, F = null;                   // payload · CC.fmt
// The subject and its label belong to the payload, not to this file. They are
// set once it has loaded, before any page renders.
let S = "sonos", SUBJ = "";
const PAYLOAD = document.body.dataset.payload || "/sonos-command-center-data.json";
let cadence = "mbr", retailer = "all", page = "scorecard";
const painted = new Set();

/* ── extensions ─────────────────────────────────────────────────────────
   Another product can add its own groups to this rail; the Sony AI Engine
   Visibility console and AEO Workbench are the first. An extension owns the
   DOM of its pages (`managed`): the shell routes to them, swaps the top bar
   and marks the rail, but never draws into them. Registering before the
   payload has loaded queues the groups for buildNav; registering after it
   re-builds the rail and re-routes, so a hash naming an extension page
   resolves whichever script finished first. A page with no extension
   registered behaves exactly as before. */
const EXTS = [];
const extPages = () => EXTS.flatMap((x) => x.groups.flatMap((g) => g.pages));
const allPages = () => PAGES.concat(extPages());
window.__CCEXT = { register(ext) { EXTS.push(ext); if (D) { buildNav(); route(); } } };

/* ── icons ──────────────────────────────────────────────────────────────── */
const I = {
  grid:'<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  traffic:'<path d="M3 17l5-6 4 3 5-7 4 4"/><path d="M3 21h18"/>',
  sparkle:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  star:'<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  shelf:'<path d="M3 6h18M3 12h18M3 18h18"/><path d="M6 6v6M11 12v6M16 6v6"/>',
  page:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  box:'<path d="M3 8l9-5 9 5-9 5z"/><path d="M3 8v8l9 5 9-5V8"/>',
  stack:'<path d="M4 7h16v4H4zM4 13h16v4H4z"/>',
  truck:'<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  tag:'<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  percent:'<path d="M19 5L5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  wallet:'<path d="M3 7a2 2 0 012-2h13a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M16 12h4"/>',
  chess:'<path d="M8 21h8"/><path d="M10 21l1-6H8l2-3-2-2 2-2h4l2 2-2 2 2 3h-3l1 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};
const icon = (k, raw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw || I[k] || I.grid}</svg>`;

/* ── information architecture ───────────────────────────────────────────── */
const NAV = [
  { id: "overview",     label: "Overview",              pages: [{ id: "scorecard", label: "360° Scorecard", icon: "grid", crumb: "Overview", title: "360° Scorecard" }] },
  { id: "demand",       label: "Demand",                pages: [{ id: "traffic", label: "Website Traffic", icon: "traffic", crumb: "Demand", title: "Website Traffic" }] },
  { id: "mind",         label: "Share of Mind",         pages: [
      { id: "ai",      label: "AI Visibility",     icon: "sparkle", crumb: "Share of Mind", title: "AI Visibility" },
      { id: "voice",   label: "Voice of Customer", icon: "star",    crumb: "Share of Mind", title: "Voice of Customer" }] },
  { id: "visibility",   label: "Share of Visibility",   pages: [
      { id: "shelf",   label: "Retail Shelf",      icon: "shelf",   crumb: "Share of Visibility", title: "Retail Shelf" },
      { id: "landing", label: "Landing Pages",     icon: "page",    crumb: "Share of Visibility", title: "Landing Pages" }] },
  { id: "distribution", label: "Share of Distribution", pages: [
      { id: "carriage", label: "Carriage & Buy Box", icon: "box",   crumb: "Share of Distribution", title: "Carriage & Buy Box" },
      { id: "stock",    label: "Availability",       icon: "stack", crumb: "Share of Distribution", title: "Availability" },
      { id: "delivery", label: "Delivery Promise",   icon: "truck", crumb: "Share of Distribution", title: "Delivery Promise" }] },
  { id: "commercial",   label: "Commercial",            pages: [
      { id: "pricing",    label: "Pricing",            icon: "tag",      crumb: "Commercial", title: "Pricing" },
      { id: "promotions", label: "Promotions",         icon: "percent",  crumb: "Commercial", title: "Promotions" },
      { id: "calendar",   label: "Promo Calendar",     icon: "calendar", crumb: "Commercial", title: "Promotion Calendar" },
      { id: "tco",        label: "Cost of Ownership",  icon: "wallet",   crumb: "Commercial", title: "Total Cost of Ownership" },
      { id: "strategy",   label: "Promo Strategy",     icon: "chess",    crumb: "Commercial", title: "Promotion Strategy" }] },
  { id: "method",       label: "Method",                pages: [{ id: "method", label: "How this was built", icon: "info", crumb: "Method", title: "How this was built" }] },
];
const PAGES = NAV.flatMap((g) => g.pages);
const pageDef = (id) => allPages().find((p) => p.id === id) || PAGES[0];

/* ── data accessors ─────────────────────────────────────────────────────── */
const B = (id) => D.dims.brands.find((b) => b.id === id) || { id, label: id, color: "#888" };
const RT = (id) => D.dims.retailers.find((r) => r.id === id) || { id, label: id, color: "#888" };
const MD = (id) => D.dims.models.find((m) => m.id === id) || { id, label: id };
const BIDS = () => D.dims.brands.map((b) => b.id);
const AI_BIDS = () => BIDS().filter((b) => !D.ai || !D.ai.overall || D.ai.overall[b] != null);
const RIDS = () => D.dims.retailers.map((r) => r.id);
const period = () => D.dims.periods.find((p) => p.id === cadence);
const win = () => { const p = period(); return p.cur; };
const inWin = (i) => { const [a, z] = win(); return i >= a && i <= z; };
const slice = (arr) => { const [a, z] = win(); return arr.slice(a, z + 1); };
const winDates = () => slice(D.dims.dates);
const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const retailerScope = () => retailer === "all" ? RIDS() : [retailer];
const carriedPairs = () => Object.keys(D.distribution.carriage).filter((k) => D.distribution.carriage[k]);
const pairsFor = (brand, rts) => carriedPairs().filter((k) => {
  const [mid, rt] = k.split("|");
  return (!brand || MD(mid).brand === brand) && (!rts || rts.includes(rt));
});
const sc = (metric, brand) => (D.scorecard[cadence][metric] || {})[brand] || {};
const metricDef = (id) => D.dims.metrics.find((m) => m.id === id) || {};
const bands = () => D.dims.events.map((e) => ({ start: e.start, end: e.end, label: e.label, color: e.kind === "platform" ? "#1a73e8" : e.kind === "brand" ? "#9334e6" : "#5f6368" }));
const winBands = () => { const ds = winDates(); return bands().filter((b) => b.end >= ds[0] && b.start <= ds.at(-1))
  .map((b) => ({ ...b, start: b.start < ds[0] ? ds[0] : b.start, end: b.end > ds.at(-1) ? ds.at(-1) : b.end })); };

/* ── shared components ──────────────────────────────────────────────────── */
function fmtFor(id) {
  const u = (metricDef(id) || {}).unit;
  if (id === "sessions") return F.k;
  if (u === "%") return (v) => F.pct(v);
  if (u === "d") return F.d;
  if (u === "★") return F.star;
  if (u === "/100") return (v) => Math.round(v);
  return F.n;
}
function deltaChip(metricId, brand, opts) {
  const o = sc(metricId, brand), md = metricDef(metricId);
  // A withheld measure has no delta to show, and a zero-looking chip beside a
  // dash reads as a measurement that did not move. Say withheld instead.
  if (o.value == null) return `<span class="delta flat">withheld</span>`;
  if (o.delta == null) return `<span class="delta flat">${md.static ? "point-in-time" : "no prior"}</span>`;
  const good = md.good;
  const cls = good === "neutral" ? "neu" : (o.delta > 0) === (good === "up") ? "up" : "dn";
  const arrow = Math.abs(o.delta) < 1e-9 ? "→" : o.delta > 0 ? "↑" : "↓";
  const f = fmtFor(metricId);
  const body = (opts && opts.pct && o.deltaPct != null) ? `${o.deltaPct > 0 ? "+" : ""}${o.deltaPct.toFixed(1)}%` : `${o.delta > 0 ? "+" : ""}${f(Math.abs(o.delta) < 1e-9 ? 0 : o.delta).replace("$", "")}`;
  return `<span class="delta ${Math.abs(o.delta) < 1e-9 ? "flat" : cls}">${arrow} ${body}</span>`;
}
function rankChip(metricId, brand) {
  const o = sc(metricId, brand);
  if (!o.rank) return "";
  return `<span class="rankchip">${o.tied ? "=" : ""}#${o.rank} of ${o.of}</span>`;
}
const SHOW_SRC = document.body.dataset.sources === "on";
const PROV_LABEL = {
  real: ["real", "Read from a live source on this build"],
  synthetic: ["synthetic", "Modelled — no live source read this on this build"],
  measured: ["measured", "Measured for this brand"],
  derived: ["derived", "Simulated, but bounded by a measurement taken for this brand"],
  reference: ["ref", "Reference data from another brand's capture, shown under this name"],
  unmeasured: ["not measured", "Not measured on this build — left blank"],
};
function provOf(metricId, brand) {
  const p = D && D.meta && D.meta.provenance;
  if (p && p.mode === "hybrid") return SHOW_SRC && p.metrics && p.metrics[metricId] ? (p.metrics[metricId][brand] === "measured" ? "real" : "synthetic") : null;
  return p && p.metrics && p.metrics[metricId] ? p.metrics[metricId][brand] || (p.mode === "measured-only" ? "unmeasured" : "reference") : null;
}
function laneOf(page) {
  const lanes = D && D.meta && D.meta.provenance && D.meta.provenance.lanes;
  return lanes ? lanes[page] || null : null;
}
function provBadge(metricId, brand) {
  const k = provOf(metricId, brand);
  if (!k || !PROV_LABEL[k]) return "";
  return `<i class="pv pv-${k}" title="${esc(PROV_LABEL[k][1])}">${PROV_LABEL[k][0]}</i>`;
}
function labelSimChip() {
  const p = D.meta.provenance;
  if (p && p.mode === "measured-only" && $("#simBtn")) { $("#simBtn").innerHTML = "<i></i>Measured data only"; $("#simBtn").title = "How each number was measured"; }
  if (p && p.mode === "hybrid" && $("#simBtn")) { $("#simBtn").innerHTML = "<i></i>Measured + modelled"; $("#simBtn").title = "Which figures are measured and which are modelled"; }
}
function kpi(o) {
  return `<div class="kpi">
    <div class="kl">${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ""}${esc(o.label)}${o.badge || ""}</div>
    <div class="kv">${o.value}${o.unit ? `<small>${o.unit}</small>` : ""}</div>
    <div class="kf">${o.delta || ""}${o.rank || ""}${o.spark || ""}</div>
    ${o.note ? `<div class="kn">${o.note}</div>` : ""}
  </div>`;
}
function metricKpi(metricId, brand, note) {
  const md = metricDef(metricId), o = sc(metricId, brand), f = fmtFor(metricId);
  return kpi({
    label: md.label, dot: B(brand).color, badge: provBadge(metricId, brand),
    value: o.value == null ? "—" : f(o.value),
    delta: deltaChip(metricId, brand), rank: rankChip(metricId, brand),
    spark: (D.trend[metricId] && D.trend[metricId][brand]) ? CC.spark({ data: D.trend[metricId][brand], color: B(brand).color, width: 62, height: 20 }) : "",
    note: note || (md.static ? "Point-in-time read — no trend" : null),
  });
}
function readsBlock(key, extra) {
  const list = (D.reads[key] || []).concat(extra || []);
  if (!list.length) return "";
  const word = { good: "Strength", watch: "Watch", risk: "Risk" };
  const note = (D.meta.provenance || {}).mode === "measured-only"
    ? "Statements of measured fact for the full window on Amazon; they do not change with the cadence selected above."
    : `Computed across the full ${D.dims.weeks.length}-week window and over all ${D.dims.retailers.length} retailers, so these hold whatever cadence or retailer is selected above — they will not match a tile scoped to a shorter period.`;
  return `<p class="mini" style="margin:-4px 0 9px">${note}</p>
    <div class="reads">${list.map((r) => `<div class="read ${r.tone}"><span class="rt">${word[r.tone] || "Note"}</span><p>${r.text}</p></div>`).join("")}</div>`;
}
/* ── Title Case ──────────────────────────────────────────────────────────
   Every heading and every segmented-control label goes through one function, so
   the casing cannot drift between a page written today and one written next
   month. Words that already carry an internal capital are left alone (PDP, AI,
   HomePod), as is anything with a dot or a digit in it (sonos.com, 360°). */
const TC_SMALL = new Set(["a","an","and","as","at","but","by","for","from","in","into","nor","of","off","on","onto","or","over","per","than","the","to","up","via","vs","with","without","yet","so","if","out"]);
// Capitalise the first LETTER of the part, not the first lowercase character in
// it: "Cross" already starts capital and its first lowercase letter is the r.
const tcUp = (p) => p.replace(/^([^A-Za-z]*)([a-z])/, (_, pre, c) => pre + c.toUpperCase());
function tc(s) {
  if (!s) return s;
  const words = String(s).split(/(\s+)/);
  const idx = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter((i) => i >= 0);
  const first = idx[0], last = idx[idx.length - 1];
  return words.map((w, i) => {
    if (!/\S/.test(w)) return w;
    if (/[A-Z]/.test(w.slice(1))) return w;
    if (/[.\/@\d]/.test(w)) return w;
    const edge = i === first || i === last;
    // A hyphenated compound cases each part, so "in-stock" is "In-Stock" — and
    // a small word inside one still stays small, so it is "Out-of-Stock".
    return w.split("-").map((p, k) => {
      const bare = p.toLowerCase().replace(/[^a-z]/g, "");
      if (!(edge && k === 0) && TC_SMALL.has(bare)) return p;
      return tcUp(p);
    }).join("-");
  }).join("");
}

function card(o) {
  // Every card carries a "?" unless it opts out: hovering it defines what the
  // card measures, and it opens a chat grounded in that card's own numbers.
  // `help` is the definition of the measure, which stays true whatever the
  // reading does; the sub-line stands in where a card has no separate one.
  const help = o.help || o.sub || "";
  const q = o.noHelp ? "" : `<button type="button" class="cardq" aria-label="What this card shows" data-title="${esc(tc(o.title))}" data-help="${esc(String(help).replace(/<[^>]+>/g, ""))}">?</button>`;
  return `<section class="card${o.cls ? " " + o.cls : ""}">${q}
    <div class="card-h"><div class="ct"><h3>${tc(o.title)}</h3>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.tag ? `<div class="ca"><span class="tag ${o.tagCls || ""}">${o.tag}</span></div>` : ""}</div>
    ${o.slot ? `<div id="${o.slot}"></div>` : ""}${o.html || ""}</section>`;
}
function intro(lead, aside) {
  return `<div class="pintro"><div class="lead">${lead}</div>${aside ? `<div>${aside}</div>` : ""}</div>`;
}
function table(cols, rows, opts) {
  opts = opts || {};
  return `<div class="dt-wrap"${opts.maxH ? ` style="--dtmax:${opts.maxH}"` : ""}><table class="dt">
    <thead><tr>${cols.map((c) => `<th class="${c.lft ? "lft" : ""}">${c.label}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r._subject ? "subj" : ""}">${cols.map((c) => `<td class="${c.lft ? "lft" : "num"}">${c.get(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function slot(id) { return `<div id="${id}"></div>`; }

/* ── drawer ─────────────────────────────────────────────────────────────── */
function openDrawer(title, sub, html) {
  $("#drTitle").textContent = title; $("#drSub").textContent = sub || "";
  $("#drBody").innerHTML = html; $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drX").focus();
}
function closeDrawer() { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); CC.hideTip(); }

/* ── boot ───────────────────────────────────────────────────────────────── */
// A standalone export inlines the payload on the page itself, because a page
// opened from a file cannot fetch its own data (see export-cco-standalone.mjs).
//
// It has to WAIT, though. A fetch resolves long after every script on the page
// has run; an already-resolved promise resolves on the next microtask, which is
// before the very next <script> tag executes. Booting that early meant
// cco-dashboard-pages.js had not defined __ccSubject yet, so the subject stayed
// at its default and five pages rendered against a brand that is not in the
// payload. Waiting for DOMContentLoaded restores the ordering the fetch gave us
// for free. Everything after this line is identical either way.
const bootData = window.__CCO_PAYLOAD
  ? new Promise((done) => (document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", () => done(window.__CCO_PAYLOAD))
      : done(window.__CCO_PAYLOAD)))
  : (function load() {
      if (document.body.dataset.shareMissing) return Promise.reject(Object.assign(new Error("This share link is incomplete — open the full link you were sent."), { friendly: true }));
      return fetch(PAYLOAD, window.__CC_AUTH ? { headers: { authorization: window.__CC_AUTH } } : undefined).then((r) => {
      if (r.status === 202) {
        const m = $("#ccLoaderMsg");
        if (m) m.textContent = "This dashboard is being built from live data — it opens by itself when ready (usually 3–4 minutes).";
        clearTimeout(loaderSlow);
        return new Promise((done) => setTimeout(done, 10000)).then(load);
      }
      if (r.ok) return r.json();
      const why = r.status === 401 ? (window.__CC_AUTH ? "This share link isn't valid. Check that you opened the whole link." : "You need to sign in to see this dashboard.")
        : r.status === 404 ? "This dashboard link does not exist, or the brand has no finished build yet."
        : r.status === 410 ? "This share link has expired."
        : r.status === 409 ? "This brand's last build used simulated data, which is no longer shown. Rebuild it from Add a brand to get measured figures."
        : r.status === 424 ? "The build for this dashboard failed. Ask whoever shared it for a new link."
        : `The server returned ${r.status}.`;
      throw Object.assign(new Error(why), { friendly: true });
    }); })();
window.__ccBoot = bootData;
const loaderSlow = setTimeout(() => { const m = $("#ccLoaderMsg"); if (m) m.textContent = "Still loading — the first visit after a build can take a few seconds…"; }, 6000);
function hideLoader() {
  clearTimeout(loaderSlow);
  const l = $("#ccLoader");
  if (!l) return;
  l.classList.add("done");
  setTimeout(() => l.remove(), 260);
}
function failLoader(e) {
  clearTimeout(loaderSlow);
  const l = $("#ccLoader");
  if (!l) return;
  l.classList.add("failed");
  $("#ccLoaderTitle").textContent = "Couldn't load this dashboard";
  $("#ccLoaderMsg").textContent = e && e.friendly ? e.message : "The data didn't load. A reload usually fixes it.";
  $("#ccLoaderActions").hidden = false;
}
const MODEL_TAIL = /(\s+(origin|cordless|stick|vacuum|vacuums|cleaner))+$/i;
function shortModelLabels(p) {
  const brandOf = new Map(((p.dims && p.dims.brands) || []).map((b) => [b.id, b.label]));
  const models = (p.dims && p.dims.models) || [];
  for (const m of models) {
    const brand = brandOf.get(m.brand) || "";
    const rx = brand ? new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i") : null;
    let short = String(m.label || "").replace(/[™®©]/g, "").replace(/\s*\S*…$/, "").replace(/\s+/g, " ").trim();
    if (rx) short = short.replace(rx, "");
    const trimmed = short.replace(MODEL_TAIL, "").trim();
    m.fullLabel = m.fullLabel || m.label;
    const specific = /\d/.test(trimmed) || trimmed.split(" ").length >= 2;
    m.label = (specific ? trimmed : short) || m.label;
  }
  const seen = {};
  for (const m of models) { const k = `${m.brand}|${m.label.toLowerCase()}`; (seen[k] ||= []).push(m); }
  for (const list of Object.values(seen)) if (list.length > 1) for (const m of list) m.label = String(m.fullLabel).replace(/[™®©]/g, "");
  return p;
}
const RETAILER_DAYS = { amazon: 0, walmart: 0.5, bestbuy: 1, target: 1.5, newegg: 2 };
const CITY_DAYS = { nyc: 0, chi: 0.2, lax: 0.3, mia: 0.5, hou: 0.4, den: 0.6 };
const wobble = (key) => { let h = 2166136261; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619); return ((h >>> 0) % 1000) / 1000 - 0.5; };
function fillModelledDelivery(p) {
  const weekly = p.delivery && p.delivery.weekly;
  if (!weekly) return p;
  const lastOf = (s) => { for (let i = (s || []).length - 1; i >= 0; i--) if (s[i] != null) return s[i]; return null; };
  const amazonBase = {};
  for (const [k, s] of Object.entries(weekly)) { const [mid, rt] = k.split("|"); const v = lastOf(s); if (rt === "amazon" && v != null) (amazonBase[mid] ||= []).push(v); }
  const brandOfModel = new Map(((p.dims && p.dims.models) || []).map((m) => [m.id, m.brand]));
  const brandBase = {};
  for (const [mid, vs] of Object.entries(amazonBase)) (brandBase[brandOfModel.get(mid)] ||= []).push(...vs);
  const avg = (a) => a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const all = avg(Object.values(amazonBase).flat());
  if (all == null) return p;
  for (const [k, s] of Object.entries(weekly)) {
    if (!Array.isArray(s)) continue;
    const [mid, rt, city] = k.split("|");
    const base = avg(amazonBase[mid]) ?? avg(brandBase[brandOfModel.get(mid)]) ?? all;
    for (let i = 0; i < s.length; i++) {
      if (s[i] != null) continue;
      const v = base + (RETAILER_DAYS[rt] ?? 1) + (CITY_DAYS[city] ?? 0.3) + wobble(`${k}|${i}`) * 0.8;
      s[i] = Math.max(1, Math.round(v * 10) / 10);
    }
  }
  return p;
}
const PAGE_LANES = { traffic: "traffic", tco: "tco" };
const LANE_METRICS = { traffic: ["trafficShare", "sessions"] };
function hideModelledLanes(p) {
  const lanes = (p.meta && p.meta.provenance && p.meta.provenance.lanes) || {};
  const gone = Object.keys(PAGE_LANES).filter((pg) => lanes[PAGE_LANES[pg]] && lanes[PAGE_LANES[pg]].status === "modelled");
  if (!gone.length) return p;
  p.meta.hiddenPages = gone;
  const metrics = new Set(gone.flatMap((pg) => LANE_METRICS[pg] || []));
  if (metrics.size) {
    p.dims.metrics = (p.dims.metrics || []).filter((m) => !metrics.has(m.id));
    for (const cadence of Object.values(p.scorecard || {})) for (const m of metrics) delete cadence[m];
    for (const m of metrics) { if (p.trend) delete p.trend[m]; if (p.meta.provenance.metrics) delete p.meta.provenance.metrics[m]; }
  }
  for (const pg of gone) if (p.reads) delete p.reads[pg];
  if (gone.includes("traffic") && p.reads && Array.isArray(p.reads.overview)) p.reads.overview = p.reads.overview.filter((r) => !/traffic|sessions/i.test(typeof r === "string" ? r : (r && r.text) || ""));
  return p;
}
const isHiddenPage = (id) => !!(D && D.meta && (D.meta.hiddenPages || []).includes(id));
const PLACEHOLDER_BRAND = /^Competitor \d+$/;
function rerankCells(cells, good) {
  const present = Object.values(cells).filter((c) => c && c.value != null);
  const sorted = present.map((c) => c.value).sort((x, y) => (good === "down" ? x - y : y - x));
  for (const c of Object.values(cells)) {
    if (!c) continue;
    c.of = present.length;
    if (c.value == null || good === "neutral") { c.rank = null; c.tied = false; continue; }
    c.rank = sorted.indexOf(c.value) + 1;
    c.tied = sorted.filter((v) => v === c.value).length > 1;
  }
}
function dropPlaceholderBrands(p) {
  const brands = (p && p.dims && p.dims.brands) || [];
  const fake = brands.filter((b) => PLACEHOLDER_BRAND.test(b.label || ""));
  if (!fake.length) return p;
  const ids = new Set(fake.map((b) => b.id));
  const before = brands.length;
  const prune = (o) => {
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) {
        const x = o[i];
        if (x && typeof x === "object" && !Array.isArray(x) && (ids.has(x.brand) || ids.has(x.topBrand) || (o === p.dims.brands && ids.has(x.id)))) o.splice(i, 1);
        else prune(x);
      }
    } else if (o && typeof o === "object") {
      for (const k of Object.keys(o)) { if (ids.has(k)) delete o[k]; else prune(o[k]); }
    }
  };
  prune(p);
  const good = new Map(((p.dims && p.dims.metrics) || []).map((m) => [m.id, m.good]));
  for (const cadence of Object.values(p.scorecard || {})) for (const [metric, cells] of Object.entries(cadence || {})) if (cells && typeof cells === "object") rerankCells(cells, good.get(metric));
  const mentionsFake = (t) => fake.some((b) => t.includes(b.label)) || new RegExp(`\\bof (the )?${before}\\b`).test(t);
  for (const k of Object.keys(p.reads || {})) if (Array.isArray(p.reads[k])) p.reads[k] = p.reads[k].filter((r) => !mentionsFake(typeof r === "string" ? r : (r && r.text) || ""));
  return p;
}
bootData.then((json) => {
  D = CC.googlePalette(fillModelledDelivery(shortModelLabels(hideModelledLanes(dropPlaceholderBrands(json))))); F = CC.fmt;
  S = D.meta.subject; SUBJ = D.meta.subjectLabel;
  if (window.__ccSubject) window.__ccSubject(S, SUBJ);
  buildNav(); buildControls(); buildBrand(); labelSimChip();
  $("#scWin").textContent = `${F.date(D.meta.window.start)} – ${F.date(D.meta.window.end)} · ${D.meta.market || "US"}`;
  window.addEventListener("hashchange", route);
  route();
  $("#simBtn").hidden = false;
  hideLoader();
}).catch((e) => {
  failLoader(e);
  // Only a genuine load failure reaches here now — a render throw is caught at
  // the page. The two need different responses, so they say different things.
  $("#pages").innerHTML = `<div class="card"><div class="card-h"><div class="ct"><h3>Could not load the dataset</h3>`
    + `<p>The dashboard could not fetch ${esc(PAYLOAD)}. A hard reload usually fixes it.</p></div></div>`
    + `<p class="mini" style="margin:0">${esc(e && e.message ? e.message : String(e))}</p></div>`;
});

// The top-left is the product area and it belongs to the brand: the wordmark
// where the instance ships one, the brand's own name where it does not, and a
// tile carrying the initial for when the rail is collapsed. A mark that fails
// to load leaves the name in place rather than an empty corner.
function buildBrand() {
  const name = D.meta.subjectLabel, logo = $("#bmLogo"), nm = $("#bmName"), tile = $("#bmTile");
  nm.textContent = name;
  tile.textContent = name.trim().charAt(0).toUpperCase();
  if (!D.meta.brandMark) { logo.remove(); return; }
  logo.alt = name;
  logo.onload = () => { logo.hidden = false; nm.hidden = true; };
  logo.onerror = () => logo.remove();
  logo.src = D.meta.brandMark;
}
function buildNav() {
  // extension groups sit between the shell's own groups and its Method group — unless a group
  // names the shell group it wants to follow (`after`), in which case it goes right under it.
  // Added 2026-09-22: the AI Engine Visibility groups sat below the fold of a laptop's rail.
  const groups = NAV.slice(0, -1);
  const extGroups = EXTS.flatMap((x) => x.groups);
  const tail = [];
  for (const g of extGroups) {
    const at = g.after ? groups.findIndex((s) => s.id === g.after) : -1;
    if (at < 0) { tail.push(g); continue; }
    let i = at + 1; while (i < groups.length && groups[i].ext && groups[i].after === g.after) i++;   // keep sibling order
    groups.splice(i, 0, g);
  }
  groups.push(...tail, ...NAV.slice(-1));
  const visible = groups.map((g) => ({ ...g, pages: g.pages.filter((p) => !isHiddenPage(p.id)) })).filter((g) => g.pages.length);
  $("#nav").innerHTML = visible.map((g) => `<div class="nav-grp${g.ext ? " ext" : ""}"><h5>${g.label}</h5>${g.pages.map((p) =>
    `<a href="#${p.id}" data-p="${p.id}" title="${p.label}"${laneOf(p.id) && laneOf(p.id).status === "not_measured" ? ' class="nm"' : ""}>${icon(p.icon, p.svg)}<span>${(laneOf(p.id) || {}).label || p.label}</span>${p.pill ? `<span class="pill">${p.pill}</span>` : ""}</a>`).join("")}</div>`).join("");
  $("#railToggle").onclick = () => {
    document.body.classList.toggle("rail-collapsed");
    try { localStorage.setItem("cc_rail", document.body.classList.contains("rail-collapsed") ? "1" : "0"); } catch (e) {}
    setTimeout(() => repaint(true), 250);
  };
  try { if (localStorage.getItem("cc_rail") === "1") document.body.classList.add("rail-collapsed"); } catch (e) {}
}
function buildControls() {
  $("#cadence").innerHTML = D.dims.periods.map((p) => `<button data-c="${p.id}" title="${p.long}">${p.label}</button>`).join("");
  $$("#cadence button").forEach((b) => b.onclick = () => { cadence = b.dataset.c; syncControls(); repaint(true); });
  $("#retSel").innerHTML = `<option value="all">All retailers</option>` + D.dims.retailers.map((r) => `<option value="${r.id}">${r.label}</option>`).join("");
  $("#retSel").onchange = (e) => { retailer = e.target.value; repaint(true); };
  $("#simBtn").onclick = () => location.hash = "#method";
  $("#drX").onclick = closeDrawer; $("#scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  syncControls();
}
function syncControls() {
  $$("#cadence button").forEach((b) => b.classList.toggle("on", b.dataset.c === cadence));
  $("#retSel").value = retailer;
}
const SRC_WORD = { measured: "real", mixed: "mixed", modelled: "synthetic" };
function srcNote(lane) {
  const k = SRC_WORD[lane.status] || "synthetic";
  return `<p class="lane-note src-note"><i class="pv pv-${k}">${k}</i><span>${esc(lane.note)}${!lane.sources ? "" : lane.sources.length ? ` <b>Real sources:</b> ${lane.sources.map(esc).join(" · ")}.` : " <b>No live source</b> — every figure here is synthetic."}</span></p>`;
}
function srcStatus(def) {
  const id = def.id;
  if (/^ai-/.test(id)) return { k: "real", t: `AI engine answers (${(D.aiConsole?.engines || []).map((e) => e.label).join(", ")})` };
  if (id === "aeo-programme") return { k: "real", t: "built from the AI engine answers" };
  if (/^aeo-/.test(id)) return { k: "mixed", t: "week 0 real · weeks 1–12 synthetic" };
  if (id === "method") return null;
  const lane = laneOf(id);
  return lane ? { k: SRC_WORD[lane.status] || "synthetic", t: lane.sources ? lane.sources.join(" · ") || "no live source" : lane.status === "modelled" ? "no live source" : "Amazon data real · rest modelled" } : null;
}
function route() {
  const id = (location.hash || "#scorecard").slice(1);
  if (isHiddenPage(id)) { location.replace("#scorecard"); return; }
  page = allPages().some((p) => p.id === id) ? id : "scorecard";
  const def = pageDef(page);
  const title = (laneOf(page) || {}).label || def.title;
  $("#crumb").textContent = def.crumb; $("#ptitle").textContent = title;
  const chip = $("#srcChip"); const st = SHOW_SRC && D.meta.provenance && D.meta.provenance.mode === "hybrid" ? srcStatus(def) : null;
  if (chip) { chip.hidden = !st; if (st) chip.innerHTML = `<i class="pv pv-${st.k}">${st.k}</i>${esc(st.t)}`; }
  $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.p === page));
  const onLink = $("#nav a.on"); if (onLink && onLink.scrollIntoView) onLink.scrollIntoView({ block: "nearest" });   // a deep link lands with its rail item in view
  document.title = `${title} · ${SUBJ} Commercial Command Center`;
  // an extension page carries its own top-bar controls; the shell's step aside
  document.body.classList.toggle("ext-page", !!def.ext);
  const topCC = $("#topCC"); if (topCC) topCC.hidden = !!def.ext;
  EXTS.forEach((x) => { if (x.onRoute) { try { x.onRoute(def.ext === x.id ? def : null); } catch (e) { console.error("[cco] extension route failed", e); } } });
  repaint(); window.scrollTo({ top: 0, behavior: "instant" });
}
function repaint(force) {
  const def = pageDef(page);
  let host = document.getElementById("pg-" + page);
  if (!host) { host = h(`<div class="page" id="pg-${page}"></div>`); $("#pages").appendChild(host); }
  $$(".page").forEach((p) => p.classList.toggle("on", p.id === "pg-" + page));
  if (window.CCASK) window.CCASK.close();   // the anchor for any open popover is about to be discarded
  if (def.managed) return;                  // an extension draws and re-draws its own pages
  // A throw inside one page used to surface as "Could not load the dataset",
  // because route() runs inside the fetch chain — so a renderer reading a key
  // the payload had renamed looked exactly like a network failure, on every
  // page at once. A page that cannot draw now says so on its own, and the rail
  // and the other fourteen pages go on working.
  const draw = () => { host.innerHTML = "";
    const lane = laneOf(page);
    if (lane && lane.status === "not_measured") {
      host.innerHTML = `<div class="card nm-card"><div class="card-h"><div class="ct"><h3>Not measured for ${esc(SUBJ)}</h3><p>${esc(lane.note)}</p></div></div>`
        + `<p class="mini" style="margin:0">This page is left blank rather than filled with modelled figures. <a href="#method">What was measured</a></p></div>`;
      return;
    }
    try { (RENDER[page] || (() => {}))(host); if (SHOW_SRC && lane && D.meta.provenance.mode === "hybrid") host.insertAdjacentHTML("afterbegin", srcNote(lane)); if (lane && lane.status !== "modelled" && lane.status !== "mixed" && D.meta.provenance.mode !== "hybrid") host.insertAdjacentHTML("afterbegin", `<p class="lane-note"><i class="pv pv-${lane.status === "snapshot" ? "derived" : "measured"}">${lane.status === "snapshot" ? "single reading" : "measured"}</i>${esc(lane.note)}</p>`); }
    catch (e) {
      host.innerHTML = `<div class="card"><div class="card-h"><div class="ct"><h3>This page could not be drawn</h3>`
        + `<p>The rest of the dashboard is unaffected — pick another page from the rail. If this tab has been open a while, a hard reload will fetch the current build.</p></div></div>`
        + `<p class="mini" style="margin:0">${esc(e && e.message ? e.message : String(e))}</p></div>`;
      console.error("[cco] render failed on " + page, e);
    } };
  if (force || !painted.has(page)) { painted.add(page); draw(); }
  else if (force) { draw(); }
  // A section heading written inline in a page template goes through the same
  // caser as a card title, so a page written next month cannot introduce a
  // second convention. tc() is idempotent, so re-running it costs nothing.
  host.querySelectorAll("h2.sec").forEach((n) => { n.textContent = tc(n.textContent); });
}
// A cadence or retailer change invalidates every page, not just the visible one.
const _repaint = repaint;
repaint = function (force) { if (force) painted.clear(); _repaint(force); };

const RENDER = {};
window.__CCPAGES = RENDER; window.__CC = { get D() { return D; }, get S() { return S; }, get SUBJ() { return SUBJ; }, get cadence() { return cadence; }, get retailer() { return retailer; },
  B, RT, MD, BIDS, AI_BIDS, RIDS, sc, metricDef, fmtFor, deltaChip, rankChip, kpi, metricKpi, readsBlock, card, intro, table, slot,
  win, winDates, winBands, slice, mean, sum, pairsFor, carriedPairs, retailerScope, openDrawer, closeDrawer, esc, h, $, $$, period, tc, provOf, provBadge, laneOf };
})();
