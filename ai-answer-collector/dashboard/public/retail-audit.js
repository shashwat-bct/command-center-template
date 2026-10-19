/* ===========================================================================
   RETAIL SHELF + AI × SHELF — the retail audit tool's sheet beside the AI answers
   ---------------------------------------------------------------------------
   Loaded before ai-visibility.js. When the page declares a retail payload
   (body[data-payload-retail], written by `npm run retail`), it adds three
   groups to the console's rail:

     Overview      360° Scorecard (AI share of answer + shelf, one row per brand)
     Retail Shelf  Carriage & Availability · Pricing · Promotions · Ratings & Reviews
     AI × Shelf    AI vs the Shelf · How this was built

   Page names, the card / KPI / table / reads markup and the measured-only
   rules (a number is shown only when it was read; otherwise it is withheld and
   says why) follow command-center-template (cco-dashboard.js and
   cco-measured-pages.js, feat/measured-only-dashboards). Charts are the
   template's cco-charts.js. The AI side is read through window.__AIV, which the
   patched console exposes, so the persona / run / scope filters apply here too.
   =========================================================================== */
(function () {
"use strict";
const URL_ = document.body.dataset.payloadRetail;
const F = () => CC.fmt;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const median = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const uniq = (a) => [...new Set(a)];
const pct = (v) => v == null ? "—" : F().pct(v, 0);

/* ── rail ─────────────────────────────────────────────────────────────── */
const ICONS = {
  ra_stack: '<path d="M4 7h16v4H4zM4 13h16v4H4z"/>',
  ra_tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  ra_percent: '<path d="M19 5L5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  ra_star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  ra_join: '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  ra_score: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const GROUPS = [
  { id: "ra-overview", label: "Overview", first: true, pages: [
    { id: "ra-scorecard", label: "360° Scorecard", icon: "ra_score", crumb: "Overview", title: "360° Scorecard · AI Answers and the Retail Shelf" }] },
  { id: "ra-shelf", label: "Retail Shelf", pages: [
    { id: "ra-carriage", label: "Carriage & Availability", icon: "ra_stack", crumb: "Retail Shelf · Share of Distribution", title: "Carriage & Availability" },
    { id: "ra-pricing", label: "Pricing", icon: "ra_tag", crumb: "Retail Shelf · Commercial", title: "Pricing" },
    { id: "ra-promos", label: "Promotions", icon: "ra_percent", crumb: "Retail Shelf · Commercial", title: "Promotions" },
    { id: "ra-voice", label: "Ratings & Reviews", icon: "ra_star", crumb: "Retail Shelf · Voice of Customer", title: "Ratings & Reviews" }] },
  { id: "ra-join", label: "AI × Shelf", pages: [
    { id: "ra-aishelf", label: "AI vs the Shelf", icon: "ra_join", crumb: "AI × Shelf", title: "What the Engines Say vs What the Shelf Shows" },
    { id: "ra-method", label: "How this was built", icon: "info", crumb: "AI × Shelf · Method", title: "How this was built" }] },
];

/* ── markup, as command-center-template's cco-dashboard.js ───────────── */
const card = (o) => `<section class="card${o.cls ? " " + o.cls : ""}"><div class="card-h"><div class="ct"><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.tag ? `<div class="ca"><span class="tag ${o.tagCls || ""}">${o.tag}</span></div>` : ""}</div>${o.slot ? `<div id="${o.slot}"></div>` : ""}${o.html || ""}</section>`;
const kpi = (o) => `<div class="kpi"><div class="kl">${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ""}${esc(o.label)}</div><div class="kv">${o.value}${o.unit ? `<small>${o.unit}</small>` : ""}</div><div class="kf">${o.rank || ""}</div>${o.note ? `<div class="kn">${o.note}</div>` : ""}</div>`;
const intro = (lead) => `<div class="pintro"><div class="lead">${lead}</div></div>`;
const table = (cols, rows, opts = {}) => `<div class="dt-wrap"${opts.maxH ? ` style="--dtmax:${opts.maxH}"` : ""}><table class="dt">
  <thead><tr>${cols.map((c) => `<th class="${c.lft ? "lft" : ""}">${c.label}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr class="${r._subject ? "subj" : ""}">${cols.map((c) => `<td class="${c.lft ? "lft" : "num"}">${c.get(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const reads = (list) => list.length ? `<div class="reads">${list.map((r) => `<div class="read ${r.tone}"><span class="rt">${{ good: "Strength", watch: "Watch", risk: "Risk" }[r.tone] || "Note"}</span><p>${r.text}</p></div>`).join("")}</div>` : "";
const laneNote = (status, text) => `<p class="lane-note"><i class="pv pv-${status}">${status === "derived" ? "joined" : "measured"}</i>${text}</p>`;
const withheld = (why) => `<div class="withheld-card"><b>Withheld</b><p>${why}</p></div>`;
const standing = (obj, id) => { const rows = Object.entries(obj).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]); const i = rows.findIndex(([k]) => k === id); if (i < 0) return null; const tied = rows.some(([k, v]) => k !== id && v === rows[i][1]); return { rank: rows.findIndex(([, v]) => v === rows[i][1]) + 1, of: rows.length, tied, leader: rows[0][0] }; };
const rankChip = (obj, id) => { const s = standing(obj, id); return s ? `<span class="rankchip">${s.tied ? "joint " : ""}#${s.rank} of ${s.of}</span>` : ""; };

/* ── state ────────────────────────────────────────────────────────────── */
let R = null, A = null, failed = null;
const load = URL_ ? fetch(URL_, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((p) => { R = p; if (A) render(A); }).catch((e) => { failed = e.message; if (A) render(A); }) : null;

const brands = () => A.D.brands;
const B = (id) => brands().find((b) => b.id === id) || { id, label: id, color: "#80868b" };
const S = () => A.D.subject;
const SL = () => A.D.subjectLabel;
const dot = (id) => `<span class="dot" style="background:${B(id).color}"></span>`;
const tagFor = (cls, t) => `<span class="tag ${cls}">${esc(t)}</span>`;
const shot = (r) => r && r.screenshot ? ` <a class="ra-shot" href="${esc(r.screenshot)}" target="_blank" rel="noopener" title="The screenshot this was read from (${esc(r.capturedAt.slice(0, 10))})">screenshot</a>` : "";

/** The audit's listings: one per brand × product × retailer, with its latest reading of each field. */
function listings() {
  const by = new Map();
  for (const r of R.rows) {
    const k = `${r.brand}|${r.product}|${r.retailer}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  return [...by.values()].map((rs) => {
    rs.sort((a, b) => (a.capturedAt || a.date).localeCompare(b.capturedAt || b.date));
    const lastWith = (f) => [...rs].reverse().find(f) || null;
    const model = R.models.find((m) => m.brand === rs[0].brand && m.product === rs[0].product);
    return {
      brand: rs[0].brand, product: rs[0].product, model, label: model ? model.label : rs[0].product, retailer: rs[0].retailer, history: rs,
      latest: rs[rs.length - 1],
      priced: lastWith((r) => r.priceUsable),
      stocked: lastWith((r) => !!r.availability),
      rated: lastWith((r) => r.rating != null),
    };
  });
}
const AV = {
  in_stock: ["In stock", "good"], limited: ["Limited", "warn"], out_of_stock: ["Out of stock", "risk"],
  no_buy_box: ["No buy box", "risk"], store_required: ["Store pick-up only", "warn"], discontinued: ["Discontinued", "risk"], unknown: ["Unknown", ""],
};
const sellable = (l) => l.stocked && (l.stocked.availability === "in_stock" || l.stocked.availability === "limited");
const knownStock = (l) => l.stocked && l.stocked.availability !== "unknown";

function brandShelf(L) {
  const out = {};
  for (const b of brands()) {
    const mine = L.filter((l) => l.brand === b.id);
    if (!mine.length) { out[b.id] = null; continue; }
    const known = mine.filter(knownStock), priced = mine.filter((l) => l.priced);
    const rated = mine.filter((l) => l.rated);
    const reviews = rated.reduce((n, l) => n + (l.rated.reviews || 0), 0);
    out[b.id] = {
      listings: mine.length,
      models: uniq(mine.map((l) => l.product)).length,
      retailers: uniq(mine.map((l) => l.retailer)).length,
      sellable: known.length ? (known.filter(sellable).length / known.length) * 100 : null,
      oos: known.length ? (known.filter((l) => l.stocked.availability === "out_of_stock").length / known.length) * 100 : null,
      discounted: priced.length ? (priced.filter((l) => l.priced.discountPct).length / priced.length) * 100 : null,
      depth: median(priced.map((l) => l.priced.discountPct).filter(Boolean)),
      promo: mine.length ? (mine.filter((l) => l.latest.promos.length).length / mine.length) * 100 : null,
      rating: reviews ? rated.reduce((n, l) => n + l.rated.rating * (l.rated.reviews || 0), 0) / reviews : mean(rated.map((l) => l.rated.rating)),
      reviews,
    };
  }
  return out;
}
const col = (obj, f) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v ? v[f] : null]));

/* ── the AI side, through the console ─────────────────────────────────── */
function aiBrand() {
  const C = A.compareAnswers(), share = A.shareOf(C), out = {};
  for (const b of brands()) {
    const named = C.filter((a) => a.brands.some((x) => x.id === b.id));
    out[b.id] = {
      share: share[b.id] == null ? null : share[b.id] * 100,   // shareOf is a fraction
      named: C.length ? (named.length / C.length) * 100 : null,
      recommended: C.length ? (C.filter((a) => a.brands.some((x) => x.id === b.id && x.recommended)).length / C.length) * 100 : null,
      top: C.length ? (C.filter((a) => a.topPick === b.id).length / C.length) * 100 : null,
    };
  }
  return { out, n: C.length };
}
/** "BRAVIA 9 II True RGB 4K HDR Google TV with Gemini" → "BRAVIA 9 II". */
function aiModelName(brandId, raw) {
  let s = String(raw || "").split(/\s*\/\s*|,|\bor\b|\bvs\.?\b|\(/i)[0];
  s = s.replace(new RegExp(`^\\s*${B(brandId).label}\\s+`, "i"), "");
  s = s.split(/\b(?:QD-?OLED|OLED|Mini[\s-]?LED|LED|4K|8K|True\s+RGB|Smart|Google|with|Series|evo|Neo|Vision|QLED|ULED|TV|\d{2}["”]|\d{2}-?inch|inch)\b/i)[0];
  s = s.replace(/\s+/g, " ").trim().toUpperCase();
  return /\d/.test(s) ? s : null;
}
const modelRe = (m) => new RegExp(m.match, "i");
const SIZE_RE = /\b(\d{2,3})\s*(?:["”]|-?\s*inch(?:es)?\b|-?in\b|\s*class\b)/i;
const sizeOf = (s) => { const m = SIZE_RE.exec(s || ""); return m ? +m[1] : null; };
/** The first dollar figure in a claim, or null for a range or a claim with no dollar figure. */
function dollars(value, claim) {
  const src = /\$/.test(value || "") ? value : claim;
  if (/\$\s?[\d,.]+k?\s*(?:-|–|to)\s*\$?\s?[\d,.]+/i.test(src || "")) return null;
  const m = /\$\s?([\d,]+(?:\.\d+)?)(\s?k\b)?/i.exec(src || "");
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return v >= 50 ? v : null;
}

/* ── pages ────────────────────────────────────────────────────────────── */
const TPL = (id) => `<div class="ra-host" id="host-${id}">${URL_ ? '<div class="withheld-card"><b>Loading</b><p>Reading the retail audit…</p></div>' : ""}</div>`;

function renderScorecard(L, shelf, ai) {
  const s = S(), sh = shelf[s], a = ai.out[s];
  const row = (b) => ({ b: b.id, _subject: b.id === s });
  const cell = (v, f, obj, id) => v == null ? "—" : `${f(v)}`;
  const shareObj = col(ai.out, "share"), topObj = col(ai.out, "top"), sellObj = col(shelf, "sellable"), discObj = col(shelf, "discounted"), rateObj = col(shelf, "rating"), promoObj = col(shelf, "promo");
  const best = (obj) => { const st = standing(obj, s); return st ? st.rank === 1 : false; };
  const leaderOf = (obj) => { const st = standing(obj, s); return st ? B(st.leader).label : "—"; };
  const R_ = [];
  if (a.share != null) R_.push({ tone: best(shareObj) ? "good" : "watch", text: `On the ${A.compareLabel()} questions that name no brand, <b>${esc(SL())} holds ${pct(a.share)} of the AI answer</b>${best(shareObj) ? ", more than any tracked rival" : ` — ${esc(leaderOf(shareObj))} leads`}. Engines put ${esc(SL())} first in ${pct(a.top)} of those answers.` });
  if (sh && sh.sellable != null) R_.push({ tone: sh.sellable >= 80 ? "good" : sh.sellable >= 60 ? "watch" : "risk", text: `At the shelf, <b>${pct(sh.sellable)} of ${esc(SL())}'s tracked listings could be bought</b> at the latest reading (in stock or limited) — ${rankChip(sellObj, s).replace(/<[^>]+>/g, "")} among the brands audited.` });
  if (sh && sh.discounted != null) R_.push({ tone: "watch", text: `${pct(sh.discounted)} of ${esc(SL())}'s priced listings showed a was-price${sh.depth ? `, a median ${F().pct(sh.depth, 0)} off` : ""}; across all brands the field average is ${pct(mean(Object.values(discObj)))}.` });
  if (a.share != null && sh && sh.sellable != null) {
    const aiRank = standing(shareObj, s), shelfRank = standing(sellObj, s);
    if (aiRank && shelfRank && aiRank.rank < shelfRank.rank) R_.push({ tone: "risk", text: `The engines rank ${esc(SL())} higher (#${aiRank.rank}) than its shelf availability does (#${shelfRank.rank}): a shopper sent by an AI answer is more likely than average to land on an out-of-stock page.` });
    else if (aiRank && shelfRank && aiRank.rank > shelfRank.rank) R_.push({ tone: "watch", text: `The shelf is ahead of the answers: ${esc(SL())} ranks #${shelfRank.rank} for availability but #${aiRank.rank} in AI share. The product is there to buy; the engines are not sending shoppers to it as often.` });
  }
  $("host-ra-scorecard").innerHTML = `
  ${intro(`One row per brand: how the AI engines answer US shoppers (${ai.n} answers to brand-neutral questions in scope, from the console's filters above) beside what the retail audit tool read off ${R.rows.length} product-page screenshots on ${R.retailers.length} US retailers between ${F().dateY(R.dates[0])} and ${F().dateY(R.dates.at(-1))}. Shelf figures use each listing's latest reading.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Share of AI answer", dot: B(s).color, value: pct(a.share), rank: rankChip(shareObj, s), note: "Brand-neutral questions, all engines in scope" })}
    ${kpi({ label: "AI top pick", dot: B(s).color, value: pct(a.top), rank: rankChip(topObj, s), note: "Answers whose single top recommendation is the brand" })}
    ${kpi({ label: "Listings buyable", dot: B(s).color, value: sh ? pct(sh.sellable) : "—", rank: rankChip(sellObj, s), note: sh ? `${sh.listings} listings · ${sh.models} models · ${sh.retailers} retailers` : "Not on the audited shelf" })}
    ${kpi({ label: "Shelf rating", dot: B(s).color, value: sh && sh.rating != null ? F().n(sh.rating, 2) : "—", unit: "★", rank: rankChip(rateObj, s), note: sh ? `Review-weighted, ${F().n(sh.reviews)} reviews` : "" })}
  </div>
  ${card({ title: "The 360° view", sub: "AI columns read the answers; shelf columns read the retailer pages. Each column is ranked across the brands that have it.", html: table([
    { label: "Brand", lft: true, get: (r) => `${dot(r.b)}${esc(B(r.b).label)}` },
    { label: "Share of AI answer", get: (r) => `${pct(ai.out[r.b].share)} ${rankChip(shareObj, r.b)}` },
    { label: "Named in", get: (r) => pct(ai.out[r.b].named) },
    { label: "AI top pick", get: (r) => pct(ai.out[r.b].top) },
    { label: "Listings", get: (r) => shelf[r.b] ? String(shelf[r.b].listings) : "—" },
    { label: "Buyable", get: (r) => shelf[r.b] ? `${pct(shelf[r.b].sellable)} ${rankChip(sellObj, r.b)}` : "—" },
    { label: "With a was-price", get: (r) => shelf[r.b] ? pct(shelf[r.b].discounted) : "—" },
    { label: "With a promotion", get: (r) => shelf[r.b] ? `${pct(shelf[r.b].promo)}` : "—" },
    { label: "Rating", get: (r) => shelf[r.b] && shelf[r.b].rating != null ? `${F().n(shelf[r.b].rating, 2)}★ ${rankChip(rateObj, r.b)}` : "—" },
  ], brands().map(row)) })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "AI share against shelf availability", sub: "Right is more of the AI answer; up is more of the brand's listings buyable. Bubble size is listings tracked.", slot: "raScatter" })}
    ${card({ title: "Where each brand stands", sub: "Rank on each measure (1 is best). A brand whose AI rank beats its shelf rank sends shoppers to pages that may not convert.", slot: "raRanks" })}
  </div>
  <h2 class="sec">What the two together say</h2>${reads(R_)}`;
  const pts = brands().filter((b) => shelf[b.id] && ai.out[b.id].share != null && shelf[b.id].sellable != null)
    .map((b) => ({ x: ai.out[b.id].share, y: shelf[b.id].sellable, r: shelf[b.id].listings, color: b.color, label: b.label, tag: b.label,
      tip: `<div class="h">${esc(b.label)}</div><div class="r"><span>Share of AI answer</span><b class="tnum">${pct(ai.out[b.id].share)}</b></div><div class="r"><span>Listings buyable</span><b class="tnum">${pct(shelf[b.id].sellable)}</b></div>` }));
  if (pts.length > 1) CC.scatter($("raScatter"), { height: 280, points: pts, fmtX: (v) => v.toFixed(0) + "%", fmtY: (v) => v.toFixed(0) + "%", xLabel: "Share of AI answer", yLabel: "Listings buyable", yMax: 100 });
  else $("raScatter").innerHTML = withheld("Needs at least two brands with both readings.");
  const measures = [["AI share", shareObj], ["AI top pick", topObj], ["Buyable", sellObj], ["Rating", rateObj], ["Promotion", promoObj]];
  CC.heatmap($("raRanks"), { rows: brands(), cols: measures.map(([l]) => ({ id: l, label: l })), rowLabel: (b) => esc(b.label), rowDot: (b) => b.color,
    value: (b, c) => { const st = standing(measures.find(([l]) => l === c.id)[1], b.id); return st ? st.rank : null; }, invert: true, fmtV: (v) => "#" + v, scale: false });
}

function renderCarriage(L) {
  const s = S(), retailers = R.retailers;
  const ms = R.models.slice().sort((a, b) => (a.brand === s ? -1 : 0) - (b.brand === s ? -1 : 0) || brands().findIndex((x) => x.id === a.brand) - brands().findIndex((x) => x.id === b.brand));
  const at = (m, rt) => L.find((l) => l.brand === m.brand && l.product === m.product && l.retailer === rt);
  const mine = L.filter((l) => l.brand === s), known = mine.filter(knownStock);
  const oos = known.filter((l) => l.stocked.availability === "out_of_stock");
  const shelf = brandShelf(L), sellObj = col(shelf, "sellable");
  const chip = (l) => { if (!l) return `<span class="ra-nt" title="No link to this listing in the audit">not tracked</span>`; if (!l.stocked) return `<span class="ra-nt">no reading</span>`; const [t, c] = AV[l.stocked.availability] || [l.stocked.availability, ""]; return `<span class="tag ${c}" title="${esc(l.stocked.stock || t)} · ${esc(l.stocked.date)}">${esc(t)}</span>`; };
  $("host-ra-carriage").innerHTML = `
  ${laneNote("measured", `Read off each product page's screenshot by the retail audit tool; latest reading per listing. "Not tracked" means the audit holds no link for that model at that retailer — it is not evidence the retailer does not carry it.`)}
  ${intro(`Which of the audited models each retailer shows as buyable. ${esc(SL())} has <b>${mine.length} tracked listings</b> (${uniq(mine.map((l) => l.product)).length} models across ${uniq(mine.map((l) => l.retailer)).length} retailers); at the latest reading <b>${known.filter(sellable).length} of ${known.length}</b> with a stock reading could be bought.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Listings buyable", dot: B(s).color, value: pct(shelf[s] && shelf[s].sellable), rank: rankChip(sellObj, s), note: "In stock or limited, latest reading" })}
    ${kpi({ label: "Out of stock", dot: B(s).color, value: String(oos.length), note: oos.length ? oos.map((l) => `${esc(l.label)} at ${esc(l.retailer)}`).join(" · ") : "None at the latest reading" })}
    ${kpi({ label: "Retailers tracked", dot: "#80868b", value: String(uniq(mine.map((l) => l.retailer)).length), note: `Of ${retailers.length} in the audit: ${retailers.filter((rt) => !mine.some((l) => l.retailer === rt)).map(esc).join(", ") || "all"} hold no ${esc(SL())} link` })}
    ${kpi({ label: "Readings", dot: "#80868b", value: String(R.dates.length), note: R.dates.map((d) => F().date(d)).join(" · ") })}
  </div>
  ${card({ title: "Model × retailer", sub: "Latest stock reading for every audited model at every retailer. Hover a status for the page's own wording.", html: `<div class="dt-wrap"><table class="dt ra-matrix"><thead><tr><th class="lft">Model</th>${retailers.map((r) => `<th>${esc(r)}</th>`).join("")}</tr></thead><tbody>${ms.map((m) => `<tr class="${m.brand === s ? "subj" : ""}"><td class="lft">${dot(m.brand)}${esc(m.product)}</td>${retailers.map((rt) => `<td>${chip(at(m, rt))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Listings buyable, by brand", sub: "Share of each brand's listings with a stock reading that were in stock or limited.", slot: "raSellBars" })}
    ${card({ title: `${esc(SL())} listings, as the page said it`, sub: "Stock and delivery wording read off the latest screenshot, and the ship-to location the page was set to.", html: table([
      { label: "Listing", lft: true, get: (l) => `${esc(l.label)} · ${esc(l.retailer)}${shot(l.stocked || l.latest)}` },
      { label: "Status", lft: true, get: (l) => chip(l) },
      { label: "Page says", lft: true, get: (l) => esc(((l.stocked || l.latest).stock || "—").slice(0, 60)) },
      { label: "Delivery", lft: true, get: (l) => esc(((l.stocked || l.latest).delivery || "—").slice(0, 70)) },
      { label: "Ship to", lft: true, get: (l) => esc((l.stocked || l.latest).shipTo || "—") },
    ], mine.map((l) => ({ ...l })), { maxH: "360px" }) })}
  </div>`;
  CC.hbars($("raSellBars"), { rows: brands().filter((b) => shelf[b.id] && shelf[b.id].sellable != null).map((b) => ({ label: esc(b.label), value: shelf[b.id].sellable, color: b.color, subject: b.id === s, note: `${shelf[b.id].listings} listings` })).sort((a, b) => b.value - a.value), max: 100, fmtV: (v) => pct(v) });
}

function renderPricing(L) {
  const s = S(), retailers = R.retailers;
  const priced = L.filter((l) => l.priced);
  const mine = priced.filter((l) => l.brand === s);
  const byModel = R.models.map((m) => ({ m, ls: priced.filter((l) => l.brand === m.brand && l.product === m.product) })).filter((x) => x.ls.length);
  const spread = (x) => { const p = x.ls.map((l) => l.priced.price); return { lo: Math.min(...p), hi: Math.max(...p) }; };
  const catalog = (A.D.catalog && A.D.catalog.products) || [];
  const msrp = (m) => { const c = catalog.find((p) => p.label.toUpperCase() === m.label.toUpperCase()); return c ? c.msrp : null; };
  const own = byModel.filter((x) => x.m.brand === s);
  const widest = own.map((x) => ({ ...x, ...spread(x) })).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0];
  const shelf = brandShelf(L), discObj = col(shelf, "discounted");
  const changes = mine.map((l) => { const h = l.history.filter((r) => r.priceUsable); return h.length > 1 && h[0].price !== h.at(-1).price ? { l, from: h[0], to: h.at(-1) } : null; }).filter(Boolean);
  $("host-ra-pricing").innerHTML = `
  ${laneNote("measured", "Shelf price and was-price read off each page's screenshot; non-US pages, non-dollar prices and unreadable captures are left out. All audited TVs are the 65-inch size.")}
  ${intro(`What a shopper sees as the price of each audited model, retailer by retailer, at the latest reading. ${widest ? `${esc(SL())}'s widest gap is the <b>${esc(widest.m.label)}: ${F().usd0(widest.lo)} to ${F().usd0(widest.hi)}</b> depending on the retailer.` : ""}`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Listings with a was-price", dot: B(s).color, value: pct(shelf[s] && shelf[s].discounted), rank: rankChip(discObj, s), note: "A struck-through or list price above the shelf price" })}
    ${kpi({ label: "Median markdown", dot: B(s).color, value: shelf[s] && shelf[s].depth != null ? F().pct(shelf[s].depth, 0) : "—", note: "Among the brand's discounted listings" })}
    ${kpi({ label: "Price moves seen", dot: B(s).color, value: String(changes.length), note: changes.length ? changes.map((c) => `${esc(c.l.label)} at ${esc(c.l.retailer)} ${F().usd0(c.from.price)}→${F().usd0(c.to.price)}`).join(" · ") : `No ${esc(SL())} price changed between readings` })}
    ${kpi({ label: "Priced listings", dot: "#80868b", value: String(mine.length), note: `Of ${L.filter((l) => l.brand === s).length} tracked` })}
  </div>
  ${card({ title: "Price spread by model", sub: "Lowest and highest shelf price across retailers, latest reading, for every model priced differently at two or more retailers. The figure on the right is the gap.", slot: "raRanges" })}
  <div class="ra-mt">
    ${card({ title: `${esc(SL())} model × retailer`, sub: "Latest shelf price; the was-price, where shown, under it.", html: `<div class="dt-wrap"><table class="dt"><thead><tr><th class="lft">Model</th>${retailers.map((r) => `<th>${esc(r)}</th>`).join("")}${catalog.length ? "<th>Launch MSRP</th>" : ""}</tr></thead><tbody>${own.map((x) => `<tr><td class="lft">${esc(x.m.label)}</td>${retailers.map((rt) => { const l = x.ls.find((y) => y.retailer === rt); return `<td>${l ? `${F().usd0(l.priced.price)}${l.priced.listPrice ? `<br><s class="ra-was">${F().usd0(l.priced.listPrice)}</s>` : ""}` : "—"}</td>`; }).join("")}${catalog.length ? `<td>${msrp(x.m) ? F().usd0(msrp(x.m)) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table></div>` })}
  </div>
  ${card({ title: "Markdown by brand", sub: "Share of each brand's priced listings that showed a was-price, and the median depth of those markdowns.", slot: "raDiscBars", cls: "ra-mt" })}`;
  const rows = byModel.map((x) => ({ x, ...spread(x) })).filter((r) => r.x.ls.length > 1 && r.hi > r.lo)
    .sort((a, b) => (a.x.m.brand === s ? -1 : 0) - (b.x.m.brand === s ? -1 : 0) || b.hi - a.hi)
    .map((r) => ({ label: `${B(r.x.m.brand).label} ${r.x.m.label}`, lo: r.lo, hi: r.hi, color: B(r.x.m.brand).color, subject: r.x.m.brand === s,
      tip: `<div class="h">${esc(B(r.x.m.brand).label)} ${esc(r.x.m.label)}</div>${r.x.ls.slice().sort((a, b) => a.priced.price - b.priced.price).map((l) => `<div class="r"><span>${esc(l.retailer)}</span><b class="tnum">${F().usd0(l.priced.price)}</b></div>`).join("")}` }));
  if (rows.length) CC.ranges($("raRanges"), { rows, fmtV: F().usd0 }); else $("raRanges").innerHTML = withheld("No model is priced at more than one retailer.");
  const bs = brands().filter((b) => shelf[b.id] && shelf[b.id].discounted != null);
  CC.bars($("raDiscBars"), { height: 230, cats: bs.map((b) => b.label), series: [
    { id: "share", label: "Listings with a was-price", color: "#1a73e8", data: bs.map((b) => shelf[b.id].discounted) },
    { id: "depth", label: "Median markdown", color: "#fbbc04", data: bs.map((b) => shelf[b.id].depth || 0) }], fmtV: (v) => pct(v), fmtY: (v) => v + "%" });
}

const PROMO = { discount: "Discount", financing: "Financing", "gift-card": "Gift card", shipping: "Shipping", "free-item": "Free item", bundle: "Bundle", other: "Other" };
const PROMO_COLORS = { discount: "#1a73e8", financing: "#9334e6", "gift-card": "#e8710a", shipping: "#12b5cb", "free-item": "#34a853", bundle: "#fbbc04", other: "#80868b" };
function renderPromos(L) {
  const s = S();
  const types = Object.keys(PROMO);
  const typeShare = (b, t) => { const ls = L.filter((l) => l.brand === b); return ls.length ? (ls.filter((l) => l.latest.promos.some((p) => (PROMO[p.type] ? p.type : "other") === t)).length / ls.length) * 100 : null; };
  const mine = L.filter((l) => l.brand === s);
  const promos = mine.flatMap((l) => l.latest.promos.map((p) => ({ l, p })));
  const shelf = brandShelf(L), promoObj = col(shelf, "promo");
  const top = types.map((t) => [t, typeShare(s, t)]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  $("host-ra-promos").innerHTML = `
  ${laneNote("measured", "Up to three promotions per page, as the audit's reader classed them off the screenshot (discount, financing, gift card, free item, bundle, shipping). Latest reading per listing.")}
  ${intro(`What each listing offered on top of the price. <b>${pct(shelf[s] && shelf[s].promo)} of ${esc(SL())}'s listings</b> carried at least one promotion at the latest reading${top.length ? `; the most common was ${esc(PROMO[top[0][0]].toLowerCase())} (${pct(top[0][1])} of listings)` : ""}.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Listings with a promotion", dot: B(s).color, value: pct(shelf[s] && shelf[s].promo), rank: rankChip(promoObj, s), note: "Any promotion type" })}
    ${["discount", "financing", "gift-card"].map((t) => kpi({ label: PROMO[t], dot: PROMO_COLORS[t], value: pct(typeShare(s, t)), rank: rankChip(Object.fromEntries(brands().map((b) => [b.id, typeShare(b.id, t)])), s), note: `Of ${esc(SL())} listings` })).join("")}
  </div>
  ${card({ title: "Promotion mix by brand", sub: "Share of each brand's listings carrying each promotion type. A listing can carry several.", slot: "raPromoBars" })}
  <div style="margin-top:14px">${card({ title: `Every ${esc(SL())} promotion, verbatim`, sub: "As read off the latest screenshot of each listing.", html: promos.length ? table([
    { label: "Listing", lft: true, get: (r) => `${esc(r.l.label)} · ${esc(r.l.retailer)}${shot(r.l.latest)}` },
    { label: "Type", lft: true, get: (r) => tagFor("", PROMO[r.p.type] || r.p.type || "Other") },
    { label: "What the page says", lft: true, get: (r) => `<span class="ra-wrap">${esc(r.p.summary)}</span>` },
    // the sheet stores a percentage discount as a fraction (-0.33)
    { label: "Value", get: (r) => { const v = r.p.value, n = Number(v); return v !== "" && Number.isFinite(n) && Math.abs(n) < 1 ? F().pct(Math.abs(n) * 100, 0) + " off" : esc(v || "—"); } },
  ], promos, { maxH: "420px" }) : withheld(`No promotion was read on any ${esc(SL())} listing.`) })}</div>`;
  const bs = brands().filter((b) => L.some((l) => l.brand === b.id));
  CC.bars($("raPromoBars"), { height: 250, cats: bs.map((b) => b.label), series: types.map((t) => ({ id: t, label: PROMO[t], color: PROMO_COLORS[t], data: bs.map((b) => typeShare(b.id, t) || 0) })).filter((x) => x.data.some(Boolean)), fmtV: (v) => pct(v), fmtY: (v) => v + "%" });
}

function renderVoice(L) {
  const s = S();
  const rated = L.filter((l) => l.rated);
  const mine = rated.filter((l) => l.brand === s).sort((a, b) => b.rated.reviews - a.rated.reviews);
  const shelf = brandShelf(L), rateObj = col(shelf, "rating"), revObj = col(shelf, "reviews");
  const low = mine.filter((l) => l.rated.reviews >= 10).sort((a, b) => a.rated.rating - b.rated.rating)[0];
  const byModel = R.models.filter((m) => m.brand === s).map((m) => { const ls = mine.filter((l) => l.product === m.product); const n = ls.reduce((x, l) => x + (l.rated.reviews || 0), 0); return { m, n, r: n ? ls.reduce((x, l) => x + l.rated.rating * (l.rated.reviews || 0), 0) / n : null, ls }; }).filter((x) => x.ls.length);
  $("host-ra-voice").innerHTML = `
  ${laneNote("measured", "Star rating and review count shown on each retailer's page. The 27 Sep 2026 run wrote every rating as a whole star, so its ratings are left out; its other fields are kept.")}
  ${intro(`How shoppers rate the audited models where they buy them. ${esc(SL())} averages <b>${shelf[s] && shelf[s].rating != null ? F().n(shelf[s].rating, 2) + "★" : "—"}</b> across ${F().n(shelf[s] ? shelf[s].reviews : 0)} reviews, weighted by review count.${low ? ` Its lowest-rated listing with ten or more reviews is the ${esc(low.label)} at ${esc(low.retailer)} (${F().n(low.rated.rating, 1)}★, ${F().n(low.rated.reviews)} reviews).` : ""}`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Rating", dot: B(s).color, value: shelf[s] && shelf[s].rating != null ? F().n(shelf[s].rating, 2) : "—", unit: "★", rank: rankChip(rateObj, s), note: "Review-weighted, latest reading" })}
    ${kpi({ label: "Reviews", dot: B(s).color, value: F().k(shelf[s] ? shelf[s].reviews : null), rank: rankChip(revObj, s), note: "Summed over the tracked listings" })}
    ${kpi({ label: "Best-rated model", dot: B(s).color, value: byModel.length ? esc(byModel.slice().sort((a, b) => b.r - a.r)[0].m.label) : "—", note: byModel.length ? `${F().n(byModel.slice().sort((a, b) => b.r - a.r)[0].r, 2)}★` : "" })}
    ${kpi({ label: "Most-reviewed listing", dot: B(s).color, value: mine[0] ? F().n(mine[0].rated.reviews) : "—", note: mine[0] ? `${esc(mine[0].label)} at ${esc(mine[0].retailer)}` : "" })}
  </div>
  <div class="grid g2">
    ${card({ title: "Rating by brand", sub: "Review-weighted average star rating across each brand's tracked listings.", slot: "raRateBars" })}
    ${card({ title: `${esc(SL())} listings`, sub: "Latest rating and review count on each retailer's page.", html: table([
      { label: "Listing", lft: true, get: (l) => `${esc(l.label)} · ${esc(l.retailer)}${shot(l.rated)}` },
      { label: "Rating", get: (l) => `${F().n(l.rated.rating, 1)}★` },
      { label: "Reviews", get: (l) => F().n(l.rated.reviews) },
      { label: "Read on", get: (l) => F().date(l.rated.date) },
    ], mine, { maxH: "360px" }) })}
  </div>`;
  const rows = brands().filter((b) => shelf[b.id] && shelf[b.id].rating != null).map((b) => ({ label: esc(b.label), value: shelf[b.id].rating, color: b.color, subject: b.id === s, note: `${F().k(shelf[b.id].reviews)} reviews` })).sort((a, b) => b.value - a.value);
  CC.hbars($("raRateBars"), { rows, max: 5, fmtV: (v) => F().n(v, 2) + "★" });
}

function renderAiShelf(L) {
  const s = S(), Aall = A.activeAnswers();
  const ownModels = R.models.filter((m) => m.brand === s);
  const priced = L.filter((l) => l.priced && l.brand === s);
  const shelfRange = (m) => { const ls = priced.filter((l) => l.product === m.product); if (!ls.length) return null; const p = ls.map((l) => l.priced.price); const lists = ls.map((l) => l.priced.listPrice).filter(Boolean); return { lo: Math.min(...p), hi: Math.max(...p), list: lists.length ? Math.max(...lists) : null, ls }; };
  const shelfSize = median(L.filter((l) => l.brand === s).map((l) => sizeOf(l.latest.title)));
  // 1 · the models the engines name, against the audited shelf
  const named = new Map();
  const withSubject = Aall.filter((a) => a.brands.some((x) => x.id === s));
  for (const a of withSubject) {
    const names = new Set();
    for (const x of a.brands) if (x.id === s && x.product) { const n = aiModelName(s, x.product); if (n) names.add(n); }
    for (const c of a.subjectClaims || []) { const n = aiModelName(s, c.product); if (n) names.add(n); }
    for (const n of names) named.set(n, (named.get(n) || 0) + 1);
  }
  const shelfFor = (name) => ownModels.find((m) => modelRe(m).test(name));
  const ranked = [...named.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => ({ name, n, m: shelfFor(name) }));
  for (const m of ownModels) if (!ranked.some((r) => r.m === m)) ranked.push({ name: m.label.toUpperCase(), n: [...named.entries()].filter(([k]) => shelfFor(k) === m).reduce((x, [, v]) => x + v, 0), m });
  const onShelf = ownModels.map((m) => ({ m, n: [...named.entries()].filter(([k]) => shelfFor(k) === m).reduce((x, [, v]) => x + v, 0) }));
  const aiOnly = ranked.filter((r) => !r.m);
  // 2 · every dollar figure the engines quoted for a shelf model, checked against the shelf
  const claims = [];
  for (const a of Aall) for (const c of a.subjectClaims || []) {
    if (c.type !== "price") continue;
    const name = aiModelName(s, c.product) || "";
    const m = ownModels.find((mm) => modelRe(mm).test(`${c.product}`) || (name && modelRe(mm).test(name)));
    if (!m) continue;
    const v = dollars(c.value, c.claim); if (v == null) continue;
    const size = sizeOf(`${c.claim} ${c.value}`);
    const rg = shelfRange(m); if (!rg) continue;
    // a quote that names no size and misses the shelf is most likely for another size of the
    // same model, so it is not judged; only a quote at the audited size can be off the shelf
    const inRange = v >= rg.lo * 0.97 && v <= Math.max(rg.hi, rg.list || 0) * 1.03;
    let verdict;
    if (size && shelfSize && size !== shelfSize) verdict = ["other size", ""];
    else if (inRange) verdict = ["matches the shelf", "good"];
    else if (!size) verdict = ["size not stated", ""];
    else if (v > rg.hi) verdict = ["above the shelf", "warn"];
    else verdict = ["below the shelf", "risk"];
    claims.push({ a, c, m, v, size, rg, verdict, gap: (v - rg.lo) / rg.lo * 100 });
  }
  const sameSize = claims.filter((x) => x.verdict[0] !== "other size" && x.verdict[0] !== "size not stated");
  const unstated = claims.filter((x) => x.verdict[0] === "size not stated");
  const ok = sameSize.filter((x) => x.verdict[1] === "good");
  const byEngine = A.D.engines.filter((e) => sameSize.some((x) => x.a.engine === e.id)).map((e) => { const xs = sameSize.filter((x) => x.a.engine === e.id); return { e, n: xs.length, ok: xs.filter((x) => x.verdict[1] === "good").length }; });
  // 3 · stock on the models the engines send shoppers to
  const named4 = onShelf.filter((x) => x.n > 0);
  const oosNamed = L.filter((l) => l.brand === s && l.stocked && l.stocked.availability === "out_of_stock" && named4.some((x) => x.m.product === l.product));
  const R_ = [];
  if (aiOnly.length) R_.push({ tone: "risk", text: `The engines' most-named ${esc(SL())} models are <b>${aiOnly.slice(0, 3).map((r) => esc(r.name)).join(", ")}</b> — none of them is in the retail audit. The shelf that is audited (${ownModels.map((m) => esc(m.label)).join(", ")}) is what shoppers find; add the AI-named models to the audit's links to see whether those answers can convert.` });
  const quiet = onShelf.filter((x) => x.n <= 2);
  if (quiet.length) R_.push({ tone: "watch", text: `${quiet.map((x) => `<b>${esc(x.m.label)}</b> (${x.n} answer${x.n === 1 ? "" : "s"})`).join(", ")} ${quiet.length === 1 ? "is" : "are"} on the audited shelf but almost absent from the AI answers in scope: entry and mid-range models that carry the shelf promotions get little AI attention.` });
  if (sameSize.length) R_.push({ tone: ok.length / sameSize.length >= 0.6 ? "good" : "watch", text: `Of ${sameSize.length} checkable dollar prices the engines quoted for audited ${esc(SL())} models, <b>${ok.length} (${pct(ok.length / sameSize.length * 100)}) fall inside what the shelf showed</b> (lowest price to highest was-price, ±3%)${sameSize.length - ok.length ? `; ${sameSize.filter((x) => x.verdict[0] === "above the shelf").length} quote the ${shelfSize}-inch above it and ${sameSize.filter((x) => x.verdict[0] === "below the shelf").length} below it` : ""}. A further ${unstated.length} quotes give no screen size and miss the ${shelfSize}-inch range — most likely another size, so they are listed but not judged.` });
  if (oosNamed.length) R_.push({ tone: "risk", text: `AI-named models were out of stock at: ${oosNamed.map((l) => `${esc(l.label)} at ${esc(l.retailer)}`).join(", ")} (latest reading).` });
  $("host-ra-aishelf").innerHTML = `
  ${laneNote("derived", `Joins the two measured sets: the AI reader's product names and price claims for ${esc(SL())} (answers in the console's current scope) matched to the audited models by model name. Neither side is modelled.`)}
  ${intro(`Does what the engines tell shoppers about ${esc(SL())} line up with what a shopper then finds at the retailer? Three checks: <b>which models</b> the engines name against which models are on the audited shelf, <b>the prices</b> the engines quote against the shelf price, and <b>stock</b> on the models the engines name.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Audited models the AI names", dot: B(s).color, value: `${named4.length}<small> of ${ownModels.length}</small>`, note: `In ${withSubject.length} answers that name ${esc(SL())}` })}
    ${kpi({ label: "AI-named models not audited", dot: "#80868b", value: String(aiOnly.length), note: aiOnly.slice(0, 4).map((r) => esc(r.name)).join(" · ") || "—" })}
    ${kpi({ label: "AI prices that match the shelf", dot: "#34a853", value: sameSize.length ? pct(ok.length / sameSize.length * 100) : "—", note: `${ok.length} of ${sameSize.length} quotes at ${shelfSize || "the audited"}" or matching it · ${unstated.length} with no size and off the ${shelfSize || ""}" range, ${claims.length - sameSize.length - unstated.length} for another size, not judged` })}
    ${kpi({ label: "Named models out of stock", dot: "#ea4335", value: String(oosNamed.length), note: "Listings at the latest reading" })}
  </div>
  <div class="grid g2">
    ${card({ title: `The ${esc(SL())} models the engines name`, sub: "Answers in scope that name each model (any engine, persona, run), and whether the retail audit tracks it.", html: table([
      { label: "Model as the engines name it", lft: true, get: (r) => esc(r.name) },
      { label: "Answers", get: (r) => F().n(r.n) },
      { label: "On the audited shelf", lft: true, get: (r) => r.m ? tagFor("good", `${R.retailers.filter((rt) => L.some((l) => l.product === r.m.product && l.retailer === rt)).length} retailers`) : tagFor("warn", "not audited") },
      { label: "Shelf price", get: (r) => { const rg = r.m && shelfRange(r.m); return rg ? (rg.lo === rg.hi ? F().usd0(rg.lo) : `${F().usd0(rg.lo)}–${F().usd0(rg.hi)}`) : "—"; } },
      { label: "Buyable", get: (r) => { if (!r.m) return "—"; const ls = L.filter((l) => l.product === r.m.product && knownStock(l)); return ls.length ? `${ls.filter(sellable).length} of ${ls.length}` : "—"; } },
    ], ranked.slice().sort((a, b) => !!b.m - !!a.m || b.n - a.n).map((r) => ({ ...r, _subject: !!r.m })), { maxH: "430px" }) })}
    ${card({ title: "AI price quotes against the shelf", sub: "Checkable dollar quotes per engine for audited models, and how many sat inside the shelf range.", slot: "raClaimBars" })}
  </div>
  <div style="margin-top:14px">${card({ title: "Every price quote, checked", sub: `Dollar figures the engines gave for audited ${esc(SL())} models, against the latest shelf range (lowest price to highest was-price). Tap a row for the full answers to that question.`, html: claims.length ? table([
    { label: "Engine", lft: true, get: (x) => esc(A.engLabel(x.a.engine)) },
    { label: "Model", lft: true, get: (x) => esc(x.m.label) },
    { label: "What the engine said", lft: true, get: (x) => `<a class="ra-link" href="javascript:void 0" onclick="__AIV.openQuestion('${esc(x.a.queryId)}')"><span class="ra-wrap">${esc(x.c.claim)}</span></a>` },
    { label: "Quoted", get: (x) => F().usd0(x.v) },
    { label: "Shelf", get: (x) => `${F().usd0(x.rg.lo)}${x.rg.hi !== x.rg.lo ? "–" + F().usd0(x.rg.hi) : ""}${x.rg.list ? `<br><s class="ra-was">${F().usd0(x.rg.list)}</s>` : ""}` },
    { label: "Verdict", lft: true, get: (x) => tagFor(x.verdict[1], x.verdict[0]) },
  ], claims.sort((a, b) => ({ risk: 0, warn: 0, good: 1 }[a.verdict[1]] ?? 2) - ({ risk: 0, warn: 0, good: 1 }[b.verdict[1]] ?? 2) || Math.abs(b.gap) - Math.abs(a.gap)), { maxH: "460px" }) : withheld("No engine quoted a dollar price for an audited model in the answers in scope.") })}</div>
  <h2 class="sec">What the join says</h2>${reads(R_)}`;
  if (byEngine.length) CC.bars($("raClaimBars"), { height: 250, stacked: true, cats: byEngine.map((x) => x.e.label), series: [
    { id: "ok", label: "Matches the shelf", color: "#34a853", data: byEngine.map((x) => x.ok) },
    { id: "off", label: "Off the shelf", color: "#ea4335", data: byEngine.map((x) => x.n - x.ok) }], fmtV: (v) => F().n(v) });
  else $("raClaimBars").innerHTML = withheld("No checkable quotes in scope.");
}

function renderMethod(L) {
  const src = R.source, s = S();
  const ex = Object.entries(src.excluded || {});
  $("host-ra-method").innerHTML = `
  ${intro(`This dashboard joins two measured sources for ${esc(SL())} ${esc(R.category)}. Nothing on it is modelled: a figure that was not read is shown as "—" or withheld, the rule the command-center template's measured-only dashboards follow.`)}
  <div class="grid g2">
    ${card({ title: "1 · AI answers (the console pages)", sub: "ai-answer-collector, collection " + esc(A.D.current), html: `<ul class="ra-ul">
      <li>${A.D.bank.length} shopper questions × ${A.D.personas ? A.D.personas.length : 1} personas × ${A.D.runs || 1} runs, asked of ${A.D.engines.map((e) => esc(e.label)).join(", ")} (${A.D.engines.map((e) => esc(e.via)).join("; ")}). US market.</li>
      <li>Every answer read once by a Claude reader pass: brands named and their order, recommendations, top pick, attributes, and claims about ${esc(SL())} (price, spec, comparison).</li>
      <li>Payload in the command-center-template console schema (<code>lib/ai-console.ts</code>), rendered by its <code>ai-visibility.js</code>.</li></ul>` })}
    ${card({ title: "2 · Retail shelf (Retail Shelf pages)", sub: `retail audit tool → Google Sheet "${esc(src.tab)}" tab`, html: `<ul class="ra-ul">
      <li>The audit opens each tracked product page at ${R.retailers.map(esc).join(", ")} in a real browser and saves a full-page screenshot to GCS.</li>
      <li>A vision model reads price, was-price, availability, stock wording, delivery, rating, reviews and up to three promotions off each screenshot; rows are appended to the <a href="${esc(src.sheetUrl)}" target="_blank" rel="noopener">Retail Audit Tool Results</a> sheet.</li>
      <li><code>npm run retail</code> read ${F().n(src.rows)} rows on ${F().dateY(src.readAt.slice(0, 10))} (readings ${R.dates.map((d) => F().date(d)).join(", ")}) and kept the sheet as read beside the payload.</li></ul>` })}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "How the two are joined", html: `<ul class="ra-ul">
      <li><b>Brands</b>: both sides use the study's brand ids (${brands().map((b) => esc(b.label)).join(", ")}), so a brand's colour and rank mean the same on every page.</li>
      <li><b>Models</b>: each audited model gets a name pattern (e.g. "BRAVIA 8 II" matches "Bravia 8 II QD-OLED" but not "Bravia 8"). The reader's product names and claim products are matched against it.</li>
      <li><b>Prices</b>: the first dollar figure in a price claim is checked against the model's latest shelf range, lowest price to highest was-price, ±3%. Ranges, non-dollar claims and quotes for another screen size are not judged.</li>
      <li><b>Scope</b>: the persona, run, engine and question filters of the AI console apply to the 360° Scorecard and AI vs the Shelf; the shelf pages do not depend on them.</li></ul>` })}
    ${card({ title: "What is left out, and why", html: `<ul class="ra-ul">${ex.map(([k, v]) => `<li>${F().n(v)} rows: ${esc(k)}.</li>`).join("")}
      <li>A model the audit holds no link for at a retailer shows as "not tracked", not as unavailable.</li>
      <li>The audit tracks ${R.models.filter((m) => m.brand === s).length} ${esc(SL())} models at the 65-inch size; it is a sample of the shelf, not the retailers' full range, so shares of listings are not shares of the market.</li>
      <li>Ship-to locations differ by retailer and run (New York, Sacramento, Texas…); delivery wording is shown as read, not compared.</li></ul>` })}
  </div>`;
}

// Charts size to their card, and a page that is not showing has no width: redraw once the
// console has routed to a retail page.
let routed = false;
window.addEventListener("hashchange", () => { if (A && location.hash.startsWith("#ra-")) setTimeout(() => render(A), 0); });
function render(api) {
  A = api;
  if (!routed && R) { routed = true; setTimeout(() => render(A), 0); }
  if (!URL_) return;
  const ids = GROUPS.flatMap((g) => g.pages.map((p) => p.id));
  if (failed || !R) {
    if (failed) for (const id of ids) { const h = $("host-" + id); if (h) h.innerHTML = withheld(`The retail payload did not load (${esc(failed)}). Run <code>npm run retail -- --collection ${esc(A.D.current)}</code>.`); }
    return;
  }
  const L = listings(), shelf = brandShelf(L);
  const steps = [["ra-scorecard", () => renderScorecard(L, shelf, aiBrand())], ["ra-carriage", () => renderCarriage(L)], ["ra-pricing", () => renderPricing(L)],
    ["ra-promos", () => renderPromos(L)], ["ra-voice", () => renderVoice(L)], ["ra-aishelf", () => renderAiShelf(L)], ["ra-method", () => renderMethod(L)]];
  for (const [id, f] of steps) { try { if ($("host-" + id)) f(); } catch (e) { console.error(id, e); $("host-" + id).innerHTML = withheld(`This page failed to build (${esc(e.message)}).`); } }
}

window.RetailAudit = {
  on: !!URL_,
  icons: ICONS,
  /** Adds the groups to the console's NAV: the scorecard first, the rest after the console's own group. */
  extendNav(NAV) { if (!URL_) return; NAV.unshift(...GROUPS.filter((g) => g.first)); NAV.push(...GROUPS.filter((g) => !g.first)); },
  tpl: TPL,
  render,
  loaded: load,
};
})();
