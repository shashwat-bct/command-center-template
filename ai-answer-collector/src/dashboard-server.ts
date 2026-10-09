// Serves the AI Engine Visibility dashboards: one per brand × category per
// collection, built by `npm run payload`, rendered by the command-center-template
// console (dashboard/public/ai-visibility.js, patched to our six pages).
//
//   npm run dashboard            → http://localhost:4600
//   /                            every collection's dashboards
//   /d/<collection>/<brand-cat>  a dashboard
//   /api/payloads/<collection>/<brand-cat>   its payload
//   /files/<collection>/<path>   session images

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { PAIRS } from "./config/brands";
import { CATEGORIES } from "./config/categories";
import type { Manifest } from "./manifest";
import { CollectionStore, DATA_DIR } from "./store";

const PORT = Number(process.env.PORT || 4600);
const PUBLIC = join(import.meta.dirname, "..", "dashboard", "public");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);

const send = (res: ServerResponse, status: number, type: string, body: string) => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};
const notFound = (res: ServerResponse) => send(res, 404, "text/plain", "not found");

function sendFile(res: ServerResponse, file: string | null) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return notFound(res);
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

/** A path under `root`, or null when `rel` would escape it. */
function inside(root: string, rel: string): string | null {
  const p = resolve(root, normalize(rel).replace(/^([/\\])+/, ""));
  return p.startsWith(resolve(root) + "/") ? p : null;
}

const pairLabel = (key: string) => {
  const p = PAIRS.find((x) => x.key === key);
  const cat = CATEGORIES.find((c) => c.slug === p?.bc.category);
  return p && cat ? `${p.brand.label} · ${cat.name}` : key;
};

/** Collections with at least one built payload, newest first, with their payload keys. */
function collections(): Array<{ id: string; manifest: Manifest; payloads: string[] }> {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const store = new CollectionStore(d.name);
      const dir = store.abs("payloads");
      return { id: d.name, manifest: store.readJson<Manifest>("manifest.json")!, payloads: existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [] };
    })
    .filter((c) => c.manifest && c.payloads.length)
    .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

const HEAD = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans+Display:wght@400;500;600;700&family=Google+Sans+Text:wght@400;500;700&family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/cco-dashboard.css">
<link rel="stylesheet" href="/ai-visibility.css">
<link rel="stylesheet" href="/app.css">
</head>`;

function landing(): string {
  const cols = collections();
  const body = cols.length
    ? cols.map((c) => {
        const byCat = new Map<string, string[]>();
        for (const k of c.payloads) { const cat = PAIRS.find((p) => p.key === k)?.bc.category ?? k; byCat.set(cat, [...(byCat.get(cat) ?? []), k]); }
        return `<h2 class="sec">${esc(c.id)} <span class="tag">${esc(c.manifest.country)} · ${c.manifest.runs} runs · ${c.manifest.personas.map((p) => esc(p.label)).join(" & ")} · ${c.manifest.engines.map((e) => esc(e.label)).join(", ")}</span></h2>
        <div class="grid g2">${[...byCat].map(([cat, keys]) => `<section class="card"><div class="card-h"><div class="ct"><h3>${esc(CATEGORIES.find((x) => x.slug === cat)?.name ?? cat)}</h3><p>${keys.length} brand${keys.length === 1 ? "" : "s"}, each as the subject</p></div></div><div class="chips">${keys.map((k) => `<a class="chip" href="/d/${encodeURIComponent(c.id)}/${encodeURIComponent(k)}#overview">${esc(pairLabel(k).split(" · ")[0])}</a>`).join("")}</div></section>`).join("")}</div>`;
      }).join("")
    : `<div class="withheld-card"><b>No dashboards yet</b><p>Run <code>npm run collect</code>, <code>npm run enrich</code> and <code>npm run payload</code> for a collection.</p></div>`;
  return `${HEAD("AI Engine Visibility")}<body class="aiv landing"><main class="land"><header><h1>AI Engine Visibility</h1><p class="lead">One dashboard per brand and category, from the measured AI answers in each collection.</p></header>${body}</main></body></html>`;
}

function dashboard(collection: string, key: string): string {
  const others = collections();
  const options = others.flatMap((c) => c.payloads.map((k) => `<option value="/d/${encodeURIComponent(c.id)}/${encodeURIComponent(k)}" ${c.id === collection && k === key ? "selected" : ""}>${esc(pairLabel(k))} · ${esc(c.id)}</option>`)).join("");
  const [brand, cat] = pairLabel(key).split(" · ");
  return `${HEAD(`${pairLabel(key)} · AI Engine Visibility`)}
