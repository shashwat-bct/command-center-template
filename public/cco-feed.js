/* ===========================================================================
   RETAILER FEED READINGS — the details a retailer feed holds for a tracked
   listing, as tooltip rows for the pages that show that retailer
   =========================================================================== */
(function () {
"use strict";
const D = () => window.__CC && window.__CC.D;
const F = () => CC.fmt;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const FULFILMENT = { FC: "warehouse", STORE: "store", OTHER: "other", MARKETPLACE: "seller" };
const STATUS = { AVAILABLE: "available", IN_STOCK: "available", NOT_AVAILABLE: "not available", OUT_OF_STOCK: "out of stock" };

const feed = () => (D() && D().retailFeed) || null;
const product = (mid, rt) => { const f = feed(); return f ? f.products.find((p) => p.model === mid && p.retailer === rt) || null : null; };
const days = (mid, rt, a, z) => { const p = product(mid, rt); return p ? (feed().daily[p.id] || []).filter((d) => (!a || d.date >= a) && (!z || d.date <= z)) : []; };
const lastOf = (list, key) => { for (let i = list.length - 1; i >= 0; i--) if (list[i][key] != null) return list[i][key]; return null; };
const row = (k, v) => `<div class="r sub"><span>${esc(k)}</span><b>${v}</b></div>`;
const share = (list, key) => { const v = list.filter((d) => d[key] != null); return v.length ? v.filter((d) => d[key]).length / v.length : null; };

function sellers(list) {
  const by = new Map();
  for (const d of list) for (const o of d.sellerOffers || []) by.set(o.seller, o);
  return [...by.values()].sort((a, z) => (a.price ?? 1e9) - (z.price ?? 1e9));
}

/**
 * What the feed read for one listing at one retailer over a span of days: the price
 * range read, price per 100 wipes, where orders ship from, whether the retailer
 * fulfils them, order limit, shipping and pickup, badges, stock units, sellers
 * and their prices, and verified reviews — each only when the feed read it,
 * as [label, value] pairs.
 */
function facts(mid, rt, a, z, only) {
  const f = feed(), list = days(mid, rt, a, z);
  if (!f || !list.length) return [];
  const want = (k) => !only || only.includes(k);
  const out = [];
  const row = (k, v) => [k, v];
  const lows = list.map((d) => d.low).filter((v) => v != null), highs = list.map((d) => d.high).filter((v) => v != null);
  const name = (window.__CC.RT(rt) || {}).label || rt;
  if (want("range") && lows.length) out.push(row(a === z ? "Day's price range" : "Price range read", `${F().usd(Math.min(...lows))} – ${F().usd(Math.max(...highs))}`));
  const unit = lastOf(list, "unitPrice");
  if (want("unit") && unit != null) out.push(row("Price per 100 wipes", F().usd(unit)));
  const ff = list.map((d) => d.fulfillment).filter(Boolean);
  if (want("fulfil") && ff.length) out.push(row("Ships from", [...new Set(ff)].map((x) => FULFILMENT[x] || x.toLowerCase()).join(", ")));
  const own = share(list, "retailerFulfilled");
  if (want("fulfil") && own != null) out.push(row(`Fulfilled by ${name}`, F().pct(own * 100, 0) + " of readings"));
  const limit = lastOf(list, "orderLimit");
  if (want("stock") && limit != null) out.push(row("Order limit", `${limit} per order`));
  const ship = lastOf(list, "shipping"), pick = lastOf(list, "pickup");
  if (want("stock") && ship) out.push(row("Shipping", STATUS[ship] || ship.toLowerCase()));
  if (want("stock") && pick) out.push(row("Store pickup", STATUS[pick] || pick.toLowerCase()));
  const units = lastOf(list, "stock");
  if (want("stock") && units != null) out.push(row("Units in stock", F().n(units)));
  const best = list.some((d) => d.bestSeller), bought = lastOf(list, "bought"), low = list.some((d) => d.lowInventory);
  if (want("badges") && (best || bought != null || low)) out.push(row("Badges", [best ? "Best seller" : "", bought != null ? `${F().n(bought)}+ bought` : "", low ? "Low inventory" : ""].filter(Boolean).join(" · ")));
  const sl = sellers(list);
  if (want("sellers") && sl.length) out.push(row(`Sellers on ${name}`, sl.slice(0, 5).map((o) => `${esc(o.seller)} ${o.price != null ? F().usd(o.price) : ""}`.trim()).join(" · ") + (sl.length > 5 ? ` · +${sl.length - 5} more` : "")));
  const verified = lastOf(list, "verifiedReviews");
  if (want("reviews") && verified != null) out.push(row("Verified reviews", F().n(verified)));
  return out;
}

function rows(mid, rt, a, z, only) {
  const list = facts(mid, rt, a, z, only);
  if (!list.length) return "";
  const name = (window.__CC.RT(rt) || {}).label || rt;
  return `<div class="r sub" style="margin-top:4px"><span style="font-weight:600">${esc(name)} · ${esc(feed().label)}</span></div>${list.map(([k, v]) => row(k, v)).join("")}`;
}

const STARS = ["#ea4335", "#fa7b17", "#fbbc04", "#9cd17f", "#34a853"];

/**
 * A retailer product's own review summary for an aspect drawer: rating,
 * reviews, recommend share, star breakdown, verified share of the reviews on
 * file, the retailer's summary, and its highlight for the aspect when it has
 * one.
 */
function reviewSummaryHtml(productId, aspect) {
  const f = feed();
  const s = f && f.reviewSummary[productId];
  if (!s) return "";
  const list = f.reviews[productId] || [];
  const total = (s.stars || []).reduce((a, v) => a + (v || 0), 0);
  const bar = total ? `<span style="display:inline-flex;width:110px;height:8px;border-radius:3px;overflow:hidden;vertical-align:middle;margin:0 6px" title="${[5, 4, 3, 2, 1].map((n) => `${n}★ ${F().n(s.stars[n - 1] || 0)}`).join(" · ")}">${[4, 3, 2, 1, 0].map((i) => `<i style="display:block;height:100%;width:${((s.stars[i] || 0) / total) * 100}%;background:${STARS[i]}"></i>`).join("")}</span>` : "";
  const verified = list.length ? list.filter((r) => r.verified).length / list.length : null;
  const words = String(aspect || "").toLowerCase();
  const bullet = (s.aiBullets || []).find((b) => { const k = b.split(":")[0].toLowerCase(); return k && (k.includes(words) || words.includes(k)); });
  const parts = [
    `${F().star(s.avgRating)} · ${F().n(s.total)} reviews${s.withText != null ? ` (${F().n(s.withText)} with text)` : ""}${s.recommendedPct != null ? ` · ${F().pct(s.recommendedPct, 0)} recommend` : ""}${verified != null ? ` · ${F().pct(verified * 100, 0)} of recent reviews verified` : ""}${s.media ? ` · ${F().n(s.media)} with photos` : ""}${s.textFiveStar != null || s.textOneStar != null ? ` · written reviews: ${F().n(s.textFiveStar || 0)} at 5★, ${F().n(s.textOneStar || 0)} at 1★` : ""}${(() => { const v = lastOf(f.daily[productId] || [], "verifiedReviews"); return v != null ? ` · ${F().n(v)} verified reviews in all` : ""; })()}`,
  ];
  return `<div style="font-size:12.5px;color:var(--soft);margin:6px 0 8px;line-height:1.55">${parts.join("")}${bar}
    ${bullet ? `<div style="color:var(--ink)">${esc(bullet.replace(/\((positive|negative|neutral)\)/i, "").trim())} <span class="mini">— ${esc((window.__CC.RT((f.products.find((p) => p.id === productId) || {}).retailer) || {}).label || "retailer")}'s summary</span></div>` : ""}
    ${s.aiSummary ? `<div style="margin-top:4px">${esc(s.aiSummary)}</div>` : ""}</div>`;
}

window.__CCFEED = { feed, product, days, facts, rows, sellers, reviewSummaryHtml };
})();
