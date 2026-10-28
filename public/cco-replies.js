/* Voice of Customer: how each brand handles its retailer reviews, and the retailer's own review summary for the subject's products */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC;
const { B, RT, card, esc, table } = U;
const original = P.voice;
const pct = (n, d) => (d ? Math.round((n / d) * 100) + "%" : "—");
const day = (iso) => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

P.voice = (host) => {
  original(host);
  const f = U.D.retailFeed;
  if (!f || !f.products) return;
  const S = U.S, SUBJ = U.SUBJ;
  const withReviews = f.products.filter((p) => p.brand && (f.reviews[p.id] || []).length);
  if (!withReviews.length) return;
  const retailers = [...new Set(withReviews.map((p) => p.retailer))];
  const rows = U.D.dims.brands.map((b) => {
    const list = withReviews.filter((p) => p.brand === b.id).flatMap((p) => f.reviews[p.id] || []);
    const low = list.filter((r) => (r.rating || 5) <= 2);
    const replied = list.filter((r) => r.brandReply);
    const by = {};
    for (const r of replied) if (r.replyBy) by[r.replyBy] = (by[r.replyBy] || 0) + 1;
    const team = Object.entries(by).sort((a, z) => z[1] - a[1])[0];
    const sample = low.find((r) => r.brandReply) || replied[0] || null;
    return { b, n: list.length, verified: list.filter((r) => r.verified).length, incentivized: list.filter((r) => r.incentivized).length, replied: replied.length, low: low.length, lowReplied: low.filter((r) => r.brandReply).length, team: team ? team[0] : null, sample };
  }).filter((r) => r.n);
  const subj = rows.find((r) => r.b.id === S);
  const best = rows.filter((r) => r.b.id !== S).sort((a, z) => z.lowReplied / Math.max(1, z.low) - a.lowReplied / Math.max(1, a.low))[0];
  const tbl = table([
    { label: "Brand", lft: true, get: (r) => `<span class="dot" style="background:${r.b.color}"></span>${esc(r.b.label)}` },
    { label: "Reviews read", get: (r) => `<span class="tnum">${r.n}</span>` },
    { label: "Brand replied", get: (r) => `<b class="tnum">${pct(r.replied, r.n)}</b>` },
    { label: "1–2★ answered", get: (r) => `<b class="tnum" style="color:${r.low && r.lowReplied / r.low >= 0.6 ? "var(--good)" : r.low ? "var(--risk)" : "var(--mute)"}">${pct(r.lowReplied, r.low)}</b><div class="mini">${r.lowReplied} of ${r.low}</div>` },
    { label: "Verified purchase", get: (r) => `<span class="tnum">${pct(r.verified, r.n)}</span>` },
    { label: "Incentivized", get: (r) => `<span class="tnum">${pct(r.incentivized, r.n)}</span>` },
    { label: "Who replies", lft: true, get: (r) => esc(r.team || "—") },
  ], rows.map((r) => ({ ...r, _subject: r.b.id === S })));
  const quote = subj && subj.sample ? `<blockquote style="margin:12px 0 0;padding:10px 12px;border-left:3px solid ${B(S).color};background:var(--line2);border-radius:6px;font-size:13px"><div class="mini">${subj.sample.rating}★ review, ${day(subj.sample.date)}: “${esc((subj.sample.text || subj.sample.title || "").slice(0, 180))}${(subj.sample.text || "").length > 180 ? "…" : ""}”</div><div style="margin-top:6px"><b>${esc(subj.sample.replyBy || SUBJ)}:</b> ${esc(subj.sample.brandReply.slice(0, 260))}${subj.sample.brandReply.length > 260 ? "…" : ""}</div></blockquote>` : "";
  const lead = subj ? `${SUBJ} answered ${pct(subj.lowReplied, subj.low)} of its 1–2★ reviews${best ? `; ${best.b.label} answered ${pct(best.lowReplied, best.low)}` : ""}. ${pct(subj.incentivized, subj.n)} of ${SUBJ}'s reviews are marked incentivized.` : "";

  const summaries = withReviews.filter((p) => p.brand === S && f.reviewSummary && f.reviewSummary[p.id]).map((p) => ({ p, s: f.reviewSummary[p.id] }));
  const sumHtml = summaries.length ? table([
    { label: "Product", lft: true, get: (x) => `${esc(x.p.title || x.p.item)}<div class="mini">${esc(RT(x.p.retailer).label)}</div>` },
    { label: "Rating", get: (x) => (x.s.avgRating != null ? `<b class="tnum">${Number(x.s.avgRating).toFixed(1)}★</b><div class="mini">${(x.s.total || 0).toLocaleString("en-US")} ratings</div>` : "—") },
    { label: "Recommend", get: (x) => (x.s.recommendedPct != null ? `${x.s.recommendedPct}%` : "—") },
    { label: "Stars 1–5", lft: true, get: (x) => (x.s.stars || []).map((v) => v ?? "—").join(" · ") },
    { label: "Themes the retailer lists", lft: true, get: (x) => esc((x.s.aspects || []).slice(0, 5).join(", ") || "—") },
    { label: "Top complaint", lft: true, get: (x) => (x.s.topNegative && x.s.topNegative.text ? `<span class="mini">${x.s.topNegative.rating}★ “${esc(x.s.topNegative.text.slice(0, 140))}${x.s.topNegative.text.length > 140 ? "…" : ""}”</span>` : "—") },
  ], summaries) : "";

  const section = `<div class="grid" style="margin-top:14px;grid-template-columns:minmax(0,1fr)">
    ${card({ title: "How brands handle their reviews", help: "For each brand's reviews at the retailers read: the share with a reply from the brand, the share of 1–2★ reviews it answered, and how many are verified purchases or marked incentivized.", sub: `${retailers.map((r) => RT(r).label).join(", ")} reviews. ${esc(lead)}`, html: tbl + quote })}
    ${sumHtml ? card({ title: `${SUBJ} products: the retailer's own review summary`, help: "The retailer's rating, recommend share, star breakdown, the themes it lists and its top critical review for each of the brand's products.", sub: "As the retailer summarises them on the product page.", html: sumHtml }) : ""}
  </div>`;
  const reads = host.querySelector("h2.sec");
  if (reads) reads.insertAdjacentHTML("beforebegin", section); else host.insertAdjacentHTML("beforeend", section);
};
})();
