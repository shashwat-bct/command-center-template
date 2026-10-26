/* ===========================================================================
   KEYWORD SEARCH — every mention of a word across the engines' answers
   ---------------------------------------------------------------------------
   Loaded before ai-visibility.js. Adds an "Explore" group with one page to the
   console's rail. The shopper types a word (a model such as "Bravia 9 II", a
   feature such as "anti-glare", a retailer such as "Costco") and sees:

     · how often the engines say it: mentions, answers, questions, per engine,
       stage and persona;
     · the models the reader extracted that match it, by brand;
     · which brand those answers put first;
     · every mention in context, grouped by question, each opening to the full
       answer with the word highlighted.

   The answers are read through window.__AIV, so the console's scope (questions,
   engines) and its persona / run / week filters apply. The query lives in the
   hash (#kw-search?q=bravia), so a search is a link.
   =========================================================================== */
(function () {
"use strict";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const pct = (v) => v == null ? "—" : `${Math.round(v * 100)}%`;
const plural = (n, w, ws = w + "s") => `${n.toLocaleString()} ${n === 1 ? w : ws}`;
const PAGE = "kw-search";

const ICONS = { kw_search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>' };
const GROUP = { id: "kw-explore", label: "Explore", pages: [
  { id: PAGE, label: "Keyword Search", icon: "kw_search", crumb: "Explore · Every answer", title: "Keyword Search" }] };

/* ── state ────────────────────────────────────────────────────────────── */
let A = null;                       // the console's window.__AIV
const st = { q: "", whole: false, engine: "", sort: "most", shown: 12, open: new Set() };
const readHash = () => { const m = location.hash.match(/[?&]q=([^&]*)/); return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : ""; };
const writeHash = () => { const h = `#${PAGE}${st.q ? `?q=${encodeURIComponent(st.q)}` : ""}`; if (location.hash !== h) history.replaceState(null, "", h); };

/* ── text ─────────────────────────────────────────────────────────────── */
// Answers are markdown; mentions are counted and shown on the plain text a shopper reads.
const plainCache = new WeakMap();
function plain(a) {
  let t = plainCache.get(a);
  if (t == null) {
    t = String(a.text || "")
      .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)\s]+)\)/g, "$1")
      .replace(/\*\*|__|`/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*•]\s+/gm, "• ")
      .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "").replace(/\s*\|\s*/g, " · ").replace(/[ \t]+/g, " ");
    plainCache.set(a, t);
  }
  return t;
}
// "bravia 9" also finds "BRAVIA-9" and "Bravia  9"; whole word stops "LG" matching "ULGA"
function matcher(q, whole) {
  const body = q.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\-]+");
  return body ? new RegExp(whole ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, "giu") : null;
}
const hits = (text, re) => { re.lastIndex = 0; const out = []; let m; while ((m = re.exec(text))) { out.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; } return out; };
const mark = (text, re) => { let out = "", at = 0; for (const [s, e] of hits(text, re)) { out += esc(text.slice(at, s)) + `<mark class="kw-hl">${esc(text.slice(s, e))}</mark>`; at = e; } return out + esc(text.slice(at)); };

/** Up to two windows of context around the hits, merged where they overlap. */
function snippet(text, spans, re, pad = 120) {
  const wins = [];
  for (const [s, e] of spans) {
    const w = [Math.max(0, s - pad), Math.min(text.length, e + pad)];
    const last = wins[wins.length - 1];
    if (last && w[0] <= last[1]) last[1] = w[1]; else wins.push(w);
    if (wins.length === 2 && w !== last) break;
  }
  return wins.slice(0, 2).map(([s, e]) => {
    // start and end on a word boundary
    if (s > 0) { const sp = text.indexOf(" ", s); if (sp > 0 && sp < s + 20) s = sp + 1; }
    if (e < text.length) { const sp = text.lastIndexOf(" ", e); if (sp > e - 20) e = sp; }
    return `${s > 0 ? "…" : ""}${mark(text.slice(s, e).replace(/\n+/g, " "), re)}${e < text.length ? "…" : ""}`;
  }).join(" <span class=\"kw-gap\">·</span> ");
}

/* ── the models the reader extracted ──────────────────────────────────── */
const normModel = (s) => String(s || "").toUpperCase().replace(/[\s\-/]+/g, " ").trim();
function models(answers) {
  const by = new Map();
  for (const a of answers) for (const m of a.brands || []) {
    if (!m.product) continue;
    const k = `${m.id}|${normModel(m.product)}`;
    let r = by.get(k);
    if (!r) by.set(k, r = { brand: m.id, labels: {}, answers: new Set(), engines: new Set(), ranks: [], top: 0 });
    r.labels[m.product] = (r.labels[m.product] || 0) + 1;
    r.answers.add(a); r.engines.add(a.engine); if (m.rank) r.ranks.push(m.rank);
    if (a.topPick === m.id) r.top++;
  }
  return [...by.values()].map((r) => ({ ...r, label: Object.entries(r.labels).sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0][0], n: r.answers.size,
    rank: r.ranks.length ? r.ranks.reduce((x, y) => x + y, 0) / r.ranks.length : null })).sort((x, y) => y.n - x.n);
}

/* ── look-ups on the console's data ───────────────────────────────────── */
const D = () => A.D;
const brand = (id) => D().brands.find((b) => b.id === id) || { id, label: String(id).charAt(0).toUpperCase() + String(id).slice(1), color: "#80868b" };
const dot = (id) => `<span class="dot" style="background:${brand(id).color}"></span>`;
const qOf = (id) => D().bank.find((q) => q.id === id) || { id, text: id };
const stageL = (id) => (D().stages.find((s) => s.id === id) || {}).label || id;
const personaL = (id) => ((D().personas || []).find((p) => p.id === id) || {}).label || id || "";
// example searches for the tips: a technology and a feature per category, the model from the answers themselves
const EXAMPLES = { tv: ["Mini-LED", "anti-glare"], smartphones: ["telephoto", "battery life"], "wireless-speakers": ["Bluetooth", "waterproof"] };
const exampleModel = (allModels) => (allModels.find((m) => m.brand === D().subject) || allModels[0] || {}).label || "";
const shortForm = (label) => label.split(/\s+/).slice(0, 2).join(" ");
const engL = (id) => A.engLabel(id);
const weeks = () => D().weeks || [];
const ansLabel = (a) => `${weeks().length > 1 && a.week ? `Week ${a.week} · ` : ""}${esc(engL(a.engine))} · ${esc(personaL(a.persona))} · run ${a.run}`;

/* ── markup, as the other pages ───────────────────────────────────────── */
const card = (o) => `<section class="card${o.cls ? " " + o.cls : ""}"><div class="card-h"><div class="ct"><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.tag ? `<div class="ca">${o.tag}</div>` : ""}</div>${o.html || ""}</section>`;
const kpi = (o) => `<div class="kpi"><div class="kl">${esc(o.label)}</div><div class="kv">${o.value}${o.unit ? `<small>${o.unit}</small>` : ""}</div>${o.note ? `<div class="kn">${o.note}</div>` : ""}</div>`;
const bars = (rows) => `<div class="kw-bars">${rows.map((r) => `<div class="kw-bar${r.on ? " on" : ""}${r.click ? " click" : ""}"${r.click ? ` role="button" tabindex="0" onclick="${r.click}"` : ""}>
  <div class="kw-bl">${r.label}${r.sub ? `<small>${r.sub}</small>` : ""}</div>
  <div class="kw-track"><i style="width:${Math.max(r.v ? 2 : 0, Math.round((r.v || 0) * 100))}%;${r.color ? `background:${r.color}` : ""}"></i></div>
  <div class="kw-bv">${r.value}</div></div>`).join("")}</div>`;

/* ── page ─────────────────────────────────────────────────────────────── */
const TPL = () => `<div class="kw-page">
  <div class="kw-box card">
    <label class="kw-in" for="kwQ">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${ICONS.kw_search}</svg>
      <input id="kwQ" type="search" autocomplete="off" spellcheck="false" placeholder="Search every answer — a model, a feature, a retailer…" aria-label="Keyword">
      <kbd title="Press / to search">/</kbd>
      <button type="button" class="kw-x" id="kwX" aria-label="Clear the search" hidden>×</button>
    </label>
    <div class="kw-opts">
      <label class="kw-tog"><input type="checkbox" id="kwWhole"> Whole word only</label>
      <span class="kw-scope" id="kwScope"></span>
    </div>
    <div class="kw-sugg" id="kwSugg"></div>
  </div>
  <div id="kwOut"></div>
