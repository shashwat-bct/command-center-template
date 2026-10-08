/* ===========================================================================
   PAGE RENDERERS — one per driver, registered into the shell's RENDER map
   =========================================================================== */
(function () {
"use strict";
const P = window.__CCPAGES, U = window.__CC, F = CC.fmt;
const { B, RT, MD, BIDS, AI_BIDS, RIDS, sc, metricDef, fmtFor, deltaChip, rankChip, kpi, metricKpi, readsBlock,
        card, intro, table, slot, tc, win, winDates, winBands, slice, mean, sum, pairsFor, carriedPairs,
        retailerScope, openDrawer, esc, $, $$, period, provOf, provBadge } = U;
const D = () => U.D;
// Set from the payload by the shell before any renderer runs, so no screen here
// knows or names the brand it is showing.
let S = "sonos", SUBJ = "";
window.__ccSubject = (id, label) => { S = id; SUBJ = label; };
const el = (id) => document.getElementById(id);
// A brand whose measure is withheld has no series to draw. It is dropped from
// the chart rather than drawn at zero, and the card that owns the chart says
// which brands are missing and why.
const brandSeries = (get) => D().dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: get(b.id) ? slice(get(b.id)) : null }))
  .filter((s) => s.data && s.data.length);
const GROUPS = [
  { id: "demand", label: "Demand", metrics: ["trafficShare", "sessions"] },
  { id: "mind", label: "Share of mind", metrics: ["aiSov"] },
  { id: "visibility", label: "Share of visibility", metrics: ["shelfSov", "pdpScore"] },
  { id: "distribution", label: "Share of distribution", metrics: ["carriage", "inStock", "leadTime"] },
  { id: "commercial", label: "Commercial", metrics: ["priceIndex", "promoIntensity", "promoDepth"] },
  { id: "voice", label: "Voice", metrics: ["rating"] },
];

/* ══════════════════════════════════════════════════════════════════════════
   360° SCORECARD
   ══════════════════════════════════════════════════════════════════════════ */
