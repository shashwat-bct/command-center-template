/* About this data: what is measured and what is modelled, lane by lane, as the build recorded it */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC;
const { card, esc, table } = U;
const original = P.method;
const LABEL = { scorecard: "360° Scorecard", ai: "AI visibility", traffic: "Website traffic", voice: "Voice of Customer", shelf: "Retail shelf", landing: "Landing pages", carriage: "Carriage & buy box", stock: "Availability", delivery: "Delivery promise", pricing: "Pricing", promotions: "Promotions", calendar: "Promo calendar", strategy: "Promo strategy", tco: "Cost of ownership" };
const TONE = { measured: "var(--good)", mixed: "var(--warn)", modelled: "var(--risk)", not_measured: "var(--mute)" };
const WORD = { measured: "Measured", mixed: "Measured + modelled", modelled: "Modelled", not_measured: "Not measured" };

P.method = (host) => {
  original(host);
  const lanes = (U.D.meta && U.D.meta.provenance && U.D.meta.provenance.lanes) || {};
  const hidden = new Set((U.D.meta && U.D.meta.hiddenPages) || []);
  const rows = Object.entries(lanes).map(([id, l]) => ({ id, ...l })).filter((l) => LABEL[l.id]);
  if (!rows.length) return;
  const html = table([
    { label: "Page", lft: true, get: (l) => `<b style="font-weight:500">${esc(LABEL[l.id])}</b>${hidden.has(l.id) ? '<div class="mini">hidden: no measured data</div>' : ""}` },
    { label: "Status", lft: true, get: (l) => `<b style="color:${TONE[l.status] || "var(--mute)"}">${esc(WORD[l.status] || l.status)}</b>` },
    { label: "What was read and what was modelled", lft: true, get: (l) => `<span class="mini">${esc(l.note || "")}</span>` },
  ], rows);
  const section = card({ title: "Measured and modelled, page by page", help: "For each page of the dashboard, whether its figures were read from a source on this build, modelled around what was read, or modelled outright, with the build's own note on what was read.", sub: "As recorded by this build. A modelled page with no measured data is hidden from the dashboard.", html });
  host.insertAdjacentHTML("afterbegin", `<div style="margin-bottom:14px">${section}</div>`);
};
})();
