/* ===========================================================================
   EXPLORE — the answers behind every number, and a finder for brands, models
   and sources
   ---------------------------------------------------------------------------
   Loaded before ai-visibility.js, after keyword-search.js. Two things:

     · an "i" on every measured card: tapping it says what the card counts
       (which questions, which answers) and shows real examples from the
       answers or citations behind it, each opening to the full answer;

     · a "Brand & Source Finder" page in the Explore group: pick or type a
       brand ("Google"), a model ("Pixel 10 Pro") or a website ("rtings.com")
       and see, stage by stage, the questions and answers that name it — or,
       for a website, every citation of it — with the counts the other pages
       show. The selection lives in the hash (#ex-find?brand=google), so a
       finding is a link.

   Everything is read through window.__AIV, so the console's scope (questions,
   engines) and its persona / run / week filters apply.
   =========================================================================== */
(function () {
"use strict";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const pct = (v) => v == null || !isFinite(v) ? "—" : `${Math.round(v * 100)}%`;
const plural = (n, w, ws = w + "s") => `${n.toLocaleString()} ${n === 1 ? w : ws}`;
const uniq = (xs) => [...new Set(xs)];
const PAGE = "ex-find";

const ICONS = { ex_find: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>' };
const PAGEDEF = { id: PAGE, label: "Brand & Source Finder", icon: "ex_find", crumb: "Explore · Brands, models and sources", title: "Brand & Source Finder" };

/* ── look-ups on the console's data ───────────────────────────────────── */
let A = null;                                       // the console's window.__AIV
const D = () => A.D;
const SL = () => D().subjectLabel;
const brand = (id) => D().brands.find((b) => b.id === id) || { id, label: String(id).charAt(0).toUpperCase() + String(id).slice(1), color: "#80868b" };
const dot = (id) => `<span class="dot" style="background:${brand(id).color}"></span>`;
const qOf = (id) => D().bank.find((q) => q.id === id) || { id, text: id };
const stageOf = (a) => qOf(a.queryId).stage;
const stageL = (id) => (D().stages.find((s) => s.id === id) || {}).label || id;
const engL = (id) => A.engLabel(id);
const engIco = (id) => A.engIcon(id, engL(id));
const named = (a, id) => A.mention(a, A.brandsOn().find((b) => b.id === id) || brand(id));
const ansMeta = (a) => `${A.weeks().length > 1 && a.week ? `Week ${a.week} · ` : ""}${esc(engL(a.engine))} · ${esc(A.personaLabel(a.persona))} · run ${a.run}`;
const normP = (s) => String(s || "").toLowerCase().replace(/[\s\-/]+/g, " ").trim();
const host = (h) => String(h || "").toLowerCase().replace(/^www\./, "");

/* ── text: plain, matched, cut to a snippet ───────────────────────────── */
const plainCache = new WeakMap();
function plain(a) {
  let t = plainCache.get(a);
  if (t == null) {
    t = String(a.text || "").replace(/\[([^\]]+)\]\((?:https?:\/\/[^)\s]+)\)/g, "$1").replace(/\*\*|__|`/g, "").replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*•]\s+/gm, "• ").replace(/^\s*\|?\s*:?-{3,}.*$/gm, "").replace(/\s*\|\s*/g, " · ").replace(/[ \t]+/g, " ");
    plainCache.set(a, t);
  }
  return t;
}
const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A regex for the words to highlight: a brand's aliases, or a model name with flexible spacing. */
function termRe(words) {
  const ws = words.map((w) => String(w || "").trim()).filter(Boolean);
  if (!ws.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${ws.map((w) => w.split(/\s+/).map(reEsc).join("[\\s\\-]+")).join("|")})(?![\\p{L}\\p{N}])`, "giu");
}
const brandRe = (id) => { const b = A.brandsOn().find((x) => x.id === id) || brand(id); return termRe([b.label, ...(b.aliases || [])]); };
function snippet(a, re, pad = 130) {
  const t = plain(a).replace(/\n+/g, " ");
  let s = 0, e = Math.min(t.length, pad * 2);
  if (re) { re.lastIndex = 0; const m = re.exec(t); if (m) { s = Math.max(0, m.index - pad); e = Math.min(t.length, m.index + m[0].length + pad); } }
  if (s > 0) { const sp = t.indexOf(" ", s); if (sp > 0 && sp < s + 20) s = sp + 1; }
  if (e < t.length) { const sp = t.lastIndexOf(" ", e); if (sp > e - 20) e = sp; }
  return `${s > 0 ? "…" : ""}${mark(t.slice(s, e), re)}${e < t.length ? "…" : ""}`;
}
function mark(text, re) {
  if (!re) return esc(text);
  re.lastIndex = 0; let out = "", at = 0, m;
  while ((m = re.exec(text))) { out += esc(text.slice(at, m.index)) + `<mark class="kw-hl">${esc(m[0])}</mark>`; at = m.index + m[0].length; if (!m[0].length) re.lastIndex++; }
  return out + esc(text.slice(at));
}

/* ── the reader's models, folded by brand and spelling ────────────────── */
function models(answers) {
  const by = new Map();
  for (const a of answers) for (const m of a.brands || []) {
    if (!m.product) continue;
    const k = `${m.id}|${normP(m.product)}`;
    let r = by.get(k); if (!r) by.set(k, r = { brand: m.id, labels: {}, answers: new Set() });
    r.labels[m.product] = (r.labels[m.product] || 0) + 1; r.answers.add(a);
  }
  return [...by.values()].map((r) => ({ brand: r.brand, label: Object.entries(r.labels).sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0][0], n: r.answers.size })).sort((x, y) => y.n - x.n);
}
function hosts(answers) {
  const n = {}; for (const a of answers) for (const s of a.sources || []) if (s.host) n[host(s.host)] = (n[host(s.host)] || 0) + 1;
  return Object.entries(n).sort((x, y) => y[1] - x[1]);
}

/* ── one answer, in full, with the term highlighted ───────────────────── */
const REG = [];                                     // answers and citations the current markup points at
const reg = (x) => REG.push(x) - 1;
function openAnswer(i) {
  const r = REG[i]; if (!r) return;
  const a = r.a, q = qOf(a.queryId);
  const ranks = (a.brands || []).slice().sort((x, y) => (x.rank || 9) - (y.rank || 9)).map((m) => `<span class="ex-bchip">${dot(m.id)}<b>#${m.rank || "?"}</b> ${esc(brand(m.id).label)}${m.product ? ` · ${esc(m.product)}` : ""}${a.topPick === m.id ? ' <span class="ex-top">top pick</span>' : ""}</span>`).join("") || '<span class="kw-n">No tracked brand named</span>';
  const srcs = (a.sources || []).map((s) => `<li class="${r.host && host(s.host) === r.host ? "on" : ""}"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.host)}</a> <span class="kw-n">${esc(host(s.host))}${s.kind ? ` · ${esc(s.kind)}` : ""}</span></li>`).join("");
  A.openModal(`<div class="mhead"><h2>“${esc(q.text)}”</h2><p class="lede" style="margin:4px 0 0">${esc(stageL(q.stage))} · <span class="enl">${engIco(a.engine)}${ansMeta(a)}</span></p></div>
    <div class="ex-bchips">${ranks}</div>
    ${srcs ? `<details class="ex-srcs" ${r.host ? "open" : ""}><summary>${plural((a.sources || []).length, "source")} cited</summary><ol>${srcs}</ol></details>` : ""}
    <div class="kw-nav"><button type="button" class="btn ghost sm" onclick="EX.jump(-1)">↑ Previous</button><button type="button" class="btn ghost sm" onclick="EX.jump(1)">Next ↓</button><span class="kw-pos" id="exPos"></span>
      <button type="button" class="btn ghost sm" style="margin-left:auto" onclick="EX.question('${esc(a.queryId)}')">Every answer to this question</button></div>
    <div class="qcard"><div class="txt full ex-full">${A.md(a.text)}</div></div>`);
  const root = document.querySelector("#modalBody .ex-full"); if (!root || !r.re) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) { r.re.lastIndex = 0; if (!r.re.test(n.nodeValue)) continue; const span = document.createElement("span"); span.innerHTML = mark(n.nodeValue, r.re); n.replaceWith(...span.childNodes); }
  EX.at = -1; EX.jump(1);
}

