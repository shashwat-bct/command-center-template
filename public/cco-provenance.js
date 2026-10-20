/* ===========================================================================
   ANALYST VIEW — every card, legend entry and table row marked real or simulated
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
const HINT = {
  real: "Real data.",
  mixed: "Partly real.",
  sim: "Simulated data, not collected.",
};

const RULES = [
  ["scorecard", /measures|where each brand stands|rank movement|driver movement/, "mixed", "Each cell marked: real where a source read it, simulated where modelled"],
  ["scorecard", /category events/, "mixed", "Retail calendar real · event lift simulated"],
  ["traffic", /bought in past month|sales rank|every tracked listing/, "real", KEEPA],
  ["traffic", /./, "sim", SIM],
  ["voice", /rating through|review velocity/, "real", KEEPA],
  ["voice", /aspect scores|what reviewers say/, "real", "Amazon review summaries (Apify)"],
  ["shelf", /share of the first results|the results, in order/, "real", SEARCH],
  ["shelf", /organic against paid/, "sim", SIM],
  ["shelf", /./, "mixed", "Amazon search read live · other retailers, terms and daily movement simulated"],
  ["landing", /./, "mixed", "Amazon product pages read live · other retailers' pages simulated"],
  ["carriage", /buy box/, "real", KEEPA],
  ["carriage", /./, "mixed", AMZ_REST],
  ["stock", /availability by model and (city|location)/, "sim", "Cities simulated"],
  ["stock", /./, "mixed", AMZ_REST],
  ["delivery", /./, "mixed", "Amazon delivery promise read on the build date · other retailers, cities and earlier weeks simulated"],
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
const retailRead = () => new Set(Object.keys(((prov().record || {}).retail || {}).retailers || {}));
const pageOf = (node) => {
  const pg = node.closest(".page");
  return pg && pg.id ? pg.id.replace(/^pg-/, "") : (location.hash || "#scorecard").slice(1);
};
const ruleFor = (page, title) => {
  if (page === "method") return null;
  const t = title.trim().toLowerCase();
  const r = RULES.find(([p, re]) => (p.endsWith("-") ? page.startsWith(p) : page === p) && re.test(t));
  if (!r) return null;
  const note = RETAIL_PAGES.has(page) && r[2] === "mixed" && retailRead().size ? ((prov().lanes || {})[page] || {}).note : null;
  return { k: r[2], src: note || r[3] };
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const badge = (k, src) => `<span class="pvx-tag pvx-${k}" title="${esc(HINT[k] + " Source: " + src)}">${WORD[k]}</span>`;

function markLabels(card) {
  const d = U() && U().D; if (!d) return;
  const real = new Set(["amazon", "amazon.com"]);
  const read = RETAIL_PAGES.has(pageOf(card)) ? retailRead() : new Set();
  const retailers = new Map(d.dims.retailers.map((r) => [r.label.toLowerCase(), real.has(r.id) ? "real" : read.has(r.id) ? "read" : "sim"]));
  const cities = new Set(d.dims.cities.map((c) => c.label.toLowerCase()).concat(d.dims.cities.map((c) => c.label.split(",")[0].toLowerCase())));
  card.querySelectorAll("th, td, .cc-lg, .lb, .chip, .rk-name, .rlab").forEach((n) => {
    if (n.dataset.pvx || n.querySelector("th, td, .cc-lg")) return;
    const t = n.textContent.replace(/\s+/g, " ").trim().toLowerCase();
    const k = retailers.get(t) || (cities.has(t) ? "sim" : null);
    if (!k) return;
    n.dataset.pvx = k;
    if (k === "sim") n.insertAdjacentHTML("beforeend", `<span class="pvx-mini pvx-sim" title="Simulated data, not collected">simulated</span>`);
    if (k === "read") n.insertAdjacentHTML("beforeend", `<span class="pvx-mini pvx-mixed" title="Prices read from the retailer's own website; days before the first reading simulated">partly real</span>`);
  });
}

function decorate(card) {
  if (card.dataset.pvxDone) return;
  const h3 = card.querySelector(".card-h h3"); if (!h3) return;
  const r = ruleFor(pageOf(card), h3.textContent); if (!r) return;
  card.dataset.pvxDone = r.k;
  let ca = card.querySelector(".card-h .ca");
  if (!ca) { ca = document.createElement("div"); ca.className = "ca"; card.querySelector(".card-h").appendChild(ca); }
  ca.insertAdjacentHTML("afterbegin", badge(r.k, r.src));
  if (r.k === "mixed") markLabels(card);
}

function pageDefault(page) {
  const r = RULES.find(([p, re]) => (p.endsWith("-") ? page.startsWith(p) : page === p) && re.source === ".");
  if (r) return { k: r[2], src: r[3] };
  const lane = ((U().D.meta.provenance || {}).lanes || {})[page];
  return lane ? { k: lane.status === "measured" ? "real" : lane.status === "mixed" ? "mixed" : "sim", src: (lane.sources || []).join(" · ") || SIM } : null;
}

function decorateKpi(kpi) {
  if (kpi.dataset.pvxDone || kpi.querySelector(".pv")) return;
  const page = pageOf(kpi); if (page === "method") return;
  const card = kpi.closest(".card");
  const r = card && card.dataset.pvxDone ? { k: card.dataset.pvxDone, src: "" } : pageDefault(page);
  const kl = kpi.querySelector(".kl"); if (!r || !kl) return;
  kpi.dataset.pvxDone = r.k;
  kl.insertAdjacentHTML("beforeend", `<i class="pv pv-${r.k === "sim" ? "synthetic" : r.k}" title="${esc(HINT[r.k] + (r.src ? " Source: " + r.src : ""))}">${WORD[r.k].toLowerCase()}</i>`);
}

function sweep(root) {
  (root.matches && root.matches(".card") ? [root] : []).concat([...(root.querySelectorAll ? root.querySelectorAll(".card") : [])]).forEach(decorate);
  (root.matches && root.matches(".kpi") ? [root] : []).concat([...(root.querySelectorAll ? root.querySelectorAll(".kpi") : [])]).forEach(decorateKpi);
}

function banner() {
  if (document.getElementById("pvxBanner")) return;
  const b = document.createElement("div");
  b.id = "pvxBanner"; b.className = "pvx-banner";
  b.innerHTML = `<span><b>Analyst view</b> · internal only. Each chart is tagged:</span>
    <span class="pvx-legend"><span class="pvx-tag pvx-real">Real</span><span class="pvx-tag pvx-mixed">Partly real</span><span class="pvx-tag pvx-sim">Simulated</span></span>
    <span>Partly real = Amazon is real, other retailers are simulated unless marked partly real. Hover a tag for its source.</span>`;
  const pages = document.getElementById("pages");
  if (pages) pages.parentNode.insertBefore(b, pages);
}

function start() {
  const pages = document.getElementById("pages");
  if (!pages || !U() || !U().D) { setTimeout(start, 150); return; }
  document.body.classList.add("pvx-on");
  banner(); sweep(pages);
  const onAdd = (n) => {
    if (n.nodeType !== 1 || n.classList.contains("pvx-mini") || n.classList.contains("pvx-tag") || n.classList.contains("pv")) return;
    const card = n.closest(".card");
    if (card && card.dataset.pvxDone) { if (card.dataset.pvxDone === "mixed") markLabels(card); card.querySelectorAll(".kpi").forEach(decorateKpi); return; }
    sweep(card || n);
  };
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(onAdd); }).observe(pages, { childList: true, subtree: true });
}
start();
})();
