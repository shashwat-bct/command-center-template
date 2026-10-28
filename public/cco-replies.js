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
  addReplies(host);
  regroup(host, U.SUBJ);
};

function addReplies(host) {
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
    { label: "Product", lft: true, get: (x) => { const t = x.p.title || x.p.item, m = /BRAVIA \d+(?: II)?/i.exec(t) || /\b([A-Z]{1,5}\d{1,4}[A-Z]{0,3})(\s+Pro)?\b/.exec(t); return `<span title="${esc(t)}" style="white-space:nowrap">${esc(m ? m[0] : t.slice(0, 40))}</span><div class="mini">${esc(RT(x.p.retailer).label)}</div>`; } },
    { label: "Rating", get: (x) => (x.s.avgRating != null ? `<b class="tnum">${Number(x.s.avgRating).toFixed(1)}★</b><div class="mini">${(x.s.total || 0).toLocaleString("en-US")} ratings</div>` : "—") },
    { label: "Recommend", get: (x) => (x.s.recommendedPct != null ? `${x.s.recommendedPct}%` : "—") },
    { label: "Stars 1–5", lft: true, get: (x) => (x.s.stars || []).map((v) => v ?? "—").join(" · ") },
    { label: "Themes the retailer lists", lft: true, get: (x) => `<span style="display:block;white-space:normal;min-width:180px">${esc((x.s.aspects || []).slice(0, 5).join(", ") || "—")}</span>` },
    { label: "Top complaint", lft: true, get: (x) => (x.s.topNegative && x.s.topNegative.text ? `<span class="mini" style="display:block;white-space:normal;min-width:240px">${x.s.topNegative.rating}★ “${esc(x.s.topNegative.text.slice(0, 140))}${x.s.topNegative.text.length > 140 ? "…" : ""}”</span>` : "—") },
  ], summaries) : "";

  const section = `<div class="grid" style="grid-template-columns:minmax(0,1fr)">
    ${card({ title: "How brands handle their reviews", help: "For each brand's reviews at the retailers read: the share with a reply from the brand, the share of 1–2★ reviews it answered, and how many are verified purchases or marked incentivized.", sub: `${retailers.map((r) => RT(r).label).join(", ")} reviews. ${esc(lead)}`, html: tbl + quote })}
    ${sumHtml ? card({ title: `${SUBJ} products: the retailer's own review summary`, help: "The retailer's rating, recommend share, star breakdown, the themes it lists and its top critical review for each of the brand's products.", sub: "As the retailer summarises them on the product page.", html: sumHtml }) : ""}
  </div>`;
  const reads = host.querySelector("h2.sec");
  if (reads) reads.insertAdjacentHTML("beforebegin", section); else host.insertAdjacentHTML("beforeend", section);
}

const GROUPS = (subj) => [
  { h: `How ${subj} is rated`, match: /^(rating through the quarter|review velocity|star mix by brand|would recommend)/i },
  { h: "What reviewers say", match: /^(aspect scores by brand|.*praise vs complaints|.*against the best competitor)/i, wide: /^what reviewers say about/i },
  { h: "How each brand responds", match: /^(how brands handle their reviews|.*the retailer's own review summary)/i, single: true },
];

function regroup(host, subj) {
  const title = (c) => ((c.querySelector(".card-h h3") || {}).textContent || "").trim();
  const cards = [...host.querySelectorAll(".card")].filter((c) => title(c));
  const reads = [...host.querySelectorAll("h2.sec")].find((h) => /what the reviews say/i.test(h.textContent));
  const frag = document.createDocumentFragment();
  for (const g of GROUPS(subj)) {
    const mine = cards.filter((c) => g.match.test(title(c)));
    const wide = g.wide ? cards.filter((c) => g.wide.test(title(c))) : [];
    if (!mine.length && !wide.length) continue;
    const h = document.createElement("h2");
    h.className = "sec";
    h.textContent = g.h;
    const grid = document.createElement("div");
    grid.style.marginBottom = "14px";
    frag.append(h, grid);
    if (wide.length && mine.length) {
      grid.className = "grid g2";
      grid.style.alignItems = "stretch";
      const column = (cards) => {
        const col = document.createElement("div");
        col.style.cssText = "display:flex;flex-direction:column;gap:14px;min-width:0";
        for (const c of cards) col.appendChild(c);
        const last = cards[cards.length - 1];
        if (last) last.style.flex = "1 1 auto";
        return col;
      };
      grid.append(column(mine), column(wide));
      continue;
    }
    const list = [...mine, ...wide];
    grid.className = list.length > 1 && !g.single ? "grid g2" : "grid";
    if (list.length === 1 || g.single) grid.style.gridTemplateColumns = "minmax(0,1fr)";
    for (const c of list) grid.appendChild(c);
  }
  if (!frag.childNodes.length) return;
  host.insertBefore(frag, reads || null);
  for (const el of host.querySelectorAll(".grid, .stack-v")) if (!el.querySelector(".card, .kpi") && !el.textContent.trim()) el.remove();
}
})();