</div>`;

let wired = false;
function wire() {
  if (wired || !$("kwQ")) return; wired = true;
  let t = 0;
  $("kwQ").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => setQuery(e.target.value, false), 140); });
  $("kwQ").addEventListener("keydown", (e) => { if (e.key === "Escape" && e.target.value) { e.stopPropagation(); setQuery(""); } });
  $("kwX").onclick = () => { setQuery(""); $("kwQ").focus(); };
  $("kwWhole").onchange = (e) => { st.whole = e.target.checked; draw(); };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || /input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
    if (!location.hash.startsWith(`#${PAGE}`)) return;
    e.preventDefault(); $("kwQ").focus(); $("kwQ").select();
  });
  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith(`#${PAGE}`)) return;
    const q = readHash(); if (q !== st.q) { st.q = q; $("kwQ").value = q; st.engine = ""; st.shown = 12; st.open.clear(); draw(); }
    setTimeout(() => $("kwQ").focus(), 0);
  });
}
function setQuery(q, syncInput = true) {
  st.q = q; st.engine = ""; st.shown = 12; st.open.clear();
  if (syncInput && $("kwQ").value !== q) $("kwQ").value = q;
  writeHash(); draw();
}

window.KW = {
  set: (q) => { setQuery(q); window.scrollTo({ top: 0, behavior: "smooth" }); },
  engine: (e) => { st.engine = st.engine === e ? "" : e; st.shown = 12; draw(); },
  sort: (s) => { st.sort = s; draw(); },
  more: () => { st.shown += 12; draw(); },
  expand: (id) => { st.open.has(id) ? st.open.delete(id) : st.open.add(id); draw(); },
  open: (i) => openAnswer(LAST.rows[i]),
  question: (id) => A.openQuestion(id),
};