P.scorecard = (host) => {
  const p = period(), d = D();
  const hi = ["trafficShare", "aiSov", "shelfSov", "carriage", "priceIndex", "promoIntensity"];
  host.innerHTML = `
  ${intro(`Thirteen weeks of the ${SUBJ} commercial position, read at three cadences on one page.
    The <b>${esc(p.long.toLowerCase())}</b> view below covers <b>${F.dateY(d.dims.dates[p.cur[0]])} – ${F.dateY(d.dims.dates[p.cur[1]])}</b>,
    compared <b>${esc(p.cmp)}</b>. Every driver in the rail resolves to one of the twelve measures in the scorecard, so a
    number that moves here has a page behind it that says why.`,
    `<div class="card tint" style="min-width:250px"><div class="card-h"><div class="ct"><h3>Cadence</h3><p>${esc(p.long)}</p></div></div>
      <div style="font-family:var(--fm);font-size:12px;line-height:1.9;color:var(--soft)">
        <div><b style="color:var(--ink)">Current</b> · ${esc(p.curLabel)}</div>
        <div><b style="color:var(--ink)">Against</b> · ${esc(p.prevLabel)}</div>
        <div><b style="color:var(--ink)">Retailers</b> · ${d.dims.retailers.length === 1 ? `${RT(d.dims.retailers[0].id).label} only` : U.retailer === "all" ? `all ${d.dims.retailers.length}` : RT(U.retailer).label}</div>
      </div></div>`)}
  <div class="grid g3" style="margin-bottom:14px">${hi.map((m) => metricKpi(m, S)).join("")}</div>
  ${card({ title: `The twelve measures, ${d.dims.brands.length} brands, one page`, help: "The full scorecard: every driver in the rail resolves to one of these twelve measures, read at the cadence selected above. Rank is computed on each measure's own direction, so on delivery promise and discount depth a lower number ranks better. The sparkline is always the thirteen weekly readings, whatever cadence is showing.", sub: `${SUBJ} column highlighted. Rank is computed on each measure's own direction — on delivery promise and promotional depth a lower number ranks better. Sparkline is the 13 weekly readings, regardless of the cadence selected.`, tag: "360° scorecard", tagCls: "acc", html: `<div class="sc-wrap" id="scTable"></div>` })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Where each brand stands", help: "A radar of eight measures, each rescaled across the brands in the set, so the outer edge is the best in this category rather than an absolute. It answers shape rather than size: a brand strong everywhere looks round, a brand with one weapon looks like a star.", sub: "One shape per brand, each over the same grey category average. Read the spikes: a brand that is strong everywhere looks round, a brand with one weapon looks like a star.", slot: "scRadar" })}
    ${card({ title: "Rank movement through the quarter", help: "Weekly position rather than weekly level. A share chart answers how much; this answers who is winning, which is a different question. Measures are offered most-volatile first, so a flat chart means the order held all quarter — itself a finding.", sub: "Weekly rank, not level — it answers who is winning, which a share chart does not.",
      html: `<div class="seg mini wrap" id="scBumpPick" style="margin-bottom:12px"></div><div id="scBump"></div>` })}
  </div>
  <h2 class="sec">What the quarter says</h2>
  ${readsBlock("overview")}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Driver movement, ranked", help: "Each measure's change over the comparison window, largest mover first. Green is movement in the direction that helps that particular measure, which for discount depth and delivery promise means downward. Bar length runs on the square root of the change so one large mover does not flatten the rest.", sub: `Each measure's ${esc(p.cmp)} change for ${SUBJ}, largest mover first. Green is movement in the direction that helps.`, slot: "scMove" })}
    ${card({ title: "Category events inside the window", help: "The retail-calendar moments the simulation responds to — the shaded bands on every chart in the rail. Each carries a demand multiplier applied to the traffic and shelf lanes for its dates.", sub: "Retail-calendar moments the lanes below respond to. Every driver page bands its charts with these.", html: eventList() })}
  </div>`;

  // ── the scorecard table
  const rows = [];
  for (const g of GROUPS) {
    rows.push(`<tr class="grp"><td class="lft" colspan="7">${g.label}</td></tr>`);
    for (const mid of g.metrics) {
      const md = metricDef(mid), f = fmtFor(mid);
      rows.push(`<tr>
        <td class="lft metric">${md.label}<em>${md.good === "down" ? "lower is better" : md.good === "neutral" ? "no better direction" : "higher is better"}${md.unit ? ` · ${md.unit}` : ""}</em></td>
        ${BIDS().map((b) => { const o = sc(mid, b);
          if (provOf(mid, b) === "unmeasured") return `<td class="${b === S ? "subj " : ""}is-nm"><div class="cell"><span class="v" title="Not measured on this build">—</span></div></td>`;
          return `<td class="${b === S ? "subj" : ""}${provOf(mid, b) === "reference" ? " is-ref" : ""}"><div class="cell">${deltaChip(mid, b)}<span class="v ${o.rank === 1 ? "r1" : ""}">${o.value == null ? "—" : f(o.value)}</span>${provBadge(mid, b)}</div></td>`; }).join("")}
        <td>${d.trend[mid] && d.trend[mid][S] ? `<span class="sc-spark">${CC.spark({ data: d.trend[mid][S], color: B(S).color, width: 74, height: 22 })}</span>` : "—"}</td>
      </tr>`);
    }
  }
  el("scTable").innerHTML = `<table class="sc"><thead><tr><th class="lft">Measure</th>${BIDS().map((b) =>
    `<th class="${b === S ? "subj" : ""}"><span class="dot" style="background:${B(b).color}"></span>${B(b).label}</th>`).join("")}<th>13-week trend</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    + (!d.meta.provenance || d.meta.provenance.mode === "hybrid" ? "" : d.meta.provenance.mode === "measured-only"
      ? `<p class="mini prov-legend"><i class="pv pv-measured">measured</i> read from a source on this build · — not measured (no source on this build), left blank</p>`
      : `<p class="mini prov-legend"><i class="pv pv-measured">measured</i> measured for this brand · <i class="pv pv-derived">derived</i> simulated, bounded by a measurement for this brand · <i class="pv pv-reference">ref</i> ${esc(d.meta.provenance.reference)}'s data shown under this name</p>`);

  // ── radar: each brand's position, normalised across the set
  const axes = [
    { id: "trafficShare", label: "Traffic" }, { id: "aiSov", label: "AI" }, { id: "shelfSov", label: "Shelf" },
    { id: "carriage", label: "Distr." }, { id: "inStock", label: "Stock" }, { id: "priceIndex", label: "Price" },
    { id: "rating", label: "Rating" }, { id: "pdpScore", label: "Page" },
  ];
  // A withheld measure returns null, not a middle value: half-way along the
  // axis is a position the brand has not been measured to hold.
  const norm = (mid, b) => { const vals = BIDS().map((x) => sc(mid, x).value).filter((v) => v != null);
    if (!vals.length) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals), v = sc(mid, b).value;
    return v == null ? null : hi === lo ? 0.5 : 0.12 + ((v - lo) / (hi - lo)) * 0.88; };
  const nn = (a) => a.filter((v) => v != null);
  const avg = axes.map((a) => { const v = nn(BIDS().map((x) => norm(a.id, x))); return v.length ? mean(v) : null; });
  el("scRadar").innerHTML = `<div style="display:grid;grid-template-columns:repeat(${d.dims.brands.length <= 4 ? 2 : 3},minmax(0,1fr));gap:18px 22px">${
    d.dims.brands.map((b) => `<div><div style="font-size:11px;font-weight:700;text-align:center;color:${b.color};margin-bottom:2px">${b.label}</div><div id="rd-${b.id}"></div></div>`).join("")}</div>
    <p class="mini" style="margin:8px 0 0">Grey outline is the category average on each axis, taken over the brands measured on it. Axes are scaled across the set, so the outer edge is the best in the category, not an absolute. A brand with no reading on an axis is drawn dashed, with a hollow marker outside the grid on the axis it is missing — never at the centre or half-way out, which are positions it has not been measured to hold.</p>`;
  for (const b of d.dims.brands) CC.radar(el("rd-" + b.id), { size: d.dims.brands.length <= 4 ? 178 : 152, legend: false, axes,
    series: [{ id: "avg", label: "Category average", color: "#bdc1c6", values: avg, raw: axes.map((a) => { const v = nn(BIDS().map((x) => sc(a.id, x).value)); return v.length ? mean(v) : null; }) },
             { id: b.id, label: b.label, color: b.color, subject: true, values: axes.map((a) => norm(a.id, b.id)), raw: axes.map((a) => sc(a.id, b.id).value) }] });

  // ── bump: weekly rank on AI share
  const wk = d.dims.weeks;
  const rankable = d.dims.metrics.filter((m) => !m.static && d.trend[m.id] && d.trend[m.id][S]);
  const ranksFor = (mid) => { const md = metricDef(mid);
    return wk.map((_, w) => { const ord = BIDS().map((b) => [b, d.trend[mid][b][w]]).filter((x) => x[1] != null)
        .sort((a, z) => md.good === "down" ? a[1] - z[1] : z[1] - a[1]);
      return Object.fromEntries(ord.map(([b], i) => [b, i + 1])); }); };
  const churn = (mid) => { const r = ranksFor(mid); let c = 0;
    for (let w = 1; w < r.length; w++) for (const b of BIDS()) if (r[w][b] !== r[w - 1][b]) c++;
    return c; };
  const scored = rankable.map((m) => ({ m, c: churn(m.id) })).sort((a, b) => b.c - a.c);
  let bumpMetric = (scored[0] || {}).m ? scored[0].m.id : "aiSov";
  el("scBumpPick").innerHTML = scored.slice(0, 5).map((x) => `<button data-m="${x.m.id}" title="${x.c} rank changes across the 13 weeks">${tc(x.m.label)}</button>`).join("");
  $$("#scBumpPick button").forEach((btn) => btn.onclick = () => { bumpMetric = btn.dataset.m; drawBump(); });
  drawBump();
  function drawBump() {
    $$("#scBumpPick button").forEach((b) => b.classList.toggle("on", b.dataset.m === bumpMetric));
    const ranks = ranksFor(bumpMetric), f = fmtFor(bumpMetric);
    CC.bump(el("scBump"), { height: 330, x: wk.map((w) => w.id),
      series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject,
        rank: ranks.map((r) => (r[b.id] == null ? null : r[b.id])), value: d.trend[bumpMetric][b.id] }))
        .filter((s) => s.rank.some((r) => r != null)),
      fmtX: (v, i) => wk[i] ? F.date(wk[i].start) : v, fmtV: f,
      fmtTip: (v) => { const w = wk.find((x) => x.id === v); return `Week of ${F.dateY(w.start)} · ${metricDef(bumpMetric).label}`; } });
    const changes = (scored.find((x) => x.m.id === bumpMetric) || {}).c || 0;
    el("scBump").insertAdjacentHTML("beforeend", `<p class="mini" style="margin:10px 0 0">${changes} rank change${changes === 1 ? "" : "s"} across the 13 weeks on this measure. Measures are offered most-volatile first — a flat chart means the order held all quarter, which is itself the finding.</p>`);
  }

  // ── mover bars
  const movers = d.dims.metrics.filter((m) => !m.static).map((m) => {
    const o = sc(m.id, S); if (o.deltaPct == null) return null;
    const helps = m.good === "neutral" ? null : (o.delta > 0) === (m.good === "up");
    return { label: m.label, value: o.deltaPct, color: helps === null ? "#5f6368" : helps ? "#1e8e3e" : "#d93025",
      note: `${fmtFor(m.id)(o.prev)} → ${fmtFor(m.id)(o.value)}`,
      tip: `<div class="h">${m.label}</div><div class="r"><span>${esc(period().prevLabel)}</span><b class="tnum">${fmtFor(m.id)(o.prev)}</b></div><div class="r"><span>${esc(period().curLabel)}</span><b class="tnum">${fmtFor(m.id)(o.value)}</b></div><div class="vb">${m.good === "neutral" ? "No better direction — read it against strategy." : helps ? "Moving the helpful way." : "Moving the unhelpful way."}</div>` };
  }).filter(Boolean).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  // A single -77% mover flattened every other bar to a sliver. Bar length runs
  // on the square root of the change so the small movers stay visible; the
  // number beside each bar is the true percentage, and the note says so.
  const mx = Math.sqrt(Math.max(...movers.map((m) => Math.abs(m.value))) || 1);
  const len = (v) => (Math.sqrt(Math.abs(v)) / mx) * 50;
  el("scMove").innerHTML = `<div class="cc-hb">${movers.map((m2, i) => `<div class="cc-hb-row div" data-i="${i}" style="grid-template-columns:minmax(96px,150px) minmax(0,1fr) auto">
    <span class="lb">${m2.label}<em>${m2.note}</em></span>
    <span class="tr" style="background:transparent;position:relative;height:13px">
      <span style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--line)"></span>
      <i style="position:absolute;top:1px;height:11px;border-radius:3px;background:${m2.color};${m2.value >= 0
        ? `left:50%;width:${len(m2.value)}%`
        : `right:50%;width:${len(m2.value)}%`}"></i></span>
    <b class="tnum vv" style="color:${m2.color}">${(m2.value > 0 ? "+" : "") + m2.value.toFixed(1)}%</b></div>`).join("")}</div>
    <p class="mini" style="margin:9px 0 0">Bars run either side of the centre line, scaled on the square root of the change so a single large mover does not flatten the rest — the figure beside each bar is the true percentage. Green is movement in the helpful direction for that measure; grey has no better direction.</p>`;
  $$("#scMove .div").forEach((n2, i) => { n2.addEventListener("mousemove", (e) => CC.showTip(movers[i].tip, e)); n2.addEventListener("mouseleave", CC.hideTip); });
};
function eventList() {
  return `<div class="cc-hb">${D().dims.events.map((e) => {
    const inside = e.end >= winDates()[0] && e.start <= winDates().at(-1);
    return `<div class="cc-hb-row" style="grid-template-columns:minmax(120px,1fr) auto auto;gap:12px;${inside ? "" : "opacity:.42"}">
      <span class="lb">${esc(e.label)}</span>
      <span class="tnum" style="font-size:11px;color:var(--soft)">${F.date(e.start)}–${F.date(e.end)}</span>
      <b class="tnum vv" style="color:${e.lift > 1.4 ? "var(--risk)" : "var(--soft)"}">×${e.lift.toFixed(2)}</b></div>`; }).join("")}
    <p class="mini" style="margin:10px 0 0">Multiplier is the demand lift applied to the traffic and shelf lanes for that window. Faded rows fall outside the selected cadence.</p></div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   WEBSITE TRAFFIC
   ══════════════════════════════════════════════════════════════════════════ */
P.traffic = (host) => {
  const d = D(), ds = winDates(), basis = d.traffic.basis || {};
  // The set splits in two: brands whose own domain is a fair proxy for the
  // product line, and brands where it is not. Nothing about the split is typed
  // here — it comes from the capture, and every chart below draws only the
  // brands that carry a reading.
  const measured = d.dims.brands.filter((b) => d.traffic.daily[b.id]);
  const withheld = d.dims.brands.filter((b) => !d.traffic.daily[b.id]);
  const mb = basis[S] || {};
  const chanFor = (b) => d.dims.channels.map((c) => ({ id: c.id, label: c.label, color: c.color, data: slice(d.traffic.channels[b][c.id]) }));
  const geo = Object.entries(d.traffic.geo[S] || {}).sort((a, z) => z[1] - a[1]);
  const geoRest = Math.round((100 - geo.reduce((s, g) => s + g[1], 0)) * 10) / 10;
  const dur = (v) => v == null ? "—" : `${Math.floor(v / 60)}m ${String(Math.round(v % 60)).padStart(2, "0")}s`;
  const missingNote = withheld.length
    ? ` ${withheld.map((b) => b.label).join(" and ")} ${withheld.length === 1 ? "is" : "are"} not drawn — see the provenance table below.` : "";
  host.innerHTML = `
  ${intro(`Sessions on each brand's own site, and the retail product pages that carry its models.
    The <b>level</b> of this lane is measured, from the published traffic profile of
    ${measured.length} of the ${d.dims.brands.length} brands${mb.visitsMonthly ? `, ${F.k(mb.visitsMonthly)} monthly visits to <b>${esc(mb.domain)}</b> with ${F.pct(mb.usShare)} of them in the US` : ""}.
    The <b>day-to-day shape is modelled</b> — the public profile publishes a month, not a series — so read the
    movement against the commercial calendar, and the levels as measured.`,
    `<div class="card tint" style="min-width:266px"><div class="card-h"><div class="ct"><h3>What is measured here</h3>
      <p>${measured.length} of ${d.dims.brands.length} domains carry a published profile.</p></div></div>
      <div style="font-family:var(--fm);font-size:11.5px;line-height:1.95;color:var(--soft)">
        <div><b style="color:var(--good)">Measured</b> · visits · US share · bounce · pages per visit · duration · country mix</div>
        <div><b style="color:var(--warn)">Modelled</b> · daily shape · channel split · add-to-cart</div>
        ${withheld.length ? `<div><b style="color:var(--risk)">Withheld</b> · ${withheld.map((b) => esc(b.label)).join(" · ")}</div>` : ""}
      </div>
      <a href="#method" style="font-size:12px;font-weight:700;color:var(--accent);margin-top:9px;display:inline-block">See the anchor ledger →</a></div>`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("trafficShare", S, `Across the ${measured.length} brand${measured.length === 1 ? "" : "s"} with a published profile`)}
    ${metricKpi("sessions", S, "Modelled daily shape on the measured monthly level")}
    ${kpi({ label: "Assistant referrals", dot: "#1a73e8", value: F.k(sum(slice(d.traffic.channels[S].aiRef))),
      delta: `<span class="delta up">↑ ${(((mean(d.traffic.channels[S].aiRef.slice(-14)) / mean(d.traffic.channels[S].aiRef.slice(0, 14))) - 1) * 100).toFixed(0)}%</span>`,
      note: "Sessions arriving from an AI assistant — the fastest-growing source in the mix" })}
    ${kpi({ label: "Add-to-cart rate", dot: B(S).color, value: F.pct(mean(slice(d.traffic.engage[S].addToCart))),
      note: `Bounce ${F.pct(mean(slice(d.traffic.engage[S].bounce)))} · ${mean(slice(d.traffic.engage[S].pagesPerVisit)).toFixed(1)} pages · ${dur(mean(slice(d.traffic.engage[S].duration)))} — those three are measured, add-to-cart is modelled` })}
  </div>
  ${card({ title: "Daily sessions by brand", help: "Visits to each brand's own website, by day. The level is the monthly figure published for that domain; the day-to-day movement is modelled against the retail calendar. A brand whose own domain cannot stand for its product line is not drawn at all rather than drawn on a number that describes a different business.", sub: `Bands mark the retail-calendar events. Prime Day is the single largest movement in the quarter for every brand drawn.${missingNote}`, tag: "13 weeks", slot: "trLine" })}
  <div class="grid g23" style="margin-top:14px">
    ${card({ title: `${SUBJ} channel mix`, help: "Where the sessions come from, as a share of each day. Only the leading channel's share is published, so the rest of the split is modelled on top of it. Assistant referral is sessions arriving from an AI assistant rather than from a search engine.", sub: `Share of sessions by source, daily.${mb.leadChannel ? ` ${esc(mb.leadChannel)} leads at ${F.pct(mb.leadChannelPct)} — that much is published; the rest of the split sits behind a subscription and is modelled on top of it.` : " Modelled — the published profile does not break the split out."} Paid search steps up on event weeks; assistant referral climbs all quarter.`, slot: "trStack" })}
    ${card({ title: "Channel mix compared", help: "A marimekko: column width is each brand's share of the measured session pool, column height its channel composition. It puts size and mix in one picture — wide-and-paid is a different business from narrow-and-direct.", sub: "Column width is each brand's share of the measured session pool; height is its channel composition. Wide-and-paid is a different business from narrow-and-direct.", slot: "trMekko" })}
  </div>
  <div class="grid g3" style="margin-top:14px">
    ${card({ title: `Where ${esc(mb.domain || SUBJ)} visits come from`, help: "The country split of visits to the brand's own domain, exactly as the public traffic profile publishes it. Measured, not modelled. Only the countries the profile lists appear; the remainder is not broken out rather than guessed at.", sub: `Country share of worldwide visits to ${esc(mb.domain || "the brand site")}, as published — measured, not modelled.${geoRest > 0.05 ? ` The countries above are what the profile lists; the remaining ${F.pct(geoRest)} is spread across the rest of the world and is not broken out.` : ""}`, slot: "trGeo" })}
    ${card({ title: "Engagement quality", help: "Bounce rate against add-to-cart rate, sized by session volume. Bounce is measured; add-to-cart is published nowhere and is modelled. The top-left quadrant is warm traffic that converts — people arrive, stay, and put something in a basket.", sub: "Add-to-cart rate against bounce. Bubble size is session volume — the top-left quadrant converts warm traffic. Bounce is measured; add-to-cart is modelled.", slot: "trScatter" })}
    ${card({ title: "Retail PDP traffic", help: "Sessions landing on the brand's product pages at each retailer, modelled from search-grid presence, the retailer's weight and how sharp the price is. A carried listing draws traffic even with no search presence, so this does not fall to zero while the listing is live.", sub: `Sessions landing on ${SUBJ} product pages at each retailer, modelled from shelf presence, retailer weight and how sharp the price is. Click a bar for the model split.`, slot: "trPdp" })}
  </div>
  <div style="margin-top:14px">${card({ title: "Where these numbers come from", help: "The provenance row for the traffic lane: which domain was read for each brand, what the public profile published for it, and what had to be modelled on top. A brand whose own domain is not a fair proxy for the product line is withheld here rather than modelled.", tag: "provenance",
    sub: "One row per brand: the domain read, what its published traffic profile shows, and what had to be modelled on top. A brand whose own domain is not a fair proxy for the product line is withheld outright rather than modelled.",
    html: `<div id="trBasis"></div>` })}</div>
  <h2 class="sec">What the traffic says</h2>${readsBlock("traffic")}`;

  CC.line(el("trLine"), { height: 260, x: ds, series: brandSeries((b) => d.traffic.daily[b]), bands: winBands(), fmtV: F.k, fmtY: F.k, area: false });
  CC.stack(el("trStack"), { height: 240, x: ds, series: chanFor(S), normalize: true, fmtY: (v) => v + "%" });
  CC.mekko(el("trMekko"), { height: 250, fmtW: (v) => F.pct(v),
    cols: measured.map((b) => ({ label: b.label, weight: sum(slice(d.traffic.daily[b.id])),
      parts: d.dims.channels.map((c) => ({ id: c.id, label: c.label, color: c.color, value: sum(slice(d.traffic.channels[b.id][c.id])) })) })) });
  CC.hbars(el("trGeo"), { rows: geo.map((g) => ({ label: g[0], value: g[1], color: B(S).color,
      tip: `<div class="h">${esc(g[0])}</div><div class="r"><span>Share of ${esc(mb.domain || "brand-site")} visits</span><b class="tnum">${F.pct(g[1])}</b></div><div class="r sub"><span>Basis</span><b>Published profile</b></div>` })),
    fmtV: (v) => F.pct(v) });
  // One decimal on the add-to-cart axis: at a two-point spread, whole numbers
  // print the same tick twice.
  CC.scatter(el("trScatter"), { height: 240, xZero: false, yZero: false, xLabel: "Bounce rate", yLabel: "Add-to-cart",
    fmtX: (v) => F.pct(v, 0), fmtY: (v) => F.pct(v, 1),
    points: measured.map((b) => ({ label: b.label, tag: b.label.split(" ")[0], color: b.color,
      x: mean(slice(d.traffic.engage[b.id].bounce)), y: mean(slice(d.traffic.engage[b.id].addToCart)), r: sum(slice(d.traffic.daily[b.id])),
      tip: `<div class="h">${b.label}</div><div class="r"><span>Bounce</span><b class="tnum">${F.pct(mean(slice(d.traffic.engage[b.id].bounce)))}</b></div><div class="r"><span>Add-to-cart</span><b class="tnum">${F.pct(mean(slice(d.traffic.engage[b.id].addToCart)))}</b></div><div class="r"><span>Sessions</span><b class="tnum">${F.k(sum(slice(d.traffic.daily[b.id])))}</b></div>` })) });
  const pdpRows = retailerScope().map((rt) => {
    const ks = pairsFor(S, [rt]);
    return { label: RT(rt).label, value: sum(ks.flatMap((k) => slice(d.traffic.pdp[k]))), color: RT(rt).color, _rt: rt,
      note: `${ks.length} ${SUBJ} listing${ks.length === 1 ? "" : "s"}` };
  }).sort((a, b) => b.value - a.value);
  CC.hbars(el("trPdp"), { rows: pdpRows, fmtV: F.k, onPick: (r) => {
    const ks = pairsFor(S, [r._rt]);
    openDrawer(`${r.label} · ${SUBJ} product-page traffic`, `${F.dateY(ds[0])} – ${F.dateY(ds.at(-1))}`,
      table([{ label: "Model", lft: true, get: (x) => `<span class="dot" style="background:${B(S).color}"></span>${MD(x.mid).label}` },
             { label: "Sessions", get: (x) => `<b class="tnum">${F.k(x.v)}</b>` },
             { label: "Share", get: (x) => F.pct(x.v / (sum(ks.flatMap((k) => slice(d.traffic.pdp[k]))) || 1) * 100) }],
        ks.map((k) => ({ mid: k.split("|")[0], v: sum(slice(d.traffic.pdp[k])) })).sort((a, b) => b.v - a.v)));
  } });

  // ── provenance: the row a CCO reads before quoting anything on this page
  const bRows = d.dims.brands.map((b) => ({ b, v: basis[b.id] || {}, _subject: b.id === S }));
  el("trBasis").innerHTML = table([
    { label: "Brand", lft: true, get: (x) => `<span class="dot" style="background:${B(x.b.id).color}"></span>${x.b.label}` },
    { label: "Domain read", lft: true, get: (x) => x.v.domain ? `<span class="mono">${esc(x.v.domain)}</span>` : "—" },
    { label: "Monthly visits", get: (x) => x.v.visitsMonthly == null ? "—" : `<b class="tnum">${F.k(x.v.visitsMonthly)}</b>` },
    { label: "US share", get: (x) => x.v.usShare == null ? "—" : F.pct(x.v.usShare) },
    { label: "Bounce", get: (x) => x.v.bounce == null ? "—" : F.pct(x.v.bounce) },
    { label: "Pages / visit", get: (x) => x.v.pages == null ? "—" : x.v.pages.toFixed(2) },
    { label: "Avg. visit", get: (x) => dur(x.v.duration) },
    { label: "Basis", get: (x) => x.v.state !== "measured" ? (x.v.state === "withheld" ? `<span class="tag risk">withheld</span>` : `<span class="tag warn">modelled</span>`)
        : x.v.proxyQuality === "multiLine" ? `<span class="tag warn">whole domain</span>` : `<span class="tag good">measured</span>` },
  ], bRows)
    + `<p class="mini" style="margin:10px 0 0">Read from each domain's public traffic profile${d.traffic.capturedOn ? ` on ${F.dateY(d.traffic.capturedOn)}` : ""}. Bounce, pages per visit and average visit are the published figures; the daily series jitters around them. Add-to-cart is published nowhere and is modelled throughout.${d.dims.brands.some((b) => (basis[b.id] || {}).proxyQuality === "multiLine") ? " <b>Whole domain</b> means the figure is real but covers more than this category." : ""}${
      d.dims.brands.filter((b) => (basis[b.id] || {}).why).map((b) => ` <b>${esc(b.label)}</b> — ${esc(basis[b.id].why)}`).join("")}</p>`;
};

/* ══════════════════════════════════════════════════════════════════════════
   AI VISIBILITY
   ══════════════════════════════════════════════════════════════════════════ */
P.ai = (host) => {
  const d = D(), ds = winDates();
  const engStage = (e, st, b) => d.ai.byEngineStage[`${e}|${st}|${b}`];
  const meanES = (e, st, b) => mean(slice(engStage(e, st, b)));
  host.innerHTML = `
  ${intro(`Share of the answer when a shopper asks an assistant rather than a search box — measured across
    ${d.dims.engines.length} engine${d.dims.engines.length === 1 ? "" : "s"} and ${d.dims.stages.length} funnel stages on a ${d.ai.prompts.length}-prompt set.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("aiSov", S)}
    ${kpi({ label: `Answers containing ${SUBJ}`, dot: B(S).color, value: F.pct(d.ai.prompts.filter((p) => p.present[S]).length / d.ai.prompts.length * 100, 0),
      note: `${d.ai.prompts.filter((p) => p.present[S]).length} of the ${d.ai.prompts.length} tracked prompts` })}
    ${kpi({ label: `Prompts led by ${SUBJ}`, dot: B(S).color, value: String(d.ai.prompts.filter((p) => p.topBrand === S).length),
      note: `Named first in the answer, ahead of every other brand in the set` })}
    ${kpi({ label: "Engine spread", dot: "#1a73e8", value: (() => { const v = d.dims.engines.map((e) => mean(d.dims.stages.map((st) => meanES(e.id, st.id, S)))); return F.pct(Math.max(...v) - Math.min(...v)); })(),
      note: "Points between the strongest and weakest engine on the same prompt set" })}
  </div>
  ${card({ title: "Share of the AI answer, daily", help: "Of the answers an AI assistant gives to this category's shopping questions, the share that mentions each brand. It is not a ranking of the brand — it is whether the brand is in the room at all when the assistant answers.", sub: (d.meta.provenance || {}).mode === "hybrid" ? `One real reading per build: the line steps on each date the engines were read and is blank before the first. Brands outside the tracked ${AI_BIDS().length} count in the total, so the shares do not sum to 100.` : `Answer share sums to 100 across the ${d.dims.brands.length} brands, so a gain for one is a loss for another. Steps rather than drift — assistants re-index, they do not glide.`, slot: "aiLine", tag: "13 weeks" })}
  <div style="margin-top:14px">
    ${card({ title: "The prompt set", help: "The actual questions put to the assistants, with the funnel stage each belongs to. A share of answer means nothing without the questions it was measured over, so they are listed rather than summarised.", sub: `Every tracked question, whether ${SUBJ} appeared, and where in the answer. Click a row for the full brand ordering. A prompt is one draw, not an average — a brand with a high answer share is still absent from some of them.`, slot: "aiPrompts" })}
  </div>
  <h2 class="sec">What the answer share says</h2>${readsBlock("ai")}`;

  const aiReadings = (d.ai.history || []).length;
  if (aiReadings === 1) {
    const latest = (s) => { for (let i = (s || []).length - 1; i >= 0; i--) if (s[i] != null) return s[i]; return null; };
    const rows = d.dims.brands.map((b) => ({ label: b.label, color: b.color, subject: b.subject, value: latest(d.ai.overall[b.id]) })).filter((r) => r.value != null).sort((a, z) => z.value - a.value);
    el("aiLine").insertAdjacentHTML("beforebegin", `<p class="mini" style="margin:0 0 12px">One reading so far, taken ${F.dateY(d.ai.history[0].date)}. The daily line starts once a second build reads the engines again.</p>`);
    CC.hbars(el("aiLine"), { rows, max: Math.max(...rows.map((r) => r.value), 1), fmtV: (v) => F.pct(v) });
  } else {
    CC.line(el("aiLine"), { height: 250, x: ds, series: brandSeries((b) => d.ai.overall[b]), bands: winBands(), fmtV: (v) => F.pct(v), fmtY: (v) => v + "%" });
  }
  const consoleAnswers = (() => {
    const c = d.aiConsole, cap = c && c.captures && c.captures[c.current];
    if (!cap || !Array.isArray(cap.answers)) return new Map();
    const label = new Map((cap.engines || c.engines || []).map((e) => [e.id, e.label]));
    const text = new Map((c.bank || []).map((q) => [q.id, q.text]));
    return new Map(cap.answers.filter((a) => a.run === 1).map((a) => [`${label.get(a.engine) || a.engine}: ${text.get(a.queryId) || ""}`, a]));
  })();
  const consoleBrandName = new Map(((d.aiConsole && d.aiConsole.brands) || []).map((b) => [b.id, b.label]));
  const prettyBrand = (id) => consoleBrandName.get(id) || (d.dims.brands.find((b) => b.id === id) || {}).label || String(id).split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const ranked = (a) => [...(a.brands || [])].sort((x, z) => (x.rank || 99) - (z.rank || 99));
  for (const p of d.ai.prompts || []) {
    const a = consoleAnswers.get(p.q);
    if (!Array.isArray(p.named) && a) p.named = ranked(a).map((b) => prettyBrand(b.id));
  }
  const hasNamed = (d.ai.prompts || []).some((p) => Array.isArray(p.named));
  const trackedByName = new Map(d.dims.brands.map((b) => [b.label.toLowerCase(), b]));
  const brandName = (name) => { const b = trackedByName.get(String(name).toLowerCase()); return b ? `<span class="dot" style="background:${b.color}"></span>${esc(b.label)}` : `<span style="color:var(--mute)">${esc(name)}</span>`; };
  const namedList = (names) => !names || !names.length ? `<span class="mini">no brand named</span>`
    : `<span style="white-space:normal;display:inline-block;max-width:380px;line-height:1.7">${names.slice(0, 6).map((n, i) => `${i ? '<span style="color:var(--line)"> · </span>' : ""}${brandName(n)}`).join("")}${names.length > 6 ? ` <span class="mini">+${names.length - 6}</span>` : ""}</span>`;
  const SENT = { positive: "good", negative: "risk", mixed: "warn", neutral: "" };
  const brandCell = (id) => { const t = d.dims.brands.find((b) => b.id === id); return t ? `<span class="dot" style="background:${t.color}"></span><b style="font-weight:500">${esc(t.label)}</b>` : `<span style="color:var(--soft)">${esc(prettyBrand(id))}</span>`; };
  const stat2 = (k, v) => `<div style="flex:1;min-width:120px;padding:12px 14px;border:1px solid var(--line);border-radius:12px"><div class="mini">${k}</div><div style="font-family:var(--fd);font-size:18px;margin-top:4px">${v}</div></div>`;
  const isTracked = (id) => AI_BIDS().includes(id);
  const sheetCols = [
    { label: "#", get: (r) => r.rank ? `<span class="tnum">${r.rank}</span>` : "—" },
    { label: "Brand", lft: true, get: (r) => brandCell(r.id) },
    { label: "Product mentioned", lft: true, get: (r) => r.product ? esc(r.product) : '<span class="mini">—</span>' },
    { label: "Tone", get: (r) => r.sentiment ? `<span class="tag ${SENT[r.sentiment] || ""}">${esc(r.sentiment)}</span>` : "—" },
    { label: "Recommended", get: (r) => r.rank ? (r.recommended ? "✓" : "—") : '<span class="mini">not named</span>' },
  ];
  const setRows = (list) => [...list.filter((b) => isTracked(b.id)), ...AI_BIDS().filter((id) => !list.some((b) => b.id === id)).map((id) => ({ id, rank: null }))].map((b) => ({ ...b, _subject: b.id === S }));
  const others = (list) => list.filter((b) => !isTracked(b.id));
  const answerSheet = (p2, ans) => {
    const list = ranked(ans);
    const subj = list.find((b) => b.id === S);
    const sources = ans.sources || [];
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
        ${stat2(SUBJ, subj ? `#${subj.rank}${subj.recommended ? ' <span class="tag good">recommended</span>' : ""}` : '<span class="mini" style="font-size:15px">not named</span>')}
        ${stat2("Top pick", ans.topPick ? brandCell(ans.topPick) : "—")}
        ${stat2("Brands named", String(list.length))}
        ${stat2("Sources cited", String(sources.length))}
      </div>
      <h4 style="font-size:13px;font-weight:500;margin:0 0 8px">Your competitor set</h4>
      ${table(sheetCols, setRows(list))}
      ${others(list).length ? `<h4 style="font-size:13px;font-weight:500;margin:22px 0 8px">Other brands named <span class="mini">· ${others(list).length} outside your set</span></h4>${table(sheetCols, others(list))}` : ""}
      ${sources.length ? `<h4 style="font-size:13px;font-weight:500;margin:22px 0 8px">Sources the engine cited</h4>
        <div style="display:flex;flex-direction:column;gap:6px">${sources.slice(0, 10).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:var(--accent);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.title || x.host || x.url)} <span class="mini">· ${esc(x.host || "")}</span></a>`).join("")}</div>` : ""}
      <h4 style="font-size:13px;font-weight:500;margin:22px 0 8px">The answer, as captured</h4>
      <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:var(--soft);background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;max-height:420px;overflow:auto">${esc(ans.text || "")}</div>`;
  };
  const trackedNames = (names) => (names || []).filter((n) => { const b = trackedByName.get(String(n).toLowerCase()); return b && AI_BIDS().includes(b.id); });
  const renderPrompts = () => {
    const all = !!window.__ccOtherBrands;
    const shown = (r) => all ? r.named : trackedNames(r.named);
    const switcher = hasNamed ? `<div style="display:flex;align-items:center;gap:10px;margin:0 0 12px"><span class="mini">Brands named</span><div class="seg mini"><button type="button" data-ob="0" class="${all ? "" : "on"}">Your competitor set</button><button type="button" data-ob="1" class="${all ? "on" : ""}">All brands</button></div></div>` : "";
    el("aiPrompts").innerHTML = switcher + table([
      { label: "Prompt", lft: true, get: (r) => `<span class="tag" style="margin-right:8px">${esc((d.dims.stages.find((st) => st.id === r.stage) || { label: r.stage }).label)}</span>${esc(r.q)}` },
      { label: SUBJ, get: (r) => r.present[S] ? `<b class="tnum" style="color:var(--good)">#${r.rank[S]}</b>` : `<span class="mini">absent</span>` },
      { label: "Cited", get: (r) => r.cited[S] ? "✓" : "—" },
      ...(hasNamed ? [{ label: "Brands named", lft: true, get: (r) => { const n = shown(r); const extra = all ? 0 : (r.named || []).length - n.length; return n.length ? namedList(n) + (extra > 0 ? ` <span class="mini">+${extra} other</span>` : "") : `<span class="mini">${extra > 0 ? `none from your set · ${extra} other` : "no brand named"}</span>`; } }] : []),
      { label: "Answer led by", get: (r) => { const n = hasNamed ? shown(r) : []; return hasNamed ? (n.length ? brandName(n[0]) : "—") : r.topBrand ? `<span class="dot" style="background:${B(r.topBrand).color}"></span>${B(r.topBrand).label}` : "—"; } },
    ], d.ai.prompts, { maxH: "460px" });
    $$("#aiPrompts [data-ob]").forEach((btn) => { btn.onclick = () => { window.__ccOtherBrands = btn.dataset.ob === "1"; renderPrompts(); }; });
    $$("#aiPrompts tbody tr").forEach((tr, i) => { tr.style.cursor = "pointer"; tr.onclick = () => {
      const p2 = d.ai.prompts[i];
      const ans = consoleAnswers.get(p2.q);
      const stageLabel = (d.dims.stages.find((st) => st.id === p2.stage) || { label: p2.stage }).label;
      if (!ans) {
        openDrawer(esc(p2.q), `${stageLabel} · brand ordering in the answer`,
          table([{ label: "Brand", lft: true, get: (r) => `<span class="dot" style="background:${B(r.b).color}"></span>${B(r.b).label}` },
                 { label: "Position", get: (r) => r.rank ? `#${r.rank}` : "not named" },
                 { label: "Cited", get: (r) => r.cited ? "✓" : "—" }],
            AI_BIDS().map((b) => ({ b, rank: p2.rank[b], cited: p2.cited[b], _subject: b === S })).sort((a, z) => (a.rank || 99) - (z.rank || 99))));
        return;
      }
      openDrawer(esc(p2.q), `${stageLabel} · the full answer, brand by brand`, answerSheet(p2, ans));
    }; });
  };
  renderPrompts();
};

/* ══════════════════════════════════════════════════════════════════════════
   VOICE OF CUSTOMER
   ══════════════════════════════════════════════════════════════════════════ */
P.voice = (host) => {
  const d = D(), ds = winDates();
  const AM = d.dims.aspectMonths, last = AM.length - 1;
  const asp = (b, a) => (d.voice.aspects[b] || {})[a] || null;
  function topAspect(b, dir) {
    const rows = d.dims.aspects.map((a) => ({ k: a, v: (asp(b, a) || [])[last] })).filter((r) => r.v != null);
    if (!rows.length) return null;
    rows.sort((x, y) => dir > 0 ? y.v - x.v : x.v - y.v);
    return rows[0];
  }
  const withheld = d.dims.brands.filter((b) => !d.voice.aspects[b.id]);
  const anyAspect = withheld.length < d.dims.brands.length;
  const velOf = (b) => (d.voice.velocity[b] ? sum(slice(d.voice.velocity[b])) : null);
  host.innerHTML = `
  ${intro(`Rating, review velocity and the aspect scores behind them. Aspect scores run over the months the
    captured reviews actually span rather than the thirteen weeks of the panel, and a brand without scorable
    reviews is withheld rather than filled in.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("rating", S)}
    ${kpi({ label: "Reviews in window", dot: B(S).color, value: velOf(S) == null ? "—" : F.k(velOf(S)),
      note: (() => { const lead = BIDS().map((b) => ({ b, v: velOf(b) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v)[0];
        return !lead ? "Not measured" : lead.b === S ? "The most new reviews in the set" : `Against ${F.k(lead.v)} for ${B(lead.b).label}`; })() })}
    ${!anyAspect ? "" : `${kpi({ label: "Strongest aspect", dot: "#1e8e3e", value: (() => { const a = topAspect(S, 1); return a ? String(a.v) : "—"; })(),
      note: (() => { const a = topAspect(S, 1); return a ? `${a.k} · ${AM[last]}` : "No aspect scored"; })() })}
    ${kpi({ label: "Weakest aspect", dot: "#d93025", value: (() => { const a = topAspect(S, -1); return a ? String(a.v) : "—"; })(),
      note: (() => { const a = topAspect(S, -1); return a ? `${a.k} · ${AM[last]}` : "No aspect scored"; })() })}`}
  </div>
  ${!anyAspect ? `<div class="grid g2">
    ${card({ title: "Rating through the quarter", help: "Keepa's daily Amazon star rating, averaged across each brand's tracked listings.", sub: "Daily Amazon star rating across each brand's tracked listings.", slot: "vcLine" })}
    ${card({ title: "Review velocity", help: "New Amazon reviews per day, from the daily change in Keepa's review count. One-day jumps where Amazon regroups variant listings are not counted.", sub: "New Amazon reviews per day.", slot: "vcVel" })}
  </div>` : `<div class="grid g2">
    ${card({ title: "Aspect scores by brand", help: "What reviewers praise and complain about, scored per aspect from the captured review text. A row is withheld where a brand's reviews carried too few mentions of that aspect to score — an unscored aspect is silence, not a bad score.", sub: `Latest captured month (${AM[last]}). Where a brand's reviews carried too few aspect mentions to score, the row is withheld rather than filled${withheld.length ? ` — which is why ${withheld.map((b) => b.label).join(" and ")} ${withheld.length === 1 ? "is" : "are"} hatched right across` : ""}.`, slot: "vcHeat" })}
    ${card({ title: "Rating through the quarter", help: "The star rating, weighted by rating count rather than by review. The level is captured; the drift across the window is modelled from review velocity.", sub: "Daily weighted star rating across each brand's tracked listings.", slot: "vcLine" })}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: `${SUBJ} aspects, ${AM[0]} to ${AM[last]}`, help: "The subject's aspect scores month by month, so a complaint that is growing reads as growth rather than as a level. Months that had a real reading are passed through untouched.", sub: "Monthly score per aspect over the twelve months the captured reviews span. Months with a real reading are passed through; the rest are modelled around them.", slot: "vcTrend" })}
    ${card({ title: "Review velocity", help: "New reviews arriving per day. It is a demand proxy rather than a sentiment one: rating says how people feel, velocity says how many are arriving to feel it.", sub: "Reviews arriving per day. Volume is what makes a rating hard to move — in either direction.", slot: "vcVel" })}
  </div>`}
  <h2 class="sec">What the reviews say</h2>${readsBlock("voice")}`;

  if (anyAspect) CC.heatmap(el("vcHeat"), { rows: d.dims.brands, cols: d.dims.aspects.map((a) => ({ id: a, label: a })), corner: "Brand ╲ Aspect",
    rowLabel: (r) => r.label, rowDot: (r) => r.color, colLabel: (c) => c.label,
    value: (r, c) => (asp(r.id, c.id) || [])[last] ?? null, fmtV: (v) => Math.round(v),
    scaleNote: `Aspect score, ${AM[last]} — hatched means not scorable from the captured reviews`,
    tip: (r, c, v) => `<div class="h">${r.label} · ${c.label}</div><div class="r"><span>${AM[last]}</span><b class="tnum">${Math.round(v)}</b></div>` });
  CC.line(el("vcLine"), { height: 220, x: ds, series: brandSeries((b) => d.voice.rating[b]), zero: false, fmtV: (v) => F.star(v), fmtY: (v) => v.toFixed(1) });
  if (anyAspect) CC.line(el("vcTrend"), { height: 250, x: AM, xTicks: 6, fmtX: (m) => m, fmtTip: (m) => m, fmtV: (v) => Math.round(v),
    series: d.dims.aspects.map((a, i) => ({ id: a, label: a, color: ["#1a73e8", "#ea4335", "#fbbc04", "#34a853", "#9334e6", "#12b5cb", "#e8710a", "#80868b"][i],
      data: asp(S, a) })).filter((x) => x.data) });
  CC.line(el("vcVel"), { height: 250, x: ds, area: true, series: brandSeries((b) => d.voice.velocity[b]), fmtV: F.n, fmtY: F.k });
};