<body class="aiv" data-payload="/api/payloads/${encodeURIComponent(collection)}/${encodeURIComponent(key)}">
<a class="sronly" href="#pages">Skip to content</a>
<nav id="rail" aria-label="Pages">
  <div class="rail-top">
    <div class="bm"><b class="bm-name" id="bmName">${esc(brand)}</b><span class="bm-sub">${esc(cat ?? "")} · AI Engine Visibility</span></div>
    <div class="bm-tile" aria-hidden="true">${esc(brand.charAt(0))}</div>
  </div>
  <div class="period"><span id="scWin">—</span></div>
  <div class="nav" id="nav"></div>
  <div class="rail-foot">
    <a class="rf-btn" href="/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17"><path d="M3 12l9-8 9 8M5 10v10h14V10" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="rf-txt">All dashboards</span></a>
    <button class="rf-btn" id="railToggle" aria-label="Collapse navigation">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="rf-txt">Collapse</span>
    </button>
  </div>
</nav>

<div id="main">
  <header id="top">
    <div class="top-l">
      <div class="crumb" id="crumb">AI Engine Visibility</div>
      <h1 id="ptitle">Executive Summary</h1>
    </div>
    <div class="top-r">
      <div class="selw"><select class="sel" aria-label="Dashboard" onchange="location.href=this.value+location.hash">${options}</select></div>
      <div class="topset" id="lensSet"></div>
      <div class="topset" id="topConsole">
        <button class="scopebtn" id="scopeBtn" title="Change the questions, competitors and engines"><i></i><span id="scopeTxt">Scope</span></button>
        <button class="scopebtn qbtn" id="qbankBtn" title="Every question in scope, by stage"><i></i><span id="qbankTxt">Question bank</span></button>
        <span class="goodchip" title="Every answer opens to its receipt"><i></i><span id="evChip">Measured · engine answers</span></span>
      </div>
      <div class="topset" id="topWB" hidden></div>
    </div>
  </header>
  <div id="pages"></div>
</div>

<div id="scrim"></div>
<aside id="scopeDrawer" role="dialog" aria-modal="true" aria-labelledby="sdTitle">
  <div class="dr-h"><div><h3 id="sdTitle">Scope</h3><p id="sdSub">Change the questions, the competitor set and the engines. Every page recomputes from the captured answers.</p></div><button class="dr-x" id="sdX" aria-label="Close">×</button></div>
  <div class="dr-b" id="sdBody">
    <div class="scope-sec"><h4>Funnel &amp; questions <span id="qCount"></span></h4><div id="stageCfg"></div></div>
    <div class="scope-sec"><h4>Competitor set <span id="bCount"></span></h4><div class="chips" id="brandCfg"></div>
      <div class="addq"><input id="addB" placeholder="Add a brand"><button class="btn sm ghost" id="addBBtn">Add</button></div>
      <div class="note" style="margin-top:6px">An added brand is read by text match on the captured answers (presence only) until the next capture reads it properly.</div></div>
    <div class="scope-sec"><h4>Engines</h4><div class="chips" id="engineCfg"></div></div>
    <div class="scope-sec"><h4>Parameters</h4>
      <div class="param">
        <div><label>Market</label><select id="pMarket" disabled><option value="us">United States</option></select></div>
        <div><label>Personas</label><select disabled><option>Value Seeker &amp; Feature Enthusiast</option></select></div>
        <div><label>Runs per question</label><select disabled><option>3 · every question, every persona</option></select></div>
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

<script src="/cco-charts.js"></script>
<script type="module" src="/ai-visibility.js"></script>
</body>
</html>`;
}

createServer((req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const known = (c: string, k: string) => collections().some((x) => x.id === c && x.payloads.includes(k));
    if (!parts.length) return send(res, 200, TYPES[".html"], landing());
    if (parts[0] === "d" && parts.length === 3) return known(parts[1], parts[2]) ? send(res, 200, TYPES[".html"], dashboard(parts[1], parts[2])) : notFound(res);
    if (parts[0] === "api" && parts[1] === "payloads" && parts.length === 4) {
      if (!known(parts[2], parts[3])) return notFound(res);
      return sendFile(res, new CollectionStore(parts[2]).abs(`payloads/${parts[3]}.json`));
    }
    if (parts[0] === "files" && parts.length > 2) {
      if (!collections().some((c) => c.id === parts[1])) return notFound(res);
      return sendFile(res, inside(new CollectionStore(parts[1]).dir, parts.slice(2).join("/")));
    }
    return sendFile(res, inside(PUBLIC, url.pathname));
  } catch (e) {
    send(res, 500, "text/plain", (e as Error).message);
  }
}).listen(PORT, () => console.log(`[dashboard] http://localhost:${PORT}  (data: ${DATA_DIR})`));