let LAST = { rows: [] };
function draw() {
  if (!A || !$("kwOut")) return;
  wire();
  const all = A.activeAnswers();
  $("kwX").hidden = !st.q;
  $("kwScope").innerHTML = `Searching <b>${all.length.toLocaleString()}</b> answers to <b>${new Set(all.map((a) => a.queryId)).size}</b> questions · follows the scope, persona, run${weeks().length > 1 ? " and week" : ""} filters above · counts every question, including those that name a brand, so its numbers run higher than Picks &amp; Products, which reads the brand-neutral questions only`;
  const allModels = models(all);
  const re = matcher(st.q, st.whole);
  if (!re) { $("kwSugg").innerHTML = suggestions(allModels, 14); $("kwOut").innerHTML = landing(allModels, all); return; }

  // every answer that says it
  const rows = [];
  for (const a of all) { const sp = hits(plain(a), re); if (sp.length) rows.push({ a, n: sp.length, sp }); }
  const matchModels = allModels.filter((m) => { re.lastIndex = 0; return re.test(m.label) || Object.keys(m.labels).some((l) => { re.lastIndex = 0; return re.test(l); }); });
  $("kwSugg").innerHTML = rows.length ? "" : suggestions(allModels, 14, "No answer says that. Try a model the engines name:");
  if (!rows.length) { $("kwOut").innerHTML = `<div class="withheld-card"><b>No mentions of “${esc(st.q)}”</b><p>None of the ${all.length.toLocaleString()} answers in the current scope ${st.whole ? "uses it as a whole word — untick “Whole word only” to find it inside longer words, or" : ""} contains it. Check the spelling, try a shorter form${(() => { const l = exampleModel(allModels); return l.split(/\s+/).length > 2 ? ` (“${esc(shortForm(l))}” rather than “${esc(l)}”)` : ""; })()}, or widen the filters above.</p></div>`; return; }

  const mentions = rows.reduce((s, r) => s + r.n, 0);
  const qs = new Set(rows.map((r) => r.a.queryId));
  const engines = [...new Set(all.map((a) => a.engine))];
  const rate = (list, pred) => { const of = list.filter(pred).length; return of ? rows.filter((r) => pred(r.a)).length / of : null; };
  const engRows = engines.map((e) => { const of = all.filter((a) => a.engine === e).length, n = rows.filter((r) => r.a.engine === e).length;
    return { e, label: `<span class="enl">${engIco(e)}${esc(engL(e))}</span>`, sub: `${n} of ${of} answers`, v: of ? n / of : 0, value: pct(of ? n / of : null), on: st.engine === e, click: `KW.engine('${e}')` }; })
    .sort((x, y) => y.v - x.v);
  const stageRows = D().stages.map((s) => { const ids = new Set(D().bank.filter((q) => q.stage === s.id).map((q) => q.id)); const r = rate(all, (a) => ids.has(a.queryId));
    return { label: esc(s.label), sub: `${rows.filter((x) => ids.has(x.a.queryId)).length} answers`, v: r || 0, value: pct(r) }; });
  const personaRows = (D().personas || []).map((p) => { const r = rate(all, (a) => a.persona === p.id); return { label: esc(p.label), sub: `${rows.filter((x) => x.a.persona === p.id).length} answers`, v: r || 0, value: pct(r) }; });

  // which brand these answers put first
  const picks = {}; let withPick = 0;
  for (const { a } of rows) if (a.topPick) { picks[a.topPick] = (picks[a.topPick] || 0) + 1; withPick++; }
  const pickRows = Object.entries(picks).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([id, n]) => ({ label: `${dot(id)}${esc(brand(id).label)}${id === D().subject ? " <small class=\"kw-you\">you</small>" : ""}`, v: n / withPick, value: `${n}`, color: brand(id).color }));
  const named = {}; for (const { a } of rows) for (const id of new Set((a.brands || []).map((m) => m.id))) named[id] = (named[id] || 0) + 1;
  const nameRows = Object.entries(named).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([id, n]) => ({ label: `${dot(id)}${esc(brand(id).label)}${id === D().subject ? " <small class=\"kw-you\">you</small>" : ""}`, v: n / rows.length, value: pct(n / rows.length), color: brand(id).color }));

  // mentions in context, by question
  const shownRows = st.engine ? rows.filter((r) => r.a.engine === st.engine) : rows;
  const byQ = new Map(); for (const r of shownRows) { const g = byQ.get(r.a.queryId) || { id: r.a.queryId, rows: [], n: 0 }; g.rows.push(r); g.n += r.n; byQ.set(r.a.queryId, g); }
  const order = D().bank.map((q) => q.id);
  const groups = [...byQ.values()].sort(st.sort === "most" ? (x, y) => y.n - x.n || order.indexOf(x.id) - order.indexOf(y.id) : (x, y) => order.indexOf(x.id) - order.indexOf(y.id));
  LAST = { rows: [] };
  const groupHtml = groups.slice(0, st.shown).map((g) => {
    const q = qOf(g.id);
    const all3 = st.open.has(g.id), sorted = g.rows.sort((x, y) => String(x.a.engine).localeCompare(y.a.engine) || String(x.a.persona).localeCompare(y.a.persona) || x.a.run - y.a.run);
    const items = sorted.slice(0, all3 ? sorted.length : 3).map((r) => {
      const i = LAST.rows.push({ ...r, re }) - 1;
      const self = (r.a.brands || []).find((m) => m.id === D().subject);
      return `<li class="kw-hit"><button type="button" class="kw-hit-b" onclick="KW.open(${i})">
        <span class="kw-hit-h"><span class="enl">${engIco(r.a.engine)}${ansLabel(r.a)}</span><span class="kw-n">${plural(r.n, "mention")}</span>${r.a.topPick ? `<span class="kw-pick">${dot(r.a.topPick)}top pick ${esc(brand(r.a.topPick).label)}</span>` : ""}${self ? "" : `<span class="kw-miss">${esc(D().subjectLabel)} not named</span>`}</span>
        <span class="kw-snip">${snippet(plain(r.a), r.sp, re)}</span>
        <span class="kw-read">Read the full answer →</span></button></li>`;
    }).join("");
    return `<div class="kw-q"><div class="kw-qh"><div><div class="kw-qt">“${esc(q.text)}”</div><div class="kw-qm">${esc(stageL(q.stage))} · ${plural(g.rows.length, "answer")} · ${plural(g.n, "mention")}</div></div>
      <button type="button" class="btn ghost sm" onclick="KW.question('${esc(g.id)}')">Every answer to this question</button></div><ul class="kw-hits">${items}</ul>${sorted.length > 3 ? `<button type="button" class="kw-expand" onclick="KW.expand('${esc(g.id)}')">${all3 ? "Show fewer" : `Show ${sorted.length - 3} more answer${sorted.length - 3 === 1 ? "" : "s"} to this question`}</button>` : ""}</div>`;
  }).join("");

  const modelTable = matchModels.length ? card({ title: "Models that match", sub: `Products the reader extracted from the answers whose name contains “${esc(st.q)}”. Tap one to search for it exactly.`,
    html: `<div class="dt-wrap" style="--dtmax:360px"><table class="dt"><thead><tr><th class="lft">Model</th><th class="lft">Brand</th><th>Answers</th><th>Engines</th><th>Avg position</th><th>Brand top pick</th></tr></thead><tbody>${
      matchModels.slice(0, 25).map((m) => `<tr class="${m.brand === D().subject ? "subj" : ""} kw-tr" onclick="KW.set(${esc(JSON.stringify(m.label))})"><td class="lft"><b>${esc(m.label)}</b>${Object.keys(m.labels).length > 1 ? ` <small class="kw-alt" title="${esc(Object.keys(m.labels).join(" · "))}">+${Object.keys(m.labels).length - 1} spelling${Object.keys(m.labels).length > 2 ? "s" : ""}</small>` : ""}</td><td class="lft">${dot(m.brand)}${esc(brand(m.brand).label)}</td><td class="num">${m.n}</td><td class="num">${[...m.engines].map((e) => engIco(e)).join("")}</td><td class="num">${m.rank ? m.rank.toFixed(1) : "—"}</td><td class="num">${m.top}</td></tr>`).join("")}</tbody></table></div>` }) : "";

  $("kwOut").innerHTML = `
  <div class="grid g4 kw-kpis">
    ${kpi({ label: "Mentions", value: mentions.toLocaleString(), note: `times “${esc(st.q)}” appears in an answer` })}
    ${kpi({ label: "Answers", value: rows.length.toLocaleString(), unit: ` / ${all.length.toLocaleString()}`, note: `${pct(rows.length / all.length)} of answers in scope say it` })}
    ${kpi({ label: "Questions", value: qs.size, unit: ` / ${new Set(all.map((a) => a.queryId)).size}`, note: "questions where at least one answer says it" })}
    ${kpi({ label: "Most often from", value: engRows[0] ? `<span class="enl kw-kv-eng">${engIco(engRows[0].e)}${esc(engL(engRows[0].e))}</span>` : "—", note: engRows[0] ? `${engRows[0].value} of its answers say it` : "" })}
  </div>
  <div class="grid g3 kw-g">
    ${card({ title: "By engine", sub: "Share of each engine's answers that say it. Tap an engine to show only its mentions.", html: bars(engRows) })}
    ${card({ title: "By funnel stage", sub: "Share of the stage's answers that say it.", html: bars(stageRows) })}
    ${card({ title: "Who these answers put first", sub: withPick ? `Top pick in the ${withPick} of ${rows.length} answers that commit to one.` : "None of these answers commits to a top pick.", html: withPick ? bars(pickRows) : "" })}
  </div>
  <div class="grid g2 kw-g">
    ${modelTable || card({ title: "Brands named alongside it", sub: "Share of these answers that name each brand.", html: bars(nameRows) })}
    ${modelTable ? card({ title: "Brands named alongside it", sub: "Share of these answers that name each brand.", html: bars(nameRows) }) : (personaRows.length > 1 ? card({ title: "By persona", sub: "Share of each persona's answers that say it.", html: bars(personaRows) }) : "")}
  </div>
  ${card({ title: `Every mention of “${esc(st.q)}”`, sub: `${plural(shownRows.length, "answer")} across ${plural(byQ.size, "question")}${st.engine ? ` from ${esc(engL(st.engine))} only — <a href="javascript:KW.engine('${st.engine}')">show every engine</a>` : ""}. Tap a mention to read the whole answer.`,
    tag: `<div class="seg mini" role="group"><button class="${st.sort === "most" ? "on" : ""}" onclick="KW.sort('most')">Most mentions</button><button class="${st.sort === "bank" ? "on" : ""}" onclick="KW.sort('bank')">Question order</button></div>`,
    html: `<div class="kw-list">${groupHtml}</div>${groups.length > st.shown ? `<div class="kw-more"><button type="button" class="btn ghost sm" onclick="KW.more()">Show more questions (${groups.length - st.shown} left)</button></div>` : ""}` })}`;
}