/* ══════════════════════════════════════════════════════════════════════════
   RETAIL SHELF
   ══════════════════════════════════════════════════════════════════════════ */
P.shelf = (host) => {
  const d = D(), ds = winDates(), rts = retailerScope();
  const sov = (rt, t, b) => d.shelf.sov[`${rt}|${t}|${b}`];
  const sovMean = (rt, t, b) => { const a = sov(rt, t, b); return a ? mean(slice(a)) : null; };
  // A retailer whose grid the capture could not read is withheld everywhere on
  // this page, never averaged in as a zero.
  const withheld = d.dims.shelfWithheld || [];
  const isWithheld = (rt) => withheld.some((w) => w.retailer === rt);
  const readable = rts.filter((rt) => !isWithheld(rt));
  const brandShelf = (b) => ds.map((_, i) => mean(readable.flatMap((rt) => d.dims.terms.map((t) => { const a = sov(rt, t.id, b); return a ? a[win()[0] + i] : null; })).filter((v) => v != null)));
  host.innerHTML = `
  ${intro(`Share of the result grid a shopper sees when they search a retailer — ${rts.length} retailer${rts.length === 1 ? "" : "s"}
    × ${d.dims.terms.length} terms, read daily.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("shelfSov", S)}
    ${kpi({ label: "Best shelf", dot: B(S).color, value: (() => { const r = shelfByRetailer().sort((a, b) => b.v - a.v)[0]; return r ? F.pct(r.v) : "—"; })(),
      note: (() => { const r = shelfByRetailer().sort((a, b) => b.v - a.v)[0]; return r ? RT(r.rt).label : ""; })() })}
    ${kpi({ label: "Thinnest shelf", dot: "#d93025", value: (() => { const r = shelfByRetailer().sort((a, b) => a.v - b.v)[0]; return r ? F.pct(r.v) : "—"; })(),
      note: (() => { const r = shelfByRetailer().sort((a, b) => a.v - b.v)[0]; return r ? RT(r.rt).label : ""; })() })}
    ${kpi({ label: "Presence that is paid", dot: "#f9ab00", value: F.pct(mean(readable.flatMap((rt) => d.dims.terms.map((t) => mean(slice(d.shelf.sponsored[`${rt}|${t.id}|${S}`] || [])))).filter((v) => v != null))),
      note: `Share of ${SUBJ} grid presence carried by a sponsored placement` })}
  </div>
  ${card({ title: "Shelf share, daily", help: "Of the listings a retailer returns for a category search, the share belonging to each brand. This is share of the shelf a shopper actually sees, not share of the catalogue.", sub: `Mean across ${rts.length === 1 ? RT(rts[0]).label : `all ${d.dims.retailers.length} retailers`} and every tracked term. The bands are the retail calendar — watch what happens to ${SUBJ} share inside them.`, slot: "shLine", tag: "13 weeks" })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: `Retailer × term, ${SUBJ} share`, help: "The same measure split by retailer and by search term. A brand can hold a retailer on one term and be invisible on the next, and the term mix is the part a merchandiser can act on.", sub: `Where the brand is found and where it is not. Click a cell for the brand ordering on that grid.${withheld.length ? ` ${withheld.map((w) => RT(w.retailer).label).join(" and ")} ${withheld.length === 1 ? "is" : "are"} hatched right across: the capture could not read a comparable result grid there, and a shelf nobody could read is withheld rather than shown as zero.` : ""}`, slot: "shHeat" })}
    ${card({ title: "Organic against paid", help: "How much of the brand's grid presence is bought. Sponsored placements are separated from organic results, so a share that only holds while the media is running is visible as exactly that.", sub: "Each brand's grid share plotted against how much of it is sponsored. Bottom-right is bought presence; top-left is earned.", slot: "shScatter" })}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Grid share by retailer", help: "Mean share of the result grid per retailer across the term set. A retailer whose logged-out grid is not a comparable result set is withheld and hatched rather than reported as a zero.", sub: "Every brand, every retailer, meaned across terms.", slot: "shBars" })}
    ${card({ title: "Who fills the grid", help: "How the whole grid divides — the brands that make up a retailer's category page, with the subject in place among them. It sizes the field that shelf share is a share of.", sub: "Each retailer's result grid as 100%: your tracked brands, and everything else the search returns in grey.", slot: "shSun" })}
  </div>
  <h2 class="sec">What the shelf says</h2>${readsBlock("shelf")}`;

  CC.line(el("shLine"), { height: 250, x: ds, bands: winBands(), fmtV: (v) => F.pct(v), fmtY: (v) => v + "%",
    series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: brandShelf(b.id) })) });
  CC.heatmap(el("shHeat"), { rows: d.dims.retailers.filter((r) => rts.includes(r.id)), cols: d.dims.terms, corner: "Retailer ╲ Term",
    rowLabel: (r) => r.label, rowDot: (r) => r.color, colLabel: (c) => c.label,
    value: (r, c) => sovMean(r.id, c.id, S), fmtV: (v) => F.pct(v, v < 10 ? 1 : 0), scaleNote: `${SUBJ} share of the grid`,
    tip: (r, c) => `<div class="h">${r.label} · “${c.label}”</div>` + BIDS().map((b) =>
      `<div class="r"><i style="background:${B(b).color}"></i><span>${B(b).label}</span><b class="tnum">${F.pct(sovMean(r.id, c.id, b))}</b></div>`).join(""),
    onPick: (r, c) => openDrawer(`${r.label} · “${c.label}”`, "Grid share and best organic rank, selected window",
      table([{ label: "Brand", lft: true, get: (x) => `<span class="dot" style="background:${B(x.b).color}"></span>${B(x.b).label}` },
             { label: "Grid share", get: (x) => `<b class="tnum">${F.pct(x.v)}</b>` },
             { label: "Best rank", get: (x) => x.rk ? `#${Math.round(x.rk)}` : "—" },
             { label: "Sponsored", get: (x) => F.pct(x.sp) }],
        BIDS().map((b) => ({ b, v: sovMean(r.id, c.id, b), rk: mean(slice(d.shelf.rank[`${r.id}|${c.id}|${b}`])), sp: mean(slice(d.shelf.sponsored[`${r.id}|${c.id}|${b}`])), _subject: b === S })).sort((a, z) => z.v - a.v))) });
  CC.scatter(el("shScatter"), { height: 250, xLabel: "Share of presence that is sponsored", yLabel: "Share of the grid",
    fmtX: (v) => F.pct(v, 0), fmtY: (v) => F.pct(v, 0), sized: false,
    points: d.dims.brands.map((b) => ({ label: b.label, tag: b.label.split(" ")[0], color: b.color,
      x: mean(readable.flatMap((rt) => d.dims.terms.map((t) => mean(slice(d.shelf.sponsored[`${rt}|${t.id}|${b.id}`] || [])))).filter((v) => v != null)),
      y: mean(readable.flatMap((rt) => d.dims.terms.map((t) => sovMean(rt, t.id, b.id))).filter((v) => v != null)), r: 1,
      tip: `<div class="h">${b.label}</div><div class="r"><span>Grid share</span><b class="tnum">${F.pct(mean(readable.flatMap((rt) => d.dims.terms.map((t) => sovMean(rt, t.id, b.id))).filter((v) => v != null)))}</b></div><div class="r"><span>Sponsored</span><b class="tnum">${F.pct(mean(readable.flatMap((rt) => d.dims.terms.map((t) => mean(slice(d.shelf.sponsored[`${rt}|${t.id}|${b.id}`] || [])))).filter((v) => v != null)))}</b></div>` })) });
  CC.bars(el("shBars"), { height: 250, cats: d.dims.retailers.filter((r) => readable.includes(r.id)).map((r) => r.label), fmtV: (v) => F.pct(v), fmtY: (v) => v + "%",
    series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color,
      data: d.dims.retailers.filter((r) => readable.includes(r.id)).map((r) => mean(d.dims.terms.map((t) => sovMean(r.id, t.id, b.id)).filter((v) => v != null))) })) });
  const fillRts = d.dims.retailers.filter((r) => readable.includes(r.id));
  const brandShare = (rt, bid) => mean(d.dims.terms.map((t) => sovMean(rt, t.id, bid)).filter((v) => v != null)) || 0;
  CC.bars(el("shSun"), { height: 250, stacked: true, cats: fillRts.map((r) => r.label), fmtV: (v) => F.pct(v), fmtY: (v) => v + "%",
    series: [...d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, data: fillRts.map((r) => brandShare(r.id, b.id)) })),
      { id: "other", label: "Other brands", color: "#dadce0", data: fillRts.map((r) => Math.max(0, 100 - d.dims.brands.reduce((acc, b) => acc + brandShare(r.id, b.id), 0))) }] });
  function shelfByRetailer() { return readable.map((rt) => ({ rt, v: mean(d.dims.terms.map((t) => sovMean(rt, t.id, S)).filter((v) => v != null)) })).filter((x) => x.v != null); }
};

