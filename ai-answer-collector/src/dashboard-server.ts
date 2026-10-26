// Serves the AI Engine Visibility dashboards: one per brand × category per
// collection, built by `npm run payload`, rendered by the command-center-template
// console (dashboard/public/ai-visibility.js, patched to our six pages).
//
//   npm run dashboard            → http://localhost:4600
//   /                            every collection's dashboards
//   /d/<collection>/<brand-cat>  a dashboard
//   /api/payloads/<collection>/<brand-cat>   its payload
//   /api/retail/<collection>/<brand-cat>     its retail payload (npm run retail), when built:
//                                            adds the 360° Scorecard, Retail Shelf and AI × Shelf pages
//   /files/<collection>/<path>   session images
//
// Data comes from data/ by default. Deployed, it reads the bucket instead:
//   DASHBOARD_BUCKET=ai-answer-collector   gs://<bucket>/<DASHBOARD_PREFIX><collection>/<same path as data/>, re-listed
//   DASHBOARD_PREFIX=google-smartphones/   every DASHBOARD_REFRESH_SECONDS (default 300), so a pushed week shows up by itself
//   DASHBOARD_PAIRS=google-smartphones     serve only these dashboards (comma-separated); with one, / opens it

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { Storage } from "@google-cloud/storage";
import { PAIRS } from "./config/brands";
import { CATEGORIES } from "./config/categories";
import type { Manifest } from "./manifest";
import { GCP_PROJECT } from "./secrets";
import { DATA_DIR } from "./store";

const PORT = Number(process.env.PORT || 4600);
const PUBLIC = join(import.meta.dirname, "..", "dashboard", "public");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
const PAIRS_ONLY = process.env.DASHBOARD_PAIRS ? new Set(process.env.DASHBOARD_PAIRS.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const SERVED_CATEGORIES = new Set(PAIRS.filter((p) => PAIRS_ONLY?.has(p.key)).map((p) => p.bc.category));
const REFRESH_MS = Number(process.env.DASHBOARD_REFRESH_SECONDS || 300) * 1000;

type Collection = { id: string; manifest: Manifest; payloads: string[]; retail: string[] };

/** Where collections live: data/ on this machine, or the bucket they are pushed to. */
type Source = {
  list(): Promise<Collection[]>;
  /** A file of a collection, by its path inside it; null when missing. */
  open(collection: string, rel: string): Promise<Readable | null>;
};

const keysIn = (names: string[], dir: string) => names.filter((n) => n.startsWith(`${dir}/`) && n.endsWith(".json") && !n.slice(dir.length + 1).includes("/")).map((n) => n.slice(dir.length + 1, -5));

const localSource: Source = {
  async list() {
    if (!existsSync(DATA_DIR)) return [];
    return readdirSync(DATA_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => {
        const dir = join(DATA_DIR, d.name), mf = join(dir, "manifest.json");
        if (!existsSync(mf)) return [];
        const ls = (sub: string) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).map((f) => `${sub}/${f}`) : []);
        const names = [...ls("payloads"), ...ls("retail")];
        return [{ id: d.name, manifest: JSON.parse(readFileSync(mf, "utf8")) as Manifest, payloads: keysIn(names, "payloads"), retail: keysIn(names, "retail") }];
      });
  },
  async open(collection, rel) {
    const file = inside(join(DATA_DIR, collection), rel);
    return file && existsSync(file) && statSync(file).isFile() ? createReadStream(file) : null;
  },
};

function bucketSource(name: string, prefix: string): Source {
  const bucket = new Storage({ projectId: GCP_PROJECT }).bucket(name);
  return {
    async list() {
      const [, , top] = await bucket.getFiles({ prefix, delimiter: "/", autoPaginate: false, maxResults: 1000 });
      const ids = ((top as { prefixes?: string[] })?.prefixes ?? []).map((p) => p.slice(prefix.length, -1));
      const cols = await Promise.all(ids.map(async (id) => {
        const names = (await Promise.all(["payloads/", "retail/"].map((d) => bucket.getFiles({ prefix: `${prefix}${id}/${d}`, delimiter: "/" }))))
          .flatMap(([files]) => files.map((f) => f.name.slice(prefix.length + id.length + 1)));
        if (!keysIn(names, "payloads").length) return null;
        const [buf] = await bucket.file(`${prefix}${id}/manifest.json`).download().catch(() => [null]);
        return buf ? { id, manifest: JSON.parse(buf.toString("utf8")) as Manifest, payloads: keysIn(names, "payloads"), retail: keysIn(names, "retail") } : null;
      }));
      return cols.filter((c): c is Collection => !!c);
    },
    async open(collection, rel) {
      if (!inside("/x", rel)) return null;
      const file = bucket.file(`${prefix}${collection}/${normalize(rel).replace(/^([/\\])+/, "")}`);
      const [exists] = await file.exists();
      return exists ? file.createReadStream() : null;
    },
  };
}

