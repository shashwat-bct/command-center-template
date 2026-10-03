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

// Known brands with their OWN simulation (config + captured data vendored
// into the image). For these the dashboard structure IS the brand's own.
// Any slug not in this set has its payload built by piggybacking on the Sonos
// simulation with the subject-row's pricing/reviews/AI fields overridden —
// which means competitor names, model catalog, retailer matrix are all
// Sonos's. We show a very visible banner so the viewer can't miss that.
const VENDORED_BRANDS = new Set(["sonos", "sony", "shark"]);

export async function GET(_req: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (!SLUG_RE.test(brand)) return new Response("invalid slug", { status: 400 });

  const title = TITLE_OVERRIDES[brand] ?? `${brand.charAt(0).toUpperCase() + brand.slice(1)} · Commercial Command Center`;
  const payloadUrl = `/api/payloads/${brand}`;
  const isVendored = VENDORED_BRANDS.has(brand);

  // Dynamic brands get the FULL variant with the AI Engine Visibility console,
  // AEO Workbench, and Snapshots viewer loaded alongside the base shell. For
  // vendored brands the base shell is enough (their config may not have the
  // AI visibility capture).
  const includeExtras = !isVendored || brand === "sony";
  const payloadAi = `/api/payloads/${brand}?kind=ai`;
  const payloadWb = `/api/payloads/${brand}?kind=wb`;
  const payloadSnap = `/api/payloads/${brand}?kind=snapshots`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Spline+Sans+Mono:wght@400;500;600&family=Urbanist:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/cco-dashboard.css">${includeExtras ? `
<link rel="stylesheet" href="/ai-visibility.css">
<link rel="stylesheet" href="/aeo-workbench.css">
<link rel="stylesheet" href="/cco-snapshots.css">` : ""}
<style>
.ref-banner {
  position: sticky; top: 0; z-index: 9999;
  padding: 10px 20px;
  background: linear-gradient(90deg, #f59e0b, #ef4444);
  color: #fff;
  font-family: 'Urbanist', ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  box-shadow: 0 2px 10px rgba(239, 68, 68, 0.3);
}
.ref-banner b { font-weight: 700; }
.ref-banner code { background: rgba(0,0,0,0.2); padding: 1px 6px; border-radius: 3px; font-family: 'Spline Sans Mono', ui-monospace, monospace; font-size: 11px; }
.ref-banner .ref-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #fff;
  animation: refPulse 1.6s ease-in-out infinite;
}
.ref-banner .ref-close {
  margin-left: auto;
  background: rgba(0,0,0,0.2); border: 0; color: #fff;
  padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;
}
.ref-banner .ref-close:hover { background: rgba(0,0,0,0.35); }
@keyframes refPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.3); }
}
body.ref-banner-closed .ref-banner { display: none; }
</style>
</head>
<body data-payload="${escapeAttr(payloadUrl)}"${includeExtras ? ` data-payload-ai="${escapeAttr(payloadAi)}" data-payload-wb="${escapeAttr(payloadWb)}" data-snapshots="${escapeAttr(payloadSnap)}"` : ""}>
${isVendored ? "" : `<div class="ref-banner" role="note">
  <span class="ref-dot" aria-hidden></span>
  <span>
    <b>Reference-structure dashboard.</b>
    Real for ${escapeHtml(brand)}: pricing, review rating, delivery days, AI share of voice, in-stock (from Keepa + Apify + Claude).
    Sonos reference data: the <b>competitor set</b> (Sonos, Amazon Echo, Apple HomePod, Bose, JBL) and the <b>product models</b> (Era 100, Beam Gen 2, etc.) and the <b>retailer / shelf / promotional / delivery-city breakdowns</b>.
    A real ${escapeHtml(brand)}-shaped dashboard needs a brand-specific config + captures (one-shot per brand).
  </span>
  <button type="button" class="ref-close" onclick="document.body.classList.add('ref-banner-closed')">dismiss</button>
</div>`}
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
      <div class="topset" id="topCC">
        <div class="seg" id="cadence" role="group" aria-label="Review cadence"></div>
        <div class="selw"><select class="sel" id="retSel" aria-label="Retailer filter"></select></div>
        <button class="simchip" id="simBtn" title="What this dashboard is"><i></i>Simulated forward view</button>
      </div>${includeExtras ? `
      <div class="aiv" style="display:contents">
        <div class="topset" id="topConsole" hidden>
          <button class="scopebtn" id="scopeBtn" title="Change the questions, competitors, engines and parameters"><i></i><span id="scopeTxt">Scope</span></button>
          <button class="scopebtn qbtn" id="qbankBtn" title="Every question in scope, by stage, with each engine's answer"><i></i><span id="qbankTxt">Question bank</span></button>
          <a class="goodchip" href="#ai-evidence" title="Every answer opens to its receipt"><i></i><span id="evChip">Measured · real sessions</span></a>
        </div>
        <div class="topset" id="topWB" hidden>
          <div class="seg mini" id="weekSeg" title="Read the programme as of a week"></div>
          <div class="selw"><select class="sel" id="weekSel" aria-label="As of week"></select></div>
          <button class="simchip" id="wbSimBtn" title="What the workbench is and what anchors it"><i></i>Simulated programme view</button>
        </div>
      </div>` : ""}
    </div>
  </header>
  <div id="pages"><div id="mobwarn">Built for a wide screen — some tables scroll sideways on a phone.</div></div>
</div>

<div id="scrim"></div>
<aside id="drawer" role="dialog" aria-modal="true" aria-labelledby="drTitle">
  <div class="dr-h"><div><h3 id="drTitle"></h3><p id="drSub"></p></div><button class="dr-x" id="drX" aria-label="Close">×</button></div>
  <div class="dr-b" id="drBody"></div>
</aside>${includeExtras ? `
<div class="aiv">
<aside id="scopeDrawer" role="dialog" aria-modal="true" aria-labelledby="sdTitle">
  <div class="dr-h"><div><h3 id="sdTitle">Scope</h3><p id="sdSub">Change the questions, the competitor set, the engines and the parameters. Every page recomputes from the captured answers.</p></div><button class="dr-x" id="sdX" aria-label="Close">×</button></div>
  <div class="dr-b" id="sdBody">
    <div class="scope-sec"><h4>Funnel &amp; questions <span id="qCount"></span></h4><div id="stageCfg"></div>
      <div class="addq"><input id="addQ" placeholder="Add a shopper question…"><button class="btn sm" id="addQBtn">Add</button></div>
      <div class="note" style="margin-top:6px">An added question isn't in the measured capture yet — it joins the bank and can be run live.</div></div>
    <div class="scope-sec"><h4>Competitor set <span id="bCount"></span></h4><div class="chips" id="brandCfg"></div>
      <div class="addq"><input id="addB" placeholder="Add a brand"><button class="btn sm ghost" id="addBBtn">Add</button></div>
      <div class="note" style="margin-top:6px">An added brand is read by text match on the captured answers (presence only) until the next capture reads it properly.</div></div>
    <div class="scope-sec"><h4>Engines</h4><div class="chips" id="engineCfg"></div></div>
    <div class="scope-sec"><h4>Parameters</h4>
      <div class="param">
        <div><label>Market</label><select id="pMarket"><option value="us">United States</option><option value="gb">United Kingdom</option><option value="de">Germany</option><option value="jp">Japan</option><option value="in">India</option></select></div>
        <div><label>Persona (live runs)</label><select id="pPersona"><option value="">Any shopper</option></select></div>
        <div><label>Runs per question</label><select id="pRuns"><option value="1">1 · single pass</option><option value="3" selected>3 · volatility read</option><option value="7">7 · stable estimate</option></select></div>
        <div><label>Cadence</label><select id="pCadence"><option>Weekly</option><option selected>Monthly</option><option>Daily</option></select></div>
      </div>
      <div class="note" style="margin-top:8px" id="paramNote"></div></div>
    <div class="scope-foot"><button class="btn ghost sm" id="resetCfg">Reset to measured scope</button><span class="note" id="cfgState"></span></div>
  </div>
</aside>
<aside id="drawer2" role="dialog" aria-modal="true" aria-labelledby="drTitle2">
  <div class="dr-h"><div><h3 id="drTitle2">—</h3><p id="drSub2"></p></div><button class="dr-x" id="drX2" aria-label="Close">×</button></div>
  <div class="dr-b" id="drBody2"></div>
</aside>
<div class="modal" id="modal" onclick="if(event.target===this)closeModal()"><div class="msheet"><button class="close" onclick="closeModal()">✕</button><div id="modalBody"></div></div>
</div>` : ""}

<script src="/cco-charts.js"></script>
<script src="/cco-dashboard.js"></script>
<script src="/cco-dashboard-pages.js"></script>
<script src="/cco-card-ask.js"></script>${includeExtras ? `
<script src="/cco-snapshots.js"></script>
<script type="module" src="/ai-visibility.js"></script>` : ""}
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
