/* ===========================================================================
   CCO CHART KIT — hand-rolled SVG, no external library
   ---------------------------------------------------------------------------
   Every renderer takes (host, spec) and paints into `host`. Shared rules:
     · 2px strokes, 4px rounded data-ends anchored to the baseline
     · a 2px surface gap between stacked segments and adjacent bars
     · recessive grid, tabular figures, text in ink tokens never in series colour
     · a hover layer by default: crosshair + tooltip on continuous forms,
       per-mark tooltip on categorical ones
   Colours arrive from the payload (validated upstream); nothing here invents a
   hue, and nothing cycles a categorical palette past its last slot.
   =========================================================================== */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a || {}) if (a[k] != null) e.setAttribute(k, a[k]); return e; };
  const px = (v) => Math.round(v * 100) / 100;
  const INK = "#1f1f1f", SOFT = "#444746", MUTE = "#5f6368", GRID = "#e8eaed", SURF = "#ffffff";

  // ── number formatting ─────────────────────────────────────────────────────
  const fmt = {
    n: (v, d = 0) => v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
    k: (v) => v == null ? "—" : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + "B" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + "k" : String(Math.round(v)),
    pct: (v, d = 1) => v == null ? "—" : Number(v).toFixed(d) + "%",
    usd: (v, d = 2) => v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
    usd0: (v) => v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US"),
    d: (v) => v == null ? "—" : Number(v).toFixed(1) + "d",
    star: (v) => v == null ? "—" : Number(v).toFixed(2) + "★",
    date: (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${+d}`; },
    dateY: (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${+d}, ${y}`; },
    signed: (v, f) => v == null ? "—" : (v > 0 ? "+" : "") + (f ? f(v) : fmt.n(v, 1)),
  };

  // ── shared tooltip ────────────────────────────────────────────────────────
  let TIP = null;
  function tip() {
    if (!TIP) { TIP = document.createElement("div"); TIP.className = "cc-tip"; TIP.setAttribute("role", "tooltip"); document.body.appendChild(TIP); }
    return TIP;
  }
  function showTip(html, ev) {
    const t = tip(); t.innerHTML = html; t.style.display = "block";
    const r = t.getBoundingClientRect();
    let x = ev.clientX + 16, y = ev.clientY - r.height / 2;
    if (x + r.width > innerWidth - 12) x = ev.clientX - r.width - 16;
    t.style.left = Math.max(8, x) + "px";
    t.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y)) + "px";
  }
  const hideTip = () => { if (TIP) TIP.style.display = "none"; };
  root.addEventListener("scroll", hideTip, true);

  // ── scales & helpers ──────────────────────────────────────────────────────
  function nice(max, min = 0) {
    if (max === min) return { lo: min, hi: min + 1, ticks: [min, min + 1] };
    const span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const mult = [1, 2, 2.5, 5, 10].find((m) => span / (step * m) <= 5.5) || 10;
    const s = step * mult;
    const lo = Math.floor(min / s) * s, hi = Math.ceil(max / s) * s;
    const ticks = []; for (let v = lo; v <= hi + s / 2; v += s) ticks.push(Math.round(v * 1e6) / 1e6);
    return { lo, hi, ticks };
  }
  function frame(host, spec) {
    host.innerHTML = "";
    const W = spec.width || host.clientWidth || 720, H = spec.height || 260;
    const m = Object.assign({ t: 14, r: 16, b: 26, l: 48 }, spec.margin || {});
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "cc-svg", role: "img", "aria-label": spec.aria || spec.title || "chart" });
    host.appendChild(svg);
    return { svg, W, H, m, iw: W - m.l - m.r, ih: H - m.t - m.b };
  }
  function grid(g, m, iw, ih, ticks, y, fmtY) {
    for (const t of ticks) {
      const yy = y(t);
      g.appendChild(el("line", { x1: m.l, x2: m.l + iw, y1: px(yy), y2: px(yy), stroke: GRID, "stroke-width": 1 }));
      g.appendChild(text(m.l - 8, yy + 3.5, fmtY ? fmtY(t) : fmt.n(t), { anchor: "end", size: 11, fill: MUTE }));
    }
  }
  function text(x, y, s, o) {
    o = o || {};
    const t = el("text", { x: px(x), y: px(y), "text-anchor": o.anchor || "start", "font-size": o.size || 11,
      fill: o.fill || SOFT, "font-weight": o.weight || 400, class: "cc-t" + (o.mono ? " tnum" : ""), transform: o.rotate });
    t.textContent = s; return t;
  }
  const legendRow = (host, items, opts) => {
    const d = document.createElement("div"); d.className = "cc-legend" + (opts && opts.compact ? " compact" : "");
    for (const it of items) {
      const s = document.createElement("span"); s.className = "cc-lg";
      if (opts && opts.onToggle) { s.tabIndex = 0; s.dataset.id = it.id; s.classList.add("clickable"); }
      s.innerHTML = `<i style="background:${it.color}${it.dash ? ";outline:2px solid " + it.color + ";outline-offset:-2px;background:transparent" : ""}"></i>${it.label}${it.value != null ? `<b class="tnum">${it.value}</b>` : ""}`;
      if (opts && opts.onToggle) { const go = () => { s.classList.toggle("off"); opts.onToggle(it.id, !s.classList.contains("off")); };
        s.onclick = go; s.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; }
      d.appendChild(s);
    }
    host.appendChild(d); return d;
  };

  /* ========================================================================
     LINE / AREA — multi-series over time, crosshair + shared tooltip
     ====================================================================== */
  function line(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, spec);
    const xs = spec.x, n = xs.length;
    const ser = spec.series.filter((s) => s.data && s.data.length);
    const all = ser.flatMap((s) => s.data).filter((v) => v != null);
    const dom = nice(spec.max != null ? spec.max : Math.max(...all), spec.min != null ? spec.min : (spec.zero === false ? Math.min(...all) : 0));
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.t + ih - ((v - dom.lo) / (dom.hi - dom.lo)) * ih;
    const g = el("g"); svg.appendChild(g);
    grid(g, m, iw, ih, dom.ticks, y, spec.fmtY);

    // event bands behind the data
    for (const b of spec.bands || []) {
      const a = xs.indexOf(b.start), z = xs.indexOf(b.end);
      if (a < 0) continue;
      g.appendChild(el("rect", { x: px(x(a)), y: m.t, width: px(Math.max(2, x(z < 0 ? n - 1 : z) - x(a))), height: ih, fill: b.color || INK, opacity: b.opacity || 0.05 }));
      if (b.label && spec.bandLabels !== false) g.appendChild(text(x(a) + 4, m.t + 11, b.label, { size: 9.5, fill: MUTE, weight: 600 }));
    }
    for (const s of ser) {
      const pts = s.data.map((v, i) => v == null ? null : [x(i), y(v)]);
      const segs = []; let cur = [];
      for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
      if (cur.length) segs.push(cur);
      for (const seg of segs) {
        const dPath = seg.map((p, i) => `${i ? "L" : "M"}${px(p[0])} ${px(p[1])}`).join(" ");
        if (spec.area) g.appendChild(el("path", { d: `${dPath} L${px(seg.at(-1)[0])} ${px(y(dom.lo))} L${px(seg[0][0])} ${px(y(dom.lo))} Z`, fill: s.color, opacity: 0.10 }));
        g.appendChild(el("path", { d: dPath, fill: "none", stroke: s.color, "stroke-width": s.width || (s.subject ? 2.6 : 2),
          "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": s.dash || null, opacity: s.dim ? 0.3 : 1 }));
      }
      if (spec.endLabel !== false && s.data.at(-1) != null) {
        const lastY = y(s.data.at(-1));
        g.appendChild(el("circle", { cx: px(x(n - 1)), cy: px(lastY), r: 3.4, fill: s.color, stroke: SURF, "stroke-width": 2 }));
      }
    }
    // x ticks
    const step = Math.max(1, Math.round(n / (spec.xTicks || 7)));
    for (let i = 0; i < n; i += step) g.appendChild(text(x(i), m.t + ih + 16, spec.fmtX ? spec.fmtX(xs[i], i) : fmt.date(xs[i]), { anchor: "middle", size: 10, fill: MUTE }));

    // hover layer
    const hv = el("g", { class: "cc-hover", opacity: 0 }); svg.appendChild(hv);
    const cross = el("line", { y1: m.t, y2: m.t + ih, stroke: INK, "stroke-width": 1, "stroke-dasharray": "3 3", opacity: .35 }); hv.appendChild(cross);
    const dots = ser.map((s) => { const c = el("circle", { r: 4.4, fill: s.color, stroke: SURF, "stroke-width": 2 }); hv.appendChild(c); return c; });
    const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" }); svg.appendChild(hit);
    hit.addEventListener("mousemove", (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - r.left) / r.width * W - m.l) / (iw || 1) * (n - 1))));
      hv.setAttribute("opacity", 1); cross.setAttribute("x1", px(x(i))); cross.setAttribute("x2", px(x(i)));
      ser.forEach((s, k) => { const v = s.data[i]; if (v == null) { dots[k].setAttribute("r", 0); return; } dots[k].setAttribute("r", 4.4); dots[k].setAttribute("cx", px(x(i))); dots[k].setAttribute("cy", px(y(v))); });
      const rows = ser.map((s) => ({ s, v: s.data[i] })).filter((o) => o.v != null).sort((a, b) => b.v - a.v)
        .map((o) => `<div class="r"><i style="background:${o.s.color}"></i><span>${o.s.label}</span><b class="tnum">${(spec.fmtV || fmt.n)(o.v)}</b></div>`).join("");
      showTip(`<div class="h">${spec.fmtTip ? spec.fmtTip(xs[i]) : fmt.dateY(xs[i])}</div>${rows}`, ev);
    });
    hit.addEventListener("mouseleave", () => { hv.setAttribute("opacity", 0); hideTip(); });
    if (spec.legend !== false && ser.length > 1) legendRow(host, ser.map((s) => ({ id: s.id, color: s.color, label: s.label })));
    return svg;
  }

  /* ========================================================================
     STACKED AREA — composition over time, optional 100% normalisation
     ====================================================================== */
  function stack(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, spec);
    const xs = spec.x, n = xs.length, ser = spec.series;
    const tot = xs.map((_, i) => ser.reduce((a, s) => a + (s.data[i] || 0), 0));
    const norm = spec.normalize;
    const maxV = norm ? 100 : Math.max(...tot);
    const dom = nice(maxV, 0);
    const x = (i) => m.l + (i / (n - 1)) * iw;
    const y = (v) => m.t + ih - ((v - dom.lo) / (dom.hi - dom.lo)) * ih;
    const g = el("g"); svg.appendChild(g);
    grid(g, m, iw, ih, dom.ticks, y, spec.fmtY);
    const base = new Array(n).fill(0);
    for (const s of ser) {
      const top = xs.map((_, i) => { const v = norm ? (tot[i] ? ((s.data[i] || 0) / tot[i]) * 100 : 0) : (s.data[i] || 0); return base[i] + v; });
      const d = top.map((v, i) => `${i ? "L" : "M"}${px(x(i))} ${px(y(v))}`).join(" ") + " " +
        base.map((v, i) => `L${px(x(n - 1 - i))} ${px(y(base[n - 1 - i]))}`).join(" ") + " Z";
      g.appendChild(el("path", { d, fill: s.color, opacity: .88, stroke: SURF, "stroke-width": 1.5 }));  // 2px surface gap between segments
      for (let i = 0; i < n; i++) base[i] = top[i];
    }
    const step = Math.max(1, Math.round(n / (spec.xTicks || 7)));
    for (let i = 0; i < n; i += step) g.appendChild(text(x(i), m.t + ih + 16, spec.fmtX ? spec.fmtX(xs[i], i) : fmt.date(xs[i]), { anchor: "middle", size: 10, fill: MUTE }));
    const hv = el("line", { y1: m.t, y2: m.t + ih, stroke: INK, "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 }); svg.appendChild(hv);
    const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" }); svg.appendChild(hit);
    hit.addEventListener("mousemove", (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - r.left) / r.width * W - m.l) / (iw || 1) * (n - 1))));
      hv.setAttribute("opacity", .35); hv.setAttribute("x1", px(x(i))); hv.setAttribute("x2", px(x(i)));
      const rows = ser.slice().reverse().map((s) => {
        const v = s.data[i] || 0, share = tot[i] ? (v / tot[i]) * 100 : 0;
        return `<div class="r"><i style="background:${s.color}"></i><span>${s.label}</span><b class="tnum">${norm ? fmt.pct(share) : (spec.fmtV || fmt.k)(v)}</b></div>`;
      }).join("");
      showTip(`<div class="h">${spec.fmtTip ? spec.fmtTip(xs[i]) : fmt.dateY(xs[i])}${norm ? "" : ` · ${(spec.fmtV || fmt.k)(tot[i])} total`}</div>${rows}`, ev);
    });
    hit.addEventListener("mouseleave", () => { hv.setAttribute("opacity", 0); hideTip(); });
    if (spec.legend !== false) legendRow(host, ser.map((s) => ({ id: s.id, color: s.color, label: s.label })));
    return svg;
  }

  /* ========================================================================
     COLUMNS — grouped or stacked, categorical x
     ====================================================================== */
  function bars(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, Object.assign({ margin: { t: 14, r: 16, b: 42, l: 52 } }, spec));
    const cats = spec.cats, ser = spec.series, stacked = spec.stacked;
    const totals = cats.map((_, i) => ser.reduce((a, s) => a + (s.data[i] || 0), 0));
    // Take the running maximum, not the final total: with a negative segment the
    // total can end below the tallest point the stack actually reached, which
    // puts the domain under the data and paints bars outside the chart.
    const peaks = cats.map((_, i) => { let acc = 0, hi = 0;
      for (const s of ser) { acc += (s.data[i] || 0); hi = Math.max(hi, acc); } return hi; });
    const maxV = stacked ? Math.max(...peaks) : Math.max(...ser.flatMap((s) => s.data.filter((v) => v != null)));
    const dom = nice(spec.max != null ? spec.max : maxV, 0);
    const bw = iw / cats.length, inner = bw * 0.72, sw = stacked ? inner : inner / ser.length;
    const y = (v) => m.t + ih - ((v - dom.lo) / (dom.hi - dom.lo)) * ih;
    const g = el("g"); svg.appendChild(g);
    grid(g, m, iw, ih, dom.ticks, y, spec.fmtY);
    cats.forEach((c, i) => {
      const x0 = m.l + i * bw + (bw - inner) / 2;
      let acc = 0;
      ser.forEach((s, k) => {
        const v = s.data[i]; if (v == null) return;
        const bx = stacked ? x0 : x0 + k * sw;
        const yTop = stacked ? y(acc + v) : y(v), h = Math.max(1.5, (stacked ? y(acc) : y(0)) - yTop);
        if (!isFinite(yTop) || !isFinite(h)) { acc += v; return; }
        const rect = el("rect", { x: px(bx + (stacked ? 0 : 1)), y: px(Math.max(m.t - 2, yTop)), width: px(Math.max(1, sw - (stacked ? 0 : 2))), height: px(Math.min(h, ih + 4)),
          fill: s.color, rx: Math.min(4, sw / 3), opacity: s.dim ? .35 : 1, stroke: stacked ? SURF : "none", "stroke-width": stacked ? 1.5 : 0, style: "cursor:pointer" });
        rect.addEventListener("mousemove", (ev) => showTip(`<div class="h">${spec.catLabel ? spec.catLabel(c, i) : c}</div><div class="r"><i style="background:${s.color}"></i><span>${s.label}</span><b class="tnum">${(spec.fmtV || fmt.n)(v)}</b></div>${stacked ? `<div class="r sub"><span>Total</span><b class="tnum">${(spec.fmtV || fmt.n)(totals[i])}</b></div>` : ""}`, ev));
        rect.addEventListener("mouseleave", hideTip);
        if (spec.onPick) rect.addEventListener("click", () => spec.onPick(c, s.id, i));
        g.appendChild(rect);
        acc += v;
      });
      const lbl = spec.catLabel ? spec.catLabel(c, i) : c;
      const t = text(m.l + i * bw + bw / 2, m.t + ih + (spec.rotate ? 12 : 16), lbl, { anchor: spec.rotate ? "end" : "middle", size: 10, fill: SOFT });
      if (spec.rotate) t.setAttribute("transform", `rotate(-35 ${px(m.l + i * bw + bw / 2)} ${px(m.t + ih + 12)})`);
      g.appendChild(t);
    });
    if (spec.legend !== false && ser.length > 1) legendRow(host, ser.map((s) => ({ id: s.id, color: s.color, label: s.label })));
    return svg;
  }

  /* ========================================================================
     HORIZONTAL BARS — ranked magnitude with the value read straight off
     ====================================================================== */
  function hbars(host, spec) {
    host.innerHTML = "";
    const wrap = document.createElement("div"); wrap.className = "cc-hb"; host.appendChild(wrap);
    const max = spec.max != null ? spec.max : Math.max(...spec.rows.map((r) => Math.abs(r.value) || 0), 0.0001);
    for (const r of spec.rows) {
      const d = document.createElement("div");
      d.className = "cc-hb-row" + (r.subject ? " subject" : "") + (spec.onPick ? " pick" : "");
      d.innerHTML = `<span class="lb">${r.sub ? `<em>${r.sub}</em>` : ""}${r.label}</span>
        <span class="tr"><i style="width:${Math.max(1.2, (Math.abs(r.value) / max) * 100)}%;background:${r.color || "#1a73e8"}"></i></span>
        <b class="tnum vv">${(spec.fmtV || fmt.n)(r.value)}</b>${r.note ? `<span class="nt">${r.note}</span>` : ""}`;
      if (r.tip) { d.addEventListener("mousemove", (ev) => showTip(r.tip, ev)); d.addEventListener("mouseleave", hideTip); }
      if (spec.onPick) d.onclick = () => spec.onPick(r);
      wrap.appendChild(d);
    }
    return wrap;
  }

  /* ========================================================================
     HEATMAP — a matrix where the eye finds the cold corner
     ====================================================================== */
  const GOOGLE = {
    "#5b21b6": "#1a73e8", "#2563eb": "#ea4335", "#be123c": "#fbbc04", "#d97706": "#34a853", "#0891b2": "#9334e6",
    "#7c3aed": "#9334e6", "#0d9488": "#12b5cb", "#db2777": "#e52592", "#4d7c0f": "#188038", "#64748b": "#80868b", "#881337": "#a50e0e",
    "#1d5aa0": "#1a73e8", "#d9482b": "#ea4335", "#d99a1e": "#fbbc04", "#6b7280": "#80868b",
    "#ede9fe": "#d2e3fc", "#dbeafe": "#fad2cf", "#ffe4e6": "#feefc3", "#fef3c7": "#ceead6", "#cffafe": "#e9d2fd",
  };
  const SERIES = [["#1a73e8", "#d2e3fc"], ["#ea4335", "#fad2cf"], ["#fbbc04", "#feefc3"], ["#34a853", "#ceead6"], ["#9334e6", "#e9d2fd"], ["#12b5cb", "#cbf0f8"], ["#e8710a", "#fedfc8"], ["#80868b", "#e8eaed"]];
  function recolor(node, map) {
    if (Array.isArray(node)) { for (const x of node) recolor(x, map); return; }
    if (!node || typeof node !== "object") return;
    for (const k in node) {
      const v = node[k];
      if (typeof v === "string" && (k === "color" || k === "soft")) { const g = map[v.toLowerCase()]; if (g) node[k] = g; }
      else if (v && typeof v === "object") recolor(v, map);
    }
  }
  function googlePalette(payload) {
    const map = { ...GOOGLE };
    const brands = (payload && (payload.dims && payload.dims.brands || payload.brands)) || [];
    brands.forEach((b, i) => {
      const [c, soft] = SERIES[Math.min(i, SERIES.length - 1)];
      if (typeof b.color === "string") map[b.color.toLowerCase()] = c;
      if (typeof b.soft === "string") map[b.soft.toLowerCase()] = soft;
    });
    const dims = (payload && payload.dims) || {};
    for (const k in dims) {
      if (k === "brands" || !Array.isArray(dims[k])) continue;
      dims[k].forEach((x, i) => {
        if (!x || typeof x.color !== "string") return;
        const [c, soft] = x.residual ? SERIES[SERIES.length - 1] : SERIES[i % (SERIES.length - 1)];
        x.color = c;
        if (typeof x.soft === "string") x.soft = soft;
      });
    }
    recolor(payload, map);
    return payload;
  }
  const RAMP = ["#e8f0fe", "#d2e3fc", "#aecbfa", "#8ab4f8", "#669df6", "#4285f4", "#1a73e8", "#174ea6"];
  const RAMP_R = ["#fce8e6", "#fad2cf", "#f6aea9", "#f28b82", "#ee675c", "#ea4335", "#d93025", "#a50e0e"];
  const RAMP_DIV = ["#a50e0e", "#d93025", "#f28b82", "#fad2cf", "#f1f3f4", "#ceead6", "#81c995", "#1e8e3e", "#0d652d"];
  function rampColor(t, ramp) { const R = ramp || RAMP; return R[Math.max(0, Math.min(R.length - 1, Math.round(t * (R.length - 1))))]; }
  function heatmap(host, spec) {
    host.innerHTML = "";
    const wrap = document.createElement("div"); wrap.className = "cc-heat"; host.appendChild(wrap);
    const cols = spec.cols, rows = spec.rows;
    const vals = rows.flatMap((r) => cols.map((c) => spec.value(r, c))).filter((v) => v != null);
    // Math.min of nothing is Infinity, and the scale legend printed it: a
    // heatmap over an empty dimension read "-Infinity% … Infinity%" to a client.
    // With no readings there is no scale to draw.
    const hasVals = vals.length > 0;
    const lo = spec.min != null ? spec.min : (hasVals ? Math.min(...vals) : null);
    const hi = spec.max != null ? spec.max : (hasVals ? Math.max(...vals) : null);
    const inv = spec.invert;
    const tbl = document.createElement("table"); tbl.className = "cc-heat-t";
    const th = document.createElement("tr"); th.innerHTML = `<th class="cnr">${spec.corner || ""}</th>` + cols.map((c) => `<th><span>${spec.colLabel ? spec.colLabel(c) : c.label || c}</span></th>`).join("");
    tbl.appendChild(th);
    for (const r of rows) {
      const tr = document.createElement("tr");
      const rl = document.createElement("th"); rl.className = "rw";
      rl.innerHTML = `${spec.rowDot ? `<i style="background:${spec.rowDot(r)}"></i>` : ""}${spec.rowLabel ? spec.rowLabel(r) : r.label || r}`;
      tr.appendChild(rl);
      for (const c of cols) {
        const v = spec.value(r, c);
        const td = document.createElement("td");
        if (v == null) { td.className = "na"; td.innerHTML = `<span>—</span>`; }
        else {
          let t = hi === lo ? .5 : (v - lo) / (hi - lo); if (inv) t = 1 - t;
          const bg = rampColor(t, spec.ramp === "red" ? RAMP_R : spec.ramp === "div" ? RAMP_DIV : RAMP);
          td.style.background = bg;
          td.style.color = t > 0.62 ? "#fff" : INK;
          const shown = spec.fmtCell ? spec.fmtCell(r, c, v) : (spec.fmtV || fmt.n)(v);
          td.innerHTML = `<span class="tnum">${shown == null ? "—" : shown}</span>`;
          td.addEventListener("mousemove", (ev) => showTip(spec.tip ? spec.tip(r, c, v) : `<div class="h">${(spec.rowLabel ? spec.rowLabel(r) : r.label || r)} · ${(spec.colLabel ? spec.colLabel(c) : c.label || c)}</div><div class="r"><b class="tnum">${(spec.fmtV || fmt.n)(v)}</b></div>`, ev));
          td.addEventListener("mouseleave", hideTip);
          if (spec.onPick) { td.style.cursor = "pointer"; td.onclick = () => spec.onPick(r, c, v); }
        }
        tr.appendChild(td);
      }
      tbl.appendChild(tr);
    }
    wrap.appendChild(tbl);
    if (spec.scale !== false) {
      if (lo == null || hi == null) return wrap;
      const sc = document.createElement("div"); sc.className = "cc-scale";
      const R = spec.ramp === "red" ? RAMP_R : spec.ramp === "div" ? RAMP_DIV : RAMP;
      sc.innerHTML = `<span>${(spec.fmtV || fmt.n)(inv ? hi : lo)}</span>` + R.map((c) => `<i style="background:${c}"></i>`).join("") + `<span>${(spec.fmtV || fmt.n)(inv ? lo : hi)}</span>${spec.scaleNote ? `<em>${spec.scaleNote}</em>` : ""}`;
      wrap.appendChild(sc);
    }
    return wrap;
  }
  root.__ccRamp = rampColor;

  /* ========================================================================
     TREEMAP — squarified; area is the magnitude, colour is the identity
     ====================================================================== */
  function treemap(host, spec) {
    const { svg, W, H, m } = frame(host, Object.assign({ margin: { t: 0, r: 0, b: 0, l: 0 } }, spec));
    const items = spec.items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
    const total = items.reduce((a, i) => a + i.value, 0) || 1;
    const g = el("g"); svg.appendChild(g);
    // squarified layout
    const out = [];
    (function layout(list, x, y, w, h) {
      if (!list.length) return;
      if (list.length === 1) { out.push({ it: list[0], x, y, w, h }); return; }
      const sum = list.reduce((a, i) => a + i.value, 0);
      let acc = 0, split = 0;
      for (let i = 0; i < list.length; i++) { acc += list[i].value; if (acc >= sum / 2) { split = i + 1; break; } }
      split = Math.max(1, Math.min(list.length - 1, split));
      const aSum = list.slice(0, split).reduce((a, i) => a + i.value, 0), frac = aSum / sum;
      if (w >= h) { layout(list.slice(0, split), x, y, w * frac, h); layout(list.slice(split), x + w * frac, y, w * (1 - frac), h); }
      else { layout(list.slice(0, split), x, y, w, h * frac); layout(list.slice(split), x, y + h * frac, w, h * (1 - frac)); }
    })(items, 0, 0, W, H);
    for (const c of out) {
      const share = (c.it.value / total) * 100;
      const rect = el("rect", { x: px(c.x + 1), y: px(c.y + 1), width: px(Math.max(0, c.w - 2)), height: px(Math.max(0, c.h - 2)),
        fill: c.it.color, rx: 5, opacity: c.it.opacity != null ? c.it.opacity : 0.92, style: "cursor:pointer" });
      rect.addEventListener("mousemove", (ev) => showTip(c.it.tip || `<div class="h">${c.it.label}</div><div class="r"><b class="tnum">${(spec.fmtV || fmt.n)(c.it.value)}</b><span>${fmt.pct(share)} of total</span></div>`, ev));
      rect.addEventListener("mouseleave", hideTip);
      if (spec.onPick) rect.onclick = () => spec.onPick(c.it);
      g.appendChild(rect);
      if (c.w > 58 && c.h > 30) {
        g.appendChild(text(c.x + 9, c.y + 20, c.it.label.length * 6.4 > c.w - 16 ? c.it.short || c.it.label.slice(0, Math.floor((c.w - 16) / 6.4)) : c.it.label, { size: 12, fill: "#fff", weight: 500 }));
        if (c.h > 46) g.appendChild(text(c.x + 9, c.y + 36, (spec.fmtV || fmt.n)(c.it.value), { size: 11, fill: "#fff", weight: 500, mono: true, opacity: .8 }));
      }
    }
    return svg;
  }

  /* ========================================================================
     SUNBURST — two rings: the family, then the members inside it
     ====================================================================== */
  function sunburst(host, spec) {
    const size = spec.size || 300;
    const { svg } = frame(host, { width: size, height: size, margin: { t: 0, r: 0, b: 0, l: 0 }, aria: spec.aria });
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`); svg.setAttribute("height", size);
    const cx = size / 2, cy = size / 2, r0 = size * 0.17, r1 = size * 0.31, r2 = size * 0.47;
    const total = spec.groups.reduce((a, g) => a + g.children.reduce((b, c) => b + c.value, 0), 0) || 1;
    const g = el("g"); svg.appendChild(g);
    const arc = (a0, a1, ri, ro) => {
      const p = (a, r) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];
      const [x0, y0] = p(a0, ro), [x1, y1] = p(a1, ro), [x2, y2] = p(a1, ri), [x3, y3] = p(a0, ri);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return `M${px(x0)} ${px(y0)} A${ro} ${ro} 0 ${large} 1 ${px(x1)} ${px(y1)} L${px(x2)} ${px(y2)} A${ri} ${ri} 0 ${large} 0 ${px(x3)} ${px(y3)} Z`;
    };
    let ang = 0;
    for (const grp of spec.groups) {
      const gv = grp.children.reduce((a, c) => a + c.value, 0);
      const span = (gv / total) * Math.PI * 2;
      const gp = el("path", { d: arc(ang + 0.006, ang + span - 0.006, r0, r1), fill: grp.color, opacity: .95, style: "cursor:pointer" });
      gp.addEventListener("mousemove", (ev) => showTip(`<div class="h">${grp.label}</div><div class="r"><b class="tnum">${(spec.fmtV || fmt.n)(gv)}</b><span>${fmt.pct((gv / total) * 100)} of total</span></div>`, ev));
      gp.addEventListener("mouseleave", hideTip); g.appendChild(gp);
      let a2 = ang;
      for (const ch of grp.children) {
        const cs = (ch.value / total) * Math.PI * 2;
        const cp = el("path", { d: arc(a2 + 0.004, a2 + cs - 0.004, r1 + 2, r2), fill: ch.color || grp.color, opacity: ch.opacity != null ? ch.opacity : .55, stroke: SURF, "stroke-width": 1, style: "cursor:pointer" });
        cp.addEventListener("mousemove", (ev) => showTip(`<div class="h">${grp.label} · ${ch.label}</div><div class="r"><b class="tnum">${(spec.fmtV || fmt.n)(ch.value)}</b><span>${fmt.pct((ch.value / total) * 100)} of total</span></div>`, ev));
        cp.addEventListener("mouseleave", hideTip);
        if (spec.onPick) cp.onclick = () => spec.onPick(grp, ch);
        g.appendChild(cp);
        a2 += cs;
      }
      ang += span;
    }
    if (spec.centre) {
      g.appendChild(text(cx, cy - 2, spec.centre.value, { anchor: "middle", size: 21, fill: INK, weight: 700, mono: true }));
      g.appendChild(text(cx, cy + 15, spec.centre.label, { anchor: "middle", size: 10, fill: MUTE, weight: 600 }));
    }
    if (spec.legend !== false) legendRow(host, spec.groups.map((x) => ({ id: x.id, color: x.color, label: x.label })));
    return svg;
  }

  /* ========================================================================
     PROMO CALENDAR — a gantt of who was on promotion, when, and how deep
     ====================================================================== */
  function calendar(host, spec) {
    host.innerHTML = "";
    const wrap = document.createElement("div"); wrap.className = "cc-cal"; host.appendChild(wrap);
    const dates = spec.dates, n = dates.length;
    const LW = spec.laneWidth || 176;
    const head = document.createElement("div"); head.className = "cc-cal-head";
    let hd = `<div class="lane" style="width:${LW}px">${spec.corner || ""}</div><div class="track">`;
    // month ticks + event bands
    for (const b of spec.bands || []) {
      const a = dates.indexOf(b.start), z = dates.indexOf(b.end);
      if (a < 0) continue;
      const l = (a / n) * 100, w = (((z < 0 ? n - 1 : z) - a + 1) / n) * 100;
      hd += `<span class="band" style="left:${l}%;width:${w}%;background:${b.color || "#1f1f1f"}"><em>${b.label}</em></span>`;
    }
    let lastM = "";
    dates.forEach((d, i) => { const mo = d.slice(0, 7); if (mo !== lastM) { lastM = mo;
      hd += `<span class="mtick" style="left:${(i / n) * 100}%">${fmt.date(d).split(" ")[0]}</span>`; } });
    hd += "</div>";
    head.innerHTML = hd; wrap.appendChild(head);

    for (const lane of spec.lanes) {
      // Pack overlapping events into sub-tracks so a busy lane stays readable.
      const sorted = lane.events.slice().sort((a, b) => dates.indexOf(a.start) - dates.indexOf(b.start));
      const trackEnd = [];
      for (const ev of sorted) {
        const s0 = dates.indexOf(ev.start), e0 = dates.indexOf(ev.end < dates[0] ? dates[0] : ev.end);
        let t = trackEnd.findIndex((end) => end < s0);
        if (t < 0) { t = trackEnd.length; trackEnd.push(-1); }
        trackEnd[t] = (e0 < 0 ? n - 1 : e0) + 1;
        ev._track = t;
      }
      const nTrack = Math.max(1, trackEnd.length);
      const barH = nTrack > 4 ? 5 : nTrack > 2 ? 7 : nTrack > 1 ? 9 : 14;
      const gap = nTrack > 4 ? 1 : 2;
      const rowH = Math.max(24, nTrack * (barH + gap) + 8);
      const row = document.createElement("div"); row.className = "cc-cal-row" + (lane.subject ? " subject" : "");
      row.style.height = rowH + "px";
      let h = `<div class="lane" style="width:${LW}px">${lane.dot ? `<i style="background:${lane.dot}"></i>` : ""}<span>${lane.label}</span>${lane.sub ? `<em>${lane.sub}</em>` : ""}</div><div class="track">`;
      for (const b of spec.bands || []) {
        const a = dates.indexOf(b.start), z = dates.indexOf(b.end);
        if (a < 0) continue;
        h += `<span class="bandbg" style="left:${(a / n) * 100}%;width:${(((z < 0 ? n - 1 : z) - a + 1) / n) * 100}%"></span>`;
      }
      for (const ev of lane.events) {
        const a = dates.indexOf(ev.start), z = dates.indexOf(ev.end);
        if (a < 0) continue;
        const l = (a / n) * 100, w = Math.max(0.55, (((z < 0 ? n - 1 : z) - a + 1) / n) * 100);
        const op = ev.intensity != null ? (0.34 + ev.intensity * 0.66) : 0.9;
        const top = 4 + (ev._track || 0) * (barH + gap);
        h += `<span class="ev" data-i="${ev._i}" style="left:${l}%;width:${w}%;top:${top}px;height:${barH}px;background:${ev.color};opacity:${op}" title=""></span>`;
      }
      h += "</div>";
      row.innerHTML = h;
      row.querySelectorAll(".ev").forEach((n2) => {
        const ev = lane.events[+n2.dataset.i];
        n2.addEventListener("mousemove", (e) => showTip(ev.tip, e));
        n2.addEventListener("mouseleave", hideTip);
        if (spec.onPick) n2.onclick = () => spec.onPick(ev, lane);
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* ========================================================================
     WATERFALL — the bridge from shelf price to what actually changes hands
     ====================================================================== */
  function waterfall(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, Object.assign({ margin: { t: 18, r: 16, b: 56, l: 58 } }, spec));
    const steps = spec.steps;
    let run = 0; const geo = [];
    for (const s of steps) {
      if (s.total) { geo.push({ s, from: 0, to: s.value }); run = s.value; }
      else { geo.push({ s, from: run, to: run + s.value }); run += s.value; }
    }
    const all = geo.flatMap((g2) => g2.s.total ? [g2.s.value] : [g2.from, g2.to]);
    // A bridge reads differences, so the axis sits under the lowest value
    // rather than at zero — otherwise a $9 step on a $500 price is invisible.
    const lo0 = Math.min(...all), hi0 = Math.max(...all), pad = Math.max((hi0 - lo0) * 0.28, hi0 * 0.02);
    const dom = nice(hi0 + pad, spec.zero ? 0 : Math.max(0, lo0 - pad));
    const y = (v) => m.t + ih - ((v - dom.lo) / (dom.hi - dom.lo)) * ih;
    const bw = iw / steps.length, inner = Math.min(64, bw * 0.62);
    const g = el("g"); svg.appendChild(g);
    grid(g, m, iw, ih, dom.ticks, y, spec.fmtY || fmt.usd0);
    geo.forEach((o, i) => {
      const x0 = m.l + i * bw + (bw - inner) / 2;
      const yTop = o.s.total ? y(o.s.value) : y(Math.max(o.from, o.to));
      const h = o.s.total ? Math.max(2, y(dom.lo) - y(o.s.value)) : Math.max(2, Math.abs(y(o.from) - y(o.to)));
      const col = o.s.total ? (o.s.color || INK) : o.s.value < 0 ? "#1e8e3e" : "#d93025";
      const rect = el("rect", { x: px(x0), y: px(yTop), width: px(inner), height: px(h), fill: col, rx: 4, opacity: o.s.total ? 1 : .92, style: "cursor:pointer" });
      rect.addEventListener("mousemove", (ev) => showTip(o.s.tip || `<div class="h">${o.s.label}</div><div class="r"><b class="tnum">${fmt.signed(o.s.value, fmt.usd)}</b></div>`, ev));
      rect.addEventListener("mouseleave", hideTip);
      g.appendChild(rect);
      if (i < geo.length - 1) g.appendChild(el("line", { x1: px(x0 + inner), x2: px(x0 + bw), y1: px(y(o.to)), y2: px(y(o.to)), stroke: MUTE, "stroke-width": 1, "stroke-dasharray": "2 3" }));
      g.appendChild(text(x0 + inner / 2, yTop - 6, o.s.total ? fmt.usd(o.s.value) : fmt.signed(o.s.value, fmt.usd), { anchor: "middle", size: 10.5, fill: INK, weight: 700, mono: true }));
      const words = o.s.label.split(" ");
      const lines = []; let cur = "";
      for (const w of words) { if ((cur + " " + w).trim().length > 13) { lines.push(cur.trim()); cur = w; } else cur += " " + w; }
      lines.push(cur.trim());
      lines.slice(0, 3).forEach((ln, k) => g.appendChild(text(x0 + inner / 2, m.t + ih + 15 + k * 12, ln, { anchor: "middle", size: 10, fill: SOFT })));
    });
    return svg;
  }

  /* ========================================================================
     BUMP — rank over time; the only honest way to show "who is winning"
     ====================================================================== */
  function bump(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, Object.assign({ margin: { t: 16, r: 104, b: 26, l: 104 } }, spec));
    const xs = spec.x, n = xs.length, ser = spec.series, k = ser.length;
    const x = (i) => m.l + (i / (n - 1)) * iw;
    const y = (r) => m.t + ((r - 1) / Math.max(1, k - 1)) * ih;
    const g = el("g"); svg.appendChild(g);
    for (let r = 1; r <= k; r++) {
      g.appendChild(el("line", { x1: m.l, x2: m.l + iw, y1: px(y(r)), y2: px(y(r)), stroke: GRID, "stroke-width": 1 }));
      g.appendChild(text(m.l - 12, y(r) + 4, "#" + r, { anchor: "end", size: 10.5, fill: MUTE, mono: true }));
    }
    for (const s of ser) {
      // The moveto has to be the first SURVIVING point, not index 0: a brand
      // with no rank in week one produced a path starting "L…", which SVG
      // rejects outright, so the whole line vanished and the console filled with
      // "Expected moveto path command". Number the points after the filter.
      const d = s.rank.map((r, i) => (r == null ? null : [x(i), y(r)]))
        .filter(Boolean)
        .map((p, k) => `${k ? "L" : "M"}${px(p[0])} ${px(p[1])}`).join(" ");
      g.appendChild(el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.subject ? 3 : 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: s.subject ? 1 : .78 }));
      s.rank.forEach((r, i) => { if (r == null) return;
        const c = el("circle", { cx: px(x(i)), cy: px(y(r)), r: s.subject ? 4.6 : 3.8, fill: s.color, stroke: SURF, "stroke-width": 2, style: "cursor:pointer" });
        c.addEventListener("mousemove", (ev) => showTip(`<div class="h">${spec.fmtTip ? spec.fmtTip(xs[i]) : xs[i]}</div><div class="r"><i style="background:${s.color}"></i><span>${s.label}</span><b class="tnum">#${r}${s.value ? ` · ${(spec.fmtV || fmt.n)(s.value[i])}` : ""}</b></div>`, ev));
        c.addEventListener("mouseleave", hideTip); g.appendChild(c); });
      const lastI = s.rank.reduce((a, r, i) => r != null ? i : a, 0);
      g.appendChild(text(x(lastI) + 10, y(s.rank[lastI]) + 4, s.label, { size: 11, fill: INK, weight: 600 }));
    }
    const step = Math.max(1, Math.round(n / (spec.xTicks || 7)));
    for (let i = 0; i < n; i += step) g.appendChild(text(x(i), m.t + ih + 18, spec.fmtX ? spec.fmtX(xs[i], i) : xs[i], { anchor: "middle", size: 10, fill: MUTE }));
    return svg;
  }

  /* ========================================================================
     SCATTER — two measures against each other, size as a third
     ====================================================================== */
  function scatter(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, Object.assign({ margin: { t: 18, r: 22, b: 44, l: 56 } }, spec));
    const pts = spec.points;
    const xd = nice(Math.max(...pts.map((p) => p.x)) * 1.12, spec.xZero === false ? Math.min(...pts.map((p) => p.x)) * 0.94 : 0);
    const yd = nice(Math.max(...pts.map((p) => p.y)) * 1.14, spec.yZero === false ? Math.min(...pts.map((p) => p.y)) * 0.92 : 0);
    const X = (v) => m.l + ((v - xd.lo) / (xd.hi - xd.lo)) * iw;
    const Y = (v) => m.t + ih - ((v - yd.lo) / (yd.hi - yd.lo)) * ih;
    const g = el("g"); svg.appendChild(g);
    grid(g, m, iw, ih, yd.ticks, Y, spec.fmtY);
    for (const t of xd.ticks) {
      g.appendChild(el("line", { x1: px(X(t)), x2: px(X(t)), y1: m.t, y2: m.t + ih, stroke: GRID, "stroke-width": 1 }));
      g.appendChild(text(X(t), m.t + ih + 16, (spec.fmtX || fmt.n)(t), { anchor: "middle", size: 10, fill: MUTE }));
    }
    if (spec.quadrant) {
      const mx = X(spec.quadrant.x), my = Y(spec.quadrant.y);
      g.appendChild(el("line", { x1: px(mx), x2: px(mx), y1: m.t, y2: m.t + ih, stroke: "#dadce0", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
      g.appendChild(el("line", { x1: m.l, x2: m.l + iw, y1: px(my), y2: px(my), stroke: "#dadce0", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
      (spec.quadrant.labels || []).forEach((q) => { const t = text(q.x === "l" ? m.l + 9 : m.l + iw - 9, q.y === "t" ? m.t + 13 : m.t + ih - 9, q.text,
        { anchor: q.x === "l" ? "start" : "end", size: 11, fill: MUTE, weight: 500 }); g.appendChild(t); });
    }
    const rMax = Math.max(...pts.map((p) => p.r || 1));
    for (const p of pts) {
      const rr = spec.sized === false ? 6 : 5 + Math.sqrt((p.r || 1) / rMax) * 14;
      const c = el("circle", { cx: px(X(p.x)), cy: px(Y(p.y)), r: px(rr), fill: p.color, opacity: .68, stroke: SURF, "stroke-width": 2, style: "cursor:pointer" });
      c.addEventListener("mousemove", (ev) => showTip(p.tip || `<div class="h">${p.label}</div>`, ev));
      c.addEventListener("mouseleave", hideTip);
      if (spec.onPick) c.onclick = () => spec.onPick(p);
      g.appendChild(c);
      if (p.tag) {
        const nearTop = Y(p.y) - rr - 16 < m.t + 16, nearRight = X(p.x) + rr > m.l + iw - 30;
        g.appendChild(text(nearRight ? X(p.x) - rr - 5 : X(p.x), nearTop ? Y(p.y) + rr + 13 : Y(p.y) - rr - 6, p.tag,
          { anchor: nearRight ? "end" : "middle", size: 10, fill: INK, weight: 600 }));
      }
    }
    if (spec.xLabel) g.appendChild(text(m.l + iw / 2, H - 6, spec.xLabel, { anchor: "middle", size: 10.5, fill: SOFT, weight: 600 }));
    if (spec.yLabel) { const t = text(0, 0, spec.yLabel, { anchor: "middle", size: 10.5, fill: SOFT, weight: 600 });
      t.setAttribute("transform", `translate(13 ${px(m.t + ih / 2)}) rotate(-90)`); g.appendChild(t); }
    return svg;
  }

  /* ========================================================================
     RANGE / DUMBBELL — a low and a high on one row (price spread, promise)
     ====================================================================== */
  function ranges(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, Object.assign({ margin: { t: 12, r: 74, b: 30, l: 150 }, height: 40 + spec.rows.length * 26 }, spec));
    // indexed:true rebases every row to 100 at its low, so a $12 spread on a
    // $99 listing and a $40 spread on a $999 one are finally comparable.
    if (spec.indexed) spec.rows = spec.rows.map((r) => ({ ...r, _lo: r.lo, _hi: r.hi, lo: 100, hi: 100 * (r.hi / r.lo) }));
    const lo = Math.min(...spec.rows.map((r) => r.lo)), hi = Math.max(...spec.rows.map((r) => r.hi));
    const dom = nice(hi * 1.02, spec.zero ? 0 : lo * 0.97);
    const X = (v) => m.l + ((v - dom.lo) / (dom.hi - dom.lo)) * iw;
    const rowH = ih / spec.rows.length;
    const g = el("g"); svg.appendChild(g);
    for (const t of dom.ticks) {
      g.appendChild(el("line", { x1: px(X(t)), x2: px(X(t)), y1: m.t, y2: m.t + ih, stroke: GRID, "stroke-width": 1 }));
      g.appendChild(text(X(t), m.t + ih + 16, (spec.fmtV || fmt.usd0)(t), { anchor: "middle", size: 10, fill: MUTE }));
    }
    spec.rows.forEach((r, i) => {
      const y = m.t + i * rowH + rowH / 2;
      g.appendChild(text(m.l - 10, y + 4, r.label, { anchor: "end", size: 11, fill: INK, weight: r.subject ? 700 : 500 }));
      g.appendChild(el("line", { x1: px(X(r.lo)), x2: px(X(r.hi)), y1: px(y), y2: px(y), stroke: r.color, "stroke-width": 5, "stroke-linecap": "round", opacity: .26 }));
      // the bar itself is a hover target too (Aashish, 2026-09-22: the tip carries the
      // sample promises behind the span, so the variance can be investigated in place)
      const hitTip = r.tip || `<div class="h">${r.label}</div><div class="r"><span>Low</span><b class="tnum">${(spec.fmtV || fmt.usd)(r.lo)}</b></div><div class="r"><span>High</span><b class="tnum">${(spec.fmtV || fmt.usd)(r.hi)}</b></div>`;
      const hit = el("line", { x1: px(X(r.lo)), x2: px(X(r.hi)), y1: px(y), y2: px(y), stroke: "transparent", "stroke-width": 18, "stroke-linecap": "round", style: "cursor:pointer" });
      hit.addEventListener("mousemove", (ev) => showTip(hitTip, ev)); hit.addEventListener("mouseleave", hideTip); g.appendChild(hit);
      for (const [v, fill] of [[r.lo, SURF], [r.hi, r.color]]) {
        const c = el("circle", { cx: px(X(v)), cy: px(y), r: 5.4, fill, stroke: r.color, "stroke-width": 2.4, style: "cursor:pointer" });
        c.addEventListener("mousemove", (ev) => showTip(r.tip || `<div class="h">${r.label}</div><div class="r"><span>Low</span><b class="tnum">${(spec.fmtV || fmt.usd)(r.lo)}</b></div><div class="r"><span>High</span><b class="tnum">${(spec.fmtV || fmt.usd)(r.hi)}</b></div>`, ev));
        c.addEventListener("mouseleave", hideTip); g.appendChild(c);
      }
      g.appendChild(text(m.l + iw + 10, y + 4, (spec.fmtSpread || ((r2) => (spec.fmtV || fmt.usd)(r2.hi - r2.lo)))(r), { size: 10.5, fill: SOFT, weight: 600, mono: true }));
    });
    return svg;
  }

  /* ========================================================================
     RADAR — a shape comparison across five or more measures
     ====================================================================== */
  function radar(host, spec) {
    const size = spec.size || 300;
    const { svg } = frame(host, { width: size, height: size, margin: { t: 0, r: 0, b: 0, l: 0 }, aria: spec.aria });
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`); svg.setAttribute("height", size);
    const cx = size / 2, cy = size / 2, R = size * 0.34, k = spec.axes.length;
    const g = el("g"); svg.appendChild(g);
    const pt = (i, t) => [cx + R * t * Math.cos(i / k * Math.PI * 2 - Math.PI / 2), cy + R * t * Math.sin(i / k * Math.PI * 2 - Math.PI / 2)];
    for (const ring of [0.25, 0.5, 0.75, 1]) {
      const d = spec.axes.map((_, i) => { const [x, y] = pt(i, ring); return `${i ? "L" : "M"}${px(x)} ${px(y)}`; }).join(" ") + " Z";
      g.appendChild(el("path", { d, fill: "none", stroke: GRID, "stroke-width": 1 }));
    }
    spec.axes.forEach((a, i) => {
      const [x, y] = pt(i, 1); g.appendChild(el("line", { x1: cx, y1: cy, x2: px(x), y2: px(y), stroke: GRID, "stroke-width": 1 }));
      const [lx, ly] = pt(i, 1.19);
      g.appendChild(text(lx, ly + 3.5, a.label, { anchor: Math.abs(lx - cx) < 12 ? "middle" : lx > cx ? "start" : "end", size: 9.8, fill: SOFT, weight: 600 }));
    });
    for (const s of spec.series) {
      // An axis with no reading is skipped rather than drawn at the centre or
      // half-way out — both of those are positions the brand has not been
      // measured to hold. The polygon closes over the axes that do have a
      // reading, dashed to show it is a partial shape, and the missing axis
      // gets a hollow marker outside the grid.
      const idx = spec.axes.map((_, i) => i).filter((i) => s.values[i] != null);
      const partial = idx.length !== spec.axes.length;
      if (idx.length > 1) {
        const d = idx.map((i, k) => { const [x, y] = pt(i, Math.max(0.02, Math.min(1, s.values[i]))); return `${k ? "L" : "M"}${px(x)} ${px(y)}`; }).join(" ") + " Z";
        g.appendChild(el("path", { d, fill: s.color, opacity: s.subject ? .18 : .1, stroke: s.color, "stroke-width": s.subject ? 2.6 : 2,
          "stroke-linejoin": "round", "stroke-dasharray": partial ? "5 3" : null }));
      }
      spec.axes.forEach((a, i) => {
        if (s.values[i] == null) {
          const [hx, hy] = pt(i, 1.05);
          const h = el("circle", { cx: px(hx), cy: px(hy), r: 3.1, fill: "none", stroke: s.color, "stroke-width": 1.4, "stroke-dasharray": "2 2", style: "cursor:pointer" });
          h.addEventListener("mousemove", (ev) => showTip(`<div class="h">${a.label}</div><div class="r"><i style="background:${s.color}"></i><span>${s.label}</span><b>not measured</b></div><div class="vb">Withheld rather than modelled.</div>`, ev));
          h.addEventListener("mouseleave", hideTip); g.appendChild(h); return;
        }
        const [x, y] = pt(i, Math.max(0.02, Math.min(1, s.values[i])));
        const c = el("circle", { cx: px(x), cy: px(y), r: 3.6, fill: s.color, stroke: SURF, "stroke-width": 1.6, style: "cursor:pointer" });
        c.addEventListener("mousemove", (ev) => showTip(`<div class="h">${a.label}</div><div class="r"><i style="background:${s.color}"></i><span>${s.label}</span><b class="tnum">${s.raw ? (a.fmt || fmt.n)(s.raw[i]) : fmt.pct(s.values[i] * 100)}</b></div>`, ev));
        c.addEventListener("mouseleave", hideTip); g.appendChild(c);
      });
    }
    if (spec.legend !== false) legendRow(host, spec.series.map((s) => ({ id: s.id, color: s.color, label: s.label })));
    return svg;
  }

  /* ========================================================================
     FUNNEL — presence at each stage of the question, stage by stage
     ====================================================================== */
  function funnel(host, spec) {
    host.innerHTML = "";
    const wrap = document.createElement("div"); wrap.className = "cc-funnel"; host.appendChild(wrap);
    const max = Math.max(...spec.stages.map((s) => Math.max(...s.bars.map((b) => b.value))));
    for (const st of spec.stages) {
      const d = document.createElement("div"); d.className = "cc-fn-stage";
      d.innerHTML = `<div class="hd"><b>${st.label}</b><em>${st.note || ""}</em></div><div class="bars"></div>`;
      const bs = d.querySelector(".bars");
      for (const b of st.bars.slice().sort((a, z) => z.value - a.value)) {
        const r = document.createElement("div"); r.className = "fb" + (b.subject ? " subject" : "");
        r.innerHTML = `<span class="l">${b.label}</span><span class="t"><i style="width:${(b.value / max) * 100}%;background:${b.color}"></i></span><b class="tnum">${(spec.fmtV || fmt.pct)(b.value)}</b>`;
        r.addEventListener("mousemove", (ev) => showTip(`<div class="h">${st.label}</div><div class="r"><i style="background:${b.color}"></i><span>${b.label}</span><b class="tnum">${(spec.fmtV || fmt.pct)(b.value)}</b></div>`, ev));
        r.addEventListener("mouseleave", hideTip);
        bs.appendChild(r);
      }
      wrap.appendChild(d);
    }
    return wrap;
  }

  /* ========================================================================
     SPARKLINE — inline, no axes, for a scorecard cell
     ====================================================================== */
  function spark(hostOrData, maybeSpec) {
    const spec = maybeSpec || hostOrData;
    const data = spec.data.filter((v) => v != null);
    if (data.length < 2) return "";
    const W = spec.width || 78, H = spec.height || 24, pad = 3;
    const lo = Math.min(...data), hi = Math.max(...data), span = hi - lo || 1;
    const X = (i) => pad + (i / (data.length - 1)) * (W - pad * 2);
    const Y = (v) => H - pad - ((v - lo) / span) * (H - pad * 2);
    const d = data.map((v, i) => `${i ? "L" : "M"}${px(X(i))} ${px(Y(v))}`).join(" ");
    const c = spec.color || "#1a73e8";
    return `<svg class="cc-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
      <path d="${d} L${px(X(data.length - 1))} ${H} L${px(X(0))} ${H} Z" fill="${c}" opacity=".08"/>
      <path d="${d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${px(X(data.length - 1))}" cy="${px(Y(data.at(-1)))}" r="2.4" fill="${c}"/></svg>`;
  }

  /* ========================================================================
     MARIMEKKO — column width is the weight, height the composition
     ====================================================================== */
  function mekko(host, spec) {
    const { svg, W, H, m, iw, ih } = frame(host, Object.assign({ margin: { t: 16, r: 12, b: 40, l: 44 } }, spec));
    const cols = spec.cols, tot = cols.reduce((a, c) => a + c.weight, 0) || 1;
    const g = el("g"); svg.appendChild(g);
    for (const t of [0, 25, 50, 75, 100]) {
      const y = m.t + ih - (t / 100) * ih;
      g.appendChild(el("line", { x1: m.l, x2: m.l + iw, y1: px(y), y2: px(y), stroke: GRID, "stroke-width": 1 }));
      g.appendChild(text(m.l - 8, y + 3.5, t + "%", { anchor: "end", size: 10, fill: MUTE }));
    }
    let x0 = m.l;
    for (const c of cols) {
      const w = (c.weight / tot) * iw;
      const cTot = c.parts.reduce((a, p) => a + p.value, 0) || 1;
      let acc = 0;
      for (const p of c.parts) {
        const hgt = (p.value / cTot) * ih;
        const rect = el("rect", { x: px(x0 + 1), y: px(m.t + ih - acc - hgt), width: px(Math.max(0, w - 2)), height: px(Math.max(0, hgt - 1.5)), fill: p.color, rx: 2, opacity: .92, style: "cursor:pointer" });
        rect.addEventListener("mousemove", (ev) => showTip(`<div class="h">${c.label}</div><div class="r"><i style="background:${p.color}"></i><span>${p.label}</span><b class="tnum">${fmt.pct((p.value / cTot) * 100)}</b></div><div class="r sub"><span>Column weight</span><b class="tnum">${fmt.pct((c.weight / tot) * 100)}</b></div>`, ev));
        rect.addEventListener("mouseleave", hideTip);
        g.appendChild(rect);
        acc += hgt;
      }
      g.appendChild(text(x0 + w / 2, m.t + ih + 15, c.label, { anchor: "middle", size: 10, fill: SOFT, weight: 600 }));
      g.appendChild(text(x0 + w / 2, m.t + ih + 28, (spec.fmtW || fmt.pct)((c.weight / tot) * 100), { anchor: "middle", size: 9.5, fill: MUTE, mono: true }));
      x0 += w;
    }
    if (spec.legend !== false && cols[0]) legendRow(host, cols[0].parts.map((p) => ({ id: p.id, color: p.color, label: p.label })));
    return svg;
  }

  /* ========================================================================
     Public surface
     ------------------------------------------------------------------------
     Every chart is wrapped so the element it drew into remembers the spec it
     was drawn from. Nothing in the kit reads that back — the dashboard does,
     to answer a question about a card from the same numbers the card is
     showing, rather than from a description of them.
     ====================================================================== */
  const DRAWN = { line, stack, bars, hbars, heatmap, treemap, sunburst, calendar, waterfall, bump, scatter, ranges, radar, funnel, mekko };
  const wrapped = {};
  for (const [kind, fn] of Object.entries(DRAWN)) {
    wrapped[kind] = function (host, spec) {
      if (host && typeof host === "object") { try { host.__ccSpec = { kind, spec }; } catch (e) {} }
      return fn(host, spec);
    };
  }
  root.CC = { ...wrapped, spark,
              fmt, showTip, hideTip, legendRow, rampColor, RAMP, RAMP_R, RAMP_DIV, nice, googlePalette };
})(window);
