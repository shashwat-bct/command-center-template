(function () {
  const M = window.Motion;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!M || reduced || !Element.prototype.animate) {
    window.CCMOTION = { page() {}, charts() {}, title() {} };
    return;
  }
  const { animate, inView } = M;
  const EASE = "cubic-bezier(.2,0,0,1)";
  const POP = "cubic-bezier(.34,1.56,.64,1)";
  const UNIT = ".card, .kpi, .withheld-card, .lane-note, .nm-card";
  const MAX_SVG_NODES = 260;

  const nearViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.top < window.innerHeight + 40 && r.bottom > -40;
  };
  const ownOpacity = (el) => { const v = parseFloat(el.getAttribute("opacity") ?? "1"); return Number.isFinite(v) ? v : 1; };
  const step = (n, max) => Math.min(max, 0.45 / Math.max(1, n));

  function play(el, keyframes, { duration, delay = 0, easing = EASE, origin = null, box = false }) {
    if (origin) el.style.transformOrigin = origin;
    if (box) el.style.transformBox = "fill-box";
    const a = el.animate(keyframes, { duration: duration * 1000, delay: delay * 1000, easing, fill: "backwards" });
    const done = () => { if (origin) el.style.removeProperty("transform-origin"); if (box) el.style.removeProperty("transform-box"); };
    a.finished.then(done, done);
    return a;
  }

  function svgCharts(root) {
    for (const svg of root.querySelectorAll("svg:not(.engico):not([data-ccm])")) {
      if (svg.closest(".cc-spark, .kpi .kf, button, a, .chip")) continue;
      const bb = svg.getBoundingClientRect();
      if (bb.width < 80 || bb.height < 40) continue;
      svg.dataset.ccm = "1";
      const nodes = svg.querySelectorAll("rect, path, circle");
      if (nodes.length > MAX_SVG_NODES) { play(svg, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.4 }); continue; }
      const bars = [], lines = [], fills = [], dots = [];
      for (const n of nodes) {
        if (n.closest("defs, clipPath, mask") || n.closest('[opacity="0"]')) continue;
        const fill = n.getAttribute("fill");
        if (fill === "transparent" || (fill === "none" && !n.getAttribute("stroke"))) continue;
        if (n.hasAttribute("transform") || (n.hasAttribute("stroke-dasharray") && fill === "none")) { fills.push(n); continue; }
        if (n.tagName === "rect") { if (+n.getAttribute("height") > 1 && +n.getAttribute("width") > 0 && ownOpacity(n) > 0.2) bars.push(n); }
        else if (n.tagName === "circle") dots.push(n);
        else if (fill === "none") lines.push(n);
        else fills.push(n);
      }
      bars.forEach((b, i) => play(b, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 0.6, delay: i * step(bars.length, 0.025), origin: "50% 100%", box: true }));
      for (const p of lines) {
        let len = 0;
        try { len = p.getTotalLength(); } catch { len = 0; }
        if (len) play(p, [{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: "0" }], { duration: 0.9 });
      }
      fills.forEach((f, i) => play(f, [{ opacity: 0 }, { opacity: ownOpacity(f) }], { duration: 0.55, delay: 0.1 + i * step(fills.length, 0.03) }));
      dots.forEach((d, i) => play(d, [{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 0.45, delay: 0.35 + i * step(dots.length, 0.02), easing: POP, origin: "50% 50%", box: true }));
    }
  }

  function htmlBars(root) {
    const grow = [...root.querySelectorAll(".cc-hb .tr i, .bars .bf, .dbar .pos i, .dbar .neg i, .stack, .vstack, .mbar i, .cc-fn-stage .fb i")].filter((el) => !el.dataset.ccm);
    grow.forEach((el, i) => {
      el.dataset.ccm = "1";
      play(el, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 0.7, delay: 0.08 + i * step(grow.length, 0.03), origin: el.closest(".neg") ? "100% 50%" : "0% 50%" });
    });
  }

  function heatCells(root) {
    const cells = [...root.querySelectorAll(".cc-heat-t td, .heat .h, .cell")].filter((el) => !el.dataset.ccm);
    cells.forEach((el, i) => {
      el.dataset.ccm = "1";
      play(el, [{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "scale(1)" }], { duration: 0.35, delay: i * step(cells.length, 0.012) });
    });
  }

  const NUM = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(\D*)$/;
  function countUp(root) {
    for (const kv of root.querySelectorAll(".kpi .kv, .stat .v, .ftier .fp")) {
      if (kv.dataset.ccm) continue;
      kv.dataset.ccm = "1";
      const node = [...kv.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!node) continue;
      const m = node.textContent.trim().match(NUM);
      if (!m) continue;
      const raw = m[2];
      const target = parseFloat(raw.replace(/,/g, ""));
      if (!isFinite(target) || target === 0) continue;
      const decimals = (raw.split(".")[1] || "").length;
      const commas = raw.includes(",");
      const fmt = (v) => {
        const s = decimals ? v.toFixed(decimals) : String(Math.round(v));
        return commas ? Number(s).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
      };
      const final = node.textContent;
      animate(0, target, {
        duration: 0.9,
        ease: [0.2, 0, 0, 1],
        onUpdate: (v) => { node.textContent = `${m[1]}${fmt(v)}${m[3]}`; },
        onComplete: () => { node.textContent = final; },
      });
    }
  }

  function charts(root) {
    if (!root) return;
    svgCharts(root);
    htmlBars(root);
    heatCells(root);
    countUp(root);
  }

  const rise = (el, delay, px = 10, duration = 0.45) => play(el, [{ opacity: 0, transform: `translateY(${px}px)` }, { opacity: 1, transform: "translateY(0)" }], { duration, delay });
  const topUnits = (host) => [...host.querySelectorAll(UNIT)].filter((u) => !u.parentElement.closest(UNIT) && u.offsetParent !== null);

  function page(host) {
    if (!host) return;
    const token = (host.__ccm = (host.__ccm || 0) + 1);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (host.__ccm !== token) return;
      host.querySelectorAll("[data-ccm]").forEach((el) => { delete el.dataset.ccm; });
      const units = topUnits(host);
      const now = units.filter(nearViewport);
      now.forEach((u, i) => { rise(u, Math.min(i * 0.04, 0.32)); charts(u); });
      for (const u of units.filter((x) => !now.includes(x))) {
        const stop = inView(u, () => { charts(u); stop(); }, { margin: "0px 0px -40px 0px" });
      }
      if (!units.length) charts(host);
    }));
  }

  function title(el) {
    if (el) rise(el, 0, 4, 0.3);
  }

  function watchPanel(body) {
    if (!body) return;
    new MutationObserver(() => {
      const kids = [...body.children].filter((k) => k.offsetParent !== null).slice(0, 14);
      kids.forEach((k, i) => rise(k, i * 0.035, 8, 0.38));
      requestAnimationFrame(() => charts(body));
    }).observe(body, { childList: true });
  }

  const boot = () => ["drBody", "drBody2", "modalBody"].forEach((id) => watchPanel(document.getElementById(id)));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.CCMOTION = { page, charts, title };
})();
