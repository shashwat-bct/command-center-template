/* ===========================================================================
   COMMAND CENTRE — "Underlying data": the captured retailer pages behind the
   shelf, landing-page, pricing, promotion, availability and delivery figures.
   ---------------------------------------------------------------------------
   Reads the manifest named by <body data-snapshots="…"> (built by
   scripts/insights/build-snapshot-manifest.mjs), adds an "Underlying data"
   button to the shell's top bar, and opens a left-hand panel: a grid of
   snapshots — filterable by lane, retailer, brand, product and date, grouped
   by date, brand, product or lane — each with the read marked in red, and a
   viewer for the full capture with every mark listed.

   Every box drawn here is a rect the capture stored at capture time or an
   outline the capture burned into the image; the panel adds nothing.
   The lane defaults to the page the viewer is on.
   =========================================================================== */
(() => {
  const SRC = document.body.dataset.snapshots;
  if (!SRC) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtD = (d) => { if (!d) return "—"; const [y, m, dd] = d.split("-"); return `${+dd} ${MON[+m - 1]} ${y}`; };
  const fmtT = (iso) => { if (!iso) return "—"; const d = new Date(iso); return `${fmtD(iso.slice(0, 10))} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
  const P = (n) => `${(n * 100).toFixed(3)}%`;
  const RATIO = 3 / 4;   // every thumbnail is a 4:3 window

  let M = null, LIST = [], CUR = -1, PAGE_LANE = {};
  const F = { lane: "all", retailer: "all", brand: "all", product: "all", date: "all", group: "date" };
  const loading = fetch(SRC).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((j) => { M = j; (j.lanes || []).forEach((l) => (l.pages || []).forEach((p) => { PAGE_LANE[p] = l.id; })); return j; });

  /* ── mount ─────────────────────────────────────────────────────────────── */
  function mount() {
    const host = $("#topCC") || $(".top-r");
    if (!host || $("#snapBtn")) return;
    const btn = h(`<button class="databtn" id="snapBtn" title="The captured retailer pages behind these figures, with each read marked"><i></i>Underlying data<span class="n" id="snapN"></span></button>`);
    const sim = $("#simBtn");
    if (sim && sim.parentElement === host) host.insertBefore(btn, sim); else host.appendChild(btn);

    document.body.appendChild(h(`<div id="snapScrim"></div>`));
    document.body.appendChild(h(`
      <aside id="snapPanel" role="dialog" aria-modal="true" aria-labelledby="snapTitle" aria-hidden="true">
        <div class="sp-h">
          <div>
            <h3 id="snapTitle"><i></i>Underlying data · the captured retailer pages</h3>
            <p id="snapSub">Every figure on the shelf, landing-page, pricing, promotion, availability and delivery pages is read off a captured retailer page — one visit each, US residential, nothing clicked. These are those captures. The red box is the read: the capture recorded where on the page it took each one, or outlined it in the page before the screenshot. Nothing is marked after the fact.</p>
          </div>
          <button class="dr-x" id="snapX" aria-label="Close">×</button>
        </div>
        <div class="sp-f">
          <div class="grp"><span class="lbl">Lane</span><div class="seg mini" id="snapLane" role="group" aria-label="Lane"></div></div>
          <div class="grp"><span class="lbl">Retailer</span><div class="selw"><select class="sel" id="snapRet" aria-label="Retailer"></select></div></div>
          <div class="grp"><span class="lbl">Brand</span><div class="seg mini" id="snapBrand" role="group" aria-label="Brand"></div></div>
          <div class="grp"><span class="lbl">Product</span><div class="selw"><select class="sel" id="snapProd" aria-label="Product"></select></div></div>
          <div class="grp"><span class="lbl">Date</span><div class="selw"><select class="sel" id="snapDate" aria-label="Capture date"></select></div></div>
          <div class="grp"><span class="lbl">Group by</span><div class="seg mini" id="snapGroup" role="group" aria-label="Group by">
            <button data-g="date">Date</button><button data-g="brand">Brand</button><button data-g="product">Product</button><button data-g="lane">Lane</button></div></div>
        </div>
        <div class="sp-count" id="snapCount"></div>
        <div class="sp-b" id="snapGrid"></div>
      </aside>`));
    document.body.appendChild(h(`
      <div id="snapView" role="dialog" aria-modal="true" aria-labelledby="svTitle">
        <div class="sv">
          <div class="sv-img" id="svImg"></div>
          <button class="sv-nav prev" id="svPrev" aria-label="Previous snapshot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
          <button class="sv-nav next" id="svNext" aria-label="Next snapshot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
          <div class="sv-side">
            <div class="sv-h"><div><h3 id="svTitle">—</h3><p class="sub" id="svSub"></p></div><button class="dr-x" id="svX" aria-label="Close">×</button></div>
            <div class="sv-b" id="svBody"></div>
            <div class="sv-foot"><span class="pos" id="svPos"></span><button id="svRaw">Open the raw capture ↗</button><button id="svLive" hidden>Open the live page ↗</button></div>
          </div>
        </div>
      </div>`));

    btn.addEventListener("click", () => open(true));
    $("#snapX").addEventListener("click", close);
    $("#snapScrim").addEventListener("click", close);
    $("#svX").addEventListener("click", closeView);
    $("#svPrev").addEventListener("click", () => view(CUR - 1));
    $("#svNext").addEventListener("click", () => view(CUR + 1));
    $("#snapView").addEventListener("click", (e) => { if (e.target.id === "snapView") closeView(); });
    $("#svRaw").addEventListener("click", () => { const e = LIST[CUR]; if (e) window.open(e.img, "_blank", "noopener"); });
    $("#svLive").addEventListener("click", () => { const e = LIST[CUR]; if (e && e.url) window.open(e.url, "_blank", "noopener"); });
    $("#snapGroup").addEventListener("click", (e) => { const b = e.target.closest("button[data-g]"); if (!b) return; F.group = b.dataset.g; render(); });
    $("#snapRet").addEventListener("change", (e) => { F.retailer = e.target.value; render(); });
    $("#snapProd").addEventListener("change", (e) => { F.product = e.target.value; render(); });
    $("#snapDate").addEventListener("change", (e) => { F.date = e.target.value; render(); });
    $("#snapGrid").addEventListener("click", (e) => { const c = e.target.closest(".snap[data-i]"); if (c) view(+c.dataset.i); });
    document.addEventListener("keydown", (e) => {
      if ($("#snapView").classList.contains("on")) {
        if (e.key === "Escape") closeView(); else if (e.key === "ArrowLeft") view(CUR - 1); else if (e.key === "ArrowRight") view(CUR + 1);
        return;
      }
      if (e.key === "Escape" && $("#snapPanel").classList.contains("on")) close();
    });
    loading.then((j) => { $("#snapN").textContent = j.entries.length; }).catch((err) => { console.error("[snapshots] manifest failed", err); btn.hidden = true; });
  }

  /* ── open / close ──────────────────────────────────────────────────────── */
  function open(fromPage) {
    loading.then(() => {
      if (fromPage) {
        const page = (location.hash || "#scorecard").slice(1);
        F.lane = PAGE_LANE[page] || "all";
        F.brand = "all"; F.product = "all"; F.date = "all";
      }
      buildControls();
      render();
      $("#snapPanel").classList.add("on"); $("#snapPanel").setAttribute("aria-hidden", "false");
      $("#snapScrim").classList.add("on");
      $("#snapGrid").scrollTop = 0;
    }).catch(() => {});
  }
  function close() { $("#snapPanel").classList.remove("on"); $("#snapPanel").setAttribute("aria-hidden", "true"); $("#snapScrim").classList.remove("on"); }

  /* ── controls ──────────────────────────────────────────────────────────── */
  const laneOf = (id) => (M.lanes || []).find((l) => l.id === id);
  function buildControls() {
    const lanes = $("#snapLane");
    lanes.innerHTML = `<button data-l="all">All<b>${M.entries.length}</b></button>` + M.lanes.map((l) => `<button data-l="${l.id}">${esc(l.label)}<b>${l.n}</b></button>`).join("");
    lanes.onclick = (e) => { const b = e.target.closest("button[data-l]"); if (!b) return; F.lane = b.dataset.l; render(); };
    const brands = $("#snapBrand");
    brands.innerHTML = `<button data-b="all">All</button>` + M.brands.map((b) => `<button data-b="${b.id}">${esc(b.label)}<b>${b.n}</b></button>`).join("");
    brands.onclick = (e) => { const b = e.target.closest("button[data-b]"); if (!b) return; F.brand = b.dataset.b; F.product = "all"; render(); };
    const ret = $("#snapRet");
    ret.innerHTML = (M.retailers.length > 1 ? `<option value="all">All retailers</option>` : "") + M.retailers.map((r) => `<option value="${r.id}">${esc(r.label)} · ${r.n}</option>`).join("");
    F.retailer = M.retailers.length > 1 ? F.retailer : M.retailers[0].id;
  }
  const passes = (e, skip) => (skip === "lane" || F.lane === "all" || e.lane === F.lane)
    && (skip === "retailer" || F.retailer === "all" || e.retailer === F.retailer)
    && (skip === "brand" || F.brand === "all" || e.brand === F.brand)
    && (skip === "product" || F.product === "all" || e.product === F.product)
    && (skip === "date" || F.date === "all" || e.date === F.date);
  function syncControls() {
    $$("#snapLane button").forEach((b) => b.classList.toggle("on", b.dataset.l === F.lane));
    $$("#snapBrand button").forEach((b) => b.classList.toggle("on", b.dataset.b === F.brand));
    $$("#snapGroup button").forEach((b) => b.classList.toggle("on", b.dataset.g === F.group));
    $("#snapRet").value = F.retailer;
    // the product and date lists only offer what the other filters leave
    const prods = new Map(); M.entries.filter((e) => passes(e, "product")).forEach((e) => prods.set(e.product, (prods.get(e.product) || 0) + 1));
    if (F.product !== "all" && !prods.has(F.product)) F.product = "all";
    const pk = [...prods.keys()].sort((a, b) => a.localeCompare(b));
    $("#snapProd").innerHTML = `<option value="all">All products · ${pk.length}</option>` + pk.map((p) => `<option value="${esc(p)}">${esc(p)} · ${prods.get(p)}</option>`).join("");
    $("#snapProd").value = F.product;
    const dates = new Map(); M.entries.filter((e) => passes(e, "date")).forEach((e) => dates.set(e.date, (dates.get(e.date) || 0) + 1));
    if (F.date !== "all" && !dates.has(F.date)) F.date = "all";
    const dk = [...dates.keys()].sort((a, b) => b.localeCompare(a));
    $("#snapDate").innerHTML = `<option value="all">All dates · ${dk.length}</option>` + dk.map((d) => `<option value="${d}">${fmtD(d)} · ${dates.get(d)}</option>`).join("");
    $("#snapDate").value = F.date;
  }

  /* ── grid ──────────────────────────────────────────────────────────────── */
  const brandLabel = (id) => (M.brands.find((b) => b.id === id) || {}).label || id;
  const retLabel = (id) => (M.retailers.find((r) => r.id === id) || {}).label || id;
  function render() {
    syncControls();
    LIST = M.entries.filter((e) => passes(e));
    const marks = LIST.reduce((s, e) => s + e.boxes.length, 0);
    const dates = [...new Set(LIST.map((e) => e.date))].sort();
    const brands = new Set(LIST.map((e) => e.brand)), prods = new Set(LIST.map((e) => e.product));
    const lane = F.lane !== "all" && laneOf(F.lane);
    $("#snapCount").innerHTML = `<span><b>${LIST.length}</b> of ${M.entries.length} snapshots</span><i class="dot"></i><span><b>${marks}</b> marked reads</span><i class="dot"></i>`
      + `<span>${[...new Set(LIST.map((e) => retLabel(e.retailer)))].join(", ") || "—"}</span><i class="dot"></i>`
      + `<span>${dates.length ? (dates.length === 1 ? fmtD(dates[0]) : `${fmtD(dates[0])} – ${fmtD(dates[dates.length - 1])}`) : "—"}</span><i class="dot"></i>`
      + `<span>${brands.size} brand${brands.size === 1 ? "" : "s"} · ${prods.size} product${prods.size === 1 ? "" : "s"}</span>`
      + (lane ? `<i class="dot"></i><span class="lanewhat">${esc(lane.what)}</span>` : "");
    const grid = $("#snapGrid"); grid.innerHTML = "";
    if (!LIST.length) { grid.innerHTML = `<div class="sp-empty">No captures match — widen a filter.</div>`; return; }
    const keyOf = { date: (e) => e.date, brand: (e) => e.brand, product: (e) => `${e.brand}|${e.product}`, lane: (e) => e.lane }[F.group];
    const titleOf = { date: (k) => fmtD(k), brand: (k) => brandLabel(k), product: (k) => { const [b, p] = k.split("|"); return `${brandLabel(b)} ${p}`; }, lane: (k) => (laneOf(k) || {}).label || k }[F.group];
    const groups = new Map();
    LIST.forEach((e, i) => { const k = keyOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    let keys = [...groups.keys()];
    if (F.group === "date") keys.sort((a, b) => b.localeCompare(a));
    else if (F.group === "brand") keys.sort((a, b) => M.brands.findIndex((x) => x.id === a) - M.brands.findIndex((x) => x.id === b));
    else if (F.group === "lane") keys.sort((a, b) => M.lanes.findIndex((x) => x.id === a) - M.lanes.findIndex((x) => x.id === b));
    else keys.sort((a, b) => (M.brands.findIndex((x) => x.id === a.split("|")[0]) - M.brands.findIndex((x) => x.id === b.split("|")[0])) || a.localeCompare(b));
    for (const k of keys) {
      const ix = groups.get(k);
      grid.appendChild(h(`<section class="sp-g"><h4><b>${esc(titleOf(k))}</b><span>${ix.length} snapshot${ix.length === 1 ? "" : "s"}</span></h4><div class="sp-grid">${ix.map((i) => card(LIST[i], i)).join("")}</div></section>`));
    }
  }
  // The thumbnail is the capture's focus window (a 4:3 crop the builder cut
  // around the marks), letterboxed when the crop is a different shape, with
  // the boxes positioned in the same window's coordinates.
  function card(e, i) {
    const f = e.focus, fit = Math.min(1 / f.w, RATIO / f.h);
    const ox = (1 - f.w * fit) / 2, oy = (RATIO - f.h * fit) / 2;
    const img = `<img src="${esc(e.thumb.src)}" alt="" loading="lazy" decoding="async" style="width:${P(f.w * fit)};left:${P(ox)};top:${P(oy / RATIO)}">`;
    const boxes = e.boxes.map((b, n) => {
      if (b.x + b.w < f.x || b.y + b.h < f.y || b.x > f.x + f.w || b.y > f.y + f.h) return "";
      return `<i class="bx" style="left:${P(ox + (b.x - f.x) * fit)};top:${P((oy + (b.y - f.y) * fit) / RATIO)};width:${P(b.w * fit)};height:${P(b.h * fit / RATIO)}">${e.boxes.length > 1 ? `<b>${n + 1}</b>` : ""}</i>`;
    }).join("");
    const lane = laneOf(e.lane) || { label: e.lane };
    return `<button class="snap" data-i="${i}" title="Open this capture">
      <div class="thumb">${img}${boxes}${e.baked ? `<span class="tag">marked in capture</span>` : ""}</div>
      <div class="cap">
        <div class="l1"><span class="lane">${esc(lane.label)}</span><span class="pr">${esc(e.brandLabel)} ${esc(e.product)}</span></div>
        <div class="l2">${esc(retLabel(e.retailer))} · ${fmtD(e.date)}${e.city ? ` · ${esc(e.city)} ${esc(e.zip || "")}` : ""}</div>
        <div class="rd" title="${esc(e.read)}">${esc(e.read)}</div>
      </div></button>`;
  }

  /* ── viewer ────────────────────────────────────────────────────────────── */
  function view(i) {
    if (i < 0 || i >= LIST.length) return;
    CUR = i; const e = LIST[i];
    const lane = laneOf(e.lane) || { label: e.lane, what: "" };
    $("#svTitle").textContent = `${e.brandLabel} ${e.product}${e.city ? ` · ${e.city}` : ""}`;
    $("#svSub").textContent = `${lane.label} · ${retLabel(e.retailer)} · ${fmtT(e.capturedAt)}`;
    // the image at the panel's width; a small crop (the delivery line) at up to three times its size
    const small = e.w < 700;
    const quiet = e.boxes.length > 4 ? " quiet" : "";
    $("#svImg").innerHTML = `<div class="wrap${small ? " fit" : ""}"${small ? ` style="width:min(100%,${e.w * 3}px)"` : ""}><img src="${esc(e.img)}" alt="" decoding="async">${e.boxes.map((b, n) =>
      `<i class="bx${quiet}" data-n="${n}" style="left:${P(b.x / e.w)};top:${P(b.y / e.h)};width:${P(b.w / e.w)};height:${P(b.h / e.h)}"><b>${n + 1}</b><em>${esc(b.label)}</em></i>`).join("")}</div>`;
    $("#svBody").innerHTML = `
      <div class="k">What was read</div><div class="v read">${esc(e.read)}</div>
      ${e.boxes.length ? `<div class="k">Marks · ${e.boxes.length}</div><ul class="sv-marks">${e.boxes.map((b, n) => `<li data-n="${n}"><b>${n + 1}</b><div><span>${esc(b.label)}</span>${b.text ? `<small>${esc(b.text)}</small>` : ""}</div></li>`).join("")}</ul>` : ""}
      ${e.bakedNote ? `<div class="k">How it was marked</div><div class="v mute">${esc(e.bakedNote)}</div>` : `<div class="k">How it was marked</div><div class="v mute">The capture recorded the position of each read on the page at capture time; the boxes are those positions, drawn over the saved image.</div>`}
      ${e.extra ? `<div class="k">Also on the capture</div><div class="v mute">${esc(e.extra)}</div>` : ""}
      ${e.title ? `<div class="k">Listing title</div><div class="v mute">${esc(e.title)}</div>` : ""}
      <div class="k">Capture</div><div class="v mute">${esc(retLabel(e.retailer))} · ${fmtT(e.capturedAt)}${e.asin ? ` · ${esc(e.asin)}` : ""}${e.zip ? ` · zip ${esc(e.zip)}` : ""}<br>${e.w} × ${e.h} px</div>
      <div class="k">Lane</div><div class="v mute">${esc(lane.label)} — ${esc(lane.what)}</div>
      <div class="k">Source</div><div class="v mono">${esc(e.source)}<br>${esc(e.img)}</div>`;
    $("#svBody").querySelectorAll(".sv-marks li").forEach((li) => li.addEventListener("click", () => scrollToMark(+li.dataset.n)));
    $("#svPos").textContent = `${i + 1} / ${LIST.length}`;
    $("#svLive").hidden = !e.url;
    $("#svPrev").disabled = i === 0; $("#svNext").disabled = i === LIST.length - 1;
    $("#snapView").classList.add("on");
    const img = $("#svImg img");
    const go = () => scrollToMark(0, true);
    if (img.complete) go(); else img.addEventListener("load", go, { once: true });
    $("#svBody").scrollTop = 0;
  }
  function scrollToMark(n, instant) {
    const e = LIST[CUR]; if (!e || !e.boxes[n]) { $("#svImg").scrollTop = 0; return; }
    const area = $("#svImg"), wrap = $("#svImg .wrap"); if (!wrap) return;
    const y = e.boxes[n].y / e.h * wrap.offsetHeight;
    area.scrollTo({ top: Math.max(0, y - Math.min(140, area.clientHeight * 0.25)), behavior: instant ? "instant" : "smooth" });
  }
  function closeView() { $("#snapView").classList.remove("on"); $("#svImg").innerHTML = ""; }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  window.__SNAPSHOTS = { open, close, get list() { return LIST; }, get manifest() { return M; } };
})();
