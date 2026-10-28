/* Landing page: every retailer product page captured for the brand set, with its screenshot and what was read from it */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC;
const { B, card, esc, openDrawer } = U;
const RTL = { amazon: "Amazon", walmart: "Walmart", bestbuy: "Best Buy", target: "Target", newegg: "Newegg", crutchfield: "Crutchfield" };
const ORDER = Object.keys(RTL);
const original = P.landing;
const usd = (v) => (v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const brandOf = (label) => U.D.dims.brands.find((b) => b.label.toLowerCase() === String(label).toLowerCase());
const shaky = (c) => (c.quality && c.quality !== "ok") || /mississauga|canada|\bL\d[A-Z] ?\d[A-Z]\d\b/i.test(c.shipTo || "");

function fact(label, value) {
  return value == null || value === "" ? "" : `<tr><th style="text-align:left;font-weight:500;color:var(--mute);padding:6px 12px 6px 0;vertical-align:top;white-space:nowrap">${label}</th><td style="padding:6px 0">${value}</td></tr>`;
}

function show(c, all) {
  const same = all.filter((x) => x.model === c.model && x.retailer === c.retailer).sort((a, z) => z.date.localeCompare(a.date));
  const promos = (c.promos || []).map((p) => `<li>${esc([p.type, p.summary, p.value].filter(Boolean).join(" · "))}</li>`).join("");
  const html = `
    ${same.length > 1 ? `<div class="seg mini" style="margin-bottom:12px">${same.map((x) => `<button data-cap="${esc(x.id)}" class="${x.id === c.id ? "on" : ""}">${day(x.date)}</button>`).join("")}</div>` : ""}
    ${shaky(c) ? `<p class="mini" style="color:var(--warn);margin:0 0 10px">Read with caveats${c.quality && c.quality !== "ok" ? ` (quality: ${esc(c.quality)})` : ""}${c.shipTo ? ` · delivery location ${esc(c.shipTo)}` : ""}${c.unusable ? ` · ${esc(c.unusable)}` : ""}.</p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px"><tbody>
      ${fact("Title", c.title && esc(c.title))}
      ${fact("Price", c.price != null ? `<b>${usd(c.price)}</b>${c.was && c.was > c.price ? ` <s style="color:var(--mute)">${usd(c.was)}</s>` : ""}${c.saving ? ` · save ${usd(c.saving)}${c.savingPct ? ` (${Math.round(c.savingPct)}%)` : ""}` : ""}` : esc(c.priceLabel || "Not shown"))}
      ${fact("Price label", c.price != null && c.priceLabel ? esc(c.priceLabel) : null)}
      ${fact("Other sellers from", c.otherSellersFrom != null ? usd(c.otherSellersFrom) : null)}
      ${fact("Availability", c.availability && esc(c.availability.replace(/_/g, " ")))}
      ${fact("Stock message", c.stock && esc(c.stock))}
      ${fact("Delivery", c.delivery && esc(c.delivery))}
      ${fact("Rating", c.rating != null ? `${c.rating}★${c.reviews != null ? ` · ${Math.round(c.reviews).toLocaleString("en-US")} reviews` : ""}` : null)}
      ${fact("Promotions", promos ? `<ul style="margin:0;padding-left:18px">${promos}</ul>` : null)}
      ${fact("Delivery location", c.shipTo && esc(c.shipTo))}
      ${fact("Flags", (c.flags || []).length ? esc(c.flags.join(", ")) : null)}
      ${fact("Captured", esc(c.capturedAt ? new Date(c.capturedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" : day(c.date)))}
      ${fact("Page", c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(RTL[c.retailer])} product page ↗</a>` : null)}
    </tbody></table>
    ${c.image ? `<a href="${esc(c.image)}" target="_blank" rel="noopener"><img src="${esc(c.image)}" alt="${esc(c.modelName)} at ${esc(RTL[c.retailer])}, ${day(c.date)}" loading="lazy" style="width:100%;border:1px solid var(--line2);border-radius:8px"></a>` : `<p class="mini">No screenshot was saved for this capture.</p>`}`;
  openDrawer(`${c.modelName} · ${RTL[c.retailer]}`, `Product page as captured on ${day(c.date)}`, html);
  document.querySelectorAll("#drBody [data-cap]").forEach((b) => (b.onclick = () => show(all.find((x) => x.id === b.dataset.cap), all)));
}

P.landing = (host) => {
  original(host);
  const all = (U.D.captures && U.D.captures.captures) || [];
  const caps = all.filter((c) => U.retailer === "all" || c.retailer === U.retailer);
  if (!caps.length) return;
  const rts = ORDER.filter((r) => caps.some((c) => c.retailer === r));
  const models = [...new Map(caps.map((c) => [c.model, c])).values()];
  const dates = [...new Set(caps.map((c) => c.date))].sort();
  const latest = (m, r) => caps.filter((c) => c.model === m && c.retailer === r).sort((a, z) => z.date.localeCompare(a.date))[0];
  const cell = (m, r) => {
    const c = latest(m.model, r);
    if (!c) return `<td style="padding:6px;text-align:center;color:var(--mute)">—</td>`;
    const n = caps.filter((x) => x.model === m.model && x.retailer === r).length;
    return `<td style="padding:6px;vertical-align:top"><button type="button" data-cap="${esc(c.id)}" style="all:unset;cursor:pointer;display:block;width:150px">
      ${c.top ? `<img src="${esc(c.top)}" alt="" loading="lazy" style="display:block;width:150px;height:92px;object-fit:cover;object-position:top;border:1px solid var(--line2);border-radius:6px">` : `<div style="width:150px;height:92px;border:1px dashed var(--line2);border-radius:6px"></div>`}
      <div class="mini" style="margin-top:4px"><b class="tnum">${c.price != null ? usd(c.price) : esc(c.priceLabel || "no price")}</b>${c.promos && c.promos.length ? ` · ${c.promos.length} promo${c.promos.length === 1 ? "" : "s"}` : ""}${shaky(c) ? ` · <span style="color:var(--warn)">check</span>` : ""}</div>
      <div class="mini" style="color:var(--mute)">${day(c.date)}${n > 1 ? ` · ${n} captures` : ""}</div></button></td>`;
  };
  const rows = models.sort((a, z) => (z.brand === U.D.dims.brands.find((b) => b.id === U.S)?.label) - (a.brand === U.D.dims.brands.find((b) => b.id === U.S)?.label) || a.brand.localeCompare(z.brand) || a.modelName.localeCompare(z.modelName))
    .map((m) => { const b = brandOf(m.brand); return `<tr><td style="padding:6px 10px 6px 0;white-space:nowrap;vertical-align:top"><span class="dot" style="background:${b ? B(b.id).color : "#9aa0a6"}"></span>${esc(m.brand)} ${esc(m.modelName)}</td>${rts.map((r) => cell(m, r)).join("")}</tr>`; }).join("");
  const html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:6px 10px 6px 0">Model</th>${rts.map((r) => `<th style="text-align:left;padding:6px">${RTL[r]}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const section = card({ title: "Product pages as captured", help: "The product page each retailer showed for each tracked model, captured as a screenshot with its price, promotions, delivery promise, stock message and rating read from the page.",
    sub: `${caps.length} page captures of ${models.length} models across ${rts.map((r) => RTL[r]).join(", ")}, ${day(dates[0])} – ${day(dates[dates.length - 1])}. The latest capture is shown; open one for the full page and every capture date.`, html });
  const intro = host.querySelector(".pintro");
  if (intro) intro.insertAdjacentHTML("afterend", `<div style="margin-bottom:14px">${section}</div>`);
  else host.insertAdjacentHTML("afterbegin", section);
  host.querySelectorAll("[data-cap]").forEach((b) => (b.onclick = () => show(all.find((x) => x.id === b.dataset.cap), all)));
};
})();