/* ══════════════════════════════════════════════════════════════════════════
   LANDING PAGES
   ══════════════════════════════════════════════════════════════════════════ */
P.landing = (host) => {
  const d = D(), rts = retailerScope();
  const rows = d.pdpScores.filter((p) => rts.includes(p.retailer));
  const brandMean = (b) => mean(rows.filter((r) => r.brand === b).map((r) => r.score));
  host.innerHTML = `
  ${intro(`The page a shopper lands on after the click. Seven content signals per product page per retailer —
    imagery, video, enhanced content, bullets, specs, syndicated reviews and title fit — scored the same way
    on every listing so a gap is a gap and not a formatting difference.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("pdpScore", S)}
    ${kpi({ label: "Listings scored", dot: B(S).color, value: String(rows.filter((r) => r.brand === S).length), note: `Across ${rts.length} retailer${rts.length === 1 ? "" : "s"}` })}
    ${kpi({ label: `Weakest ${SUBJ} page`, dot: "#d93025", value: (() => { const w = rows.filter((r) => r.brand === S).sort((a, b) => a.score - b.score)[0]; return w ? String(w.score) : "—"; })(),
      note: (() => { const w = rows.filter((r) => r.brand === S).sort((a, b) => a.score - b.score)[0]; return w ? `${MD(w.model).label} at ${RT(w.retailer).label}` : ""; })() })}
    ${(() => { const sr = rows.filter((r) => r.brand === S);
      const gaps = d.dims.pdpFields.map((f) => ({ f, n: sr.filter((r) => !r.fields[f.id]).length })).sort((a, b) => b.n - a.n)[0];
      return kpi({ label: "Most common gap", dot: gaps && gaps.n ? "#e37400" : "#1e8e3e",
        value: gaps && gaps.n ? String(gaps.n) : "0",
        note: gaps && gaps.n ? `${esc(gaps.f.label.toLowerCase())} missing on ${gaps.n} of ${sr.length} ${SUBJ} listings — the widest single gap in the estate`
                             : `Every ${SUBJ} listing carries all ${d.dims.pdpFields.length} content signals` }); })()}
  </div>
  <div style="margin-bottom:14px">
    ${card({ title: "Content checklist, every listing", help: "Each product page checked for the seven things a shopper and a search engine both look for. A cross is a signal the page does not carry; a partial count is a gallery or bullet list shorter than the category's best page.", sub: `Every brand's live listings${rts.length > 1 ? "" : ` on ${RT(rts[0]).label}`}, side by side. Read across a row for one page; read down a column to see who ships the signal and who leaves it off. Click a row for the detail.`, slot: "lpMatrix" })}
  </div>
  <div class="grid g2">
    ${card({ title: `Where ${SUBJ} trails`, help: "For each signal, the share of the subject's listings that carry it against the best competitor. Sorted by the size of the gap, so the first row is the first fix.", sub: `Each signal, ${SUBJ}'s coverage against the best competitor, biggest gap first.`, slot: "lpGaps" })}
    ${card({ title: "Mean page score", help: "The brand's average page score across its live listings. A point-in-time read of the estate rather than a trend: the pages were scored once.", sub: "Every brand, across the retailers in scope.", slot: "lpBars" })}
  </div>`;
  const SIGNAL = { images: "Image gallery", video: "Product video", aplus: "A+ content", bullets: "Feature bullets", specs: "Full spec table", reviews: "Reviews shown", titleKw: "Keywords in title" };
  const sigLabel = (f) => SIGNAL[f.id] || f.label;
  const sorted = rows.slice().sort((a, b) => (b.brand === S) - (a.brand === S) || b.score - a.score);
  const cell = (r, f) => { const v = r.fields[f.id] || 0; if (!v) return '<span style="color:var(--risk);font-weight:500">✕</span>'; if (f.max === 1) return '<span style="color:var(--good);font-weight:600">✓</span>'; return `<span class="tnum" style="color:${v >= f.max ? "var(--good)" : "var(--warn)"};font-weight:500">${v}/${f.max}</span>`; };
  el("lpMatrix").innerHTML = rows.length ? table([
    { label: "Listing", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span>${esc(MD(r.model).label)}${rts.length > 1 ? `<div class="mini">${RT(r.retailer).label}</div>` : ""}` },
    ...d.dims.pdpFields.map((f) => ({ label: sigLabel(f), get: (r) => cell(r, f) })),
    { label: "Score", get: (r) => `<span style="display:inline-flex;align-items:center;gap:8px"><span style="display:inline-block;width:70px;height:6px;border-radius:3px;background:var(--line2);overflow:hidden"><i style="display:block;height:100%;width:${r.score}%;background:${B(r.brand).color}"></i></span><b class="tnum">${r.score}</b></span>` },
  ], sorted.map((r) => ({ ...r, _subject: r.brand === S }))) : withheld("No listing was scored on this build.");
  $$("#lpMatrix tbody tr").forEach((tr, i) => { tr.style.cursor = "pointer"; tr.onclick = () => showPdp(sorted[i]); });
  const share = (bid, f) => { const lr = rows.filter((r) => r.brand === bid); return lr.length ? lr.filter((r) => r.fields[f.id]).length / lr.length : null; };
  const rivals = BIDS().filter((b) => b !== S && rows.some((r) => r.brand === b));
  const gaps = d.dims.pdpFields.map((f) => {
    const mine = share(S, f); const best = rivals.map((b) => ({ b, v: share(b, f) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v)[0];
    const n = rows.filter((r) => r.brand === S).length, have = rows.filter((r) => r.brand === S && r.fields[f.id]).length;
    const bn = best ? rows.filter((r) => r.brand === best.b).length : 0, bhave = best ? rows.filter((r) => r.brand === best.b && r.fields[f.id]).length : 0;
    return { f, mine, best, gap: best && mine != null ? best.v - mine : 0, n, have, bn, bhave };
  }).sort((x, y) => y.gap - x.gap || (x.mine ?? 1) - (y.mine ?? 1));
  el("lpGaps").innerHTML = gaps.length && rows.some((r) => r.brand === S) ? `<div style="display:flex;flex-direction:column">${gaps.map((g) => {
    const status = g.gap > 0 ? `<span class="tag risk">${SUBJ} trails</span>` : g.mine === 1 ? '<span class="tag good">covered</span>' : g.mine === 0 && (!g.best || g.best.v === 0) ? '<span class="tag">nobody ships it</span>' : '<span class="tag good">level or ahead</span>';
    return `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line2)"><div><b style="font-weight:500">${esc(sigLabel(g.f))}</b><div class="mini">${SUBJ}: ${g.have} of ${g.n} listing${g.n === 1 ? "" : "s"}${g.best ? ` · ${B(g.best.b).label}: ${g.bhave} of ${g.bn}` : ""}</div></div>${status}
      <div style="grid-column:1/-1;display:flex;gap:4px;height:6px"><i style="flex:${Math.max(0.0001, g.mine || 0)};background:${B(S).color};border-radius:3px"></i><i style="flex:${Math.max(0.0001, 1 - (g.mine || 0))};background:var(--line2);border-radius:3px"></i></div></div>`; }).join("")}</div>` : withheld(`No ${SUBJ} listing was scored on this build.`);
  const means = d.dims.brands.map((b) => ({ b, v: brandMean(b.id) })).filter((x) => x.v != null).sort((x, y) => y.v - x.v);
  CC.hbars(el("lpBars"), { rows: means.map(({ b, v }) => ({ label: b.label, value: v, color: b.color, subject: b.id === S })), fmtV: (v) => Math.round(v) + " /100" });
  const mineMean = brandMean(S);
  if (means.length && mineMean != null) el("lpBars").insertAdjacentHTML("beforeend", `<p class="mini" style="margin:12px 0 0">${means[0].b.id === S ? `${SUBJ} leads on page content by ${Math.round(mineMean - (means[1] ? means[1].v : mineMean))} points.` : `${SUBJ} is ${Math.round(means[0].v - mineMean)} points behind ${means[0].b.label}; closing the gaps listed beside is how that moves.`}</p>`);
  function showPdp(x) {
    openDrawer(`${MD(x.model).label} · ${RT(x.retailer).label}`, `Page content score ${x.score}/100`,
      table([{ label: "Signal", lft: true, get: (f) => sigLabel(f) },
             { label: "Present", get: (f) => x.fields[f.id] ? `<b style="color:var(--good)">${f.max === 1 ? "✓" : x.fields[f.id] + " of " + f.max}</b>` : `<span style="color:var(--risk)">missing</span>` }],
        d.dims.pdpFields));
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   CARRIAGE & BUY BOX
   ══════════════════════════════════════════════════════════════════════════ */
P.carriage = (host) => {
  const d = D(), ds = winDates(), rts = retailerScope();
  const carried = (mid, rt, i) => { const a = d.distribution.carriage[`${mid}|${rt}`]; return a ? a[i] === 1 : false; };
  const daysCarried = (mid, rt) => { const [a, z] = win(); let n = 0; for (let i = a; i <= z; i++) if (carried(mid, rt, i)) n++; return n; };
  const winLen = win()[1] - win()[0] + 1;
  const changes = d.distribution.listings.filter((l) => l.note && rts.includes(l.retailer));
  host.innerHTML = `
  ${intro(`Which model is on which shelf, for how many days, and who owned the buy box while it was there.
    A snapshot cannot see a listing lapse and come back — this is the lane that only exists once you collect
    every day. <b>${changes.length} listing${changes.length === 1 ? "" : "s"} changed state</b> inside the window.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("carriage", S)}
    ${kpi({ label: "Cells occupied", dot: B(S).color, value: `${pairsFor(S, rts).length}<small> / ${d.dims.models.filter((m) => m.brand === S).length * rts.length}</small>`,
      note: "Model × retailer combinations with a live listing at any point" })}
    ${kpi({ label: "Buy-box ownership", dot: "#12b5cb", value: F.pct(mean(pairsFor(S, rts).map((k) => d.distribution.buybox[k] * 100))),
      note: "Share of the marketplace listing owned by the brand rather than a reseller" })}
    ${kpi({ label: "Listing changes", dot: changes.length ? "#e37400" : "#1e8e3e", value: String(changes.length),
      note: `Across all ${d.dims.brands.length} brands — ${changes.filter((c) => c.note.kind === "delisted").length} dropped, ${changes.filter((c) => c.note.kind === "listed").length} appeared, ${changes.filter((c) => c.note.kind === "lapsed").length} lapsed and returned. ${changes.filter((c) => c.brand === S).length} of them ${SUBJ}.` })}
  </div>
  ${card({ title: "The distribution grid", help: "Which models are carried by which retailers, cell by cell. A cell the capture could read is held fixed; only cells that could not be read are extrapolated.", sub: "Coloured by days OFF shelf, because at this coverage the question is where the holes are, not where the shelf is full. A tick is a listing live every day of the window; a hatched cell was never carried at all.", slot: "dsHeat", tag: `${winLen} days` })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Distribution points by brand", help: "Carriage weighted for the days each listing was actually live, not merely present at the end of the window. A listing that appeared a fortnight ago is worth less than one carried all quarter, and this says so.", sub: "Weighted for the days each listing was actually live, not just present at the end.", slot: "dsBars" })}
    ${card({ title: "Buy box and seller count", help: "On a marketplace, who wins the sale when several sellers offer the same item. A brand can be carried, in stock, and still not be the seller the shopper buys from.", sub: "Every marketplace listing. More sellers, less control — the point where a third party sets the price your shopper sees.", slot: "dsScatter" })}
  </div>
  ${changes.length ? card({ cls: "", title: "Listings that changed state", help: "Listings that appeared, disappeared, or changed hands inside the window — the events a quarterly snapshot cannot see, because it only ever sees the start and the end.", sub: "The events a quarterly snapshot cannot see.", html: table([
      { label: "Model", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span>${MD(r.model).label}` },
      { label: "Retailer", lft: true, get: (r) => RT(r.retailer).label },
      { label: "Event", lft: true, get: (r) => ({ listed: "Appeared on shelf", delisted: "Dropped from shelf", lapsed: "Lapsed and returned" })[r.note.kind] },
      { label: "Date", get: (r) => F.dateY(r.note.day) },
      { label: "Days out", get: (r) => r.note.days ? String(r.note.days) : "—" },
    ], changes.map((c) => ({ ...c, _subject: c.brand === S })))}) : ""}
  <h2 class="sec">What distribution says</h2>${readsBlock("distribution")}`;

  CC.heatmap(el("dsHeat"), { rows: d.dims.models, cols: d.dims.retailers.filter((r) => rts.includes(r.id)), corner: "Model ╲ Retailer", ramp: "red",
    rowLabel: (r) => r.label, rowDot: (r) => B(r.brand).color, colLabel: (c) => c.label,
    value: (r, c) => d.distribution.carriage[`${r.id}|${c.id}`] ? winLen - daysCarried(r.id, c.id) : null,
    fmtCell: (r, c) => { const k = `${r.id}|${c.id}`; if (!d.distribution.carriage[k]) return null;
      const off = winLen - daysCarried(r.id, c.id); return off === 0 ? "✓" : `−${off}d`; },
    fmtV: (v) => String(Math.round(v)), min: 0, max: winLen, scaleNote: `Days OFF shelf out of ${winLen} — a tick is a listing that was live every day`,
    tip: (r, c, v) => { const k = `${r.id}|${c.id}`;
      return `<div class="h">${r.label} · ${c.label}</div><div class="r"><span>Days carried</span><b class="tnum">${v} of ${winLen}</b></div><div class="r"><span>Sellers</span><b class="tnum">${d.distribution.sellers[k] ?? "—"}</b></div><div class="r"><span>Buy box</span><b class="tnum">${F.pct((d.distribution.buybox[k] ?? 0) * 100)}</b></div>`; } });
  CC.hbars(el("dsBars"), { rows: d.dims.brands.map((b) => ({ label: b.label, value: sc("carriage", b.id).value || 0, color: b.color, subject: b.id === S,
    note: `${pairsFor(b.id, rts).length} live cells` })).sort((a, b) => b.value - a.value), fmtV: (v) => F.pct(v) });
  const mk = d.distribution.listings.filter((l) => rts.includes(l.retailer) && l.sellers > 1);
  CC.scatter(el("dsScatter"), { height: 240, xLabel: "Sellers on the listing", yLabel: "Buy-box ownership", yZero: false,
    fmtX: (v) => String(Math.round(v)), fmtY: (v) => F.pct(v, 0), sized: false,
    points: mk.map((l) => ({ label: MD(l.model).label, color: B(l.brand).color, x: l.sellers, y: l.buybox * 100, r: 1,
      tip: `<div class="h">${MD(l.model).label} · ${RT(l.retailer).label}</div><div class="r"><i style="background:${B(l.brand).color}"></i><span>${B(l.brand).label}</span></div><div class="r"><span>Sellers</span><b class="tnum">${l.sellers}</b></div><div class="r"><span>Buy box</span><b class="tnum">${F.pct(l.buybox * 100)}</b></div>` })) });
};

/* ══════════════════════════════════════════════════════════════════════════
   AVAILABILITY
   ══════════════════════════════════════════════════════════════════════════ */
P.stock = (host) => {
  const d = D(), ds = winDates(), rts = retailerScope();
  const [a, z] = win();
  const eps = d.availability.episodes.filter((e) => rts.includes(e.retailer) && e.start >= ds[0] && e.start <= ds.at(-1));
  const brandStock = (b) => ds.map((_, i) => { const ks = pairsFor(b, rts);
    const live = ks.filter((k) => d.distribution.carriage[k][a + i] === 1);
    return live.length ? (live.filter((k) => d.availability.stock[k][a + i]).length / live.length) * 100 : null; });
  host.innerHTML = `
  ${intro(`Whether the listing could actually be bought. In-stock rate is the quietest number on this dashboard and
    the most expensive to be wrong about — a shopper who reaches an out-of-stock page does not come back, and the
    demand shows up in a competitor's numbers.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("inStock", S)}
    ${kpi({ label: "Out-of-stock episodes", dot: eps.filter((e) => e.brand === S).length ? "#d93025" : "#1e8e3e", value: String(eps.filter((e) => e.brand === S).length),
      note: `${sum(eps.filter((e) => e.brand === S).map((e) => e.days))} listing-days lost in the window` })}
    ${kpi({ label: "Longest gap", dot: "#e37400", value: (() => { const w = eps.filter((e) => e.brand === S).sort((x, y) => y.days - x.days)[0]; return w ? `${w.days}<small>d</small>` : "—"; })(),
      note: (() => { const w = eps.filter((e) => e.brand === S).sort((x, y) => y.days - x.days)[0]; return w ? `${MD(w.model).label} at ${RT(w.retailer).label}, from ${F.dateY(w.start)}` : "No gaps in the window"; })() })}
    ${kpi({ label: "Following a deep discount", dot: "#e37400", value: String(eps.filter((e) => e.brand === S && e.afterPromo).length),
      note: "Episodes opening within five days of a discount deeper than 14%" })}
  </div>
  ${card({ title: "In-stock rate, daily", help: "Of the listings a brand had live on a given day, the share that could actually be bought. It is the quietest number here: distribution, price and promotion all do nothing while the item cannot be added to a basket.", sub: "Share of each brand's live listings that could be bought that day.", slot: "avLine", tag: "13 weeks" })}
  <div class="grid g2" style="margin-top:14px">
    ${d.dims.cities.length
      ? card({ title: "Availability by model and city", help: "The same measure by delivery location. The same model is not equally buyable everywhere, and local fulfilment is a distribution decision rather than a supply one.", sub: `${SUBJ} listings only — the same model is not equally buyable everywhere. Local fulfilment is a distribution decision, not a supply one.`, slot: "avHeat" })
      : card({ title: "Availability by model and location", help: "The same measure by delivery location. The same model is not equally buyable everywhere, and local fulfilment is a distribution decision rather than a supply one.", sub: "Whether a listing is buyable can differ by where the shopper is.", html: `<div class="withheld-card"><b>Withheld</b><p>This study read availability from the listing without setting a delivery address, so there is no location dimension behind it. A single column standing in for the country would assert a reading that was never taken.</p></div>` })}
    ${card({ title: "Out-of-stock episodes", help: "Every continuous gap in availability in the window, longest first, and whether it opened within five days of a deep discount — the signature of a promotion that outran its stock.", sub: "Every gap in the window, longest first.", html: eps.length ? table([
      { label: "Model", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span>${MD(r.model).label}` },
      { label: "Retailer", lft: true, get: (r) => RT(r.retailer).label },
      { label: "From", get: (r) => F.date(r.start) },
      { label: "Days", get: (r) => `<b class="tnum">${r.days}</b>` },
      { label: "After promo", get: (r) => r.afterPromo ? `<span style="color:var(--warn);font-weight:700">yes</span>` : "—" },
    ], eps.slice().sort((x, y) => y.days - x.days).map((e) => ({ ...e, _subject: e.brand === S })), { maxH: "300px" }) : `<p class="mini">No out-of-stock episode recorded in this window.</p>` })}
  </div>
  <h2 class="sec">What availability says</h2>${readsBlock("availability")}`;
  // The floor is read off the data, not fixed at 60: a hard floor clipped the
  // line the moment the in-stock anchor came down to what the capture says.
  const stockSeries = d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: brandStock(b.id) }));
  const stockLo = Math.min(...stockSeries.flatMap((s) => s.data).filter((v) => v != null));
  CC.line(el("avLine"), { height: 240, x: ds, bands: winBands(), min: Math.max(0, Math.floor((stockLo - 4) / 5) * 5), max: 100,
    fmtV: (v) => F.pct(v), fmtY: (v) => v + "%", series: stockSeries });
  const subjPairs = pairsFor(S, rts);
  if (d.dims.cities.length) CC.heatmap(el("avHeat"), { rows: d.dims.models.filter((m) => m.brand === S), cols: d.dims.cities, corner: "Model ╲ City", ramp: "red", invert: true,
    rowLabel: (r) => r.label, colLabel: (c) => c.label.split(",")[0], fmtV: (v) => F.pct(v, 0), scaleNote: "In-stock rate",
    value: (r, c) => { const ks = subjPairs.filter((k) => k.startsWith(r.id + "|"));
      const v = ks.map((k) => d.availability.byCity[`${k}|${c.id}`]).filter((x) => x != null);
      return v.length ? mean(v) * 100 : null; },
    tip: (r, c, v) => `<div class="h">${r.label} · ${c.label}</div><div class="r"><span>In stock</span><b class="tnum">${F.pct(v)}</b></div><div class="r sub"><span>Across</span><b>${subjPairs.filter((k) => k.startsWith(r.id + "|")).length} retailer listing(s)</b></div>` });
};

/* ══════════════════════════════════════════════════════════════════════════
   DELIVERY PROMISE
   ══════════════════════════════════════════════════════════════════════════ */
P.delivery = (host) => {
  const d = D(), rts = retailerScope();
  const w0 = Math.floor(win()[0] / 7), w1 = Math.floor(win()[1] / 7);
  const wkIds = d.dims.weeks.slice(w0, w1 + 1);
  // Where no metro was probed the promise is keyed under a single implicit
  // national location. The measure is the same; the breakdown behind it is what
  // is missing, and the cards that need it withhold rather than draw one column.
  const CITY = d.dims.cities.length ? d.dims.cities : [{ id: "national", label: "National" }];
  const metros = d.dims.cities.length;
  const promise = (mid, rt, c) => { const s2 = d.delivery.weekly[`${mid}|${rt}|${c}`]; return s2 ? mean(s2.slice(w0, w1 + 1)) : null; };
  const brandCity = (b, c) => mean(pairsFor(b, rts).map((k) => { const [mid, rt] = k.split("|"); return promise(mid, rt, c); }).filter((v) => v != null));
  const brandWeek = (b) => wkIds.map((_, i) => mean(pairsFor(b, rts).flatMap((k) => CITY.map((c) => (d.delivery.weekly[`${k}|${c.id}`] || [])[w0 + i])).filter((v) => v != null)));
  const held = (why) => `<div class="withheld-card"><b>Withheld</b><p>${why}</p></div>`;
  host.innerHTML = `
  ${intro(`Days from order to the earliest free delivery the page promises${metros ? `, read in ${metros} metros` : ""}.
    The promise is a commercial lever, not a logistics readout — it moves with peak weeks and it collapses when a
    listing goes out of stock, and the shopper sees both.${metros ? "" : ` This study read the promise as the listing
    showed it nationally and probed no delivery locations, so the metro breakdown is withheld throughout this page.`}`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("leadTime", S)}
    ${metros ? `
    ${kpi({ label: "Fastest metro", dot: "#1e8e3e", value: (() => { const r = d.dims.cities.map((c) => ({ c, v: brandCity(S, c.id) })).sort((x, y) => x.v - y.v)[0]; return F.d(r.v); })(),
      note: (() => { const r = d.dims.cities.map((c) => ({ c, v: brandCity(S, c.id) })).sort((x, y) => x.v - y.v)[0]; return r.c.label; })() })}
    ${kpi({ label: "Slowest metro", dot: "#d93025", value: (() => { const r = d.dims.cities.map((c) => ({ c, v: brandCity(S, c.id) })).sort((x, y) => y.v - x.v)[0]; return F.d(r.v); })(),
      note: (() => { const r = d.dims.cities.map((c) => ({ c, v: brandCity(S, c.id) })).sort((x, y) => y.v - x.v)[0]; return r.c.label; })() })}
    ${kpi({ label: "National spread", dot: "#e37400", value: (() => { const v = d.dims.cities.map((c) => brandCity(S, c.id)); return F.d(Math.max(...v) - Math.min(...v)); })(),
      note: "Between the fastest and slowest metro on the same catalogue" })}` : `
    ${kpi({ label: "Slowest in the set", dot: "#d93025", value: (() => { const o = d.dims.brands.map((b) => ({ b, v: sc("leadTime", b.id).value })).filter((x) => x.v != null).sort((x, y) => y.v - x.v)[0]; return o ? F.d(o.v) : "—"; })(),
      note: (() => { const o = d.dims.brands.map((b) => ({ b, v: sc("leadTime", b.id).value })).filter((x) => x.v != null).sort((x, y) => y.v - x.v)[0]; return o ? o.b.label : "No promise captured"; })() })}
    ${kpi({ label: "Fastest in the set", dot: "#1e8e3e", value: (() => { const o = d.dims.brands.map((b) => ({ b, v: sc("leadTime", b.id).value })).filter((x) => x.v != null).sort((x, y) => x.v - y.v)[0]; return o ? F.d(o.v) : "—"; })(),
      note: (() => { const o = d.dims.brands.map((b) => ({ b, v: sc("leadTime", b.id).value })).filter((x) => x.v != null).sort((x, y) => x.v - y.v)[0]; return o ? o.b.label : "No promise captured"; })() })}
    ${kpi({ label: "Metro spread", dot: "#80868b", value: "—", note: "Withheld — no delivery location was probed for this study" })}`}
  </div>
  <div class="grid g2">
    ${card({ title: metros ? "Promise by retailer and city" : "Promise by metro", help: "Days from order to the earliest free delivery the product page promises. It is the promise as displayed to a shopper, not the delivery as performed.",
      sub: metros ? `${SUBJ} listings, meaned. A warm cell is a slow promise — click for the model detail behind it.` : "The promise as displayed, broken out by delivery location.",
      slot: metros ? "dlHeat" : null,
      html: metros ? null : held("This study read the delivery promise once per listing, as the page showed it, without setting a delivery address. There is no metro dimension behind the figure, so none is drawn — a single column labelled with a city we did not probe would assert a reading that was never taken.") })}
    ${card({ title: "Promise through the quarter", help: "The weekly mean promise by brand. Peak weeks stretch the promise across the whole category rather than at one retailer, so the shape is a demand signal as much as a logistics one.", sub: "Weekly mean by brand. Peak weeks stretch the promise across the whole category, not just one retailer.", slot: "dlLine" })}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Fastest to slowest, by model", help: "The spread of the promise across a brand's own models. A wide spread inside one brand is a fulfilment choice per line, not a limit of the network.", sub: `The range each ${SUBJ} model is promised across ${metros ? "all retailers and metros" : "the window"} in scope. Hover a bar for the fastest and slowest ${metros ? "retailer-and-metro" : "retailer"} promises behind it.`, slot: "dlRange" })}
    ${card({ title: "Where each brand sits", help: "The promise brand against brand. A national average hides the places where a brand is beaten, and those are the ones a competitor advertises in.", sub: metros ? "Mean promise by metro, all brands." : "Mean promise across the window, all brands.", slot: "dlBars" })}
  </div>
  <h2 class="sec">What the promise says</h2>${readsBlock("delivery")}`;

  if (metros) {
    CC.heatmap(el("dlHeat"), { rows: d.dims.retailers.filter((r) => rts.includes(r.id)), cols: d.dims.cities, corner: "Retailer ╲ City", ramp: "red",
      rowLabel: (r) => r.label, rowDot: (r) => r.color, colLabel: (c) => c.label.split(",")[0], fmtV: (v) => v.toFixed(1), scaleNote: "Days to delivery",
      value: (r, c) => mean(pairsFor(S, [r.id]).map((k) => promise(k.split("|")[0], r.id, c.id)).filter((v) => v != null)),
      onPick: (r, c) => openDrawer(`${r.label} · ${c.label}`, "Promised days, by model",
        table([{ label: "Model", lft: true, get: (x) => `<span class="dot" style="background:${B(MD(x.mid).brand).color}"></span>${MD(x.mid).label}` },
               { label: "Days", get: (x) => `<b class="tnum">${F.d(x.v)}</b>` }],
          pairsFor(null, [r.id]).map((k) => ({ mid: k.split("|")[0], v: promise(k.split("|")[0], r.id, c.id), _subject: MD(k.split("|")[0]).brand === S }))
            .filter((x) => x.v != null).sort((x, y) => x.v - y.v))) });
  }
  CC.line(el("dlLine"), { height: 250, x: wkIds.map((w) => w.start), zero: false, fmtV: F.d, fmtY: (v) => v.toFixed(1),
    fmtX: (v) => F.date(v), fmtTip: (v) => `Week of ${F.dateY(v)}`,
    series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: brandWeek(b.id) })) });
  // One row per model; the hover carries the sample promises behind the span — the fastest and
  // slowest retailer-and-metro combinations and the median — so the variance can be investigated
  // without leaving the chart (Aashish, 2026-09-22).
  const rr = d.dims.models.filter((m) => m.brand === S).map((m) => {
    const samples = pairsFor(S, rts).filter((k) => k.startsWith(m.id + "|")).flatMap((k) => { const rt = k.split("|")[1]; return CITY.map((c) => ({ rt, c, v: promise(m.id, rt, c.id) })); }).filter((x) => x.v != null).sort((x, y) => x.v - y.v);
    if (!samples.length) return null;
    const where = (x) => `${RT(x.rt).label}${x.c && x.c.label ? " · " + x.c.label.split(",")[0] : ""}`;
    const row = (x) => `<div class="r"><i style="background:${RT(x.rt).color || "#80868b"}"></i><span>${where(x)}</span><b class="tnum">${F.d(x.v)}</b></div>`;
    const nRt = new Set(samples.map((x) => x.rt)).size, nCity = new Set(samples.map((x) => x.c && x.c.id)).size;
    const fast = samples.slice(0, 3), slow = samples.slice(-3).reverse(), med = samples[Math.floor(samples.length / 2)].v;
    const tip = `<div class="h">${m.label} · ${samples.length} promise${samples.length === 1 ? "" : "s"} across ${nRt} retailer${nRt === 1 ? "" : "s"}${metros ? ` × ${nCity} metro${nCity === 1 ? "" : "s"}` : ""}</div>` +
      `<div class="r"><span style="color:#81c995;font-weight:700">Fastest</span></div>${fast.map(row).join("")}` +
      (samples.length > 3 ? `<div class="r" style="margin-top:6px"><span style="color:#f28b82;font-weight:700">Slowest</span></div>${slow.map(row).join("")}` : "") +
      `<div class="r" style="margin-top:6px"><span>Median promise</span><b class="tnum">${F.d(med)}</b></div><div class="r"><span>Span</span><b class="tnum">${F.d(samples.at(-1).v - samples[0].v)}</b></div>`;
    return { label: m.label, lo: samples[0].v, hi: samples.at(-1).v, color: B(S).color, subject: true, tip };
  }).filter(Boolean).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo));
  CC.ranges(el("dlRange"), { rows: rr, zero: true, fmtV: (v) => v.toFixed(1) + "d", fmtSpread: (r) => (r.hi - r.lo).toFixed(1) + "d span" });
  // With no metro dimension the same chart compares brands on the one promise
  // each was measured on, which is the comparison the data supports.
  CC.bars(el("dlBars"), { height: 240, cats: metros ? d.dims.cities.map((c) => c.label.split(",")[0]) : ["Promise"], rotate: metros, fmtV: F.d, fmtY: (v) => v.toFixed(1),
    series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, data: CITY.map((c) => brandCity(b.id, c.id)) })) });
};

/* ══════════════════════════════════════════════════════════════════════════
   PRICING — the Chief Commercial Officer's first screen
   ══════════════════════════════════════════════════════════════════════════ */
P.pricing = (host) => {
  const d = D(), ds = winDates(), rts = retailerScope(), [a] = win();
  const priceMean = (k) => mean(slice(d.pricing.price[k]));
  const measuredOnly = (d.meta.provenance || {}).mode === "measured-only";
  const listAt = (k, i) => measuredOnly ? ((d.pricing.list || {})[k] || [])[i] ?? null : MD(k.split("|")[0]).msrp;
  const brandIndex = (b) => ds.map((_, i) => mean(pairsFor(b, rts).map((k) => { const p = d.pricing.price[k][a + i], l = listAt(k, a + i); return p == null || !l ? null : (p / l) * 100; })));
  const disp = d.pricing.dispersion.filter((x) => pairsFor(x.brand, rts).some((k) => k.startsWith(x.model + "|")));
  const breaches = d.pricing.mapBreaches.filter((m) => rts.includes(m.retailer));
  const subjBreach = breaches.filter((m) => m.brand === S);
  let focus = d.dims.models.filter((m) => m.brand === S && pairsFor(S, rts).some((k) => k.startsWith(m.id + "|")))[0];
  host.innerHTML = `
  ${intro(`What each model actually transacts at, every day, at every retailer that carries it. Price index is the
    measure to read first: it is the street price as a share of MSRP, so <b>100% is a brand that never discounts</b>
    and the distance below it is margin the category is giving away.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("priceIndex", S)}
    ${kpi({ label: `Mean ${SUBJ} street price`, dot: B(S).color, value: F.usd0(mean(pairsFor(S, rts).map(priceMean))),
      note: `Across ${pairsFor(S, rts).length} live listings` })}
    ${kpi({ label: "Widest cross-retailer spread", dot: "#e37400",
      value: (() => { const w = disp.filter((x) => x.brand === S).sort((x, y) => y.meanSpread - x.meanSpread)[0]; return w ? F.usd0(w.meanSpread) : "—"; })(),
      note: (() => { const w = disp.filter((x) => x.brand === S).sort((x, y) => y.meanSpread - x.meanSpread)[0]; return w ? `${MD(w.model).label} — ${F.usd0(w.maxSpread)} at its widest` : "Single-retailer models only"; })() })}
    ${d.pricing.mapFloorPct == null ? kpi({ label: "Price-floor breaches", dot: "#9aa0a6", value: "—", note: "No minimum-advertised-price policy is known for this brand" }) : kpi({ label: "Price-floor breaches", dot: subjBreach.length ? "#d93025" : "#1e8e3e", value: String(subjBreach.length),
      note: subjBreach.length ? `${sum(subjBreach.map((x) => x.days))} listing-days below the ${Math.round(d.pricing.mapFloorPct[S] * 100)}% floor` : `No ${SUBJ} listing traded below the ${Math.round(d.pricing.mapFloorPct[S] * 100)}% floor` })}
  </div>
  ${card({ title: "Price index by brand", help: "Street price as a percentage of the manufacturer's list price. The vertical distance between two lines is the difference in how much margin each brand is prepared to hand over to move a unit.", sub: "Street price as a percentage of MSRP, daily. The vertical distance between two lines is the difference in how much margin each brand is prepared to hand over to move a unit.", tag: "13 weeks", slot: "prIndex" })}
  <div class="grid g32" style="margin-top:14px">
    ${card({ title: "One model, every retailer", help: "The same product priced across every retailer that carries it, by day. Distance between the lines is channel conflict, and it is visible to any shopper with two tabs open.", sub: "Daily street price for the selected model, with MSRP as the dashed reference. Steps, not drift — a price holds until someone changes it.",
      html: `<div class="seg mini wrap" id="prPick" style="margin-bottom:12px"></div><div id="prModel"></div>` })}
    ${card({ title: "Price ladder", help: "The brand's own range laid out by price point, so the gaps and the overlaps between its models are visible. A gap in a ladder is an invitation for a competitor to stand in it.", sub: "Mean street price by model and retailer. The same model is not the same price, and the shopper can see all of them at once.", slot: "prHeat" })}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Cross-retailer price spread", help: "For each listing, the distance between its cheapest and its dearest retailer on the same day. A wide spread is where a price policy is not holding.", sub: `Every model rebased to 100 at its cheapest shelf, so a $12 spread on a $99 listing and a $40 one on a $999 listing can be compared — the index is the comparison, the dollar spread on the right is the size of it.`, slot: "prRange" })}
    ${card({ title: "Price architecture", help: "Every listing plotted at its street price against how far below list it sits, sized by page traffic. Bottom-right is expensive and discounted; top-left is keenly priced and held.", sub: "Every listing plotted at its street price against how far below MSRP it sits. Bubble size is the listing's page traffic.", slot: "prScatter" })}
  </div>
  ${breaches.length ? card({ title: "Below the price floor", help: "Listings priced under the brand's minimum advertised price, where one is set. Each is a conversation with a retailer, and the count is the size of that conversation.", sub: `A listing that traded under its brand's own advertised-price floor. ${SUBJ} holds a ${Math.round(d.pricing.mapFloorPct[S] * 100)}% floor; the set ranges from ${Math.round(Math.min(...Object.values(d.pricing.mapFloorPct)) * 100)}% to ${Math.round(Math.max(...Object.values(d.pricing.mapFloorPct)) * 100)}%.`, tag: `${breaches.length} listings`, tagCls: "risk", html: table([
      { label: "Model", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span>${MD(r.model).label}` },
      { label: "Retailer", lft: true, get: (r) => RT(r.retailer).label },
      { label: "Floor", get: (r) => F.usd0(r.floor) },
      { label: "Days under", get: (r) => `<b class="tnum">${r.days}</b>` },
      { label: "Worst", get: (r) => `<span style="color:var(--risk);font-weight:700">${F.pct(r.worstPct)}</span>` },
      { label: "First seen", get: (r) => F.dateY(r.first) },
    ], breaches.slice().sort((x, y) => y.days - x.days).map((m) => ({ ...m, _subject: m.brand === S })), { maxH: "300px" }) }) : ""}
  <h2 class="sec">What pricing says</h2>${readsBlock("pricing")}`;

  CC.line(el("prIndex"), { height: 250, x: ds, bands: winBands(), zero: false, fmtV: (v) => F.pct(v), fmtY: (v) => v + "%",
    series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: brandIndex(b.id) })) });
  const opts = d.dims.models.filter((m) => pairsFor(m.brand, rts).some((k) => k.startsWith(m.id + "|")));
  el("prPick").innerHTML = opts.filter((m) => m.brand === S).concat(opts.filter((m) => m.brand !== S).slice(0, 6))
    .map((m) => `<button data-m="${m.id}">${m.label}</button>`).join("");
  $$("#prPick button").forEach((btn) => btn.onclick = () => { focus = MD(btn.dataset.m); drawModel(); });
  drawModel();
  function drawModel() {
    $$("#prPick button").forEach((b) => b.classList.toggle("on", b.dataset.m === focus.id));
    const ks = pairsFor(focus.brand, rts).filter((k) => k.startsWith(focus.id + "|"));
    CC.line(el("prModel"), { height: 236, x: ds, bands: winBands(), zero: false, fmtV: F.usd, fmtY: F.usd0,
      series: ks.map((k) => { const rt = k.split("|")[1]; return { id: rt, label: RT(rt).label, color: RT(rt).color, data: slice(d.pricing.price[k]) }; })
        .concat([{ id: "msrp", label: "MSRP " + F.usd0(focus.msrp), color: "#80868b", dash: "5 4", data: ds.map(() => focus.msrp) }]) });
  }
  // Colour is the price index, not the price: a $1,009 listing is not "hotter"
  // than a $99 one, but a listing at 74% of MSRP is a different animal from one
  // at 99%. The dollar value stays as the cell label.
  const idxAt = (r, c) => { const k = `${r.id}|${c.id}`; const v = d.pricing.price[k] ? priceMean(k) : null; return v == null ? null : (v / r.msrp) * 100; };
  CC.heatmap(el("prHeat"), { rows: d.dims.models, cols: d.dims.retailers.filter((r) => rts.includes(r.id)), corner: "Model ╲ Retailer", ramp: "red", invert: true,
    rowLabel: (r) => r.label, rowDot: (r) => B(r.brand).color, colLabel: (c) => c.label, scaleNote: "Price index — dark is a deeper discount off MSRP",
    value: (r, c) => idxAt(r, c), fmtV: (v) => F.pct(v, 0), cellLabel: true,
    tip: (r, c, v) => { const k = `${r.id}|${c.id}`;
      return `<div class="h">${r.label} · ${c.label}</div><div class="r"><span>Mean street</span><b class="tnum">${F.usd(priceMean(k))}</b></div><div class="r"><span>MSRP</span><b class="tnum">${F.usd0(r.msrp)}</b></div><div class="r"><span>Price index</span><b class="tnum">${F.pct(v)}</b></div><div class="r sub"><span>Mean discount</span><b class="tnum">${F.pct(mean(slice(d.pricing.discount[k])))}</b></div>`; },
    fmtCell: (r, c) => { const k = `${r.id}|${c.id}`; return d.pricing.price[k] ? F.usd0(priceMean(k)) : null; } });
  CC.ranges(el("prRange"), { indexed: true, fmtV: (v) => Math.round(v),
    rows: disp.slice().sort((x, y) => y.meanSpreadPct - x.meanSpreadPct).slice(0, 12).map((x) => {
      const vals = Object.values(x.byRetailer);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return { label: MD(x.model).label, lo, hi, color: B(x.brand).color, subject: x.brand === S,
        tip: `<div class="h">${MD(x.model).label}</div>` + Object.entries(x.byRetailer).sort((p, q) => p[1] - q[1]).map(([rt, v]) =>
          `<div class="r"><i style="background:${RT(rt).color}"></i><span>${RT(rt).label}</span><b class="tnum">${F.usd(v)}</b></div>`).join("") +
          `<div class="r sub"><span>Spread</span><b class="tnum">${F.usd0(hi - lo)} · ${F.pct(((hi - lo) / hi) * 100)}</b></div>` };
    }), fmtSpread: (r) => F.usd0(r._hi - r._lo) + " · " + F.pct(((r._hi - r._lo) / r._hi) * 100) });
  CC.scatter(el("prScatter"), { height: 260, xLabel: "Street price", yLabel: "Discount off MSRP", xZero: false,
    fmtX: F.usd0, fmtY: (v) => F.pct(v, 0),
    points: pairsFor(null, rts).map((k) => { const [mid, rt] = k.split("|"), m = MD(mid);
      return { label: m.label, color: B(m.brand).color, x: priceMean(k), y: mean(slice(d.pricing.discount[k])) || 0, r: (d.traffic.pdp && d.traffic.pdp[k] ? sum(slice(d.traffic.pdp[k])) : 0) || 1,
        tip: `<div class="h">${m.label} · ${RT(rt).label}</div><div class="r"><i style="background:${B(m.brand).color}"></i><span>${B(m.brand).label}</span></div><div class="r"><span>Street</span><b class="tnum">${F.usd(priceMean(k))}</b></div><div class="r"><span>MSRP</span><b class="tnum">${F.usd0(m.msrp)}</b></div><div class="r"><span>Discount</span><b class="tnum">${F.pct(mean(slice(d.pricing.discount[k])) || 0)}</b></div>` }; }) });
};

/* ══════════════════════════════════════════════════════════════════════════
   PROMOTIONS
   ══════════════════════════════════════════════════════════════════════════ */
P.promotions = (host) => {
  const d = D(), ds = winDates(), rts = retailerScope(), [a, z] = win();
  const evs = d.promotions.events.filter((p) => rts.includes(p.retailer) && !p.alwaysOn && p.end >= ds[0] && p.start <= ds.at(-1));
  const depthDay = (b) => ds.map((_, i) => { const ks = pairsFor(b, rts); const on = ks.map((k) => d.promotions.depthByDay[k][a + i]).filter((v) => v > 0);
    return on.length ? mean(on) : null; });
  const onDay = (b) => ds.map((_, i) => { const ks = pairsFor(b, rts).filter((k) => d.distribution.carriage[k][a + i] === 1);
    return ks.length ? (ks.filter((k) => d.promotions.depthByDay[k][a + i] > 0).length / ks.length) * 100 : 0; });
  const famOf = (t) => (d.dims.promoTypes.find((x) => x.id === t) || {}).family;
  const famColor = (f) => (d.dims.promoFamilies.find((x) => x.id === f) || {}).color;
  host.innerHTML = `
  ${intro(`Every promotion running on every product page, as a discrete event with a start, an end, a depth and a
    funder. ${evs.length} price events ran in this window across ${rts.length} retailer${rts.length === 1 ? "" : "s"}.
    Depth is only half the question — the other half is <b>how often</b>, and the two together are a strategy.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${metricKpi("promoIntensity", S)}${metricKpi("promoDepth", S)}
    ${kpi({ label: `${SUBJ} price events`, dot: B(S).color, value: String(evs.filter((p) => p.brand === S).length),
      note: `Mean ${(mean(evs.filter((p) => p.brand === S).map((p) => p.days)) || 0).toFixed(1)} days each` })}
    ${kpi({ label: "Deepest in market", dot: "#d93025", value: (() => { const w = evs.slice().sort((x, y) => y.depthPct - x.depthPct)[0]; return w ? F.pct(w.depthPct) : "—"; })(),
      note: (() => { const w = evs.slice().sort((x, y) => y.depthPct - x.depthPct)[0]; return w ? `${B(w.brand).label} · ${MD(w.model).label} at ${RT(w.retailer).label}` : ""; })() })}
  </div>
  <div class="grid g2">
    ${card({ title: "How much of the shelf is on promotion", help: "Of a brand's live listings, the share carrying a price promotion on a given day. This is promotional pressure — how often, not how deep — and it is what a shopper experiences as everything being on sale.", sub: "Share of each brand's live listings carrying a price promotion that day. This is promotional pressure — the thing a shopper feels as “everything is on sale”.", slot: "pmOn" })}
    ${card({ title: "How deep it goes when it does", help: "The mean discount across only the listings actually on promotion, so it is not diluted by the ones that are not. The line breaks on days with nothing running: a gap is silence, not a zero-percent discount.", sub: "Mean depth across the listings actually on promotion. The line breaks on days when the brand had nothing running — a gap is silence, not a zero-percent discount.", slot: "pmDepth" })}
  </div>
  <div class="grid g3" style="margin-top:14px">
    ${card({ title: "Mechanic mix", help: "Listing-days by promotional mechanic — the inner ring is the family, the outer the mechanics inside it. A price give and a finance offer cost very different things and reach very different shoppers.", sub: "Listing-days by mechanic across the whole window, including the always-on ones. Inner ring is the family, outer ring the mechanics inside it — hover for the split.", slot: "pmSun" })}
    ${card({ title: "Depth against duration", help: "Every price event as a single point: how deep it went against how long it ran. Top-right is a deep, long give; bottom-left is a tactical clip.", sub: "Every price event. Top-right is a deep, long give; bottom-left is a tactical clip.", slot: "pmScatter" })}
    ${card({ title: "Where the promotions run", help: "Price-event days by retailer, with the event count and the mean depth behind each. It says which retailer the promotional budget is actually being spent at.", sub: "Price-event days by retailer.", slot: "pmRet" })}
  </div>
  ${card({ cls: "pmTableCard", title: "Every price event in the window", help: "Each promotion as a discrete event with a start, an end, a depth and a funder, deepest first. The row is the unit a commercial team negotiates in.", sub: "Sorted by depth. Click a row for the mechanics running alongside it on the same page.", tag: `${evs.length} events`, html: table([
      { label: "Brand", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span>${B(r.brand).label}` },
      { label: "Model", lft: true, get: (r) => MD(r.model).label },
      { label: "Retailer", lft: true, get: (r) => RT(r.retailer).label },
      { label: "Mechanic", lft: true, get: (r) => `<span class="dot" style="background:${famColor(famOf(r.type))}"></span>${(d.dims.promoTypes.find((t) => t.id === r.type) || {}).label || r.type}` },
      { label: "Depth", get: (r) => `<b class="tnum">${F.pct(r.depthPct)}</b>` },
      { label: "Value", get: (r) => F.usd0(r.depthUsd) },
      { label: "Ran", get: (r) => `${F.date(r.start)} – ${F.date(r.end)}` },
      { label: "Days", get: (r) => String(r.days) },
      { label: "On event", get: (r) => r.onEvent ? (d.dims.events.find((e) => e.id === r.onEvent) || {}).label || "yes" : "—" },
    ], evs.slice().sort((x, y) => y.depthPct - x.depthPct).map((e) => ({ ...e, _subject: e.brand === S })), { maxH: "440px" }) })}
  <h2 class="sec">What the promotions say</h2>${readsBlock("promotions")}`;

  CC.line(el("pmOn"), { height: 240, x: ds, bands: winBands(), area: true, fmtV: (v) => F.pct(v), fmtY: (v) => v + "%",
    series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: onDay(b.id) })) });
  CC.line(el("pmDepth"), { height: 240, x: ds, bands: winBands(), fmtV: (v) => F.pct(v), fmtY: (v) => v + "%",
    series: d.dims.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.subject, data: depthDay(b.id) })) });
  const allS = d.promotions.events.filter((p) => p.brand === S && rts.includes(p.retailer));
  const byFam = {};
  for (const p of allS) { const f = famOf(p.type); if (!f) continue; (byFam[f] = byFam[f] || {})[p.type] = ((byFam[f] || {})[p.type] || 0) + p.days; }
  CC.sunburst(el("pmSun"), { size: 280, fmtV: (v) => F.n(v) + " days",
    centre: { value: F.k(Object.values(byFam).reduce((x, o) => x + Object.values(o).reduce((p2, q) => p2 + q, 0), 0)), label: `${SUBJ} promo-days` },
    groups: d.dims.promoFamilies.filter((f) => byFam[f.id]).map((f) => ({ id: f.id, label: f.label, color: f.color,
      children: Object.entries(byFam[f.id]).map(([t, v], i) => ({ label: (d.dims.promoTypes.find((x) => x.id === t) || {}).label || t, value: v, color: f.color, opacity: 0.75 - i * 0.16 })) })) });
  CC.scatter(el("pmScatter"), { height: 240, xLabel: "Days the event ran", yLabel: "Discount depth", sized: false,
    fmtX: (v) => String(Math.round(v)), fmtY: (v) => F.pct(v, 0),
    points: evs.map((p) => ({ label: MD(p.model).label, color: B(p.brand).color, x: p.days, y: p.depthPct, r: 1,
      tip: `<div class="h">${MD(p.model).label} · ${RT(p.retailer).label}</div><div class="r"><i style="background:${B(p.brand).color}"></i><span>${B(p.brand).label}</span></div><div class="r"><span>Depth</span><b class="tnum">${F.pct(p.depthPct)} · ${F.usd0(p.depthUsd)}</b></div><div class="r"><span>Ran</span><b>${F.date(p.start)}–${F.date(p.end)}</b></div>` })) });
  CC.hbars(el("pmRet"), { rows: rts.map((rt) => ({ label: RT(rt).label, color: RT(rt).color,
    value: sum(evs.filter((p) => p.retailer === rt).map((p) => p.days)),
    note: `${evs.filter((p) => p.retailer === rt).length} events · ${F.pct(mean(evs.filter((p) => p.retailer === rt).map((p) => p.depthPct)) || 0)} mean depth` }))
    .sort((x, y) => y.value - x.value), fmtV: (v) => F.n(v) + "d" });
  const list = evs.slice().sort((x, y) => y.depthPct - x.depthPct);
  $$(".page.on .pmTableCard table.dt tbody tr").forEach((tr, i) => { const p2 = list[i]; if (!p2) return;
    tr.style.cursor = "pointer"; tr.onclick = () => {
      const same = d.promotions.events.filter((q) => q.model === p2.model && q.retailer === p2.retailer && q.start <= p2.end && q.end >= p2.start);
      openDrawer(`${MD(p2.model).label} · ${RT(p2.retailer).label}`, `Everything on the page between ${F.dateY(p2.start)} and ${F.dateY(p2.end)}`,
        table([{ label: "Mechanic", lft: true, get: (r) => `<span class="dot" style="background:${famColor(famOf(r.type))}"></span>${(d.dims.promoTypes.find((t) => t.id === r.type) || {}).label || r.type}` },
               { label: "Face value", get: (r) => r.depthUsd ? F.usd0(r.depthUsd) : r.addonUsd ? "+" + F.usd0(r.addonUsd) : r.monthly ? F.usd0(r.monthly) + "/mo" : "—" },
               { label: "Attach", get: (r) => F.pct(((d.dims.promoTypes.find((t) => t.id === r.type) || {}).attach || 0) * 100, 0) },
               { label: "Always on", get: (r) => r.alwaysOn ? "✓" : "—" }], same));
    }; });
};

/* ══════════════════════════════════════════════════════════════════════════
   PROMOTION CALENDAR — who was on, when, how deep, and against whom
   ══════════════════════════════════════════════════════════════════════════ */
let calMode = "brand";
P.calendar = (host) => {
  const d = D(), ds = winDates(), rts = retailerScope(), [a, z] = win();
  const famOf = (t) => (d.dims.promoTypes.find((x) => x.id === t) || {}).family;
  const famColor = (t) => (d.dims.promoFamilies.find((x) => x.id === famOf(t)) || { color: "#80868b" }).color;
  const typeLabel = (t) => (d.dims.promoTypes.find((x) => x.id === t) || {}).label || t;
  const evs = d.promotions.events.filter((p) => rts.includes(p.retailer) && !p.alwaysOn && p.end >= ds[0] && p.start <= ds.at(-1))
    .map((p) => ({ ...p, start: p.start < ds[0] ? ds[0] : p.start, end: p.end > ds.at(-1) ? ds.at(-1) : p.end }));
  const maxDepth = Math.max(1, ...evs.map((p) => p.depthPct));
  const concurrency = ds.map((_, i) => BIDS().filter((b) => pairsFor(b, rts).some((k) => d.promotions.depthByDay[k][a + i] > 0)).length);
  host.innerHTML = `
  ${intro(`The quarter as a calendar rather than a total. Each bar is one promotion on one listing; the darker the
    bar, the deeper the discount. Read down a column to see <b>who was in market on the same day</b> — the question a
    depth average cannot answer and the one that decides whether a promotion was competitive or merely expensive.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: "Promotions in window", dot: "#1a73e8", value: String(evs.length), note: `${evs.filter((p) => p.brand === S).length} of them ${SUBJ}` })}
    ${(() => { const n = d.dims.brands.length, thr = Math.max(2, n - 1);
      return kpi({ label: `Days with ${thr}+ of ${n} brands promoting`, dot: "#d93025", value: String(concurrency.filter((c) => c >= thr).length),
        note: `Of ${ds.length} days — the windows where a discount buys nothing but keeps you level` }); })()}
    ${kpi({ label: "Quiet days", dot: "#1e8e3e", value: String(concurrency.filter((c) => c <= 1).length),
      note: (() => { const q = longestRun(concurrency, (c) => c <= 1);
        return q.len ? `One brand or fewer in market — longest run ${q.len} day${q.len === 1 ? "" : "s"} from ${F.dateY(ds[q.at])}` : "Never fewer than two brands promoting at once"; })() })}
    ${kpi({ label: "Events on the retail calendar", dot: "#e37400", value: F.pct(evs.length ? (evs.filter((p) => p.onEvent).length / evs.length) * 100 : 0, 0),
      note: "Share of price events opening inside a Memorial Day / Prime Day / July 4th / back-to-school window" })}
  </div>
  ${card({ title: "Promotion calendar", help: "Every price event in the window on one grid, day by day. It is the picture a commercial calendar is planned from: where activity clusters, where it collides with the retail calendar, and where nothing is running at all.", sub: "Opacity is discount depth. Grey bands are the retail-calendar events. Hover any bar for the mechanic, the depth and the funder.",
    tag: `${evs.length} events`, tagCls: "acc",
    html: `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:13px">
        <div class="seg mini wrap" id="calMode">
          <button data-m="brand">By Brand</button><button data-m="model">${SUBJ} Models</button><button data-m="retailer">By Retailer</button><button data-m="mechanic">By Mechanic</button></div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-left:auto">${d.dims.promoFamilies.map((f) =>
          `<span class="cc-lg" title="${esc(f.note)}"><i style="background:${f.color}"></i>${f.label}</span>`).join("")}</div>
      </div>
      <div id="calChart"></div>
      <p class="mini" style="margin:11px 0 0">${d.dims.promoTypes.length} mechanics in ${d.dims.promoFamilies.length} families — ${d.dims.promoFamilies.map((f) => `<b style="color:var(--ink)">${f.label}</b> ${f.note.replace(/\.$/, "").toLowerCase()}`).join(" · ")}.</p>` })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "How crowded each day was", help: "The number of promotions live on each day across the whole set. A crowded day is one where a discount buys less attention, because everybody is discounting.", sub: `Number of brands running a price promotion simultaneously, out of ${d.dims.brands.length}. A day at the top of this axis is a market where nobody gains share and everybody loses margin.`, slot: "calConc" })}
    ${card({ title: "Promotional pressure by week", help: "The same activity summed by week, so a run of small events and one large one can be compared. It is the rhythm rather than the incident.", sub: "Share of each brand's listings on promotion, week by week. The warm rows are the brands that live on discount.", slot: "calHeat" })}
  </div>`;
  $$("#calMode button").forEach((b) => b.onclick = () => { calMode = b.dataset.m; drawCal(); });
  drawCal();
  function drawCal() {
    $$("#calMode button").forEach((b) => b.classList.toggle("on", b.dataset.m === calMode));
    let lanes = [];
    const mk = (list) => list.map((e, i) => ({ ...e, _i: i, color: famColor(e.type), intensity: e.depthPct / maxDepth,
      tip: `<div class="h">${MD(e.model).label} · ${RT(e.retailer).label}</div>
        <div class="r"><i style="background:${B(e.brand).color}"></i><span>${B(e.brand).label}</span><b>${typeLabel(e.type)}</b></div>
        <div class="r"><span>Depth</span><b class="tnum">${F.pct(e.depthPct)} · ${F.usd0(e.depthUsd)}</b></div>
        <div class="r"><span>Ran</span><b>${F.date(e.start)} – ${F.date(e.end)} (${e.days}d)</b></div>
        ${e.onEvent ? `<div class="vb">Opened inside ${(d.dims.events.find((x) => x.id === e.onEvent) || {}).label}</div>` : ""}` }));
    if (calMode === "brand") lanes = d.dims.brands.map((b) => ({ label: b.label, dot: b.color, subject: b.subject,
      sub: `${evs.filter((p) => p.brand === b.id).length}`, events: mk(evs.filter((p) => p.brand === b.id)) }));
    else if (calMode === "model") lanes = d.dims.models.filter((m) => m.brand === S).map((m) => ({ label: m.label, dot: B(S).color, subject: true,
      sub: `${evs.filter((p) => p.model === m.id).length}`, events: mk(evs.filter((p) => p.model === m.id)) }));
    else if (calMode === "retailer") lanes = d.dims.retailers.filter((r) => rts.includes(r.id)).map((r) => ({ label: r.label, dot: r.color,
      sub: `${evs.filter((p) => p.retailer === r.id).length}`, events: mk(evs.filter((p) => p.retailer === r.id)) }));
    else lanes = d.dims.promoTypes.filter((t) => evs.some((p) => p.type === t.id)).map((t) => ({ label: t.label, dot: famColor(t.id),
      sub: `${evs.filter((p) => p.type === t.id).length}`, events: mk(evs.filter((p) => p.type === t.id)) }));
    CC.calendar(el("calChart"), { dates: ds, lanes, bands: winBands(), corner: tc(calMode === "model" ? `${SUBJ} model` : calMode), laneWidth: 176 });
  }
  CC.line(el("calConc"), { height: 210, x: ds, bands: winBands(), area: true, max: d.dims.brands.length,
    fmtY: (v) => String(v), fmtV: (v) => `${v} of ${d.dims.brands.length} brands`,
    series: [{ id: "c", label: "Brands on promotion", color: "#d93025", data: concurrency }], legend: false });
  const wkAll = d.dims.weeks.slice(Math.floor(a / 7), Math.floor(z / 7) + 1);
  CC.heatmap(el("calHeat"), { rows: d.dims.brands, cols: wkAll, corner: "Brand ╲ Week", ramp: "red",
    rowLabel: (r) => r.label, rowDot: (r) => r.color, colLabel: (c) => F.date(c.start),
    fmtV: (v) => F.pct(v, 0), scaleNote: "Share of listings on promotion",
    value: (r, c) => { const w = d.dims.weeks.indexOf(c); const ks = pairsFor(r.id, rts); let on = 0, tot = 0;
      for (let i = w * 7; i < w * 7 + 7 && i < d.dims.dates.length; i++) for (const k of ks) { if (d.distribution.carriage[k][i] !== 1) continue; tot++; if (d.promotions.depthByDay[k][i] > 0) on++; }
      return tot ? (on / tot) * 100 : null; } });
  function longestRun(arr, test) { let best = { len: 0, at: 0 }, cur = 0;
    for (let i = 0; i < arr.length; i++) { if (test(arr[i])) { cur++; if (cur > best.len) best = { len: cur, at: i - cur + 1 }; } else cur = 0; }
    return best; }
};

/* ══════════════════════════════════════════════════════════════════════════
   TOTAL COST OF OWNERSHIP
   ══════════════════════════════════════════════════════════════════════════ */
let tcoFocus = null;
P.tco = (host) => {
  const d = D(), rts = retailerScope();
  const rows = d.tco.filter((t) => rts.includes(t.retailer));
  if (!tcoFocus || !rows.some((r) => r.model === tcoFocus.model && r.retailer === tcoFocus.retailer))
    tcoFocus = rows.filter((r) => r.brand === S).sort((a, b) => b.mechanics - a.mechanics)[0] || rows[0];
  const gapPct = (r) => ((r.shelf - r.effective) / r.shelf) * 100;
  const byBrand = d.dims.brands.map((b) => { const rs = rows.filter((r) => r.brand === b.id);
    return { b, shelf: mean(rs.map((r) => r.shelf)) || 0, eff: mean(rs.map((r) => r.effective)) || 0, gap: mean(rs.map(gapPct)) || 0,
      funded: mean(rs.map((r) => r.brandFunded)) || 0, n: rs.length }; });
  host.innerHTML = `
  ${intro(`A shelf price is not what changes hands. Every mechanic live on a page moves the number — a card offer and
    a trade-in pull it down, a protection plan pushes it up — and each is taken by only some share of buyers. This page
    weights each mechanic by its <b>attach rate</b> to get to what a buyer actually pays, and splits the give between
    the retailer and the brand. It is the difference between a price comparison and a margin conversation.`)}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpi({ label: `Mean ${SUBJ} shelf price`, dot: B(S).color, value: F.usd0(mean(rows.filter((r) => r.brand === S).map((r) => r.shelf))),
      note: `Across ${rows.filter((r) => r.brand === S).length} live listings` })}
    ${kpi({ label: "Attach-weighted outlay", dot: "#12b5cb", value: F.usd0(mean(rows.filter((r) => r.brand === S).map((r) => r.effective))),
      note: "What the buyer pays once every live mechanic is weighted by take-up" })}
    ${kpi({ label: "Gap to shelf", dot: "#e37400", value: F.pct(Math.abs(mean(rows.filter((r) => r.brand === S).map(gapPct)))),
      note: mean(rows.filter((r) => r.brand === S).map(gapPct)) < 0 ? `${SUBJ} buyers pay MORE than the shelf — attached plans outweigh the give` : "Shelf price overstates what is paid" })}
    ${kpi({ label: "Brand-funded per unit", dot: "#d93025", value: F.usd(mean(rows.filter((r) => r.brand === S).map((r) => r.brandFunded))),
      note: "The share of the give the brand carries rather than the retailer" })}
  </div>
  ${card({ title: "The bridge from list price to what is paid", help: "A waterfall from the manufacturer's list price to the shopper's actual outlay: the discount off the shelf, then accessories, protection, delivery and finance, each weighted by how often it is taken. It answers what the product costs to own, not what it costs to buy.", sub: "One listing, walked from MSRP through the shelf discount and then every mechanic live on the page, each weighted by its attach rate. Green lowers the shopper's outlay, red raises it. The axis starts below the lowest step so the small moves are visible.", tag: "TCO bridge", tagCls: "acc",
    html: `<div class="seg mini wrap" id="tcoPick" style="margin-bottom:12px"></div><div id="tcoWf"></div><div id="tcoLegend"></div>` })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Shelf against outlay, by brand", help: "The sticker beside the transaction. A brand with a wide gap looks dearer on a comparison page than it turns out to be at the till — and the reverse case is the more dangerous one.", sub: "How far the sticker sits from the transaction. A brand with a wide gap looks dearer on a comparison page than it is at the till — and the reverse.", slot: "tcoBars" })}
    ${card({ title: "Who funds the give", help: "How the promotional cost splits between what the brand funds and what the retailer funds. Two brands running the same discount depth can have entirely different margin outcomes.", sub: "The full give per unit — the shelf discount plus every attach-weighted mechanic — split between what the brand funds and what the retailer absorbs. A card offer is cheap for the brand; a straight markdown is not.", slot: "tcoFund" })}
  </div>
  ${card({ cls: "tcoTableCard", title: "Every listing, shelf to outlay", help: "The listing-level detail behind the bridge: every product at its shelf price and its modelled total outlay, sorted by the size of the gap between the two.", sub: "Click a row to bridge it. Sorted by the size of the gap.", html: table([
    { label: "Model", lft: true, get: (r) => `<span class="dot" style="background:${B(r.brand).color}"></span>${MD(r.model).label}` },
    { label: "Retailer", lft: true, get: (r) => RT(r.retailer).label },
    { label: "MSRP", get: (r) => F.usd0(r.msrp) },
    { label: "Shelf", get: (r) => `<b class="tnum">${F.usd(r.shelf)}</b>` },
    { label: "Give", get: (r) => r.give ? `<span style="color:var(--good)">−${F.usd(r.give)}</span>` : "—" },
    { label: "Add-ons", get: (r) => r.addon ? `<span style="color:var(--risk)">+${F.usd(r.addon)}</span>` : "—" },
    { label: "Outlay", get: (r) => `<b class="tnum">${F.usd(r.effective)}</b>` },
    { label: "Gap", get: (r) => `<span style="font-weight:700;color:${gapPct(r) >= 0 ? "var(--good)" : "var(--risk)"}">${(gapPct(r) >= 0 ? "−" : "+")}${F.pct(Math.abs(gapPct(r)))}</span>` },
    { label: "Brand-funded", get: (r) => F.usd(r.brandFunded) },
    { label: "Mechanics", get: (r) => String(r.mechanics) },
  ], rows.slice().sort((a, b) => Math.abs(gapPct(b)) - Math.abs(gapPct(a))).map((r) => ({ ...r, _subject: r.brand === S })), { maxH: "420px" }) })}
  ${card({ cls: "", title: "Attach rates behind the weighting", help: "The share of buyers assumed to take each add-on when it is offered. Every figure in the bridge above is weighted by these, so this is the assumption sheet for the whole page.", sub: "The share of buyers assumed to take each mechanic when it is offered, and the share of its face value the brand carries. These are modelling assumptions, stated here so the arithmetic can be argued with.", html: table([
    { label: "Mechanic", lft: true, get: (t) => `<span class="dot" style="background:${(d.dims.promoFamilies.find((f) => f.id === t.family) || {}).color}"></span>${t.label}` },
    { label: "Family", lft: true, get: (t) => (d.dims.promoFamilies.find((f) => f.id === t.family) || {}).label || "—" },
    { label: "Attach", get: (t) => F.pct(t.attach * 100, 0) },
    { label: "Brand-funded", get: (t) => F.pct(t.costToBrand * 100, 0) },
    { label: "What it is", lft: true, get: (t) => `<span class="mini">${t.note}</span>` },
  ], d.dims.promoTypes) })}
  <h2 class="sec">What the cost of ownership says</h2>${readsBlock("tco")}`;

  const opts = rows.filter((r) => r.brand === S).sort((a, b) => b.mechanics - a.mechanics).slice(0, 6)
    .concat(rows.filter((r) => r.brand !== S).sort((a, b) => b.mechanics - a.mechanics).slice(0, 4));
  el("tcoPick").innerHTML = opts.map((r) => `<button data-k="${r.model}|${r.retailer}">${MD(r.model).label} · ${RT(r.retailer).label}</button>`).join("");
  $$("#tcoPick button").forEach((btn) => btn.onclick = () => { const [m, rt] = btn.dataset.k.split("|");
    tcoFocus = rows.find((r) => r.model === m && r.retailer === rt); drawWf(); });
  drawWf();
  function drawWf() {
    $$("#tcoPick button").forEach((b) => b.classList.toggle("on", b.dataset.k === `${tcoFocus.model}|${tcoFocus.retailer}`));
    const steps = [{ label: "MSRP", value: tcoFocus.msrp, total: true, color: "#1f1f1f",
      tip: `<div class="h">Manufacturer list price</div><div class="r"><span>MSRP</span><b class="tnum">${F.usd0(tcoFocus.msrp)}</b></div>` }];
    if (Math.abs(tcoFocus.shelfCut) > 0.5) steps.push({ label: tcoFocus.shelfCut > 0 ? "Shelf discount" : "Shelf premium", value: -tcoFocus.shelfCut,
      tip: `<div class="h">${tcoFocus.shelfCut > 0 ? "Shelf discount" : "Shelf sits above list"}</div><div class="r"><span>MSRP</span><b class="tnum">${F.usd0(tcoFocus.msrp)}</b></div><div class="r"><span>Shelf price</span><b class="tnum">${F.usd(tcoFocus.shelf)}</b></div><div class="vb">Every buyer gets this one, so unlike the mechanics below it is not attach-weighted.</div>` });
    for (const c of tcoFocus.comps) steps.push({ label: c.label, value: c.dir === "up" ? c.weighted : -c.weighted,
      tip: `<div class="h">${c.label}</div><div class="r"><span>Face value</span><b class="tnum">${F.usd(c.face)}</b></div><div class="r"><span>Attach rate</span><b class="tnum">${F.pct(c.attach * 100, 0)}</b></div><div class="r"><span>Weighted</span><b class="tnum">${F.usd(c.weighted)}</b></div>${c.soft ? `<div class="vb">Non-price mechanic, valued at half its economic worth.</div>` : ""}` });
    steps.push({ label: "What is paid", value: tcoFocus.effective, total: true, color: "#1a73e8",
      tip: `<div class="h">Attach-weighted outlay</div><div class="r"><span>vs shelf</span><b class="tnum">${F.usd(tcoFocus.effective - tcoFocus.shelf)}</b></div><div class="r"><span>vs MSRP</span><b class="tnum">${F.pct(tcoFocus.vsMsrp)}</b></div>` });
    CC.waterfall(el("tcoWf"), { height: 300, steps });
    el("tcoLegend").innerHTML = `<p class="mini" style="margin:10px 0 0">
      ${MD(tcoFocus.model).label} at ${RT(tcoFocus.retailer).label} · ${tcoFocus.mechanics} live mechanic${tcoFocus.mechanics === 1 ? "" : "s"} ·
      ${F.usd(tcoFocus.brandFunded)} of the give is brand-funded, ${F.usd(tcoFocus.retailerFunded)} retailer-funded.</p>`;
  }
  CC.hbars(el("tcoBars"), { rows: byBrand.map((x) => ({ label: x.b.label, value: x.gap, color: x.b.color, subject: x.b.id === S,
    note: `${F.usd0(x.shelf)} shelf → ${F.usd0(x.eff)} paid`,
    tip: `<div class="h">${x.b.label}</div><div class="r"><span>Mean shelf</span><b class="tnum">${F.usd(x.shelf)}</b></div><div class="r"><span>Mean outlay</span><b class="tnum">${F.usd(x.eff)}</b></div><div class="r"><span>Listings</span><b class="tnum">${x.n}</b></div>` }))
    .sort((a, b) => b.value - a.value), fmtV: (v) => F.pct(v), max: Math.max(...byBrand.map((x) => Math.abs(x.gap))) });
  CC.bars(el("tcoFund"), { height: 240, stacked: true, cats: byBrand.map((x) => x.b.label), rotate: true, fmtV: F.usd, fmtY: F.usd0,
    series: [{ id: "brand", label: "Brand-funded", color: "#d93025", data: byBrand.map((x) => x.funded) },
             { id: "ret", label: "Retailer-funded", color: "#12b5cb", data: byBrand.map((x) => { const rs = rows.filter((r) => r.brand === x.b.id); return mean(rs.map((r) => r.retailerFunded)) || 0; }) }] });
  const tbl = $$(".page.on .tcoTableCard table.dt")[0];
  if (tbl) { const list = rows.slice().sort((a, b) => Math.abs(gapPct(b)) - Math.abs(gapPct(a)));
    $$("tbody tr", tbl).forEach((tr, i) => { tr.style.cursor = "pointer"; tr.onclick = () => { tcoFocus = list[i]; drawWf(); window.scrollTo({ top: 0, behavior: "smooth" }); }; }); }
};

/* ══════════════════════════════════════════════════════════════════════════
   PROMOTION STRATEGY
   ══════════════════════════════════════════════════════════════════════════ */
P.strategy = (host) => {
  const d = D(), rts = retailerScope(), ds = winDates(), [a] = win();
  const st = d.promotions.strategy;
  const famOf = (t) => (d.dims.promoTypes.find((x) => x.id === t) || {}).family;
  const evs = d.promotions.events.filter((p) => rts.includes(p.retailer) && !p.alwaysOn);
  const axes = [
    { id: "intensity", label: "Frequency" }, { id: "meanDepth", label: "Depth" }, { id: "meanDuration", label: "Duration" },
    { id: "mechanicsUsed", label: "Mechanics" }, { id: "retailerSpread", label: "Channels" }, { id: "onEventShare", label: "Calendar fit" },
  ];
  const normAx = (id, b) => { const v = BIDS().map((x) => st[x][id]); const lo = Math.min(...v), hi = Math.max(...v);
    return hi === lo ? 0.5 : 0.12 + ((st[b][id] - lo) / (hi - lo)) * 0.88; };
  const DAYMS = 86400000;
  const nearestOffset = (start) => {
    let best = null;
    for (const ev of d.dims.events) { const off = (Date.parse(start) - Date.parse(ev.start)) / DAYMS;
      if (Math.abs(off) <= 6 && (best === null || Math.abs(off) < Math.abs(best))) best = off; }
    return best;
  };
  const leadLag = BIDS().map((b) => {
    const offs = evs.filter((p) => p.brand === b).map((p) => nearestOffset(p.start)).filter((x) => x != null);
    return { b, offset: offs.length ? mean(offs) : null, n: offs.length }; });
  // The side-by-side table leads the page (Aashish, 2026-09-22): one row per brand, every
  // column defined in the card's "?" — each definition is how build-cco-dataset.mjs computes it.
  const sideBySide = card({ cls: "", title: "The strategies side by side",
    help: `The whole promotional posture of each brand in one table, one row per brand, over the retailers in scope. What each column is:
Days on promo — of the brand's listing-days in the window where the listing was carried, the share with a price promotion running. How often, not how deep.
Mean depth — the mean discount across only the listing-days actually on promotion, so it is not diluted by the days with nothing running.
Deepest — the discount of the brand's single deepest price event in the window.
Events — the number of episodic price events (a start, an end, a depth, a funder). Always-on mechanics such as protection, delivery and finance are not counted here.
Mean length — the mean number of days an episodic price event ran.
Mechanics — how many distinct promotional mechanics the brand ran, episodic and always-on together.
Retailers — how many retailers the brand's episodic price events ran at.
On calendar — the share of episodic price events that opened inside a retail-calendar window (the shaded bands on the charts).
Price index — street price as a percentage of MSRP, averaged across the brand's listings over the window; 100 means never discounted, lower means deeper and more frequent discounting.`,
    html: table([
    { label: "Brand", lft: true, get: (r) => `<span class="dot" style="background:${B(r.b).color}"></span>${B(r.b).label}` },
    { label: "Days on promo", get: (r) => `<b class="tnum">${F.pct(st[r.b].intensity)}</b>` },
    { label: "Mean depth", get: (r) => F.pct(st[r.b].meanDepth) },
    { label: "Deepest", get: (r) => F.pct(st[r.b].maxDepth) },
    { label: "Events", get: (r) => String(st[r.b].events) },
    { label: "Mean length", get: (r) => st[r.b].meanDuration == null ? "—" : st[r.b].meanDuration.toFixed(1) + "d" },
    { label: "Mechanics", get: (r) => String(st[r.b].mechanicsUsed) },
    { label: "Retailers", get: (r) => String(st[r.b].retailerSpread) },
    { label: "On calendar", get: (r) => F.pct(st[r.b].onEventShare, 0) },
    { label: "Price index", get: (r) => F.pct(sc("priceIndex", r.b).value) },
  ], BIDS().map((b) => ({ b, _subject: b === S }))) });
  host.innerHTML = `
  ${intro(`Six dimensions describe how a brand promotes: how often, how deep, for how long, with how many mechanics,
    across how many channels, and how tightly it hugs the retail calendar. Two brands can spend the same and be
    running <b>completely different strategies</b> — the table reads them side by side, and the shapes below show which one you are up against.`)}
  <div style="margin-bottom:14px">${sideBySide}</div>
  <div class="grid g5" style="margin-bottom:14px">
    ${d.dims.brands.map((b) => kpi({ label: b.label, dot: b.color,
      value: F.pct(st[b.id].intensity), unit: "",
      note: `${F.pct(st[b.id].meanDepth)} mean depth · ${st[b.id].events} events · ${st[b.id].mechanicsUsed} mechanics` })).join("")}
  </div>
  <div class="grid g2">
    ${card({ title: "Promotional shape", help: "A radar of how a brand promotes — frequency, depth, breadth, mechanic variety, retailer spread — each axis rescaled across the set. Two brands can spend the same amount and have opposite shapes.", sub: "One shape per brand over the same grey category average. Each axis is scaled across the set, so the outer edge is the most of that dimension in the category, not an absolute.", slot: "stRadar" })}
    ${card({ title: "Frequency against depth", help: "How often a brand discounts against how much it gives when it does. The two together are the strategy: frequent-and-shallow teaches a shopper to wait for nothing in particular, rare-and-deep teaches them to wait for the event.", sub: "The strategy map. Bottom-left holds price and promotes rarely; top-right is always-on and deep. There is no wrong quadrant, only a wrong one for your margin structure.", slot: "stScatter" })}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Mechanic mix by brand", help: "Column width is the brand's share of all price-event days in the window; height is the mechanic mix behind them. A narrow column that is all price give is a different problem from a wide one that is all finance.", sub: "Column width is the brand's share of all price-event days in the window; height is the mechanic mix behind them. A narrow column that is all price give is a different problem from a wide one that is all finance.", slot: "stMekko" })}
    ${card({ title: "Who moves first", help: "Which brand opens a promotional window and which brands follow it, and by how many days. It separates the price leader from the responders.", sub: "Mean days between a retail-calendar moment opening and the brand's promotion starting, across every event that opened within six days of one. Negative is early — it sets the price the others answer. Positive follows.", slot: "stLead" })}
  </div>`;

  const stAvg = axes.map((ax) => mean(BIDS().map((x) => normAx(ax.id, x))));
  el("stRadar").innerHTML = `<div style="display:grid;grid-template-columns:repeat(${d.dims.brands.length <= 4 ? 2 : 3},minmax(0,1fr));gap:18px 22px">${
    d.dims.brands.map((b) => `<div><div style="font-size:11px;font-weight:700;text-align:center;color:${b.color};margin-bottom:2px">${b.label}</div><div id="sr-${b.id}"></div></div>`).join("")}</div>`;
  for (const b of d.dims.brands) CC.radar(el("sr-" + b.id), { size: d.dims.brands.length <= 4 ? 178 : 152, legend: false, axes,
    series: [{ id: "avg", label: "Category average", color: "#bdc1c6", values: stAvg, raw: axes.map((ax) => mean(BIDS().map((x) => st[x][ax.id]))) },
             { id: b.id, label: b.label, color: b.color, subject: true, values: axes.map((ax) => normAx(ax.id, b.id)), raw: axes.map((ax) => st[b.id][ax.id]) }] });
  CC.scatter(el("stScatter"), { height: 280, xLabel: "Share of listing-days on promotion", yLabel: "Mean discount depth",
    fmtX: (v) => F.pct(v, 0), fmtY: (v) => F.pct(v, 0),
    quadrant: { x: mean(BIDS().map((b) => st[b].intensity)), y: mean(BIDS().map((b) => st[b].meanDepth)),
      labels: [{ x: "l", y: "t", text: "RARE BUT DEEP" }, { x: "r", y: "t", text: "ALWAYS ON, DEEP" }, { x: "l", y: "b", text: "PRICE HELD" }, { x: "r", y: "b", text: "ALWAYS ON, SHALLOW" }] },
    points: d.dims.brands.map((b) => ({ label: b.label, tag: b.label.split(" ")[0], color: b.color,
      x: st[b.id].intensity, y: st[b.id].meanDepth, r: st[b.id].events,
      tip: `<div class="h">${b.label}</div><div class="r"><span>Days on promo</span><b class="tnum">${F.pct(st[b.id].intensity)}</b></div><div class="r"><span>Mean depth</span><b class="tnum">${F.pct(st[b.id].meanDepth)}</b></div><div class="r"><span>Events</span><b class="tnum">${st[b.id].events}</b></div><div class="r"><span>Price index</span><b class="tnum">${F.pct(sc("priceIndex", b.id).value)}</b></div>` })) });
  CC.mekko(el("stMekko"), { height: 260, fmtW: (v) => F.pct(v),
    cols: d.dims.brands.map((b) => { const mix = st[b.id].mechanicMix;
      const byFam = {}; for (const [t, v] of Object.entries(mix)) { const f = famOf(t); byFam[f] = (byFam[f] || 0) + v; }
      const promoDays = evs.filter((p) => p.brand === b.id).reduce((x, p) => x + p.days, 0);
      return { label: b.label, weight: promoDays,
        parts: d.dims.promoFamilies.map((f) => ({ id: f.id, label: f.label, color: f.color, value: byFam[f.id] || 0 })) }; }) });
  CC.hbars(el("stLead"), { rows: leadLag.filter((x) => x.offset != null).map((x) => ({ label: B(x.b).label, value: x.offset, color: B(x.b).color, subject: x.b === S,
    note: `${x.n} event${x.n === 1 ? "" : "s"} opening within six days of a calendar moment`,
    tip: `<div class="h">${B(x.b).label}</div><div class="r"><span>Mean offset</span><b class="tnum">${x.offset > 0 ? "+" : ""}${x.offset.toFixed(1)} days</b></div><div class="vb">${x.offset < 0 ? "Opens before the event window — sets the price the others answer." : "Opens after the event window has started — follows."}</div>` }))
    .sort((a, b) => a.value - b.value), fmtV: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "d", max: Math.max(...leadLag.filter((x) => x.offset != null).map((x) => Math.abs(x.offset))) });
};