const PREFIX = (process.env.DASHBOARD_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
const SOURCE = process.env.DASHBOARD_BUCKET ? bucketSource(process.env.DASHBOARD_BUCKET, PREFIX && `${PREFIX}/`) : localSource;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);

const send = (res: ServerResponse, status: number, type: string, body: string) => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};
const notFound = (res: ServerResponse) => send(res, 404, "text/plain", "not found");

/** Streams a file, gzipped when it is text and the browser takes it (a payload is ~12 MB of JSON). */
function sendStream(req: IncomingMessage, res: ServerResponse, name: string, body: Readable | null, cache = "no-store") {
  if (!body) return notFound(res);
  const type = TYPES[extname(name)] ?? "application/octet-stream";
  const gzip = /^(text\/|application\/json)/.test(type) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  body.on("error", (e) => (res.headersSent ? res.destroy(e) : send(res, 500, "text/plain", e.message)));
  res.writeHead(200, { "content-type": type, "cache-control": cache, ...(gzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) });
  (gzip ? body.pipe(createGzip()) : body).pipe(res);
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

let listed: { at: number; cols: Promise<Collection[]> } | null = null;

/** Collections with at least one served payload, newest first; from the bucket, re-listed every REFRESH_MS. */
function collections(): Promise<Collection[]> {
  if (SOURCE === localSource || !listed || Date.now() - listed.at > REFRESH_MS) {
    const cols = SOURCE.list().then((all) => all
      .map((c) => ({ ...c, payloads: c.payloads.filter((k) => !PAIRS_ONLY || PAIRS_ONLY.has(k)) }))
      .filter((c) => c.payloads.length)
      .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt)));
    cols.catch(() => (listed = null));
    listed = { at: Date.now(), cols };
  }
  return listed.cols;
}

