import { statSync } from "node:fs";
import { join } from "node:path";

const asset = (name: string): string => {
  try {
    return `/${name}?v=${Math.round(statSync(join(process.cwd(), "public", name)).mtimeMs).toString(36)}`;
  } catch {
    return `/${name}`;
  }
};

export type DashboardHtmlInput = {
  title: string;
  payloadUrl: string;
  share?: boolean;
};

const SHARE_BOOTSTRAP = `<script>
(function () {
  var key = "cc_share_token", hash = location.hash.slice(1), token = null;
  if (hash.indexOf(".") > 0) {
    try { sessionStorage.setItem(key, hash); } catch (e) {}
    token = hash;
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (!token) { try { token = sessionStorage.getItem(key); } catch (e) {} }
  try {
    var claims = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    document.body.dataset.payload = "/api/payloads/" + encodeURIComponent(claims.slug);
    window.__CC_AUTH = "Bearer " + token;
  } catch (e) {
    document.body.dataset.shareMissing = "1";
  }
})();
</script>`;

const TITLE_OVERRIDES: Record<string, string> = {
  sonos: "Sonos · Commercial Command Center",
  sony: "Sony · Commercial Command Center",
  shark: "Shark · Commercial Command Center",
};

export const dashboardTitle = (slug: string): string =>
  TITLE_OVERRIDES[slug] ?? `${slug.charAt(0).toUpperCase() + slug.slice(1)} · Commercial Command Center`;