/* ══════════════════════════════════════════════════════════════════════════
   METHOD — what is measured, what is modelled, and where the line is
   ══════════════════════════════════════════════════════════════════════════ */
P.method = (host) => {
  const d = D(), dis = d.meta.disclosure;
  // The third line used to read "One lane has no measurement at all" — true when
  // traffic carried no anchor, and quietly false the day it got one. Counted
  // from the ledger now, and dropped when the count is zero.
  const noAnchor = dis.anchors.filter((x) => x.unmeasured);
  const measuredOnly = (d.meta.provenance || {}).mode === "measured-only";
  host.innerHTML = `
  ${intro(`<b>${esc(dis.headline)}</b> ${esc(dis.body)}`,
    `<div class="card" style="min-width:260px;border-color:#fdd663;background:linear-gradient(168deg,#fffdf6,#fef7e0)">
      <div class="card-h"><div class="ct"><h3>Read this first</h3><p>The disclosure applies to every screen in the rail, not only this one.</p></div></div>
      <div class="cc-hb">
        <div class="cc-hb-row" style="grid-template-columns:auto 1fr;gap:9px"><span class="dot" style="background:#1e8e3e;width:10px;height:10px"></span><span class="lb">${measuredOnly ? "Every figure is read from a named source" : "Levels are pinned to a capture"}</span></div>
        <div class="cc-hb-row" style="grid-template-columns:auto 1fr;gap:9px"><span class="dot" style="background:#e37400;width:10px;height:10px"></span><span class="lb">${measuredOnly ? "Daily lines are daily readings; single readings are drawn flat" : "Shapes over time are modelled"}</span></div>
        ${noAnchor.length ? `<div class="cc-hb-row" style="grid-template-columns:auto 1fr;gap:9px"><span class="dot" style="background:#d93025;width:10px;height:10px"></span><span class="lb">${noAnchor.length === 1 ? "One lane has" : `${noAnchor.length} lanes have`} no measurement at all — ${noAnchor.map((x) => esc(x.lane)).join(", ")}</span></div>` : `<div class="cc-hb-row" style="grid-template-columns:auto 1fr;gap:9px"><span class="dot" style="background:#d93025;width:10px;height:10px"></span><span class="lb">Where nothing was measured, the figure is withheld — never filled</span></div>`}
      </div></div>`)}
  ${card({ title: "The anchor ledger", help: measuredOnly ? "Source by source: what was read, where from, and which figures it produces. A lane with no source is listed as not measured and left blank." : "Lane by lane: what was actually measured, the capture it came from, and which part of the simulation it pins. A lane with no anchor is marked as such rather than left looking like the rest.", sub: measuredOnly ? "Source by source: what was read, where from, and which figures it produces. Lanes with no source are listed as not measured." : "Lane by lane: what was actually measured, where it came from, and which part of the simulation it pins. A lane with no anchor is marked as such.", tag: `${dis.anchors.length} lanes`, tagCls: "acc",
    html: `<div class="dt-wrap"><table class="dt anchor-tbl">
      <thead><tr><th class="lft">Lane</th><th class="lft">What was measured</th><th class="lft">Source</th><th class="lft">What it pins</th></tr></thead>
      <tbody>${dis.anchors.map((x) => `<tr class="${x.unmeasured ? "" : ""}" ${x.unmeasured ? 'style="background:#fef7e0"' : ""}>
        <td class="lft">${esc(x.lane)}${x.unmeasured ? ` <span class="tag risk" style="margin-left:4px">${(d.meta.provenance || {}).mode === "hybrid" ? "modelled" : "no anchor"}</span>` : ""}</td>
        <td class="lft" style="white-space:normal;max-width:340px">${esc(x.measured)}</td>
        <td class="lft mini" style="white-space:normal;max-width:230px;font-family:var(--fm);font-size:10.5px">${esc(x.source)}</td>
        <td class="lft" style="white-space:normal;max-width:400px;color:var(--soft)">${esc(x.pins)}</td></tr>`).join("")}</tbody></table></div>` })}
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "How the simulation is constrained", help: "The rules the extrapolation runs under — what may be modelled, what may not, and where a value has to be withheld instead of estimated.", html: `<div class="prose" style="font-size:14px">
      <p><b>Prices step, they do not drift.</b> Each model-retailer pair carries a price ladder that re-sets every nine to
      twenty-four days and holds in between, because that is how a retail price behaves. The ladder is then scaled so it
      lands on the captured PDP price at the capture date.</p>
      <p><b>Depth is bounded by the brand's own measured behaviour.</b> The discount ceiling for each brand comes from its
      measured discount rate, listed in the Pricing row of the ledger above rather than repeated here — a number
      restated in two places is a number that can disagree with itself. A brand never seen discounting cannot be
      simulated running 40% off.</p>
      <p><b>Out-of-stocks arrive as episodes, not as noise.</b> They cluster after deep promotions, and they stretch the
      delivery promise on the same listing, because a simulation where lanes do not talk to each other teaches nothing.</p>
      <p><b>Share sums to 100.</b> AI answer share is normalised across the five brands every day, so a gain for one is a
      loss for another — you cannot read a rising line as the category growing.</p>
      <p><b>Nothing is random twice.</b> The generator is seeded; re-running it produces a byte-identical payload.</p></div>` })}
    ${card({ title: "How the copy is kept honest", help: "Every rank and superlative on this dashboard is computed from the same object the chart reads rather than typed beside it. This is the mechanism, and the checks that fail a build if it lapses.", html: `<div class="prose" style="font-size:14px">
      <p>Every rank and superlative on these pages is <b>computed from the same object the chart reads</b>, at build time,
      by a function that handles ties and names the ends of the scale. Nothing that reads like "the shallowest of the
      ${d.dims.brands.length}" or "second-least paid-reliant" was typed.</p>
      <p>This matters more than it sounds. A rank written into fixed copy stays on the page long after the number beside
      it has moved, and no data check fires — the JSON is still valid, the sentence is simply no longer true. On an
      earlier build of this dataset, a rank on an inverted measure read "first of the five on promotional intensity",
      which said the opposite of what the number meant: the subject promoting <em>least</em> read as promoting most.</p>
      <p>Colour is computed too.${d.meta.disclosure.paletteNote ? ` The brands do not wear their marketing colours here: ${esc(d.meta.disclosure.paletteNote)}` : ""}
      The slots in use were run through a palette validator and pass the lightness band, the chroma floor, all-pairs
      colour-vision separation, the normal-vision floor and contrast against the chart surface.</p></div>` })}
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${card({ title: "Dimensions in the panel", help: "The shape of the dataset behind every screen: brands, models, retailers, cities, engines, terms and days, and what each dimension contains.", html: `<div class="cc-hb">${[
      ["Days", d.dims.dates.length, `${F.dateY(d.meta.window.start)} – ${F.dateY(d.meta.window.end)}`],
      ["Weeks", d.dims.weeks.length, "Whole weeks, Monday to Sunday"],
      ["Brands", d.dims.brands.length, d.dims.brands.map((b) => b.label).join(", ")],
      ["Models", d.dims.models.length, `${d.dims.models.filter((m) => m.brand === S).length} ${SUBJ}, ${d.dims.models.length - d.dims.models.filter((m) => m.brand === S).length} competitive`],
      ["Retailers", d.dims.retailers.length, d.dims.retailers.map((r) => r.label).join(", ")],
      ["Cities", d.dims.cities.length, d.dims.cities.map((c) => c.label.split(",")[0]).join(", ")],
      ["AI engines", d.dims.engines.length, d.dims.engines.map((e) => e.label).join(", ")],
      ["Search terms", d.dims.terms.length, d.dims.terms.map((t) => t.label).join(", ")],
      ["Promotion mechanics", d.dims.promoTypes.length, `In ${d.dims.promoFamilies.length} families`],
      ["Live listings", Object.keys(d.distribution.carriage).filter((k) => d.distribution.carriage[k]).length, "Model × retailer pairs with a listing"],
      ["Promotion events", d.promotions.events.length, `${d.promotions.events.filter((p) => !p.alwaysOn).length} episodic, ${d.promotions.events.filter((p) => p.alwaysOn).length} always-on`],
      ["Computed reads", Object.values(d.reads).reduce((x, r) => x + r.length, 0), `Across ${Object.keys(d.reads).length} drivers`],
    ].map(([k, v, note]) => `<div class="cc-hb-row" style="grid-template-columns:minmax(120px,1fr) auto;gap:12px">
      <span class="lb">${k}<em>${esc(note)}</em></span><b class="tnum vv">${F.n(v)}</b></div>`).join("")}</div>` })}
    ${!d.meta.sourceReports.length ? "" : card({ title: "The reports this is built on", help: "The delivered captures this dashboard extrapolates from. Every anchored figure on it traces back to one of these.", sub: "The measured snapshots behind the anchor ledger. Both are live client deliverables.", html: `<div class="cc-hb">${
      d.meta.sourceReports.map((r) => `<a class="cc-hb-row" href="${r.url}" target="_blank" rel="noopener" style="grid-template-columns:1fr auto;gap:12px;text-decoration:none">
        <span class="lb">${esc(r.label)}<em>${esc(r.url.replace("https://", ""))}</em></span><b class="vv" style="color:var(--accent)">Open →</b></a>`).join("")}</div>
      <p class="mini" style="margin:12px 0 0">Snapshot dates — multi-retailer capture ${F.dateY(d.meta.snapshotDates.multiRetailer.slice(0, 10))}; launch report ${F.dateY(d.meta.snapshotDates.launchReport.slice(0, 10))}${(d.meta.snapshotDates.priceHistoryMonths || []).length ? `; price history ${d.meta.snapshotDates.priceHistoryMonths[0]} to ${d.meta.snapshotDates.priceHistoryMonths.at(-1)}` : ""}.</p>` })}
  </div>
  <div class="foot">
    <span>BrandContext · Atlas</span><span>${esc(d.meta.title)}</span>
    <span>Window ${F.dateY(d.meta.window.start)} – ${F.dateY(d.meta.window.end)}</span>
    <a href="#scorecard">Back to the scorecard</a>
  </div>`;
};
})();