/** As collections(), but each payload only in its newest collection: that payload pools every earlier week. */
async function latest(): Promise<Collection[]> {
  const seen = new Set<string>();
  return (await collections())
    .map((c) => ({ ...c, payloads: c.payloads.filter((k) => !seen.has(k) && !!seen.add(k)) }))
    .filter((c) => c.payloads.length);
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

function landing(cols: Collection[]): string {
  const body = cols.length
    ? cols.map((c) => {
        const byCat = new Map<string, string[]>();
        for (const k of c.payloads) { const cat = PAIRS.find((p) => p.key === k)?.bc.category ?? k; byCat.set(cat, [...(byCat.get(cat) ?? []), k]); }
        return `<h2 class="sec">${esc(c.id)} <span class="tag">${esc(c.manifest.country)} · ${c.manifest.runs} runs · ${c.manifest.personas.map((p) => esc(p.label)).join(", ")} · ${c.manifest.engines.map((e) => esc(e.label)).join(", ")}</span></h2>
        <div class="grid g2">${[...byCat].map(([cat, keys]) => `<section class="card"><div class="card-h"><div class="ct"><h3>${esc(CATEGORIES.find((x) => x.slug === cat)?.name ?? cat)}</h3><p>${keys.length} brand${keys.length === 1 ? "" : "s"}, each as the subject</p></div></div><div class="chips">${keys.map((k) => `<a class="chip" href="/d/${encodeURIComponent(c.id)}/${encodeURIComponent(k)}#overview">${esc(pairLabel(k).split(" · ")[0])}</a>`).join("")}</div></section>`).join("")}</div>`;
      }).join("")
    : `<div class="withheld-card"><b>No dashboards yet</b><p>Run <code>npm run collect</code>, <code>npm run enrich</code> and <code>npm run payload</code> for a collection.</p></div>`;
  return `${HEAD("AI Engine Visibility")}<body class="aiv landing"><main class="land"><header><h1>AI Engine Visibility</h1><p class="lead">One dashboard per brand and category, from the measured AI answers in each collection.</p></header>${body}</main></body></html>`;
}

function dashboard(collection: string, key: string, retail: boolean): string {
  // each brand's dashboard stands alone: no switching to another brand's from here
  const options = `<option value="/d/${encodeURIComponent(collection)}/${encodeURIComponent(key)}" selected>${esc(pairLabel(key))}</option>`;
  const [brand, cat] = pairLabel(key).split(" · ");
  const product = retail ? "Command Center" : "AI Engine Visibility";
  return `${HEAD(`${pairLabel(key)} · ${product}`)}
<body class="aiv" data-payload="/api/payloads/${encodeURIComponent(collection)}/${encodeURIComponent(key)}"${retail ? ` data-payload-retail="/api/retail/${encodeURIComponent(collection)}/${encodeURIComponent(key)}"` : ""}>
<a class="sronly" href="#pages">Skip to content</a>
<nav id="rail" aria-label="Pages">
  <div class="rail-top">
    <div class="bm"><b class="bm-name" id="bmName">${esc(brand)}</b><span class="bm-sub">${esc(cat ?? "")} · ${product}</span></div>
    <div class="bm-tile" aria-hidden="true">${esc(brand.charAt(0))}</div>
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
      <div class="crumb" id="crumb">${product}</div>
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
        <div><label>Personas</label><select disabled><option>Value Seeker, Feature Enthusiast &amp; Neutral</option></select></div>
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
<script src="/retail-audit.js"></script>
<script src="/keyword-search.js"></script>
<script src="/explore.js"></script>
<script type="module" src="/ai-visibility.js"></script>
</body>
</html>`;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const find = async (c: string, k?: string) => (await collections()).find((x) => x.id === c && (!k || x.payloads.includes(k)));
    if (parts[0] === "healthz") return send(res, 200, "text/plain", "ok");
    if (!parts.length) {
      const cols = await latest();
      const only = PAIRS_ONLY?.size === 1 && cols.length === 1 && cols[0].payloads.length === 1;
      if (only) { res.writeHead(302, { location: `/d/${encodeURIComponent(cols[0].id)}/${encodeURIComponent(cols[0].payloads[0])}#overview` }); return res.end(); }
      return send(res, 200, TYPES[".html"], landing(cols));
    }
    if (parts[0] === "d" && parts.length === 3) {
      const c = await find(parts[1], parts[2]);
      return c ? send(res, 200, TYPES[".html"], dashboard(parts[1], parts[2], c.retail.includes(parts[2]))) : notFound(res);
    }
    if (parts[0] === "api" && (parts[1] === "payloads" || parts[1] === "retail") && parts.length === 4) {
      const c = await find(parts[2], parts[3]);
      if (!c || (parts[1] === "retail" && !c.retail.includes(parts[3]))) return notFound(res);
      return sendStream(req, res, "payload.json", await SOURCE.open(parts[2], `${parts[1]}/${parts[3]}.json`));
    }
    if (parts[0] === "files" && parts.length > 2) {
      // with DASHBOARD_PAIRS, only the session images of those pairs' categories (screenshots/<engine>/<category>/…)
      const rel = parts.slice(2).join("/");
      if (!(await find(parts[1])) || (PAIRS_ONLY && !(parts[2] === "screenshots" && SERVED_CATEGORIES.has(parts[4])))) return notFound(res);
      return sendStream(req, res, rel, await SOURCE.open(parts[1], rel), "private, max-age=86400");
    }
    const file = inside(PUBLIC, url.pathname);
    return sendStream(req, res, file ?? "", file && existsSync(file) && statSync(file).isFile() ? createReadStream(file) : null);
  } catch (e) {
    if (!res.headersSent) send(res, 500, "text/plain", (e as Error).message);
  }
}).listen(PORT, () => console.log(`[dashboard] http://localhost:${PORT}  (data: ${process.env.DASHBOARD_BUCKET ? `gs://${process.env.DASHBOARD_BUCKET}/${PREFIX}` : DATA_DIR}${PAIRS_ONLY ? `, only ${[...PAIRS_ONLY].join(", ")}` : ""})`));