export function renderDashboardHtml({ title, payloadUrl, share = false }: DashboardHtmlInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Spline+Sans+Mono:wght@400;500;600&family=Urbanist:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${asset("cco-dashboard.css")}">
<link rel="stylesheet" href="${asset("ai-visibility.css")}">
</head>
<body data-payload="${escapeAttr(payloadUrl)}"${process.env.SHOW_DATA_SOURCES === "true" ? ' data-sources="on"' : ""}>
${share ? SHARE_BOOTSTRAP : ""}
<div id="ccLoader" class="cc-loader" role="status" aria-live="polite">
  <div class="cc-loader-card">
    <div class="cc-spinner" aria-hidden="true"></div>
    <b id="ccLoaderTitle">Loading ${escapeHtml(title.split(" · ")[0])}</b>
    <span id="ccLoaderMsg">Fetching the latest build…</span>
    <div class="cc-loader-actions" id="ccLoaderActions" hidden>
      <button type="button" class="cc-loader-btn" onclick="location.reload()">Try again</button>
      <a class="cc-loader-link" href="/">All brands</a>
    </div>
  </div>
</div>
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
      <div class="crumb" id="crumb">Overview</div><span class="srcchip" id="srcChip" hidden></span>
      <h1 id="ptitle">360° Scorecard</h1>
    </div>
    <div class="top-r">
      <div class="topset" id="topCC">
        <div class="seg" id="cadence" role="group" aria-label="Review cadence"></div>
        <div class="selw"><select class="sel" id="retSel" aria-label="Retailer filter"></select></div>
        <button class="simchip" id="simBtn" title="What this dashboard is" hidden><i></i>Simulated forward view</button>
      </div>
      <div class="aiv" style="display:contents">
        <div class="topset" id="topConsole" hidden>
          <button class="scopebtn" id="scopeBtn" title="Change the questions, competitors, engines and parameters"><i></i><span id="scopeTxt">Scope</span></button>
          <button class="scopebtn qbtn" id="qbankBtn" title="Every question in scope, by stage, with each engine's answer"><i></i><span id="qbankTxt">Question bank</span></button>
          <a class="goodchip" href="#ai-evidence" title="Every answer opens to its receipt"><i></i><span id="evChip">Measured · engine answers</span></a>
        </div>
        <div class="topset" id="topWB" hidden>
          <div class="seg mini" id="weekSeg" title="Read the programme as of a week"></div>
          <div class="selw"><select class="sel" id="weekSel" aria-label="As of week"></select></div>
          <button class="simchip" id="wbSimBtn" title="What the workbench is and what anchors it"><i></i>Simulated programme view</button>
        </div>
      </div>
    </div>
  </header>
  <div id="pages"><div id="mobwarn">Built for a wide screen — some tables scroll sideways on a phone.</div></div>
</div>

<div id="scrim"></div>
<aside id="drawer" role="dialog" aria-modal="true" aria-labelledby="drTitle">
  <div class="dr-h"><div><h3 id="drTitle"></h3><p id="drSub"></p></div><button class="dr-x" id="drX" aria-label="Close">×</button></div>
  <div class="dr-b" id="drBody"></div>
</aside>

<div class="aiv">
<aside id="scopeDrawer" role="dialog" aria-modal="true" aria-labelledby="sdTitle">
  <div class="dr-h"><div><h3 id="sdTitle">Scope</h3><p id="sdSub">Change the questions, the competitor set and the engines. Every page recomputes from the captured answers.</p></div><button class="dr-x" id="sdX" aria-label="Close">×</button></div>
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
        <div><label>Market</label><select id="pMarket"><option value="us">United States</option></select></div>
        <div><label>Persona (live runs)</label><select id="pPersona"><option value="">Any shopper</option></select></div>
        <div><label>Runs per question</label><select id="pRuns"><option value="1" selected>1 · single pass</option><option value="3">3 · volatility read</option></select></div>
        <div><label>Cadence</label><select id="pCadence"><option>Per build</option></select></div>
      </div>
      <div class="note" style="margin-top:8px" id="paramNote"></div></div>
    <div class="scope-foot"><button class="btn ghost sm" id="resetCfg">Reset to measured scope</button><span class="note" id="cfgState"></span></div>
  </div>
</aside>
<aside id="drawer2" role="dialog" aria-modal="true" aria-labelledby="drTitle2">
  <div class="dr-h"><div><h3 id="drTitle2">—</h3><p id="drSub2"></p></div><button class="dr-x" id="drX2" aria-label="Close">×</button></div>
  <div class="dr-b" id="drBody2"></div>
</aside>
<div class="modal" id="modal" onclick="if(event.target===this)closeModal()"><div class="msheet"><button class="close" onclick="closeModal()">✕</button><div id="modalBody"></div></div></div>
</div>

<script src="${asset("cco-charts.js")}"></script>
<script src="${asset("cco-dashboard.js")}"></script>
<script src="${asset("cco-dashboard-pages.js")}"></script>
<script src="${asset("cco-measured-pages.js")}"></script>
<script src="${asset("cco-card-ask.js")}"></script>
<script type="module" src="${asset("ai-visibility.js")}"></script>
</body>
</html>`;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => String(s).replace(/[&<>"]/g, (c) => ESC[c] ?? c);
const escapeAttr = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);

export function renderSignInHtml(title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;font-family:system-ui,sans-serif;color:#1a1a1a}form{width:min(380px,calc(100vw - 32px));padding:28px;background:#fff;border:1px solid #e5e3dd;border-radius:16px;box-sizing:border-box}h1{font-size:20px;margin:0 0 6px}p{margin:0 0 16px;color:#6a6a6a;line-height:1.5;font-size:14px}input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d6d3cc;border-radius:10px;font-size:14px}button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:10px;background:#1a1a1a;color:#fff;font-weight:600;font-size:14px;cursor:pointer}#err{color:#b91c1c;margin:10px 0 0;min-height:1em}</style>
</head><body><form id="f"><h1>Private dashboard</h1><p>Sign in with the admin token, or open a share link you were sent.</p>
<input id="t" type="password" autocomplete="current-password" placeholder="Admin token" required><button type="submit">Sign in</button><p id="err" role="alert"></p></form>
<script>document.getElementById("f").onsubmit=async function(e){e.preventDefault();var r=await fetch("/api/admin/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:document.getElementById("t").value})});if(r.ok)location.reload();else document.getElementById("err").textContent="That token was not accepted.";};</script>
</body></html>`;
}