/* ── shared markup ────────────────────────────────────────────────────── */
const card = (o) => `<section class="card${o.cls ? " " + o.cls : ""}"><div class="card-h"><div class="ct"><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.tag ? `<div class="ca">${o.tag}</div>` : ""}</div>${o.html || ""}</section>`;
const kpi = (o) => `<div class="kpi"><div class="kl">${esc(o.label)}</div><div class="kv">${o.value}${o.unit ? `<small>${o.unit}</small>` : ""}</div>${o.note ? `<div class="kn">${o.note}</div>` : ""}</div>`;
const bars = (rows) => `<div class="kw-bars">${rows.map((r) => `<div class="kw-bar${r.on ? " on" : ""}${r.click ? " click" : ""}"${r.click ? ` role="button" tabindex="0" onclick="${r.click}"` : ""}>
  <div class="kw-bl">${r.label}${r.sub ? `<small>${r.sub}</small>` : ""}</div>
  <div class="kw-track"><i style="width:${Math.max(r.v ? 2 : 0, Math.round((r.v || 0) * 100))}%;${r.color ? `background:${r.color}` : ""}"></i></div>
  <div class="kw-bv">${r.value}</div></div>`).join("")}</div>`;
const rankChips = (a, hlId) => (a.brands || []).slice().sort((x, y) => (x.rank || 9) - (y.rank || 9)).slice(0, 5)
  .map((m) => `<span class="ex-mini${m.id === hlId ? " on" : ""}">${dot(m.id)}#${m.rank || "?"} ${esc(brand(m.id).label)}${a.topPick === m.id ? " ★" : ""}</span>`).join("");
