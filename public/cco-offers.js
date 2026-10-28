/* Promotions: the offers read on retailer product pages, by brand and offer type, with every offer listed */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC;
const { B, RT, card, esc, table, $$ } = U;
const el = (id) => document.getElementById(id);
const original = P.promotions;
const ORDER = ["amazon", "walmart", "bestbuy", "target"];
const TYPE = { discount: "Price discount", event: "Event banner", badge: "Deal badge", financing: "Financing / card", "gift-card": "Gift card", "free-item": "Free item", bundle: "Bundle", shipping: "Delivery / returns", "trade-in": "Trade-in / haul-away", "price-in-cart": "Price in cart", other: "Other" };
const day = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
let tab = "all", who = "subject";

const brandId = (label) => (U.D.dims.brands.find((b) => b.label.toLowerCase() === String(label).toLowerCase()) || {}).id;

function drawList(offers) {
  const S = U.S;
  const list = offers.filter((o) => (tab === "all" || o.retailer === tab) && (who === "all" || brandId(o.brand) === S)).sort((a, z) => z.date.localeCompare(a.date));
  $$("#ofTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
  $$("#ofWho button").forEach((b) => b.classList.toggle("on", b.dataset.w === who));
  el("ofList").innerHTML = list.length ? table([
    { label: "Date", lft: true, get: (o) => `<span class="tnum">${day(o.date)}</span>` },
    { label: "Retailer", lft: true, get: (o) => esc(RT(o.retailer).label) },
    { label: "Model", lft: true, get: (o) => { const id = brandId(o.brand); return `<span class="dot" style="background:${id ? B(id).color : "#9aa0a6"}"></span>${esc(o.brand)} ${esc(o.modelName)}`; } },
    { label: "Offer", lft: true, get: (o) => `<span class="tag">${esc(TYPE[o.type] || o.type)}</span>` },
    { label: "What the page said", lft: true, get: (o) => `${esc(o.summary || "—")}${o.url ? ` <a href="${esc(o.url)}" target="_blank" rel="noopener" class="mini">page ↗</a>` : ""}` },
  ], list.map((o) => ({ ...o, _subject: brandId(o.brand) === S })), { maxH: "420px" }) : '<p class="mini">No offers read for this selection.</p>';
}

P.promotions = (host) => {
  original(host);
  const offers = (U.D.offers || []).filter((o) => ORDER.includes(o.retailer));
  if (!offers.length) return;
  const S = U.S, SUBJ = U.SUBJ;
  const brands = U.D.dims.brands.filter((b) => offers.some((o) => brandId(o.brand) === b.id));
  const types = Object.keys(TYPE).filter((t) => offers.some((o) => o.type === t));
  const count = (b, t) => offers.filter((o) => brandId(o.brand) === b && o.type === t).length;
  const share = (b, t) => { const n = offers.filter((o) => brandId(o.brand) === b).length; return n ? count(b, t) / n : 0; };
  const subjOnly = types.filter((t) => count(S, t) && brands.every((b) => b.id === S || !count(b.id, t)));
  const rivalOnly = types.filter((t) => !count(S, t) && brands.some((b) => b.id !== S && count(b.id, t)));
  const dates = offers.map((o) => o.date).sort();
  const grid = `<div style="overflow-x:auto"><table class="cc-heat-t" style="width:100%;font-size:12.5px"><thead><tr><th style="text-align:left">Offer type</th>${brands.map((b) => `<th><span class="dot" style="background:${b.color}"></span>${esc(b.label)}</th>`).join("")}</tr></thead><tbody>${types.map((t) => `<tr><th style="text-align:left;font-weight:500;padding:6px 8px 6px 0">${TYPE[t]}</th>${brands.map((b) => { const n = count(b.id, t); return `<td style="text-align:center;padding:6px 4px;${b.id === S ? "font-weight:600" : ""}">${n ? `<span class="tnum">${n}</span><div class="mini" style="color:var(--mute)">${Math.round(share(b.id, t) * 100)}%</div>` : '<span style="color:var(--mute)">—</span>'}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="mini" style="margin:10px 0 0">${rivalOnly.length ? `<b>Rivals use, ${esc(SUBJ)} does not:</b> ${rivalOnly.map((t) => TYPE[t].toLowerCase()).join(", ")}. ` : ""}${subjOnly.length ? `<b>Only ${esc(SUBJ)} uses:</b> ${subjOnly.map((t) => TYPE[t].toLowerCase()).join(", ")}.` : ""}</p>`;
  const section = `<div class="grid" style="margin-top:14px;grid-template-columns:minmax(0,1fr)">
    ${card({ title: "Offers on retailer product pages", help: "Every offer read on a product page: price discounts, deal badges and event banners, financing and card offers, gift cards, free items, bundles, delivery and trade-in offers. Read from page captures and archived product pages.", sub: `${offers.length} offers read between ${day(dates[0])} and ${day(dates[dates.length - 1])}. Count per brand, with the share of that brand's offers underneath.`, html: grid })}
    ${card({ title: "Every offer read", help: "Each offer as the product page showed it, newest first.", sub: "Newest first. Pick a retailer, or switch to all brands to see what competitors ran.",
      html: `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px"><div class="seg mini" id="ofTabs"><button data-t="all">All retailers</button>${ORDER.filter((r) => offers.some((o) => o.retailer === r)).map((r) => `<button data-t="${r}">${RT(r).label}</button>`).join("")}</div><div class="seg mini" id="ofWho"><button data-w="subject">${esc(SUBJ)}</button><button data-w="all">All brands</button></div></div><div id="ofList"></div>` })}
  </div>`;
  const reads = host.querySelector("h2.sec");
  if (reads) reads.insertAdjacentHTML("beforebegin", section); else host.insertAdjacentHTML("beforeend", section);
  $$("#ofTabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; drawList(offers); }));
  $$("#ofWho button").forEach((b) => (b.onclick = () => { who = b.dataset.w; drawList(offers); }));
  drawList(offers);
};
})();
