/* ===========================================================================
   DATA SOURCES — an "i" button in the top bar listing which charts on the page
   are real, partly real or simulated, and where each one comes from
   =========================================================================== */
(function () {
"use strict";
if (document.body.dataset.sources !== "on") return;

const KEEPA = "Keepa · Amazon daily history";
const PAGES = "Apify · Amazon product pages, read on the build date";
const SEARCH = "Apify · Amazon search results, read on the build date";
const AI = "ChatGPT, Gemini and Claude answers, read on the build date";
const AMZ_REST = "Amazon read live · other retailers simulated around it";
const SIM = "No live source · simulated, seeded per brand";

const WORD = { real: "Real", mixed: "Partly real", sim: "Simulated" };

const RULES = [
  ["scorecard", /measures|where each brand stands|rank movement|driver movement/, "mixed", "Each cell marked: real where a source read it, simulated where modelled"],
  ["scorecard", /category events/, "mixed", "Retail calendar real · event lift simulated"],
  ["traffic", /bought in past month|sales rank|every tracked listing/, "real", KEEPA],
  ["traffic", /./, "sim", SIM],
  ["voice", /rating through|review velocity/, "real", KEEPA],
  ["voice", /aspect scores|what reviewers say/, "real", "Amazon review summaries (Apify)"],
  ["voice", /praise vs complaints|best competitor/, "real", "Amazon review summaries (Apify) and Walmart reviews"],
  ["voice", /star mix|would recommend/, "real", "Walmart review summaries"],
  ["shelf", /share of the first results|the results, in order/, "real", SEARCH],
  ["shelf", /organic against paid/, "sim", SIM],
  ["shelf", /./, "mixed", "Amazon search read live · other retailers, terms and daily movement simulated"],
  ["landing", /./, "mixed", "Amazon product pages read live · other retailers' pages simulated"],
  ["carriage", /buy box/, "real", KEEPA],
  ["carriage", /./, "mixed", AMZ_REST],
  ["stock", /availability by model and (city|location)/, "sim", "Cities simulated"],
  ["stock", /./, "mixed", AMZ_REST],
  ["delivery", /./, "mixed", "Amazon delivery promise read on the build date · other retailers, cities and earlier weeks simulated"],
  ["pricing", /below the price floor/, "mixed", "Prices as read where real · the price floor itself is an assumed policy, not measured"],
  ["pricing", /./, "mixed", AMZ_REST],
  ["promotions", /how .* promotes|where the promotions run/, "sim", "Promotion mechanics simulated"],
  ["promotions", /./, "mixed", "Amazon price cuts read live · other retailers and mechanics simulated"],
  ["calendar", /./, "mixed", "Amazon price cuts read live · other retailers simulated"],
  ["strategy", /mechanic mix/, "sim", "Promotion mechanics simulated"],
  ["strategy", /./, "mixed", "Amazon price cuts read live · other retailers simulated"],
  ["tco", /effective price as a share|^by brand$/, "real", "Keepa · Amazon coupons and lightning deals"],
  ["tco", /./, "sim", SIM],
  ["ai-", /placement pipeline/, "mixed", "Week 0 real · later stages simulated"],
  ["ai-", /crawler access|access findings/, "real", "robots.txt read on the build date"],
  ["ai-", /./, "real", AI],
  ["aeo-", /./, "mixed", "Week 0 real · weeks 1–12 simulated"],
];

const U = () => window.__CC;
const RETAIL_PAGES = new Set(["pricing", "promotions", "calendar", "strategy", "carriage"]);
const prov = () => (U() && U().D && U().D.meta.provenance) || {};
const retailRec = () => (prov().record || {}).retail || null;
const importedRec = () => (retailRec() || {}).imported || null;
const measuredRec = () => (retailRec() || {}).measured || null;
const retailRead = () => new Set(Object.keys((retailRec() || {}).retailers || {}).concat(Object.keys((importedRec() || {}).retailers || {}), Object.keys((measuredRec() || {}).retailers || {})));
const readOn = (page) => (RETAIL_PAGES.has(page) ? [...retailRead()] : page === "stock" || (page === "delivery" && (retailRec() || {}).delivery) ? Object.keys((measuredRec() || {}).retailers || {}) : []);
const ASSUMED = [[/price floor/, "the price floor itself (an assumed policy)"]];
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const liveFrom = (id) => { const r = retailRec(); if (!r || !(r.retailers || {})[id]) return null; return (r.firstLive || {})[id] || (r.days || [])[0] || null; };
const importedOf = (id) => ((importedRec() || {}).retailers || {})[id] || null;
const measuredOf = (id) => ((measuredRec() || {}).retailers || {})[id] || null;
const windowStart = () => (U().D.dims.dates || [])[0];
const firstIso = (id) => (measuredOf(id) ? windowStart() : [liveFrom(id), (importedOf(id) || {}).first].filter(Boolean).sort()[0] || null);
const firstRead = (id) => { const f = firstIso(id); return f ? day(f) : null; };
const sourceOf = (id) => {
  const imp = importedOf(id), live = liveFrom(id), m = measuredRec();
  const parts = [m && measuredOf(id) ? `stock, sellers and prices from ${m.label}` : imp ? `imported price history ${day(imp.first)}–${day(imp.last)}` : "", live ? `own website from ${day(live)}` : ""].filter(Boolean);
  return parts.join(", ");
};
const labelOf = (id) => ((U().D.dims.retailers.find((r) => r.id === id) || {}).label || id);
function split(page, title) {
  const read = readOn(page);
  const real = ["Amazon (daily, Keepa)"].concat(read.map((id) => `${labelOf(id)} (${sourceOf(id)})`));
  const sim = U().D.dims.retailers.filter((r) => r.id !== "amazon" && !read.includes(r.id)).map((r) => r.label)
    .concat(read.filter((id) => firstIso(id) > windowStart()).map((id) => `${labelOf(id)} before ${firstRead(id)}`))
    .concat(ASSUMED.filter(([re]) => re.test(title)).map(([, s]) => s));
  return { real, sim };
}
const pageOf = (node) => {
  const pg = node.closest(".page");
  return pg && pg.id ? pg.id.replace(/^pg-/, "") : (location.hash || "#scorecard").slice(1);
};
const ruleFor = (page, title) => {
  if (page === "method") return null;
  const t = title.trim().toLowerCase();
  const r = RULES.find(([p, re]) => (p.endsWith("-") ? page.startsWith(p) : page === p) && re.test(t));
  if (!r) return null;
  const note = r[2] === "mixed" && readOn(page).length ? ((prov().lanes || {})[page] || {}).note : null;
  return { k: r[2], src: note || r[3] };
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
function pageDefault(page) {
  const r = RULES.find(([p, re]) => (p.endsWith("-") ? page.startsWith(p) : page === p) && re.source === ".");
  if (r) return { k: r[2], src: r[3] };
  const lane = ((U().D.meta.provenance || {}).lanes || {})[page];
  return lane ? { k: lane.status === "measured" ? "real" : lane.status === "mixed" ? "mixed" : "sim", src: (lane.sources || []).join(" · ") || SIM } : null;
}

const tag = (k) => `<span class="pvx-tag pvx-${k}">${WORD[k]}</span>`;

function partlyReal() {
  const read = [...retailRead()];
  return read.length
    ? `Amazon is read daily; ${read.map((id) => `${labelOf(id)} prices are real from ${firstRead(id)} (${sourceOf(id)})`).join("; ")}; every other retailer, and earlier days, are simulated.`
    : "Amazon is read daily; every other retailer is simulated.";
}

function currentPage() {
  const id = (location.hash || "#scorecard").slice(1);
  const el = document.getElementById(`pg-${id}`) || document.querySelector("#pages .page:not([hidden])");
  return { id: el && el.id ? el.id.replace(/^pg-/, "") : id, el };
}

function panelHtml() {
  const { id, el } = currentPage();
  const seen = new Set();
  const rows = [...(el ? el.querySelectorAll(".card .card-h h3") : [])].map((h) => h.textContent.trim()).filter((t) => t && !seen.has(t) && seen.add(t)).map((title) => {
    const r = ruleFor(id, title); if (!r) return "";
    const parts = r.k === "mixed" ? split(id, title.toLowerCase()) : null;
    return `<li><div class="pvx-row"><b>${esc(title)}</b>${tag(r.k)}</div><div class="pvx-src">${parts ? `<span class="pvx-k">Real</span> ${esc(parts.real.join(", "))}${parts.sim.length ? `<br><span class="pvx-k">Simulated</span> ${esc(parts.sim.join(", "))}` : ""}` : esc(r.src)}</div></li>`;
  }).filter(Boolean);
  const dflt = pageDefault(id);
  return `<div class="pvx-head"><b>Where this page's data comes from</b><button type="button" class="pvx-x" aria-label="Close">✕</button></div>
    <p class="pvx-sum">${esc(partlyReal())}</p>
    ${rows.length ? `<ul class="pvx-list">${rows.join("")}</ul>` : dflt ? `<p class="pvx-sum">${tag(dflt.k)} ${esc(dflt.src)}</p>` : `<p class="pvx-sum">Nothing on this page is tagged.</p>`}`;
}

function start() {
  const top = document.querySelector("#top .top-r");
  if (!top || !U() || !U().D) { setTimeout(start, 150); return; }
  if (document.getElementById("pvxInfo")) return;
  const wrap = document.createElement("div"); wrap.className = "pvx-wrap";
  wrap.innerHTML = `<button type="button" class="pvx-info" id="pvxInfo" aria-label="Which data is real and which is simulated" aria-expanded="false" title="Which data is real">i</button><div class="pvx-pop" id="pvxPop" role="dialog" hidden></div>`;
  top.appendChild(wrap);
  const btn = wrap.querySelector("#pvxInfo"), pop = wrap.querySelector("#pvxPop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", () => { if (!pop.hidden) { close(); return; } pop.innerHTML = panelHtml(); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); });
  pop.addEventListener("click", (e) => { if (e.target.closest(".pvx-x")) close(); });
  document.addEventListener("click", (e) => { if (!pop.hidden && !wrap.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) close(); });
  window.addEventListener("hashchange", close);
}
start();
})();