/** One answer as an example: question, who answered, the brands in order, the passage that matters. */
function exAnswer(a, { re = null, hlId = "", note = "", host: h = "" } = {}) {
  const i = reg({ a, re, host: h });
  return `<button type="button" class="ex-ex" onclick="EX.open(${i})"><span class="ex-q">“${esc(qOf(a.queryId).text)}”</span>
    <span class="kw-hit-h"><span class="enl">${engIco(a.engine)}${ansMeta(a)}</span><span class="kw-n">${esc(stageL(stageOf(a)))}</span>${note}</span>
    <span class="ex-minis">${rankChips(a, hlId) || '<span class="kw-n">no tracked brand named</span>'}</span>
    <span class="kw-snip">${snippet(a, re)}</span><span class="kw-read">Read the full answer →</span></button>`;
}
/** One citation as an example: the page, where it was cited, who the answer names. */
function exCite(a, s, { showQ = true } = {}) {
  const i = reg({ a, re: null, host: host(s.host) });
  return `<button type="button" class="ex-ex" onclick="EX.open(${i})"><span class="ex-cite"><b>${esc(host(s.host))}</b>${s.kind ? ` <span class="ex-kind">${esc(s.kind)}</span>` : ""}<span class="ex-ttl">${esc(s.title || s.url)}</span></span>
    <span class="kw-hit-h"><span class="enl">${engIco(a.engine)}${ansMeta(a)}</span></span>
    ${showQ ? `<span class="ex-q sm">“${esc(qOf(a.queryId).text)}”</span>` : ""}
    <span class="ex-minis">${rankChips(a) || '<span class="kw-n">the answer names no tracked brand</span>'}</span><span class="kw-read">Open the answer that cites it →</span></button>`;
}
/** n items spread across a key (engine, stage…), in a stable order, so examples aren't all from one place. */
function spread(list, n, key = (a) => a.engine) {
  const by = new Map(); for (const x of list) { const k = key(x); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  for (const arr of by.values()) arr.sort((x, y) => ((x.a || x).queryId > (y.a || y).queryId ? 1 : -1));
  // round-robin over the keys, a question not shown yet first, so the examples differ
  const out = [], seen = new Set(), lists = [...by.values()], qid = (x) => (x.a || x).queryId;
  for (const fresh of [true, false]) for (const l of lists.flatMap((l) => l.map((x, i) => [i, x])).sort((x, y) => x[0] - y[0]).map(([, x]) => x)) {
    if (out.length >= n) break;
    if (out.includes(l) || (fresh && seen.has(qid(l)))) continue;
    out.push(l); seen.add(qid(l));
  }
  return out;
}

/* ── the "i" on each card: what it counts, and examples behind it ─────── */
const ctx = () => {
  const all = A.activeAnswers(), cmp = A.compareAnswers(), s = D().subject;
  return { all, cmp, s, bs: A.brandsOn(), cmpLabel: A.compareLabel(), nCmpQ: uniq(cmp.map((a) => a.queryId)).length, nQ: uniq(all.map((a) => a.queryId)).length };
};
const BASE_ALL = (c) => `It reads every answer in scope: ${plural(c.all.length, "answer")} to ${plural(c.nQ, "question")}, including the ones that name ${esc(SL())} in the question.`;
const BASE_CMP = (c) => `It reads only the brand-neutral questions (${esc(c.cmpLabel)}): ${plural(c.cmp.length, "answer")} to ${plural(c.nCmpQ, "question")}. Questions that name a brand are left out, because an answer to “is the ${esc(SL())} … worth it?” names ${esc(SL())} by definition.`;
const cites = (answers, pred = () => true) => answers.flatMap((a) => (a.sources || []).filter((s) => s.host && pred(s, a)).map((s) => ({ a, s })));
const citeGroups = (list, keyFn, labelFn, per = 2, max = 5) => {
  const by = new Map(); for (const x of list) { const k = keyFn(x); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  return [...by.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, max).map(([k, arr]) => ({ title: labelFn(k, arr), items: spread(arr, per).map(({ a, s }) => exCite(a, s)) }));
};
const attrItems = (answers, id, pol, n) => spread(answers.filter((a) => (a.attributes?.[id] || []).some((x) => (x.polarity === "-") === (pol === "-"))), n)
  .map((a) => exAnswer(a, { re: brandRe(id), hlId: id, note: `<span class="ex-attrs">${(a.attributes[id] || []).filter((x) => (x.polarity === "-") === (pol === "-")).map((x) => `<span class="ex-attr ${pol === "-" ? "neg" : "pos"}">${pol === "-" ? "−" : "+"} ${esc(x.attr)}</span>`).join("")}</span>` }));

const SPECS = {
  funnelViz: (c) => ({ base: `${BASE_ALL(c)} Each tier is one stage. The share weights each mention by its position (1st counts most) and tone; “named in” counts questions where at least one answer names ${esc(SL())}.`,
    groups: D().stages.map((st) => ({ title: `${esc(st.label)}: answers that name ${esc(SL())}`, items: spread(c.all.filter((a) => stageOf(a) === st.id && named(a, c.s)), 2).map((a) => exAnswer(a, { re: brandRe(c.s), hlId: c.s })) })),
    link: { brand: c.s } }),
  presenceViz: (c) => ({ base: `${BASE_CMP(c)} “Named in” counts questions where at least one answer names the brand; position is where its first mention falls; top pick is the single product the answer recommends first.`,
    groups: c.bs.map((b) => ({ title: `${dot(b.id)}${esc(b.label)} named`, items: spread(c.cmp.filter((a) => named(a, b.id)), 2).map((a) => exAnswer(a, { re: brandRe(b.id), hlId: b.id })) })),
    link: { brand: c.s, base: "neutral" } }),
  engineViz: (c) => ({ base: `${BASE_CMP(c)} Each row is one engine's answers to those questions.`,
    groups: uniq(c.cmp.map((a) => a.engine)).map((e) => ({ title: `<span class="enl">${engIco(e)}${esc(engL(e))}</span>`, items: spread(c.cmp.filter((a) => a.engine === e), 2, stageOf).map((a) => exAnswer(a, { re: brandRe(c.s), hlId: c.s })) })),
    link: { brand: c.s, base: "neutral" } }),
  funnelHeat: (c) => ({ base: `${BASE_ALL(c)} Each cell is ${esc(SL())}'s share of one engine's answers at one stage.`,
    groups: D().stages.map((st) => ({ title: esc(st.label), items: uniq(c.all.map((a) => a.engine)).map((e) => c.all.find((a) => a.engine === e && stageOf(a) === st.id)).filter(Boolean).map((a) => exAnswer(a, { re: brandRe(c.s), hlId: c.s })) })),
    link: { brand: c.s } }),
  ovH2H: (c) => ({ base: `${BASE_CMP(c)} An answer counts when it names ${esc(SL())} and the rival; the one named first wins it.`,
    groups: c.bs.filter((b) => b.id !== c.s).map((b) => ({ title: `${esc(SL())} and ${esc(b.label)} in one answer`, items: spread(c.cmp.filter((a) => named(a, c.s) && named(a, b.id)), 2).map((a) => exAnswer(a, { re: termRe([SL(), b.label]), hlId: c.s })) })),
    link: { brand: c.s, base: "neutral" } }),
  ovWin: (c) => ({ base: `${BASE_CMP(c)} These are answers that leave ${esc(SL())} out.`,
    groups: [{ title: `Answers without ${esc(SL())}`, items: spread(c.cmp.filter((a) => !named(a, c.s)), 4).map((a) => exAnswer(a, { hlId: c.s, note: `<span class="kw-miss">${esc(SL())} not named</span>` })) }],
    link: { brand: c.s, base: "neutral" } }),
  cites: (c) => ({ base: `Every citation in every answer in scope (${plural(cites(c.all).length, "citation")}), each classified by the kind of site. Only engines that show their sources contribute.`,
    groups: citeGroups(cites(c.all), (x) => x.s.kind || "other", (k, arr) => `${esc(k)} · ${plural(arr.length, "citation")}`, 2, 6) }),
  hosts: (c) => ({ base: `Every citation in every answer in scope, grouped by website. “Named” is the share of answers citing the site that name the brand.`,
    groups: citeGroups(cites(c.all), (x) => host(x.s.host), (k, arr) => `<a href="#${PAGE}?source=${encodeURIComponent(k)}" onclick="EX.close()">${esc(k)}</a> · ${plural(arr.length, "citation")}`, 2, 4), link: { source: hosts(c.all)[0]?.[0] } }),
  gap: (c) => ({ base: `Answers that cite a website and don't name ${esc(SL())} anywhere in the answer.`,
    groups: citeGroups(cites(c.all, (s, a) => !named(a, c.s)), (x) => host(x.s.host), (k, arr) => `<a href="#${PAGE}?source=${encodeURIComponent(k)}" onclick="EX.close()">${esc(k)}</a> · ${plural(uniq(arr.map((x) => x.a)).length, "answer")} without ${esc(SL())}`, 2, 4) }),
  byengine: (c) => ({ base: `Every citation in every answer in scope, split by the engine that cited it.`,
    groups: citeGroups(cites(c.all), (x) => x.a.engine, (k, arr) => `<span class="enl">${engIco(k)}${esc(engL(k))}</span> · ${plural(arr.length, "citation")}`, 2, 6) }),
  owned: (c) => ({ base: `Citations of each brand's own website (${c.bs.map((b) => esc((b.owned || [`${b.id}.com`])[0])).join(", ")}) in the answers in scope.`,
    groups: c.bs.map((b) => { const l = cites(c.all, (s) => A.isOwnedHost(b, s.host)); return { title: `${dot(b.id)}${esc(b.label)}'s own pages · ${plural(l.length, "citation")}`, items: spread(l, 2).map(({ a, s }) => exCite(a, s)) }; }) }),
  attrs: (c) => ({ base: `${BASE_ALL(c)} The reader tags each brand in each answer with the attributes the answer praises (+) or criticises (−); a cell is praise minus criticism.`,
    groups: [{ title: `${esc(SL())} praised`, items: attrItems(c.all, c.s, "+", 2) }, { title: `${esc(SL())} criticised`, items: attrItems(c.all, c.s, "-", 2) },
      ...c.bs.filter((b) => b.id !== c.s).map((b) => ({ title: `${esc(b.label)} criticised`, items: attrItems(c.all, b.id, "-", 1) }))], link: { brand: c.s } }),
  attrbal: (c) => SPECS.attrs(c),
  attrlead: (c) => ({ base: `${BASE_ALL(c)} Where a rival's net praise for an attribute is higher than ${esc(SL())}'s.`,
    groups: c.bs.filter((b) => b.id !== c.s).map((b) => ({ title: `${esc(b.label)} praised`, items: attrItems(c.all, b.id, "+", 2) })) }),
  attreng: (c) => ({ base: `${BASE_ALL(c)} ${esc(SL())}'s attribute tags, split by engine.`,
    groups: uniq(c.all.map((a) => a.engine)).map((e) => ({ title: `<span class="enl">${engIco(e)}${esc(engL(e))}</span>`, items: [...attrItems(c.all.filter((a) => a.engine === e), c.s, "+", 1), ...attrItems(c.all.filter((a) => a.engine === e), c.s, "-", 1)] })) }),
  pick: (c) => ({ base: `${BASE_CMP(c)} The top pick is the one product an answer recommends above the rest; answers that don't commit to one aren't counted.`,
    groups: c.bs.map((b) => ({ title: `${dot(b.id)}${esc(b.label)} as the top pick`, items: spread(c.cmp.filter((a) => a.topPick === b.id), 2).map((a) => exAnswer(a, { re: brandRe(b.id), hlId: b.id })) })),
    link: { brand: c.s, base: "neutral" } }),
  h2h: (c) => SPECS.ovH2H(c),
  products: (c) => { const ms = models(c.cmp).slice(0, 4); return { base: `${BASE_CMP(c)} The reader extracts the model each answer names for each brand; a model counts once per answer. Keyword Search and the Finder count every question, so their numbers run higher.`,
    groups: ms.map((m) => { const re = termRe([m.label]); return { title: `${dot(m.brand)}${esc(m.label)} · ${plural(m.n, "answer")}`, items: spread(c.cmp.filter((a) => (a.brands || []).some((x) => x.id === m.brand && normP(x.product) === normP(m.label))), 2).map((a) => exAnswer(a, { re, hlId: m.brand })) }; }),
    link: ms[0] ? { model: ms[0].label, base: "neutral" } : null }; },
  weeks: (c) => { const ws = uniq(c.all.map((a) => a.week)).filter(Boolean).sort(); return { base: `${BASE_CMP(c)} Read one week at a time; each week is a fresh pass of the same questions.`,
    groups: ws.map((w) => ({ title: `Week ${w}`, items: spread(c.cmp.filter((a) => a.week === w && named(a, c.s)), 2).map((a) => exAnswer(a, { re: brandRe(c.s), hlId: c.s })) })), link: { brand: c.s, base: "neutral" } }; },
  drift: (c) => SPECS.weeks(c),
  vol: (c) => {
    // a question × engine × persona whose runs disagree on naming the subject: the volatility made concrete
    const by = new Map(); for (const a of c.all) { const k = `${a.week}|${a.queryId}|${a.engine}|${a.persona}`; if (!by.has(k)) by.set(k, []); by.get(k).push(a); }
    const flips = [...by.values()].filter((l) => l.length > 1 && uniq(l.map((a) => !!named(a, c.s))).length > 1).sort((x, y) => (x[0].queryId > y[0].queryId ? 1 : -1));
    return { base: `The same question asked of the same engine, as the same persona, several times in a week. Below: ${flips.length ? `one of the ${flips.length} cases where the runs disagree on naming ${esc(SL())}` : `no case where the runs disagree`}.`,
      groups: flips.slice(0, 2).map((l) => ({ title: `“${esc(qOf(l[0].queryId).text)}” · ${esc(engL(l[0].engine))}`, items: l.sort((x, y) => x.run - y.run).map((a) => exAnswer(a, { re: brandRe(c.s), hlId: c.s, note: named(a, c.s) ? "" : `<span class="kw-miss">${esc(SL())} not named</span>` })) })) };
  },
};

function openInfo(key, title) {
  const spec = SPECS[key]; if (!spec || !A) return;
  REG.length = 0;
  const o = spec(ctx());
  const groups = o.groups.filter((g) => g.items.length);
  const linkHash = o.link ? `#${PAGE}?${Object.entries(o.link).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
  A.openModal(`<div class="mhead"><h2>${esc(title)}</h2><p class="lede" style="margin:4px 0 0">What this card counts, and real answers behind it.</p></div>
    <div class="ex-base"><b>How it's counted</b><p>${o.base}</p></div>
    ${groups.map((g) => `<div class="ex-grp"><h4>${g.title}</h4><div class="ex-list">${g.items.join("")}</div></div>`).join("") || '<p class="kw-n">No examples in the current scope; widen the filters at the top.</p>'}
    ${linkHash ? `<div class="kw-more"><a class="btn ghost sm" href="${linkHash}" onclick="EX.close()">See every one in the Brand &amp; Source Finder →</a></div>` : ""}`);
}
/** Puts an "i" on every card that has a spec, once; cards are rebuilt on each render so this re-runs. */
function decorate() {
  for (const sec of document.querySelectorAll(".page section.card")) {
    if (sec.querySelector(":scope > .card-h .ex-i")) continue;
    const key = sec.dataset.lid || [...sec.querySelectorAll(":scope > [id]")].map((x) => x.id).find((id) => SPECS[id]);
    if (!key || !SPECS[key]) continue;
    const h = sec.querySelector(":scope > .card-h"); if (!h) continue;
    let ca = h.querySelector(":scope > .ca"); if (!ca) { ca = document.createElement("div"); ca.className = "ca"; h.appendChild(ca); }
    const t = (h.querySelector("h3") || {}).textContent || "";
    const b = document.createElement("button");
    b.type = "button"; b.className = "ex-i"; b.textContent = "i"; b.title = "How this is counted, with examples"; b.setAttribute("aria-label", `How “${t}” is counted, with examples`);
    b.onclick = (e) => { e.stopPropagation(); openInfo(key, t); };
    ca.appendChild(b);
  }
}

/* ── the finder page ──────────────────────────────────────────────────── */
const st = { kind: "", v: "", base: "all", stage: "", missing: false, shown: 8, open: new Set(), typed: "" };
const readHash = () => {
  const p = new URLSearchParams((location.hash.split("?")[1] || ""));
  const k = ["brand", "model", "source"].find((x) => p.has(x));
  return { kind: k || "", v: k ? p.get(k) : (p.get("q") || ""), base: p.get("base") === "neutral" ? "neutral" : "all" };
};
const writeHash = () => {
  const p = new URLSearchParams(); if (st.kind && st.v) p.set(st.kind, st.v); else if (st.typed) p.set("q", st.typed); if (st.base === "neutral") p.set("base", "neutral");
  const h = `#${PAGE}${[...p].length ? `?${p}` : ""}`; if (location.hash !== h) history.replaceState(null, "", h);
};
/** What a typed word most likely is: a tracked brand, a website, or a model the reader extracted. */
function resolve(q, answers) {
  const t = q.trim().toLowerCase(); if (!t) return { kind: "", v: "" };
  const b = A.brandsOn().find((x) => x.id === t || x.label.toLowerCase() === t || (x.aliases || []).some((al) => al.trim().toLowerCase() === t));
  if (b) return { kind: "brand", v: b.id };
  const hs = hosts(answers).map(([h]) => h);
  const ms = models(answers);
  const hostHit = hs.find((h) => h === t || h.startsWith(t + ".")) || (/\./.test(t) ? hs.find((h) => h.includes(t)) : null);
  if (hostHit) return { kind: "source", v: hostHit };
  if (ms.some((m) => normP(m.label).includes(normP(t)))) return { kind: "model", v: q.trim() };
  const partial = hs.find((h) => h.includes(t)); if (partial) return { kind: "source", v: partial };
  return { kind: "none", v: q.trim() };
}

const TPL = () => `<div class="kw-page ex-page">
  <div class="kw-box card">
    <label class="kw-in" for="exQ">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${ICONS.ex_find}</svg>
      <input id="exQ" type="search" autocomplete="off" spellcheck="false" placeholder="A brand, a model or a website — then press Enter" aria-label="Brand, model or website">
      <button type="button" class="kw-x" id="exX" aria-label="Clear" hidden>×</button>
    </label>
    <div id="exChips" class="ex-chips"></div>
    <div class="kw-opts"><div class="seg mini" role="group" aria-label="Which questions to count">
      <button type="button" id="exBaseAll">All questions</button><button type="button" id="exBaseCmp">Brand-neutral questions only</button></div>
      <span class="ex-why" id="exWhy"></span></div>
  </div>
  <div id="exOut"></div>
</div>`;

let wired = false;
function wire() {
  if (wired || !$("exQ")) return; wired = true;
  $("exQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); EX.type(e.target.value); } if (e.key === "Escape" && e.target.value) { e.stopPropagation(); EX.clear(); } });
  $("exX").onclick = () => { EX.clear(); $("exQ").focus(); };
  $("exBaseAll").onclick = () => { st.base = "all"; st.stage = ""; writeHash(); draw(); };
  $("exBaseCmp").onclick = () => { st.base = "neutral"; st.stage = ""; writeHash(); draw(); };
  window.addEventListener("hashchange", () => { if (!location.hash.startsWith(`#${PAGE}`)) return; fromHash(); draw(); });
}
function fromHash() {
  const h = readHash(); st.base = h.base; st.stage = ""; st.shown = 8; st.open.clear(); st.missing = false;
  if (h.kind) { st.kind = h.kind; st.v = h.v; st.typed = ""; } else { st.typed = h.v; st.kind = ""; st.v = ""; }
  if ($("exQ")) $("exQ").value = st.kind === "brand" ? brand(st.v).label : (st.v || st.typed);
}
const pick = (kind, v) => { st.kind = kind; st.v = v; st.typed = ""; st.stage = ""; st.shown = 8; st.open.clear(); st.missing = false; if ($("exQ")) $("exQ").value = kind === "brand" ? brand(v).label : v; writeHash(); draw(); window.scrollTo({ top: 0, behavior: "smooth" }); };

window.EX = {
  open: (i) => openAnswer(i),
  question: (id) => A.openQuestion(id),
  close: () => window.closeModal(),
  brand: (id) => pick("brand", id), model: (v) => pick("model", v), source: (v) => pick("source", v),
  type: (q) => { const r = resolve(q, base(A.activeAnswers())); if (r.kind && r.kind !== "none") pick(r.kind, r.v); else { st.kind = ""; st.v = ""; st.typed = q.trim(); writeHash(); draw(); } },
  clear: () => { st.kind = ""; st.v = ""; st.typed = ""; if ($("exQ")) $("exQ").value = ""; writeHash(); draw(); },
  stage: (s) => { st.stage = st.stage === s ? "" : s; st.shown = 8; draw(); },
  more: () => { st.shown += 8; draw(); },
  expand: (id) => { st.open.has(id) ? st.open.delete(id) : st.open.add(id); draw(); },
  missing: () => { st.missing = !st.missing; draw(); },
};
EX.jump = (d) => {
  const marks = [...document.querySelectorAll("#modalBody .ex-full mark.kw-hl")]; const pos = $("exPos");
  if (!marks.length) { if (pos) pos.textContent = ""; return; }
  marks.forEach((m) => m.classList.remove("cur")); EX.at = (EX.at + d + marks.length) % marks.length;
  marks[EX.at].classList.add("cur"); marks[EX.at].scrollIntoView({ block: "center", behavior: "smooth" }); if (pos) pos.textContent = `${EX.at + 1} of ${marks.length}`;
};

const base = (all) => st.base === "neutral" ? all.filter((a) => A.isCompareStage(stageOf(a))) : all;

function chips(answers) {
  const s = D().subject;
  const ms = models(answers); const mine = ms.filter((m) => m.brand === s).slice(0, 5); const top = [...mine, ...ms.filter((m) => m.brand !== s)].slice(0, 10);
  const hs = hosts(answers).slice(0, 10).map(([h]) => h);
  const on = (k, v) => st.kind === k && normP(st.v) === normP(v) ? " on" : "";
  return `<div class="ex-chrow"><span class="kw-sl">Brands</span>${A.brandsOn().map((b) => `<button type="button" class="kw-chip${on("brand", b.id)}" onclick="EX.brand('${esc(b.id)}')">${dot(b.id)}${esc(b.label)}</button>`).join("")}</div>
    <div class="ex-chrow"><span class="kw-sl">Models</span>${top.map((m) => `<button type="button" class="kw-chip${on("model", m.label)}" onclick="EX.model(${esc(JSON.stringify(m.label))})">${dot(m.brand)}${esc(m.label)}</button>`).join("")}</div>
    ${hs.length ? `<div class="ex-chrow"><span class="kw-sl">Websites</span>${hs.map((h) => `<button type="button" class="kw-chip${on("source", h)}" onclick="EX.source('${esc(h)}')">${esc(h)}</button>`).join("")}</div>` : ""}`;
}

function draw() {
  if (!A || !$("exOut")) return;
  wire();
  REG.length = 0;
  const all = base(A.activeAnswers());
  $("exX").hidden = !(st.v || st.typed);
  $("exBaseAll").classList.toggle("on", st.base === "all"); $("exBaseCmp").classList.toggle("on", st.base === "neutral");
  $("exWhy").innerHTML = st.base === "all"
    ? `Counts every question, including the ones that name a brand, like Keyword Search. The Funnel's presence table and Picks &amp; Products read the brand-neutral questions only, so their counts are lower.`
    : `Only the questions that name no brand (${esc(A.compareLabel())}), the same base as the Funnel's presence table and Picks &amp; Products.`;
  $("exChips").innerHTML = chips(all);
  if (st.kind === "brand" || st.kind === "model") return drawNamed(all);
  if (st.kind === "source") return drawSource(all);
  $("exOut").innerHTML = st.typed
    ? `<div class="withheld-card"><b>Nothing matches “${esc(st.typed)}”</b><p>It isn't a tracked brand, a model the reader extracted, or a website the engines cite in the ${plural(all.length, "answer")} in scope. Pick one of the buttons above, or search the answers' full text in <a href="#kw-search?q=${encodeURIComponent(st.typed)}">Keyword Search</a>.</p></div>`
    : landing(all);
}

function landing(all) {
  const s = D().subject;
  const rows = A.brandsOn().map((b) => { const n = all.filter((a) => named(a, b.id)).length; return { label: `${dot(b.id)}${esc(b.label)}${b.id === s ? ' <small class="kw-you">you</small>' : ""}`, sub: `named in ${plural(n, "answer")}`, v: all.length ? n / all.length : 0, value: pct(all.length ? n / all.length : null), color: b.color, click: `EX.brand('${esc(b.id)}')` }; });
  const hs = hosts(all).slice(0, 8); const mx = hs[0] ? hs[0][1] : 1;
  return `<div class="grid g2 kw-g">
    ${card({ title: "Brands", sub: "Share of the answers in scope that name each brand. Tap one for the questions behind it, stage by stage.", html: bars(rows) })}
    ${card({ title: "Most-cited websites", sub: "Citations in the answers in scope. Tap one for every citation of it.", html: bars(hs.map(([h, n]) => ({ label: esc(h), v: n / mx, value: `${n}`, click: `EX.source('${esc(h)}')` }))) })}
  </div>
  <div class="kw-tips card"><b>What this page answers</b><ul>
    <li>“The funnel says ${esc(SL())} is named in so many Attention questions: which ones?” Pick ${esc(SL())}, then tap a stage.</li>
    <li>“Which answers recommend this model, and what do they say?” Pick a model.</li>
    <li>“What does this website get cited for, and who do those answers name?” Pick a website.</li>
    <li>For any word in the answers' full text (a feature, a retailer), use <a href="#kw-search">Keyword Search</a>.</li></ul></div>`;
}

/* a brand or a model: where it is named, stage by stage, and the answers that name it */
function drawNamed(all) {
  const s = D().subject, isB = st.kind === "brand";
  const mOf = isB ? (a) => named(a, st.v) : (a) => (a.brands || []).find((m) => m.product && normP(m.product).includes(normP(st.v)));
  const label = isB ? brand(st.v).label : st.v;
  const re = isB ? brandRe(st.v) : termRe([st.v]);
  const hits = all.filter((a) => mOf(a));
  const bid = isB ? st.v : (hits[0] && mOf(hits[0]).id) || "";
  const qsAll = uniq(all.map((a) => a.queryId)), qsHit = uniq(hits.map((a) => a.queryId));
  const top = hits.filter((a) => a.topPick && a.topPick === mOf(a).id).length;
  const ranks = hits.map((a) => mOf(a).rank).filter(Boolean); const avg = ranks.length ? ranks.reduce((x, y) => x + y, 0) / ranks.length : null;
  if (!hits.length) { $("exOut").innerHTML = `<div class="withheld-card"><b>No answer in scope names ${esc(label)}</b><p>Widen the filters above${st.base === "neutral" ? " or switch to All questions" : ""}, or search the full text in <a href="#kw-search?q=${encodeURIComponent(label)}">Keyword Search</a>.</p></div>`; return; }

  // stage by stage, the same counts as the funnel: questions named in, and answers
  const stages = D().stages.filter((x) => all.some((a) => stageOf(a) === x.id));
  const stRows = stages.map((x) => { const sa = all.filter((a) => stageOf(a) === x.id), sh = sa.filter((a) => mOf(a));
    return { id: x.id, label: x.label, aida: x.aida, cmp: A.isCompareStage(x.id), q: uniq(sh.map((a) => a.queryId)).length, qOf: uniq(sa.map((a) => a.queryId)).length, n: sh.length, of: sa.length, top: sh.filter((a) => a.topPick === mOf(a).id).length }; });
  const stTable = `<div class="tblwrap"><table class="t ex-st"><thead><tr><th>Stage</th><th class="num">Questions named in</th><th class="num">Answers naming it</th><th class="num">Share of answers</th><th class="num">Top pick</th></tr></thead><tbody>${
    stRows.map((r) => `<tr class="tap${st.stage === r.id ? " subj" : ""}" onclick="EX.stage('${r.id}')"><td>${esc(r.label)}<small class="kw-n">${r.aida && r.aida !== r.label ? ` · ${esc(r.aida)}` : ""}${r.cmp ? "" : " · questions name a brand"}</small></td><td class="num"><b>${r.q}</b> / ${r.qOf}</td><td class="num">${r.n} / ${r.of}</td><td class="num">${pct(r.of ? r.n / r.of : null)}</td><td class="num">${r.top}</td></tr>`).join("")}</tbody></table></div>
    <div class="note" style="margin-top:8px">Tap a stage to list only its questions. “Questions named in” is the funnel's “named in”: a question counts when at least one of its answers names ${esc(label)}.</div>`;
  const engines = uniq(all.map((a) => a.engine));
  const engRows = engines.map((e) => { const of = all.filter((a) => a.engine === e).length, n = hits.filter((a) => a.engine === e).length; return { label: `<span class="enl">${engIco(e)}${esc(engL(e))}</span>`, sub: `${n} of ${of} answers`, v: of ? n / of : 0, value: pct(of ? n / of : null) }; }).sort((x, y) => y.v - x.v);
  const hs = hosts(hits).slice(0, 8); const mxH = hs[0] ? hs[0][1] : 1;
  const srcCard = card({ title: `Websites cited when ${esc(label)} is named`, sub: hs.length ? "Citations in the answers that name it. Tap one for every citation of it." : "None of these answers cites a source (Claude answers without citations).",
    html: hs.length ? bars(hs.map(([h, n]) => ({ label: esc(h), v: n / mxH, value: `${n}`, click: `EX.source('${esc(h)}')` }))) : "" });
  let side;
  if (isB) {
    const ms = models(hits).filter((m) => m.brand === st.v).slice(0, 8); const mx = ms[0] ? ms[0].n : 1;
    side = card({ title: `${esc(label)} models named`, sub: "The models the reader extracted from these answers. Tap one to see where it is named.", html: ms.length ? bars(ms.map((m) => ({ label: esc(m.label), v: m.n / mx, value: `${m.n}`, color: brand(m.brand).color, click: `EX.model(${esc(JSON.stringify(m.label))})` }))) : '<p class="kw-n">No model extracted.</p>' });
  } else {
    const co = {}; for (const a of hits) for (const m of a.brands || []) if (m.id !== bid) co[m.id] = (co[m.id] || 0) + 1;
    side = card({ title: "Brands named alongside it", sub: "Share of these answers that also name each brand.", html: bars(Object.entries(co).sort((x, y) => y[1] - x[1]).map(([id, n]) => ({ label: `${dot(id)}${esc(brand(id).label)}`, v: n / hits.length, value: pct(n / hits.length), color: brand(id).color, click: `EX.brand('${esc(id)}')` }))) });
  }

  // the questions, stage by stage
  const inStage = (a) => !st.stage || stageOf(a) === st.stage;
  const order = D().bank.map((q) => q.id);
  const qids = uniq(all.filter(inStage).map((a) => a.queryId)).sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const withHit = qids.filter((id) => qsHit.includes(id)), without = qids.filter((id) => !qsHit.includes(id));
  withHit.sort((x, y) => hits.filter((a) => a.queryId === y).length - hits.filter((a) => a.queryId === x).length || order.indexOf(x) - order.indexOf(y));
  const qBlock = (id) => {
    const qa = all.filter((a) => a.queryId === id), qh = qa.filter((a) => mOf(a)); const q = qOf(id); const open = st.open.has(id);
    const list = (qh.length ? qh : qa).sort((x, y) => String(x.engine).localeCompare(y.engine) || String(x.persona).localeCompare(y.persona) || x.run - y.run);
    const items = list.slice(0, open ? list.length : 3).map((a) => { const m = mOf(a); return `<li class="kw-hit">${exAnswer(a, { re, hlId: bid, note: m ? `<span class="ex-pos">#${m.rank || "?"}${m.product ? ` · ${esc(m.product)}` : ""}${a.topPick === m.id ? " · top pick" : ""}</span>` : `<span class="kw-miss">${esc(label)} not named</span>` })}</li>`; }).join("");
    const picks = {}; for (const a of qa) if (a.topPick) picks[a.topPick] = (picks[a.topPick] || 0) + 1;
    return `<div class="kw-q"><div class="kw-qh"><div><div class="kw-qt">“${esc(q.text)}”</div><div class="kw-qm">${esc(stageL(q.stage))} · named in <b>${qh.length}</b> of ${plural(qa.length, "answer")}${Object.keys(picks).length ? ` · top picks ${Object.entries(picks).sort((x, y) => y[1] - x[1]).map(([b, n]) => `${dot(b)}${esc(brand(b).label)} ${n}`).join(" ")}` : ""}</div></div>
      <button type="button" class="btn ghost sm" onclick="EX.question('${esc(id)}')">Every answer to this question</button></div><ul class="kw-hits">${items}</ul>${list.length > 3 ? `<button type="button" class="kw-expand" onclick="EX.expand('${esc(id)}')">${open ? "Show fewer" : `Show ${list.length - 3} more answer${list.length - 3 === 1 ? "" : "s"}`}</button>` : ""}</div>`;
  };
  const shownQ = withHit.slice(0, st.shown);
  const stageName = st.stage ? stageL(st.stage) : "";

  $("exOut").innerHTML = `
  <div class="grid g4 kw-kpis">
    ${kpi({ label: "Answers naming it", value: hits.length.toLocaleString(), unit: ` / ${all.length.toLocaleString()}`, note: `${pct(hits.length / all.length)} of the answers in scope` })}
    ${kpi({ label: "Questions named in", value: qsHit.length, unit: ` / ${qsAll.length}`, note: "at least one answer names it" })}
    ${kpi({ label: "Top pick", value: top.toLocaleString(), note: isB ? `answers whose single top pick is ${esc(label)}` : `answers whose top pick is its brand, naming this model` })}
    ${kpi({ label: "Average position", value: avg ? avg.toFixed(1) : "—", note: "order of first mention among the brands (1 = first)" })}
  </div>
  ${card({ title: `${esc(label)} through the funnel`, sub: `Where ${esc(label)} is named, stage by stage, on ${st.base === "neutral" ? "the brand-neutral questions" : "every question"}.`, html: stTable })}
  <div class="grid g3 kw-g">
    ${card({ title: "By engine", sub: "Share of each engine's answers that name it.", html: bars(engRows) })}
    ${side}${srcCard}
  </div>
  ${card({ title: `${stageName ? `${esc(stageName)} questions` : "The questions"} that name ${esc(label)}`, sub: `${plural(withHit.length, "question")}${stageName ? ` at ${esc(stageName.toLowerCase())}` : ""} where at least one answer names it, most answers first${st.stage ? ` · <a href="javascript:EX.stage('${st.stage}')">show every stage</a>` : ""}. Tap an answer to read it in full.`,
    html: `<div class="kw-list">${shownQ.map(qBlock).join("")}</div>${withHit.length > st.shown ? `<div class="kw-more"><button type="button" class="btn ghost sm" onclick="EX.more()">Show more questions (${withHit.length - st.shown} left)</button></div>` : ""}
      ${without.length ? `<div class="ex-miss"><button type="button" class="btn ghost sm" onclick="EX.missing()">${st.missing ? "Hide" : "Show"} the ${plural(without.length, "question")} where no answer names ${esc(label)}</button>${st.missing ? `<div class="kw-list">${without.map(qBlock).join("")}</div>` : ""}</div>` : ""}` })}`;
}

/* a website: every citation of it, and who the citing answers name */
function drawSource(all) {
  const h = host(st.v);
  const match = (x) => { const y = host(x); return y === h || y.endsWith("." + h); };
  const cs = cites(all, (s) => match(s.host));
  const citing = uniq(cs.map((x) => x.a));
  if (!cs.length) { $("exOut").innerHTML = `<div class="withheld-card"><b>No answer in scope cites ${esc(h)}</b><p>Only ChatGPT and Gemini show their sources. Widen the filters above${st.base === "neutral" ? " or switch to All questions" : ""}.</p></div>`; return; }
  const withSrc = all.filter((a) => (a.sources || []).length);
  const s = D().subject;
  const qsHit = uniq(citing.map((a) => a.queryId));
  const subjIn = citing.filter((a) => named(a, s)).length, subjAll = withSrc.filter((a) => named(a, s)).length;
  const stages = D().stages.filter((x) => all.some((a) => stageOf(a) === x.id));
  const stRows = stages.map((x) => { const sa = withSrc.filter((a) => stageOf(a) === x.id), sc = citing.filter((a) => stageOf(a) === x.id); return { label: `${esc(x.label)}`, sub: `${sc.length} of ${sa.length} answers with sources`, v: sa.length ? sc.length / sa.length : 0, value: pct(sa.length ? sc.length / sa.length : null), on: st.stage === x.id, click: `EX.stage('${x.id}')` }; });
  const engines = uniq(withSrc.map((a) => a.engine));
  const engRows = engines.map((e) => { const of = withSrc.filter((a) => a.engine === e).length, n = citing.filter((a) => a.engine === e).length; return { label: `<span class="enl">${engIco(e)}${esc(engL(e))}</span>`, sub: `${n} of ${of} answers with sources`, v: of ? n / of : 0, value: pct(of ? n / of : null) }; }).sort((x, y) => y.v - x.v);
  const bRows = A.brandsOn().map((b) => { const n = citing.filter((a) => named(a, b.id)).length; return { label: `${dot(b.id)}${esc(b.label)}${b.id === s ? ' <small class="kw-you">you</small>' : ""}`, sub: `${n} of ${citing.length} citing answers`, v: n / citing.length, value: pct(n / citing.length), color: b.color, click: `EX.brand('${esc(b.id)}')` }; }).sort((x, y) => y.v - x.v);
  const pages = {}; for (const { s: x } of cs) { const k = String(x.url || "").split("#")[0]; (pages[k] ||= { n: 0, title: x.title, url: x.url }).n++; }
  const pageRows = Object.values(pages).sort((x, y) => y.n - x.n).slice(0, 10);

  const shownC = cs.filter((x) => !st.stage || stageOf(x.a) === st.stage);
  const byQ = new Map(); for (const x of shownC) { if (!byQ.has(x.a.queryId)) byQ.set(x.a.queryId, []); byQ.get(x.a.queryId).push(x); }
  const groups = [...byQ.entries()].sort((x, y) => y[1].length - x[1].length);
  const qBlock = ([id, list]) => { const open = st.open.has(id); const q = qOf(id);
    const items = list.slice(0, open ? list.length : 3).map(({ a, s: x }) => `<li class="kw-hit">${exCite(a, x, { showQ: false })}</li>`).join("");
    return `<div class="kw-q"><div class="kw-qh"><div><div class="kw-qt">“${esc(q.text)}”</div><div class="kw-qm">${esc(stageL(q.stage))} · ${plural(list.length, "citation")} in ${plural(uniq(list.map((x) => x.a)).length, "answer")}</div></div>
      <button type="button" class="btn ghost sm" onclick="EX.question('${esc(id)}')">Every answer to this question</button></div><ul class="kw-hits">${items}</ul>${list.length > 3 ? `<button type="button" class="kw-expand" onclick="EX.expand('${esc(id)}')">${open ? "Show fewer" : `Show ${list.length - 3} more citation${list.length - 3 === 1 ? "" : "s"}`}</button>` : ""}</div>`; };

  $("exOut").innerHTML = `
  <div class="grid g4 kw-kpis">
    ${kpi({ label: "Citations", value: cs.length.toLocaleString(), note: `times an answer cites ${esc(h)}` })}
    ${kpi({ label: "Answers citing it", value: citing.length.toLocaleString(), unit: ` / ${withSrc.length.toLocaleString()}`, note: "of the answers that cite any source" })}
    ${kpi({ label: "Questions", value: qsHit.length, unit: ` / ${uniq(all.map((a) => a.queryId)).length}`, note: "where at least one answer cites it" })}
    ${kpi({ label: `${SL()} named alongside`, value: pct(subjIn / citing.length), note: `in answers citing it, against ${pct(withSrc.length ? subjAll / withSrc.length : null)} of all answers with sources` })}
  </div>
  <div class="grid g3 kw-g">
    ${card({ title: "Brands in the answers that cite it", sub: "Share of the citing answers that name each brand. Tap one to explore it.", html: bars(bRows) })}
    ${card({ title: "By funnel stage", sub: "Share of each stage's answers with sources that cite it. Tap a stage to filter the list.", html: bars(stRows) })}
    ${card({ title: "By engine", sub: "Share of each engine's answers with sources that cite it.", html: bars(engRows) })}
  </div>
  ${card({ title: "Pages cited", sub: `The ${esc(h)} pages the engines link to, most cited first.`, html: `<ol class="ex-pages">${pageRows.map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title || p.url)}</a> <span class="kw-n">${plural(p.n, "citation")}</span></li>`).join("")}</ol>` })}
  ${card({ title: `Every citation of ${esc(h)}`, sub: `${plural(shownC.length, "citation")} across ${plural(groups.length, "question")}${st.stage ? ` at ${esc(stageL(st.stage).toLowerCase())} · <a href="javascript:EX.stage('${st.stage}')">show every stage</a>` : ""}. Tap one to read the answer that cites it.`,
    html: `<div class="kw-list">${groups.slice(0, st.shown).map(qBlock).join("")}</div>${groups.length > st.shown ? `<div class="kw-more"><button type="button" class="btn ghost sm" onclick="EX.more()">Show more questions (${groups.length - st.shown} left)</button></div>` : ""}` })}`;
}

/* ── hooks the patched console calls ──────────────────────────────────── */
function render(api) {
  A = api;
  if (!wired && $("exQ")) fromHash();
  draw();
  decorate();
}
window.Explore = {
  icons: ICONS,
  /** Adds the finder to the Explore group (keyword-search.js makes the group); makes the group if it isn't there. */
  extendNav(NAV) {
    let g = NAV.find((x) => x.id === "kw-explore");
    if (!g) { g = { id: "kw-explore", label: "Explore", pages: [] }; const i = NAV.findIndex((x) => x.id === "console"); NAV.splice(i < 0 ? NAV.length : i + 1, 0, g); }
    g.pages.push(PAGEDEF);
  },
  tpl: TPL,
  render,
};
})();
