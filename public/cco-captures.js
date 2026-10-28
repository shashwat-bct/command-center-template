/* Retailer page captures for the Landing content checklist: the page each listing was read from, its screenshot and what the page showed */
(function () {
"use strict";
const U = window.__CC;
const { esc } = U;
const RTL = { amazon: "Amazon", walmart: "Walmart", bestbuy: "Best Buy", target: "Target" };
const usd = (v) => (v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shaky = (c) => (c.quality && c.quality !== "ok") || /mississauga|canada|\bL\d[A-Z] ?\d[A-Z]\d\b/i.test(c.shipTo || "");
const all = () => (U.D.captures && U.D.captures.captures) || [];

function latest(model, retailer) {
  return all().filter((c) => c.model === model && c.retailer === retailer).sort((a, z) => z.date.localeCompare(a.date))[0] || null;
}

function thumb(c) {
  return c && c.top ? `<img src="${esc(c.top)}" alt="" loading="lazy" style="display:block;width:96px;height:60px;object-fit:cover;object-position:top;border:1px solid var(--line2);border-radius:5px">` : "";
}

function fact(label, value) {
  return value == null || value === "" ? "" : `<tr><th style="text-align:left;font-weight:500;color:var(--mute);padding:5px 12px 5px 0;vertical-align:top;white-space:nowrap">${label}</th><td style="padding:5px 0">${value}</td></tr>`;
}

function detail(c) {
  const same = all().filter((x) => x.model === c.model && x.retailer === c.retailer).sort((a, z) => z.date.localeCompare(a.date));
  const promos = (c.promos || []).map((p) => `<li>${esc([p.type, p.summary, p.value].filter(Boolean).join(" · "))}</li>`).join("");
  return `<div data-capture-detail>
    <h4 style="margin:16px 0 8px">Page as captured</h4>
    ${same.length > 1 ? `<div class="seg mini" style="margin-bottom:10px">${same.map((x) => `<button data-cap="${esc(x.id)}" class="${x.id === c.id ? "on" : ""}">${day(x.date)}</button>`).join("")}</div>` : ""}
    ${shaky(c) ? `<p class="mini" style="color:var(--warn);margin:0 0 8px">Read with caveats${c.quality && c.quality !== "ok" ? ` (quality: ${esc(c.quality)})` : ""}${c.shipTo ? ` · delivery location ${esc(c.shipTo)}` : ""}${c.unusable ? ` · ${esc(c.unusable)}` : ""}.</p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px"><tbody>
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
      ${fact("Captured", esc(c.capturedAt ? new Date(c.capturedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" : day(c.date)))}
      ${fact("Page", c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(RTL[c.retailer] || c.retailer)} product page ↗</a>` : null)}
    </tbody></table>
    ${c.top ? `<a href="${esc(c.top.replace(".top.jpg", ".jpg"))}" target="_blank" rel="noopener"><img src="${esc(c.top)}" alt="Top of the page" style="width:100%;border:1px solid var(--line2);border-radius:8px;margin-bottom:8px"></a>` : ""}
    ${c.image ? `<a href="${esc(c.image)}" target="_blank" rel="noopener"><img src="${esc(c.image)}" alt="Full page" loading="lazy" style="width:100%;border:1px solid var(--line2);border-radius:8px"></a>` : `<p class="mini">No screenshot was saved for this capture.</p>`}
  </div>`;
}

function bind(host) {
  host.querySelectorAll("[data-cap]").forEach((b) => (b.onclick = () => {
    const c = all().find((x) => x.id === b.dataset.cap);
    const box = host.querySelector("[data-capture-detail]");
    if (c && box) { box.outerHTML = detail(c); bind(host); }
  }));
}

window.__CCCAPTURES = { latest, thumb, detail, bind, any: () => all().length > 0 };
})();
