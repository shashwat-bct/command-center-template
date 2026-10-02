// localStorage-backed brand view. Served as raw HTML so the shell JS executes
// at HTML-parse time (no React hydration issues) and so an inline bootstrap
// script can synchronously read localStorage + set window.__CCO_PAYLOAD before
// the shell loads. See comments in app/[brand]/route.ts for why this isn't a
// React page.

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safeSlug = JSON.stringify(slug);
  const slugText = String(slug).replace(/[^a-z0-9-]/gi, "");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loading… · Command Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Spline+Sans+Mono:wght@400;500;600&family=Urbanist:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/cco-dashboard.css">
<style>
  .viewer-missing { max-width: 540px; margin: 80px auto; padding: 32px; background: #fff; border: 1px solid #e5e3dd; border-radius: 16px; font-family: 'Urbanist', system-ui, sans-serif; }
  .viewer-missing h1 { font-family: 'Newsreader', Georgia, serif; font-weight: 500; font-size: 28px; margin: 0 0 10px; }
  .viewer-missing p { color: #6a6a6a; line-height: 1.5; }
  .viewer-missing a { display: inline-block; margin-top: 16px; padding: 10px 16px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; }
  .viewer-missing code { background: #ececec; padding: 1px 6px; border-radius: 4px; font-family: 'Spline Sans Mono', ui-monospace, monospace; font-size: 12px; }
  body[data-missing] #rail, body[data-missing] #main, body[data-missing] #scrim, body[data-missing] #drawer { display: none !important; }
</style>
</head>
<body>
<script>
(function () {
  "use strict";
  var STORE = "cct_brands_v1";
  var slug = ${safeSlug};
  var store;
  try { store = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { store = {}; }
  var brand = store[slug];
  if (!brand || !brand.payload) { document.body.setAttribute("data-missing", slug); return; }
  window.__CCO_PAYLOAD = brand.payload;
  document.title = (brand.payload.meta && brand.payload.meta.title) || (brand.name + " · Commercial Command Center");
})();
</script>

<div id="missing" class="viewer-missing" style="display:none">
  <h1>No brand found</h1>
  <p id="missingMsg">No brand <code>${slugText}</code> in your browser's localStorage.</p>
  <a href="/admin">Add a brand →</a>
</div>
<script>
(function () {
  if (!document.body.hasAttribute("data-missing")) return;
  document.getElementById("missing").style.display = "";
})();
</script>

<a class="sronly" href="#pages">Skip to content</a>
<nav id="rail" aria-label="Drivers">
  <div class="rail-top">
    <div class="bm">
      <img class="bm-logo" id="bmLogo" alt="" hidden>
      <b class="bm-name" id="bmName">—</b>
      <span class="bm-sub">Atlas</span>
    </div>
    <div class="bm-tile" id="bmTile" aria-hidden="true"></div>
  </div>
  <div class="period"><span id="scWin">—</span></div>
  <div class="nav" id="nav"></div>
  <div class="rail-foot">
    <button class="rf-btn" id="railToggle" aria-label="Collapse navigation">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="rf-txt">Collapse</span>
    </button>
  </div>
</nav>

<div id="main">
  <header id="top">
    <div class="top-l">
      <div class="crumb" id="crumb">Overview</div>
      <h1 id="ptitle">360° Scorecard</h1>
    </div>
    <div class="top-r">
      <div class="seg" id="cadence" role="group" aria-label="Review cadence"></div>
      <div class="selw"><select class="sel" id="retSel" aria-label="Retailer filter"></select></div>
      <button class="simchip" id="simBtn" title="What this dashboard is"><i></i>Simulated forward view</button>
    </div>
  </header>
  <div id="pages"><div id="mobwarn">Built for a wide screen — some tables scroll sideways on a phone.</div></div>
</div>

<div id="scrim"></div>
<aside id="drawer" role="dialog" aria-modal="true" aria-labelledby="drTitle">
  <div class="dr-h"><div><h3 id="drTitle"></h3><p id="drSub"></p></div><button class="dr-x" id="drX" aria-label="Close">×</button></div>
  <div class="dr-b" id="drBody"></div>
</aside>

<script src="/cco-charts.js"></script>
<script src="/cco-dashboard.js"></script>
<script src="/cco-dashboard-pages.js"></script>
<script src="/cco-card-ask.js"></script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