const engIco = (e) => { const f = { gpt: "chatgpt", chatgpt: "chatgpt", gemini: "gemini", claude: "claude" }[e]; return f ? `<img class="engico" src="/engine-icons/${f}.svg" alt="" aria-hidden="true">` : e ? `<span class="engico mono" aria-hidden="true">${esc(String(engL(e) || e).charAt(0).toUpperCase())}</span>` : ""; };

function suggestions(allModels, n, lead = "Try a model the engines name:") {
  const s = D().subject;
  // the subject's models first, then the most named; one chip per model
  const pick = [...allModels.filter((m) => m.brand === s).slice(0, Math.ceil(n / 2)), ...allModels.filter((m) => m.brand !== s)].slice(0, n);
  return `<span class="kw-sl">${lead}</span>${pick.map((m) => `<button type="button" class="kw-chip" onclick="KW.set(${esc(JSON.stringify(m.label))})">${dot(m.brand)}${esc(m.label)}</button>`).join("")}`;
}

const tip = (q, what) => q ? `${what} (<a href="javascript:KW.set(${esc(JSON.stringify(q))})">${esc(q)}</a>)` : what;
function landing(allModels, all) {
  const s = D().subject;
  const top = allModels.slice(0, 30);
  const max = top[0] ? top[0].n : 1;
  const mine = allModels.filter((m) => m.brand === s).slice(0, 8);
  return `<div class="grid g2 kw-g">
    ${card({ title: "Most-named models", sub: `The products the engines name most often across the ${all.length.toLocaleString()} answers in scope. Tap one to see every mention.`,
      html: bars(top.slice(0, 12).map((m) => ({ label: `${dot(m.brand)}${esc(m.label)}`, sub: esc(brand(m.brand).label), v: m.n / max, value: `${m.n}`, color: brand(m.brand).color, click: `KW.set(${esc(JSON.stringify(m.label))})` }))) })}
    ${card({ title: `${esc(D().subjectLabel)} models the engines name`, sub: mine.length ? `Answers naming each, and how often that answer's top pick is ${esc(D().subjectLabel)}.` : `No ${esc(D().subjectLabel)} model is named in the answers in scope.`,
      html: mine.length ? bars(mine.map((m) => ({ label: `${dot(m.brand)}${esc(m.label)}`, sub: `top pick in ${m.top} · avg position ${m.rank ? m.rank.toFixed(1) : "—"}`, v: m.n / max, value: `${m.n}`, color: brand(m.brand).color, click: `KW.set(${esc(JSON.stringify(m.label))})` }))) : "" })}
  </div>
  <div class="kw-tips card"><b>Tips</b><ul>
    <li>Search ${tip(shortForm(exampleModel(allModels)), "a model")}${(EXAMPLES[D().category] || []).map((t, i) => `, ${tip(t, i ? "a feature" : "a technology")}`).join("")} or ${tip("Best Buy", "a retailer")}. Case doesn't matter and spaces also match hyphens.</li>
    <li>Tick <b>Whole word only</b> so a short word like “LG” doesn't match inside longer ones.</li>
    <li>The persona, run${weeks().length > 1 ? ", week" : ""} and scope filters at the top narrow what is searched. Copy the address bar to share a search.</li></ul></div>`;
}

/* ── one answer, in full, with the word highlighted ───────────────────── */
function openAnswer(r) {
  if (!r) return;
  const q = qOf(r.a.queryId);
  const html = `<div class="mhead"><h2>“${esc(q.text)}”</h2><p class="lede" style="margin:4px 0 0">${esc(stageL(q.stage))} · <span class="enl">${engIco(r.a.engine)}${ansLabel(r.a)}</span> · ${plural(r.n, "mention")} of “${esc(st.q)}” highlighted</p></div>
    <div class="kw-nav"><button type="button" class="btn ghost sm" onclick="KW.jump(-1)">↑ Previous mention</button><button type="button" class="btn ghost sm" onclick="KW.jump(1)">Next mention ↓</button><span class="kw-pos" id="kwPos"></span>
      <button type="button" class="btn ghost sm" style="margin-left:auto" onclick="KW.question('${esc(r.a.queryId)}')">Every answer to this question</button></div>
    <div class="qcard"><div class="txt full kw-full">${A.md(r.a.text)}</div></div>`;
  A.openModal(html);
  // highlight inside the rendered answer's text nodes only, never inside a link or tag
  const root = document.querySelector("#modalBody .kw-full"); if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const re = r.re; re.lastIndex = 0; if (!re.test(n.nodeValue)) continue;
    const span = document.createElement("span"); span.innerHTML = mark(n.nodeValue, re); n.replaceWith(...span.childNodes);
  }
  KW.at = -1; KW.jump(1);
}
KW.jump = (d) => {
  const marks = [...document.querySelectorAll("#modalBody .kw-full mark.kw-hl")]; if (!marks.length) return;
  marks.forEach((m) => m.classList.remove("cur"));
  KW.at = (KW.at + d + marks.length) % marks.length;
  marks[KW.at].classList.add("cur"); marks[KW.at].scrollIntoView({ block: "center", behavior: "smooth" });
  const pos = $("kwPos"); if (pos) pos.textContent = `${KW.at + 1} of ${marks.length}`;
};

/* ── hooks the patched console calls ──────────────────────────────────── */
function render(api) {
  A = api;
  if (!wired && $("kwQ")) { st.q = readHash(); $("kwQ").value = st.q; }
  draw();
}
window.KeywordSearch = {
  icons: ICONS,
  /** Adds the Explore group right after the console's own group. */
  extendNav(NAV) { const i = NAV.findIndex((g) => g.id === "console"); NAV.splice(i < 0 ? NAV.length : i + 1, 0, GROUP); },
  tpl: TPL,
  render,
};
})();
