// File-backed brand dashboards served as a Route Handler returning raw HTML.
// Why not a React page? The bravo-platform shell JS mutates the DOM at parse
// time (populating #bmName with the brand label, filling #nav with page links,
// drawing into #pages). React 19's hydration can't reconcile those mutations
// and either errors or wipes them. Serving raw HTML sidesteps React entirely
// for this one route — the shell is a legacy classic-script app embedded as-is.
//
// Add a brand by: new row in BRANDS below, drop <slug>-command-center-data.json
// into /public (via `npm run build:<slug>` from bravo-platform, see root README).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Any URL-safe slug is accepted. The payload endpoint resolves it to the latest
// ready build in GCS and 404s only if a build has never run for that slug.
// A short-list of friendly titles for slugs we've seen before; the generic
// title is used for the rest.
const TITLE_OVERRIDES: Record<string, string> = {
  sonos: "Sonos · Commercial Command Center",
  sony: "Sony · Commercial Command Center",
  shark: "Shark · Commercial Command Center",
};

const SLUG_RE = /^[a-z0-9-]+$/;

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (!SLUG_RE.test(brand)) return new Response("invalid slug", { status: 400 });

  const title = TITLE_OVERRIDES[brand] ?? `${brand.charAt(0).toUpperCase() + brand.slice(1)} · Commercial Command Center`;
  const payloadUrl = `/api/payloads/${brand}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Spline+Sans+Mono:wght@400;500;600&family=Urbanist:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/cco-dashboard.css">
</head>
<body data-payload="${escapeAttr(payloadUrl)}">
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

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => String(s).replace(/[&<>"]/g, (c) => ESC[c] ?? c);
const escapeAttr = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);
