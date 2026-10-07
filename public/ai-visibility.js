// =============================================================================
// SONY · AI VISIBILITY — product shell and page logic
// =============================================================================
// A tabbed product in the command-centre idiom: a rail of pages, a top bar that
// carries the scope, and cards. Every figure is computed here, in the browser,
// from the captured answers in the payload. Change the scope (questions,
// brands, engines) and the same functions run again — nothing is pre-typed, no
// superlative is fixed copy, and every tile opens to its receipt.
// =============================================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, d = 0) => x == null || Number.isNaN(x) ? "—" : (x * 100).toFixed(d) + "%";
const n1 = (x) => x == null ? "—" : (Math.round(x * 10) / 10).toFixed(1);
const uniq = (a) => [...new Set(a)];
const sum = (a) => a.reduce((s, v) => s + v, 0);
const byDesc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);

let D = null;                 // payload
// The copy names the subject through these, never a literal brand: "${SL} is third of four",
// "a ${PL} the engine recommends", "for ${CAT} questions". Set as soon as the payload is in.
let SL = "", PL = "", CAT = "", CATS = "", OWN = "";
const CAT_NOUN = { tv: ["TV", "TVs"], phone: ["phone", "phones"], headphones: ["pair of headphones", "headphones"], vacuum: ["vacuum", "vacuums"] };
function setSubjectCopy() { SL = D.subjectLabel; PL = D.productLine || ({ sony: "BRAVIA", samsunggalaxy: "Galaxy", galaxy: "Galaxy" })[D.instance] || SL; [CAT, CATS] = CAT_NOUN[D.category] || D.categoryNoun || [D.category, D.category + "s"]; const sb = D.brands.find(b => b.subject) || D.brands[0]; OWN = (sb && sb.owned && sb.owned[0]) || `${sb ? sb.id : D.subject}.com`; }
let S = null;                 // state
let CUR = null;               // current capture (consumer-UI read, API-filled where the UI path failed)
let PREV = null;              // drift: from (API path)
let DTO = null;               // drift: to (API path, same month as CUR)
let APIC = null;              // the API-path capture of the current month (UI-vs-API lens)

// ── state ────────────────────────────────────────────────────────────────────
function initState() {
  S = {
    stagesOn: new Set(D.stages.map(s => s.id)),
    qOff: new Set(),
    customQ: [],                                      // {id, stage, text}
    brands: D.brands.map(b => ({ ...b, on: true, custom: false })),
    engines: new Set(D.engines.filter(e => e.measured && e.id !== "google-aio").map(e => e.id)),
    liveEngines: new Set(D.liveConfig.engines.filter(e => e !== "claude")),
    market: "us", persona: "", runs: 3, openStage: null,
  };
}
const brandsOn = () => S.brands.filter(b => b.on);
const subjectId = () => D.subject;
const brandLabel = (id) => (S.brands.find(b => b.id === id) || {}).label || id;
const brandColor = (id) => (S.brands.find(b => b.id === id) || {}).color || "#80868b";
const ALIASES = { sony: ["sony", "bravia"], samsung: ["samsung"], lg: ["lg "], tcl: ["tcl"], hisense: ["hisense"], vizio: ["vizio"], panasonic: ["panasonic"], roku: ["roku "], philips: ["philips"], sharp: ["sharp "], amazon: ["fire tv", "amazon fire"],
  galaxy: ["samsung", "galaxy"], apple: ["apple", "iphone"], google: ["google", "pixel"], oneplus: ["oneplus", "one plus"], motorola: ["motorola", "moto ", "razr"] };
const aliasesOf = (b) => (b.aliases && b.aliases.length ? b.aliases : (ALIASES[b.id] || [b.label.toLowerCase()]));
function firstIdx(text, b) { const t = " " + (text || "").toLowerCase() + " "; const hits = aliasesOf(b).map(a => t.indexOf(a.toLowerCase())).filter(i => i >= 0); return hits.length ? Math.min(...hits) : -1; }

// ── the measured scope ───────────────────────────────────────────────────────
const qById = () => Object.fromEntries([...D.bank, ...S.customQ].map(q => [q.id, q]));
function activeQueries() { const on = S.stagesOn; return D.bank.filter(q => on.has(q.stage) && !S.qOff.has(q.id)); }
function activeAnswers(cap = CUR) {
  const ids = new Set(activeQueries().map(q => q.id));
  return cap.answers.filter(a => ids.has(a.queryId) && S.engines.has(a.engine) && a.run === 1);
}
// a brand's mention inside one answer — LLM-read for tracked brands, text match for added ones
function mention(a, b) {
  if (!b.custom) return a.brands.find(x => x.id === b.id) || null;
  const idx = firstIdx(a.text, b); if (idx < 0) return null;
  const earlier = a.brands.filter(x => { const bb = S.brands.find(y => y.id === x.id); return bb && firstIdx(a.text, bb) >= 0 && firstIdx(a.text, bb) < idx; }).length;
  return { id: b.id, rank: earlier + 1, recommended: null, sentiment: "neutral", product: "", textMatch: true };
}
const FAV = () => D.weighting.favour;
const score = (m) => m ? (1 / Math.max(1, m.rank || 1)) * (FAV()[m.sentiment] ?? 0.6) : 0;

function shareOf(answers, brands = brandsOn()) {
  const tot = {}; for (const b of brands) tot[b.id] = 0;
  for (const a of answers) for (const b of brands) tot[b.id] += score(mention(a, b));
  const all = sum(Object.values(tot)) || 0;
  return Object.fromEntries(brands.map(b => [b.id, all ? tot[b.id] / all : null]));
}
function presenceOf(answers, brands = brandsOn()) {
  const qs = uniq(answers.map(a => a.queryId)); const out = {};
  for (const b of brands) { const named = new Set(answers.filter(a => mention(a, b)).map(a => a.queryId)); out[b.id] = { n: named.size, of: qs.length, rate: qs.length ? named.size / qs.length : null }; }
  return out;
}
function avgRank(answers, b) { const r = answers.map(a => mention(a, b)).filter(Boolean).map(m => m.rank).filter(x => x); return r.length ? sum(r) / r.length : null; }
function topPickShare(answers, brands = brandsOn()) { const withPick = answers.filter(a => a.topPick && brands.some(b => b.id === a.topPick)); const out = {}; for (const b of brands) out[b.id] = withPick.length ? withPick.filter(a => a.topPick === b.id).length / withPick.length : null; return { out, n: withPick.length }; }
function stageAnswers(st, answers) { const q = qById(); return answers.filter(a => q[a.queryId]?.stage === st); }

// ── the brand-comparison set (Aashish, 2026-09-21) ───────────────────────────
// A question that names Sony ("Is a Sony Bravia worth the money?", "Sony vs LG OLED")
// is answered about Sony, so counting it in a brand-versus-brand aggregate tilts every
// such figure towards the subject: on all 58 questions Sony read 33% and "first of four";
// on the 36 questions that name no brand it reads 18% and third. Brand comparisons —
// share of answer, named-in, position, top pick, the engine stack and scorecard, drift —
// are therefore read on the stages whose questions are ALL brand-neutral (awareness and
// consideration in this bank). The bottom two stages are still read per stage, where
// "Sony's share of a Sony question" is the honest label. Derived from the bank's own
// focus tags, never typed, so a re-cut bank moves the set with it.
const compareStages = () => D.stages.filter(st => { const qs = D.bank.filter(q => q.stage === st.id); return qs.length > 0 && qs.every(q => q.focus === "neutral"); });
const isCompareStage = (id) => compareStages().some(st => st.id === id);
function compareQueries() { return activeQueries().filter(q => isCompareStage(q.stage)); }
function compareAnswers(cap = CUR) { const q = qById(); return activeAnswers(cap).filter(a => isCompareStage(q[a.queryId]?.stage)); }
const compareLabel = () => compareStages().map(st => st.label.toLowerCase()).join(" and ") || "no stage";
const compareNote = () => { const n = compareQueries().length; return `Brand comparison on the ${n} brand-neutral question${n === 1 ? "" : "s"} (${esc(compareLabel())}); the ${activeQueries().length - n} questions that name ${SL} are read per stage only.`; };
const compareFoot = () => `<div class="note" style="margin-top:8px">${compareNote()}</div>`;

// computed superlatives — never typed
function standing(obj, id) { const rows = Object.entries(obj).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]); const i = rows.findIndex(([k]) => k === id); if (i < 0) return null; const tiedAbove = rows.filter(([k, v], j) => j < i && v === rows[i][1]).length; return { rank: i + 1 - tiedAbove, of: rows.length, tie: rows.some(([k, v], j) => j !== i && v === rows[i][1]), leader: rows[0][0], value: rows[i][1] }; }
function rankPhrase(obj, id) { const s = standing(obj, id); if (!s) return "unmeasured"; if (s.rank === 1 && !s.tie) return "first"; if (s.rank === 1 && s.tie) return "joint first"; return `${s.tie ? "joint " : ""}#${s.rank} of ${s.of}`; }
const ordinal = (n) => n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `#${n}`;
// "third of the 4 brands tracked" — a standing with its own denominator, so a sentence never
// reads "#3 of 4 of the 4 brands" once the subject stops being first
const standingPhrase = (obj, id, noun = "brands") => { const st = standing(obj, id); return st ? `${st.tie ? "joint " : ""}${ordinal(st.rank)} of the ${st.of} ${noun}` : "unmeasured"; };

// ── markdown-lite for engine answers ─────────────────────────────────────────
function md(text, hlBrands = []) {
  let t = esc(text || "");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, a, u) => `<a href="${u}" target="_blank" rel="noopener">${a}</a>`);
  t = t.replace(/(^|[^"'>])(https?:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, "").slice(0, 48)}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/^#{1,4}\s+(.*)$/gm, "<b>$1</b>");
  // highlight brand names in text only — never inside a tag or an href (a "sony" inside
  // https://sony.com/... once got a <mark> injected into the attribute and broke the link)
  const hlSeg = (seg) => { for (const b of hlBrands) for (const a of aliasesOf(b)) { const re = new RegExp(`(^|[^A-Za-z])(${a.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=[^A-Za-z]|$)`, "gi"); seg = seg.replace(re, (m, p, w) => `${p}<mark class="${b.id === subjectId() ? "hl" : "hlr"}">${w}</mark>`); } return seg; };
  t = t.split(/(<[^>]+>)/).map(seg => seg.startsWith("<") ? seg : hlSeg(seg)).join("");
  const lines = t.split(/\r?\n/); let html = "", inList = false;
  for (const ln of lines) { const li = ln.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/); if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; } else { if (inList) { html += "</ul>"; inList = false; } if (ln.trim()) html += `<p>${ln}</p>`; } }
  if (inList) html += "</ul>";
  return html;
}

// ── evidence helpers ─────────────────────────────────────────────────────────
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }); } catch { return iso; } };
const PATH_LABEL = { ui: "consumer app session", api: "engine API with web search", "claude-api": "Claude API with web search" };
function askRow(text, small) { const L = D.askLinks || {}; const items = [["gpt", "ChatGPT"], ["perplexity", "Perplexity"], ["claude", "Claude"], ["copilot", "Copilot"], ["googleAiMode", "Google AI Mode"]].filter(([k]) => L[k]).map(([k, l]) => `<a href="${esc(L[k] + encodeURIComponent(text))}" target="_blank" rel="noopener">${l} ↗</a>`); if (L.gemini) items.push(`<a href="${esc(L.gemini)}" target="_blank" rel="noopener" title="Gemini has no prefill link — paste the question">Gemini ↗</a>`); return `<div class="ask ${small ? "sm" : ""}"><span class="evk">Ask it yourself</span>${items.join("")}</div>`; }
function evidenceStrip(a) {
  const ev = a.evidence || {}; const bits = [PATH_LABEL[a.path] || a.path || "measured"];
  if (ev.capturedAt) bits.push(`captured ${fmtTime(ev.capturedAt)}`); if (ev.country) bits.push(ev.country);
  if (ev.appModel) bits.push(`app answered with ${esc(ev.appModel)}`); if (ev.model) bits.push(esc(ev.model));
  if (ev.webSearchTriggered != null) bits.push(`web search ${ev.webSearchTriggered ? "on" : "off"}`); if (ev.shoppingVisible) bits.push("shopping module shown");
  if (a.sha256) bits.push(`<span title="SHA-256 of the captured answer text">sha256 ${a.sha256.slice(0, 12)}…</span>`);
  const raw = { queryId: a.queryId, engine: a.engine, path: a.path, capturedAt: ev.capturedAt || null, session: ev.sessionUrl || null, snapshot: ev.snapshotId || null, model: ev.model || ev.appModel || null, sha256: a.sha256 || null, sources: (a.sources || []).map(x => x.url) };
  return `<div class="evd"><span class="evk">Evidence</span>${bits.join(" · ")} ${ev.image ? `<button class="more" onclick="toggleEv(this)">show the real session</button><div class="evimg" hidden><img loading="lazy" src="${esc(ev.image)}" alt="Captured ${esc(a.engine)} session for this question"><div class="note">Rendered from the page source captured in the session (scripts and network off); the fingerprint above is of the answer text.</div></div>` : ""}<button class="more" onclick="toggleEv(this)">raw record</button><pre class="evraw" hidden>${esc(JSON.stringify(raw, null, 1))}</pre></div>`;
}
window.toggleEv = (btn) => { const d = btn.nextElementSibling; if (!d) return; d.hidden = !d.hidden; if (btn.textContent.includes("session")) btn.textContent = d.hidden ? "show the real session" : "hide the session"; else btn.textContent = d.hidden ? "raw record" : "hide raw record"; };

// ── modal / proof drawer ─────────────────────────────────────────────────────
window.closeModal = () => { $("modal").classList.remove("open"); document.body.style.overflow = ""; };
function openModal(html) { $("modalBody").innerHTML = html; $("modal").classList.add("open"); document.body.style.overflow = "hidden"; $("modal").scrollTop = 0; }
window.toggleFull = (btn) => { const t = btn.previousElementSibling; t.classList.toggle("full"); btn.textContent = t.classList.contains("full") ? "collapse" : "show the full answer"; };
function proof({ title, lede, calc, qids, engines = [...S.engines], cap = CUR, hl = brandsOn(), maxQ = 40 }) {
  const q = qById(); const eng = Object.fromEntries(D.engines.map(e => [e.id, e.label]));
  const blocks = qids.slice(0, maxQ).map(id => {
    const ans = cap.answers.filter(a => a.queryId === id && engines.includes(a.engine) && a.run === 1);
    return `<div class="qblock"><div class="qt">“${esc(q[id]?.text || id)}”</div><div class="qm">${esc(q[id]?.stage || "")} · ${esc(q[id]?.focus || "")} question · ${ans.length} engine answer${ans.length === 1 ? "" : "s"}</div>${askRow(q[id]?.text || "", true)}
      ${ans.map(a => { const ms = brandsOn().map(b => ({ b, m: mention(a, b) })).filter(x => x.m).sort((x, y) => (x.m.rank || 9) - (y.m.rank || 9));
        // one accordion per engine (Aashish, 2026-09-21): closed, it shows the engine, the brands in
        // the order the answer named them, and one fading line of the answer; open, the whole answer
        const peek = esc(String(a.text || "").replace(/[#*_`>\[\]]+/g, " ").replace(/\(https?:[^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 240));
        return `<details class="eng"><summary><div class="eh"><span class="en">${esc(eng[a.engine] || a.engine)}</span><span class="bchips">${ms.map(({ b, m }) => `<span class="bchip ${b.id === subjectId() ? "sub" : ""} ${m.sentiment || ""}"><i class="sw" style="width:8px;height:8px;border-radius:2px;background:${b.color}"></i>${esc(b.label)}<span class="r">#${m.rank || "?"}${m.recommended ? " · pick" : ""}${m.product ? " · " + esc(m.product) : ""}${m.textMatch ? " · text match" : ""}</span></span>`).join("") || '<span class="note">no tracked brand named</span>'}</span></div><div class="peek"><span class="pk">${peek || "(empty answer)"}</span><span class="seemore">See more ▾</span></div></summary>
        <div class="txt full">${md(a.text, hl)}</div>
        ${a.sources?.length ? `<div class="cites" style="margin-top:8px">${a.sources.slice(0, 8).map(s => `<span><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.host || s.title)}</a><span class="kd">${esc(s.kind || "")}</span></span>`).join("")}</div>` : ""}${evidenceStrip(a)}</details>`; }).join("")}</div>`; }).join("");
  openModal(`<h2>${esc(title)}</h2><p class="lede">${lede || ""}</p>${calc ? `<div class="calc">${calc}</div>` : ""}${blocks}${qids.length > maxQ ? `<p class="note">${qids.length - maxQ} more questions not shown.</p>` : ""}`);
}
window.__proof = proof;

// ── renderers ────────────────────────────────────────────────────────────────
function barRows(obj, { fmt = pct, maxv, subj = subjectId(), onclick } = {}) {
  const rows = byDesc(Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null))); const mx = maxv ?? Math.max(...rows.map(r => r[1]), 0.0001);
  return `<div class="bars">${rows.map(([id, v]) => `<div class="bar ${id === subj ? "subj" : ""}" ${onclick ? `style="cursor:pointer" onclick="${onclick}('${id}')"` : ""}><span class="bl">${esc(brandLabel(id))}</span><span class="bt"><span class="bf" style="--sw:${brandColor(id)};width:${Math.max(1, v / mx * 100)}%"></span></span><span class="bv">${fmt(v)}</span></div>`).join("")}</div>`;
}
function stackBar(obj) { const rows = byDesc(Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null))); return `<div class="stack">${rows.map(([id, v]) => `<span style="width:${(v * 100).toFixed(1)}%;background:${brandColor(id)}" title="${esc(brandLabel(id))} ${pct(v)}"></span>`).join("")}</div><div class="legend">${rows.map(([id, v]) => `<span><i style="background:${brandColor(id)}"></i>${esc(brandLabel(id))} ${pct(v)}</span>`).join("")}</div>`; }
// a donut for a part-to-whole with few kinds: the arcs carry the shape, the legend carries every
// count and share (a 1% sliver is unreadable as an arc and readable as a row), the centre the total
function donut(rows, { total, label, sub }) {
  const R = 42, C = 2 * Math.PI * R, GAP = 2.2; let off = 0;
  const arcs = rows.map(r => { const share = total ? r.v / total : 0; const len = Math.max(0, share * C - GAP); const h = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${r.color}" stroke-width="15" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(r.label)} · ${r.v} (${pct(share)})</title></circle>`; off += share * C; return h; }).join("");
  return `<div class="donutwrap"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${esc(label)} ${esc(sub || "")}">${arcs}<text x="60" y="57" text-anchor="middle" class="dv">${esc(label)}</text><text x="60" y="71" text-anchor="middle" class="dl">${esc(sub || "")}</text></svg><ul class="dleg">${rows.map(r => `<li><i style="background:${r.color}"></i><span class="l">${esc(r.label)}</span><span class="n tnum">${r.v}</span><span class="p tnum">${pct(total ? r.v / total : null)}</span></li>`).join("")}</ul></div>`;
}
function stat(k, v, n, onclick, small) { return `<div class="stat ${onclick ? "" : "static"}" ${onclick ? `onclick="${onclick}"` : ""}><div class="k">${k}</div><div class="v tnum">${v}${small ? `<small>${small}</small>` : ""}</div><div class="n">${n}</div></div>`; }

// ── product shell: rail, pages, cards ────────────────────────────────────────
const I = {
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  funnel: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.5-1.5"/>',
  box: '<path d="M3 8l9-5 9 5-9 5z"/><path d="M3 8v8l9 5 9-5V8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  trend: '<path d="M3 17l5-6 4 3 5-7 4 4"/><path d="M3 21h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 3v3M17.5 4.5h3M5 17v3M3.5 18.5h3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k] || I.grid}</svg>`;
const NAV = [
  { id: "console", label: "Console", pages: [
    { id: "overview", label: "Executive Summary", icon: "grid", crumb: "Console · Overview", title: "Executive Summary" },
    // 2026-09-22 (Aashish): the four measurement pages re-cut around the charts that matter —
    // the funnel carries the rivals and the engine stack (the Engines page folded in), the
    // question bank is a top-bar drawer, attributes and the claim audit each get a page.
    { id: "funnel", label: "Funnel & Engines", icon: "funnel", crumb: "Console · Measure", title: "Funnel, Presence & Engines" },
    { id: "sources", label: "Sources & Access", icon: "link", crumb: "Console · Measure", title: "Sources & Access" },
    { id: "attrs", label: "Brand Attributes", icon: "spark", crumb: "Console · Measure", title: "What the Engines Say Each Brand Is Good At" },
    { id: "products", label: "Picks & Products", icon: "box", crumb: "Console · Measure", title: "Recommendations & Products" },
    { id: "claims", label: "Claim Audit", icon: "shield", crumb: "Console · Measure", title: "Claim Audit" },
    { id: "change", label: "Change Over Time", icon: "clock", crumb: "Console · Measure", title: "Change Over Time" },
    { id: "live", label: "Live Run", icon: "play", crumb: "Console · Demonstrate", title: "Live Run", pill: "10–15 s" },
    { id: "evidence", label: "Evidence", icon: "receipt", crumb: "Console · Demonstrate", title: "Evidence" }] },
  { id: "workbench", label: "Workbench", pages: [
    { id: "scorecard", label: "Programme Scorecard", icon: "target", crumb: "Workbench · Simulated programme", title: "Programme Scorecard", wb: true },
    { id: "programme", label: "90-Day Programme", icon: "flag", crumb: "Workbench · Plan", title: "90-Day Programme" },
    { id: "diagnose", label: "Diagnose", icon: "check", crumb: "Workbench · Simulated programme", title: "Diagnose", wb: true },
    { id: "earn", label: "Earn & Own", icon: "page", crumb: "Workbench · Simulated programme", title: "Earn & Own", wb: true },
    { id: "measure", label: "Trajectory & Ledger", icon: "trend", crumb: "Workbench · Simulated programme", title: "Trajectory & Ledger", wb: true }] },
  { id: "context", label: "Context", pages: [
    { id: "landscape", label: "Vendor Landscape", icon: "map", crumb: "Context", title: "Vendor Landscape" },
    { id: "method", label: "Method & Provenance", icon: "info", crumb: "Context", title: "Method & Provenance" }] },
];
const PAGES = NAV.flatMap(g => g.pages);
// Embedded in the command centre? Its shell (cco-dashboard.js) exposes an extension hook;
// when it is present this module adds its groups to that rail instead of building its own,
// and its page ids carry a prefix so they cannot collide with the command centre's (both
// have a "scorecard" and a "method"). `hash` is what the URL and the DOM carry; `id` stays
// the key every template and renderer is written against.
const EMBED = !!window.__CCEXT;
const PID = (id, grp) => EMBED ? (grp === "workbench" ? "aeo-" : "ai-") + id : id;
for (const g of NAV) for (const p of g.pages) { p.hash = PID(p.id, g.id); p.group = g.id; }
const pageDef = (id) => PAGES.find(p => p.id === id) || PAGES[0];
let page = "overview";
function card(o) { return `<section class="card${o.cls ? " " + o.cls : ""}"${o.id ? ` id="${o.id}"` : ""}><div class="card-h"><div class="ct"><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.tag ? `<div class="ca"><span class="tag ${o.tagCls || ""}">${o.tag}</span></div>` : ""}</div>${o.slot ? `<div id="${o.slot}"></div>` : ""}${o.html || ""}</section>`; }
function kpi(o) { return `<div class="kpi${o.onclick ? " tap" : ""}"${o.onclick ? ` onclick="${o.onclick}" role="button" tabindex="0" title="Open the proof"` : ""}><div class="kl">${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ""}${esc(o.label)}</div><div class="kv">${o.value}${o.unit ? `<small>${o.unit}</small>` : ""}</div><div class="kf">${o.delta || ""}${o.rank || ""}</div>${o.note ? `<div class="kn">${o.note}</div>` : ""}</div>`; }
function intro(lead, aside) { return `<div class="pintro"><div class="lead">${lead}</div>${aside ? `<div>${aside}</div>` : ""}</div>`; }
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rankChip = (obj, id) => { const st = standing(obj, id); return st ? `<span class="rankchip">${st.tie ? "joint " : ""}#${st.rank} of ${st.of}</span>` : ""; };
const monthLabel = (basis) => { const m = /^(\d{4})-(\d{2})/.exec(basis || ""); return m ? `${MON[+m[2] - 1]} ${m[1]}` : basis; };
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso || "") : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const engLabel = (e) => (D.engines.find(x => x.id === e) || {}).label || e;
const stageLabel = (id) => (D.stages.find(s => s.id === id) || {}).label || id;
const withheld = (why) => `<div class="withheld-card"><b>Withheld</b><p>${why}</p></div>`;
function renderCfg() {
  const q = qById();
  $("stageCfg").innerHTML = D.stages.map(st => { const qs = [...D.bank.filter(x => x.stage === st.id), ...S.customQ.filter(x => x.stage === st.id)]; const on = qs.filter(x => !S.qOff.has(x.id) && !x.custom).length;
    return `<div class="stagecfg ${S.openStage === st.id ? "open" : ""}"><div class="sh" onclick="toggleStage('${st.id}')"><input type="checkbox" ${S.stagesOn.has(st.id) ? "checked" : ""} onclick="event.stopPropagation();toggleStageOn('${st.id}')" style="accent-color:var(--accent)"><b>${esc(st.label)}</b><span class="aida">${esc(st.aida)}</span><span class="cnt">${on}/${qs.filter(x => !x.custom).length}</span><span class="note">${S.openStage === st.id ? "▾" : "▸"}</span></div>
      <div class="qs">${qs.map(x => `<label class="q ${S.qOff.has(x.id) ? "off" : ""} ${x.custom ? "custom" : ""}"><input type="checkbox" ${x.custom ? "disabled" : (S.qOff.has(x.id) ? "" : "checked")} onchange="toggleQ('${x.id}')"><span>${esc(x.text)}</span><span class="fx">${x.custom ? "added · run live" : esc(x.focus)}</span></label>`).join("")}</div></div>`; }).join("");
  $("qCount").textContent = `${activeQueries().length} of ${D.bank.length} in scope`;
  $("brandCfg").innerHTML = S.brands.map(b => `<span class="chip ${b.on ? "on" : ""} ${b.subject ? "lock" : ""}" style="--sw:${b.color}" onclick="${b.subject ? "" : `toggleBrand('${b.id}')`}"><i class="sw"></i>${esc(b.label)}${b.subject ? "<small>subject</small>" : ""}${b.custom ? "<small>text match</small>" : ""}</span>`).join("");
  $("bCount").textContent = `${brandsOn().length} brands`;
  $("engineCfg").innerHTML = D.engines.map(e => { const meas = e.measured && e.id !== "google-aio"; const on = S.engines.has(e.id); const ep = CUR.enginePaths?.[e.id]; const lab = e.id === "google-aio" ? "own lens" : !meas ? "live only" : ep ? (ep.path === "ui" ? "consumer UI" : "API path") : "measured"; return `<span class="chip ${on ? "on" : ""} ${meas ? "" : "lock"}" style="--sw:var(--accent)" onclick="${meas ? `toggleEngine('${e.id}')` : ""}" title="${esc(ep?.why || e.via)}"><i class="sw"></i>${esc(e.label)}<small>${lab}</small></span>`; }).join("") + (Object.values(CUR.enginePaths || {}).some(x => x.path === "api" && x.why) ? `<div class="note" style="margin-top:8px">${Object.entries(CUR.enginePaths).filter(([, x]) => x.path === "api" && x.why).map(([e, x]) => `${esc(D.engines.find(y => y.id === e)?.label || e)}: ${esc(x.why)}.`).join(" ")}</div>` : "");
  const runs = S.runs; $("paramNote").innerHTML = runs === 1 ? "One pass per question is what most dashboards report. Identical prompts share only about a third of their sources day to day, so treat a single pass as a sketch." : runs === 3 ? "Three passes is the volatility read used on this page — enough to see which questions are stable and which flip." : "Seven passes per question per day is the published threshold for a stable brand estimate; that is the production cadence we propose.";
  $("cfgState").textContent = (S.qOff.size || S.stagesOn.size < D.stages.length || S.brands.some(b => !b.on || b.custom) || S.engines.size < D.engines.filter(e => e.measured && e.id !== "google-aio").length) ? "scope changed — figures recomputed" : "measured scope";
}
window.toggleStage = (id) => { S.openStage = S.openStage === id ? null : id; renderCfg(); };
window.toggleStageOn = (id) => { S.stagesOn.has(id) ? S.stagesOn.delete(id) : S.stagesOn.add(id); if (!S.stagesOn.size) S.stagesOn.add(id); rerender(); };
window.toggleQ = (id) => { S.qOff.has(id) ? S.qOff.delete(id) : S.qOff.add(id); rerender(); };
window.toggleBrand = (id) => { const b = S.brands.find(x => x.id === id); if (b.custom && b.on) { S.brands = S.brands.filter(x => x.id !== id); } else b.on = !b.on; rerender(); };
window.toggleEngine = (id) => { S.engines.has(id) ? S.engines.delete(id) : S.engines.add(id); if (!S.engines.size) S.engines.add(id); rerender(); };
function renderCanvas() {
  const A = activeAnswers(); const s = subjectId(); const bs = brandsOn();
  // a stage whose questions name Sony ("Sony vs LG OLED", "Is a Sony Bravia worth it?") is read for
  // Sony alone: the rivals' shares there are shares of Sony questions and are shown as n/a
  const stageData = D.stages.map(st => { const sa = stageAnswers(st.id, A); return { ...st, cmp: isCompareStage(st.id), answers: sa, share: shareOf(sa), pres: presenceOf(sa), qids: uniq(sa.map(a => a.queryId)) }; });
  const widths = [100, 86, 72, 58];
  const first = stageData[0].share[s], last = stageData[stageData.length - 1].share[s];
  const peak = stageData.filter(x => x.share[s] != null).sort((a, b) => b.share[s] - a.share[s])[0];
  const cmpTop = stageData.filter(x => x.cmp); const cmpLead = cmpTop.map(x => { const rows = byDesc(Object.fromEntries(Object.entries(x.share).filter(([, v]) => v != null))); return { st: x, leader: rows[0] }; });
  $("funnelRead").innerHTML = first != null && last != null ? `${SL}'s share of the AI answer ${last > first ? "<b>strengthens as shoppers get closer to buying</b>" : last < first ? "<b>weakens as shoppers get closer to buying</b>" : "<b>holds steady through the funnel</b>"} — from ${pct(first)} in ${stageData[0].label.toLowerCase()} to ${pct(last)} at the ${stageData[stageData.length - 1].label.toLowerCase()}, peaking in ${esc(peak.label)}. ${cmpLead.length ? `On the brand-neutral stages, where the rivals are read on the same questions, ${SL} is ${cmpLead.map(x => `${rankPhrase(x.st.share, s)} in ${esc(x.st.label.toLowerCase())}${x.leader && x.leader[0] !== s ? ` (${esc(brandLabel(x.leader[0]))} leads at ${pct(x.leader[1])})` : ""}`).join(" and ")}.` : ""} The bottom stages name ${SL} in the question, so there the figure is ${SL}'s hold on its own questions and the rivals are not ranked.` : "Not enough questions in scope to read a funnel — switch a stage back on.";
  // each tier carries the rivals' shares where the stage compares brands (Aashish, 2026-09-22:
  // the stage × brand pivot said the same thing twice); a Sony-framed stage says so instead
  const rivals = bs.filter(b => b.id !== s);
  $("funnelViz").innerHTML = `<div class="funnelviz">${stageData.map((st, i) => {
    const chips = st.cmp
      ? byDesc(Object.fromEntries(rivals.map(b => [b.id, st.share[b.id]]).filter(([, v]) => v != null))).map(([id, v]) => `<span class="rv"><i style="background:${brandColor(id)}"></i>${esc(brandLabel(id))} ${pct(v)}</span>`).join("") || '<span class="rv na">no rival in scope</span>'
      : `<span class="rv na">questions name ${SL} · not ranked</span>`;
    return `<div class="ftier" style="width:${widths[i]}%;background:linear-gradient(120deg,var(--accent),color-mix(in srgb,var(--accent) ${55 + i * 10}%,#8ab4f8))" onclick="openStageProof('${st.id}')"><div class="ft1"><span class="fn">${esc(st.label)}<small>${esc(st.aida)} · ${st.qids.length} q</small></span><span style="text-align:right"><span class="fp tnum">${pct(st.share[s])}</span><div class="fq">${st.cmp ? `${SL} ${rankPhrase(st.share, s)} · ` : ""}named in ${st.pres[s]?.n ?? 0}/${st.pres[s]?.of ?? 0}</div></span></div><div class="ft2">${chips}</div></div>`; }).join("")}<div class="fcap">share of weighted AI answer · ${bs.length} brands · ${S.engines.size} engines · tap a tier for the proof</div></div>`;
  const lead = (obj) => { const rows = Object.entries(obj).filter(([, v]) => v != null); const mx = Math.max(...rows.map(r => r[1])); return rows.filter(r => r[1] === mx).map(r => r[0]); };
  const piv = $("stagePivot");   // the pivot host is gone from the funnel page; kept for any page that still carries one
  if (piv) piv.innerHTML = `<table class="pivot"><thead><tr><th></th>${bs.map(b => `<th class="${b.id === s ? "subj" : ""}">${esc(b.label)}</th>`).join("")}</tr></thead><tbody>${stageData.map(st => `<tr>${`<td class="rowh" style="cursor:pointer" onclick="openStageProof('${st.id}')">${esc(st.label)}<small>${esc(st.aida)}${st.cmp ? "" : ` · names ${SL}`}</small></td>`}${bs.map(b => { const v = st.share[b.id]; if (!st.cmp && b.id !== s) return `<td><div class="cell na" title="The ${esc(st.label.toLowerCase())} questions name ${SL} (or ${SL} against one rival), so ${esc(b.label)}'s share of them is not comparable" onclick="openStageProof('${st.id}')"><b>n/a</b></div></td>`; const isLead = st.cmp && lead(st.share).includes(b.id); return `<td><div class="cell ${b.id === s ? "subj" : ""} ${isLead ? "lead" : ""} ${v != null && v < .35 ? "lo" : ""}" style="--sw:${b.color}" onclick="openStageProof('${st.id}')"><span class="fill" style="width:${v == null ? 0 : Math.min(100, v * 150)}%"></span><b>${pct(v)}</b></div></td>`; }).join("")}</tr>`).join("")}</tbody></table><div class="note" style="margin-top:8px">Outlined cell = leads the stage. Share = presence × 1/position × favourability, normalised across the selected brands. <b>n/a</b> = the questions at that stage name ${SL} (or ${SL} against one rival), so a rival's share of them would mislead; ${SL}'s own figure there is its hold on its own questions.</div>`;
  const eng = Object.fromEntries(D.engines.map(e => [e.id, e.label]));
  const AC = compareAnswers();
  $("engineViz").innerHTML = ([...S.engines].map(e => { const sa = AC.filter(a => a.engine === e); const sh = shareOf(sa); const ep = CUR.enginePaths?.[e]; return `<div class="srow big" style="cursor:pointer" onclick="openEngineProof('${e}')"><div class="rl">${esc(eng[e])}<small>${uniq(sa.map(a => a.queryId)).length} answers · ${ep ? (ep.path === "ui" ? "consumer app" : "API path") : "measured"}</small><small>${SL} ${pct(sh[s])} · ${rankPhrase(sh, s)}</small></div><div>${stackBar(sh)}</div></div>`; }).join("") || '<div class="pending">No engine selected.</div>');
  const pr = presenceOf(AC); const tpC = topPickShare(AC);
  $("presenceViz").innerHTML = `<div class="tblwrap"><table class="t"><thead><tr><th>Brand</th><th class="num">Named in</th><th class="num">Presence</th><th class="num">Avg. position</th><th class="num">Top pick</th></tr></thead><tbody>${bs.map(b => { const tp = tpC; return `<tr class="tap ${b.id === s ? "subj" : ""}" onclick="openPresenceProof('${b.id}')"><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${b.color};margin-right:7px"></i>${esc(b.label)}${b.custom ? ' <span class="note">text match</span>' : ""}</td><td class="num">${pr[b.id].n} / ${pr[b.id].of}</td><td class="num">${pct(pr[b.id].rate)}</td><td class="num">${b.custom ? "—" : n1(avgRank(AC, b))}</td><td class="num">${b.custom ? "—" : pct(tp.out[b.id])}</td></tr>`; }).join("")}</tbody></table></div>${compareFoot()}`;
}
window.openStageProof = (st) => { const A = stageAnswers(st, activeAnswers()); const qids = uniq(A.map(a => a.queryId)); const sh = shareOf(A); const S_ = D.stages.find(x => x.id === st); proof({ title: `${S_.label} · ${S_.aida} · the proof`, lede: `${qids.length} shopper questions, every engine's answer, the brands as the reader extracted them.`, calc: `Share of AI answer, ${S_.label.toLowerCase()}: ${isCompareStage(st) ? brandsOn().map(b => `${b.label} ${pct(sh[b.id])}`).join(" · ") : `${brandLabel(subjectId())} ${pct(sh[subjectId()])} — these questions name ${SL}, so the rivals' shares are not comparable and are not ranked`}. Each mention scores 1/position × favourability (positive 1, neutral or mixed 0.6, negative 0.2); shares are the brand's total over all selected brands' totals.`, qids }); };
window.openEngineProof = (e) => { const A = compareAnswers().filter(a => a.engine === e); const qids = uniq(A.map(a => a.queryId)); const eng = D.engines.find(x => x.id === e); proof({ title: `${eng.label} · every answer on the brand-neutral questions`, lede: `${qids.length} brand-neutral questions (${compareLabel()}) as ${eng.label} answered them (${eng.via}). The questions that name ${SL} are read per stage on the Funnel page.`, qids, engines: [e] }); };
window.openPresenceProof = (b) => { const A = compareAnswers(); const bb = S.brands.find(x => x.id === b); const qids = uniq(A.filter(a => mention(a, bb)).map(a => a.queryId)); const missing = uniq(A.map(a => a.queryId)).filter(q => !qids.includes(q)); proof({ title: `${bb.label} · where it is named`, lede: `${qids.length} brand-neutral questions where at least one engine names ${bb.label}; ${missing.length} where none does. Named questions first. Brand comparisons are read on the ${compareLabel()} stages only.`, qids: [...qids, ...missing] }); };
window.openPickProof = (b) => { const A = compareAnswers(); const qids = uniq(A.filter(a => a.topPick === b).map(a => a.queryId)); proof({ title: `${brandLabel(b)} · answers where it is the top pick`, lede: `${qids.length} brand-neutral questions where at least one engine's single top recommendation is ${brandLabel(b)}.`, qids }); };
window.openShareProof = () => { const A = compareAnswers(); const sh = shareOf(A); proof({ title: "Share of AI answer · how it is computed", lede: `Every answer to the ${compareQueries().length} brand-neutral questions (${compareLabel()}), with each brand's position and framing as extracted. Questions that name ${SL} are left out of brand comparisons and read per stage.`, calc: `${brandsOn().map(b => `${b.label} ${pct(sh[b.id])}`).join(" · ")} — over ${A.length} answers to ${compareQueries().length} brand-neutral questions. Score per mention = 1/position × favourability; share = brand total ÷ all selected brands' totals.`, qids: uniq(A.map(a => a.queryId)) }); };
// "$2,498.00", "2498.00" and "$2,498" are one value, not three: a money or plain number
// canonicalises to its digits (2498 / 2499.99); anything else to lower-case text
function canonClaimValue(v) {
  const s = String(v || "").trim(); const m = /^\$?\s*([\d,]+)(?:\.(\d+))?\s*(?:usd)?$/i.exec(s);
  if (m) { const whole = m[1].replace(/,/g, ""); const frac = (m[2] || "").replace(/0+$/, ""); return whole + (frac ? "." + frac : ""); }
  return s.toLowerCase().replace(/\s+/g, " ");
}
function claimConflicts(A) {
  const norm = (p) => (p || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const groups = {}; for (const a of A) for (const c of (a.subjectClaims || [])) { if (!c.value || !c.product) continue; const k = `${norm(c.product)}|${c.type}`; (groups[k] ||= []).push({ ...c, engine: a.engine, queryId: a.queryId }); }
  const out = []; for (const [k, arr] of Object.entries(groups)) { const byCanon = {}; for (const c of arr) byCanon[canonClaimValue(c.value)] ||= c.value; const vals = Object.values(byCanon); if (vals.length > 1 && arr[0].type === "price") out.push({ key: k, product: arr[0].product, type: arr[0].type, values: vals, claims: arr }); }
  return out;
}
const LENS = {};
// the lens number stays in the code and the docs; on the page every card carries the same
// "Measured" tag as the shell's cards (the "Lens 05 · Source map" kickers read as clutter — Aashish, 2026-09-22)
function lensCard(id, kicker, title, lede, vizHtml, sowhat) { const html = `<section class="card" data-lens="${esc(kicker)}"><div class="card-h"><div class="ct"><h3>${title}</h3><p>${lede}</p></div><div class="ca"><span class="tag good">Measured</span></div></div><div class="viz">${vizHtml}</div>${sowhat ? `<div class="sowhat"><span class="lab">So what</span>${sowhat}</div>` : ""}</section>`; LENS[id] = html; return html; }
function heat(rowsLabels, colLabels, cells, { fmt = (v) => v, colorFor, cls = "", cellAttr = null, rowW = "150px", colw = "minmax(58px,1fr)" }) {
  return `<div class="heatwrap"><div class="heat ${cls}${colLabels.length > 10 ? " dense" : ""}" style="grid-template-columns:${rowW} repeat(${colLabels.length},${colw})"><div></div>${colLabels.map(c => `<div class="hh">${esc(c)}</div>`).join("")}${rowsLabels.map((r, i) => `<div class="hl" title="${esc(r)}">${esc(r)}</div>${colLabels.map((c, j) => { const v = cells[i][j]; return `<div class="h" style="background:${colorFor(v)}" ${cellAttr ? cellAttr(i, j) : ""}>${fmt(v)}</div>`; }).join("")}`).join("")}</div></div>`;
}
// a brand's own domains: the payload's list, else <id>.com; the host test keeps the original "<id>.<tld>" rule when no list is carried
const ownedOf = (b) => (b.owned && b.owned.length ? b.owned : [`${b.id}.com`]);
const isOwnedHost = (b, h) => { const host = (h || "").toLowerCase().replace(/^www\./, ""); return b.owned && b.owned.length ? b.owned.some(d => host === d || host.endsWith("." + d)) : new RegExp(`(^|\\.)${b.id}\\.[a-z.]+$`, "i").test(host); };
// one spelling per model, so a model counts once however the reader wrote it. Per brand, the
// token that identifies the model on the shelf; a string that carries none stays as written.
function canonModel(brand, p) {
  const t = String(p || "").toLowerCase(); let m;
  if (brand === "sony") { if ((m = /bravia\s*(\d)\s*(ii|iii)?\b/.exec(t))) return `${PL} ${m[1]}${m[2] ? " " + m[2].toUpperCase() : ""}`; if ((m = /\b([axz]\d{2}[a-z]?)\b/.exec(t))) return m[1].toUpperCase(); return null; }
  if (brand === "lg") { if ((m = /\b([bcg]\d)\b/.exec(t))) return `${m[1].toUpperCase()} OLED`; if (/qned/.test(t)) return "QNED"; return null; }
  if (brand === "samsung") { if ((m = /\b(s\d{2}[a-z]?|qn\d{2,3}[a-z]?|q\d{2}[a-z]?|du\d{4}|u\d{4}[a-z]?|the frame)\b/.exec(t))) return m[1].toUpperCase().replace("THE FRAME", "The Frame"); return null; }
  if (brand === "tcl") { if ((m = /\b(qm\d[a-z]?|q\d{2}[a-z]?|q\d[a-z]?|c\d{3}|s\d[a-z]?)\b/.exec(t))) return m[1].toUpperCase(); return null; }
  if (brand === "hisense") { if ((m = /\b(u\d[a-z]{0,2}|ux|a\d[a-z]?)\b/.exec(t))) return m[1].toUpperCase(); return null; }
  // phones: the shelf token per line — "Galaxy S26 Ultra", "iPhone 17 Pro Max", "Pixel 10 Pro Fold", "OnePlus 15", "Razr Ultra"
  // "S26+" and "S26 Plus" are one model: the "+" has no word boundary after it, so it is matched
  // on its own branch (paid for 2026-09-22: every S26+ mention folded into "Galaxy S26" and the
  // catalogue lens called the S26+ never named)
  if (brand === "galaxy") { if ((m = /\b(?:galaxy\s+)?(s\d{2})(?:\s*(ultra|plus|fe|edge)\b|\s?(\+))?/.exec(t))) { const v = m[3] ? "+" : m[2] === "plus" ? "+" : m[2] || ""; return `Galaxy ${m[1].toUpperCase()}${v ? (v === "+" ? "+" : " " + v[0].toUpperCase() + v.slice(1)) : ""}`; } if ((m = /\bz\s*(fold|flip)\s*(\d)\s*(ultra|fe)?\b/.exec(t))) return `Galaxy Z ${m[1][0].toUpperCase() + m[1].slice(1)} ${m[2]}${m[3] ? " " + m[3][0].toUpperCase() + m[3].slice(1) : ""}`; if ((m = /\b(a\d{2})\b/.exec(t))) return `Galaxy ${m[1].toUpperCase()}`; return null; }
  if (brand === "apple") { if ((m = /iphone\s*(\d{2})\s*(pro max|pro|plus|air|e)?\b/.exec(t))) return `iPhone ${m[1]}${m[2] ? " " + m[2].replace(/\b\w/g, c => c.toUpperCase()) : ""}`; if (/iphone air/.test(t)) return "iPhone Air"; return null; }
  if (brand === "google") { if ((m = /pixel\s*(\d{1,2})\s*(pro fold|pro xl|pro|fold|a)?\b/.exec(t))) return `Pixel ${m[1]}${m[2] ? (m[2] === "a" ? "a" : " " + m[2].replace(/\b\w/g, c => c.toUpperCase()).replace(/\bXl\b/, "XL")) : ""}`; return null; }
  if (brand === "oneplus") { if ((m = /oneplus\s*(\d{1,2})\s*(r|t|pro)?\b/.exec(t))) return `OnePlus ${m[1]}${m[2] ? m[2].toUpperCase() : ""}`; if (/\bopen\b/.test(t)) return "OnePlus Open"; return null; }
  if (brand === "motorola") { if ((m = /razr\s*(ultra|\+|plus)?\s*(\d{4})?/.exec(t))) return `Razr${m[1] ? " " + (m[1] === "+" ? "+" : m[1][0].toUpperCase() + m[1].slice(1)) : ""}${m[2] ? " " + m[2] : ""}`; if ((m = /\bedge\s*(\d{2})?\s*(pro|ultra)?/.exec(t))) return `Edge${m[1] ? " " + m[1] : ""}${m[2] ? " " + m[2][0].toUpperCase() + m[2].slice(1) : ""}`; return null; }
  return null;
}
const seqColor = (v, mx) => { if (!v) return "var(--line2)"; const t = Math.min(1, v / mx); return `color-mix(in srgb, var(--seq5) ${Math.round(12 + t * 78)}%, #fff)`; };
const divColor = (v, mx) => { if (!v) return "var(--div-mid)"; const t = Math.min(1, Math.abs(v) / mx); return `color-mix(in srgb, ${v > 0 ? "var(--div-pos)" : "var(--div-neg)"} ${Math.round(14 + t * 70)}%, #fff)`; };

function renderLenses() {
  const A = activeAnswers(); const s = subjectId(); const bs = brandsOn(); const sb = bs.find(b => b.id === s); const q = qById(); const cards = [];
  const engL = Object.fromEntries(D.engines.map(e => [e.id, e.label]));
  // a verdict cell: the brand an answer commits to, or "no verdict"
  const pickCell = (x) => { if (!x) return '<td class="num"><span class="note">—</span></td>'; if (!x.topPick) return '<td class="num" title="no single top pick"><span class="pk none">no verdict</span></td>'; const b = bs.find(z => z.id === x.topPick); return `<td class="num"><span class="pk" style="--sw:${b ? b.color : "#80868b"}">${esc(b ? b.label : x.topPick)}</span></td>`; };
  const vEng = [...S.engines];
  // 1 recommendation rate — with every question and each engine's pick behind an accordion
  const AC = compareAnswers(); const tp = topPickShare(AC); const cq = compareQueries();
  const pickTable = `<details class="h2hq"><summary>See the ${cq.length} brand-neutral questions and each engine's top pick</summary><div class="tblwrap tall"><table class="t wrap"><thead><tr><th>Question</th>${vEng.map(e => `<th class="num">${esc(engL[e])}</th>`).join("")}</tr></thead><tbody>${cq.map(qq => `<tr class="tap" onclick="openQuestion('${qq.id}')"><td class="wrap">${esc(qq.text)}<small class="note" style="display:block">${esc(stageLabel(qq.stage))}</small></td>${vEng.map(e => pickCell(AC.find(y => y.queryId === qq.id && y.engine === e))).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  const pickEngRows = vEng.map(e => { const ea = AC.filter(a => a.engine === e); const t = topPickShare(ea); const lead = byDesc(Object.fromEntries(Object.entries(t.out).filter(([, v]) => v != null)))[0]; return { e, n: t.n, sony: ea.filter(a => a.topPick === s).length, share: t.out[s], lead }; });
  const pickByEngTable = `<div class="tblwrap" style="margin-top:14px"><table class="t"><thead><tr><th>Engine</th><th class="num">Commits</th><th class="num">Picks ${SL}</th><th class="num">${SL} share</th><th>Most picked</th></tr></thead><tbody>${pickEngRows.map(r => `<tr class="tap" onclick="openEngineProof('${r.e}')"><td>${esc(engL[r.e])}</td><td class="num">${r.n}</td><td class="num"><b>${r.sony}</b></td><td class="num">${pct(r.share)}</td><td>${r.lead ? `<span class="pk" style="--sw:${brandColor(r.lead[0])}">${esc(brandLabel(r.lead[0]))} ${pct(r.lead[1])}</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>`;
  cards.push(lensCard("pick", "Lens 01 · Recommendation", "Recommendation rate", "Being named is not being recommended. The share of answers whose single top recommendation is each brand; the bars add to 100% of the answers that commit to one brand.", barRows(tp.out, { onclick: "openPickProof" }) + `<div class="note" style="margin-top:8px">${tp.n} of ${AC.length} answers to the ${cq.length} brand-neutral questions commit to one top pick; the rest hedge.</div>` + pickByEngTable + pickTable, `${SL} is the top pick in ${pct(tp.out[s])} of committed answers — ${rankPhrase(tp.out, s)}. The programme's content and source work is judged on this number, not on mentions.`));
  // 2 head-to-head — every answer is one of: Sony, a rival, another brand, or no verdict, so the
  // verdict bar adds to 100% (the bars alone once read 32 / 9 / 7 / 5 and left the reader to
  // guess where the other 48% went — Aashish, 2026-09-22)
  const vsQ = activeQueries().filter(x => x.focus === "vs"); const vsA = A.filter(a => vsQ.some(x => x.id === a.queryId));
  const wins = {}; for (const b of bs) wins[b.id] = vsA.filter(a => a.topPick === b.id).length; const und = vsA.filter(a => !a.topPick).length;
  const other = vsA.filter(a => a.topPick && !bs.some(b => b.id === a.topPick)).length; const total = vsA.length, committed = total - und;
  // one bar, three units (Aashish, 2026-09-22): the subject, every rival as a single "Rivals"
  // segment (the per-brand split is in the tooltip and the table below), and no verdict
  const rivalWins = vsA.filter(a => a.topPick && a.topPick !== s).length;
  const rivalNote = bs.filter(b => b.id !== s && wins[b.id]).map(b => `${b.label} ${wins[b.id]}`).concat(other ? [`another brand ${other}`] : []).join(", ");
  const segs = [{ id: s, label: SL, color: brandColor(s), n: wins[s], cls: "", note: "" }, { id: "rivals", label: "Rivals", color: "#8b93a7", n: rivalWins, cls: "", note: rivalNote }, { id: "none", label: "No verdict", color: "#dfe2ea", cls: "none", n: und, note: "" }].filter(x => x.n > 0);
  const verdictBar = total ? `<div class="vstack">${segs.map(x => `<span class="${x.cls}" style="width:${(x.n / total * 100).toFixed(1)}%;background:${x.color}" title="${esc(x.label)} · ${x.n} of ${total} (${pct(x.n / total)})${x.note ? " — " + esc(x.note) : ""}"><b>${x.n / total >= 0.09 ? pct(x.n / total) : ""}</b></span>`).join("")}</div><div class="legend">${segs.map(x => `<span title="${x.note ? esc(x.note) : ""}"><i style="background:${x.color}"></i>${esc(x.label)} ${x.n} · ${pct(x.n / total)}</span>`).join("")}</div>` : '<div class="pending">No head-to-head question in scope.</div>';
  const h2hStats = `<div class="stats3">${stat(`${SL} wins`, pct(total ? wins[s] / total : null), `${wins[s]} of all ${total} head-to-head answers`, "openH2H('all')")}${stat("Wins when a verdict is given", pct(committed ? wins[s] / committed : null), `${wins[s]} of the ${committed} answers that commit to one brand`, "openH2H('committed')")}${stat("No verdict", pct(total ? und / total : null), `${und} answers refuse to choose between the two`, "openH2H('none')")}</div>`;
  const h2hByEng = `<div class="tblwrap" style="margin-top:12px"><table class="t"><thead><tr><th>Engine</th><th class="num">Answers</th><th class="num">${SL}</th><th class="num">A rival</th><th class="num">No verdict</th></tr></thead><tbody>${vEng.map(e => { const ea = vsA.filter(a => a.engine === e); const w = ea.filter(a => a.topPick === s).length, r = ea.filter(a => a.topPick && a.topPick !== s).length, n0 = ea.filter(a => !a.topPick).length; return `<tr><td>${esc(engL[e])}</td><td class="num">${ea.length}</td><td class="num"><b>${w}</b></td><td class="num">${r}</td><td class="num">${n0}</td></tr>`; }).join("")}</tbody></table></div>`;
  const h2hTable = `<details class="h2hq"><summary>See the ${vsQ.length} questions and each engine's verdict</summary><div class="tblwrap"><table class="t wrap"><thead><tr><th>Question</th>${vEng.map(e => `<th class="num">${esc(engL[e])}</th>`).join("")}</tr></thead><tbody>${vsQ.map(qq => `<tr class="tap" onclick="openQuestion('${qq.id}')"><td class="wrap">${esc(qq.text)}</td>${vEng.map(e => pickCell(vsA.find(y => y.queryId === qq.id && y.engine === e))).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  cards.push(lensCard("h2h", "Lens 02 · Head-to-head", "Who wins the comparison", `${vsQ.length} questions put ${SL} beside one named rival and ask which to buy. Every one of the ${total} answers ends one way — ${SL}, the rival, another brand or no verdict — so the bar adds to 100%.`, verdictBar + h2hStats + h2hByEng + h2hTable, `When a shopper puts ${SL} beside a rival, ${SL} wins ${pct(total ? wins[s] / total : null)} of all answers and ${pct(committed ? wins[s] / committed : null)} of those where the engine commits; the engines refuse to choose in ${pct(total ? und / total : null)}. Comparison pages that answer the exact question are the lever, and the no-verdict answers are the softest ground.`));
  // 3 cross-engine agreement
  const byQ = {}; for (const a of A) (byQ[a.queryId] ||= []).push(a);
  const multi = Object.entries(byQ).filter(([, arr]) => arr.length >= 2); let agree = 0, agreeSony = 0, splitNoSony = 0; const disagreeQ = [];
  for (const [qid, arr] of multi) { const picks = uniq(arr.map(a => a.topPick || "")); if (picks.length === 1 && picks[0]) { agree++; if (picks[0] === s) agreeSony++; } else { disagreeQ.push(qid); if (!arr.some(a => a.topPick === s)) splitNoSony++; } }
  cards.push(lensCard("agree", "Lens 03 · Consensus", "Do the engines agree?", `For each question, whether every engine lands on the same top pick — and whether that consensus is ${SL}.`, `<div class="grid2" style="gap:10px">${stat("Consensus", pct(multi.length ? agree / multi.length : null), `${agree} of ${multi.length} questions where all engines pick the same brand`, "openAgree('agree')")}${stat(`Consensus is ${SL}`, `${agreeSony}<small>/ ${agree}</small>`, `questions where every engine's top pick is ${SL}`, "openAgree('sony')")}</div>`, `On ${disagreeQ.length} questions the engines disagree; on ${splitNoSony} of those no engine picks ${SL} at all — the softest ground, where one earned source can tip the answer.`));
  // 4 citation share by kind + top domains — each citation knows which brands its answer names
  const cites = A.flatMap(a => (a.sources || []).map(x => ({ ...x, named: !!mention(a, sb), by: Object.fromEntries(bs.map(b => [b.id, !!mention(a, b)])), qid: a.queryId, engine: a.engine, aid: `${a.queryId}|${a.engine}` })));
  const kinds = {}; for (const c of cites) kinds[c.kind] = (kinds[c.kind] || 0) + 1; const kindTot = cites.length || 1;
  const KIND_L = { editorial: "Editorial reviews", community: "Community (Reddit, YouTube)", retailer: "Retailers", owned: `${SL}-owned`, "rival-owned": "Rival-owned", news: "News", other: "Other" };
  const KIND_C = { editorial: "var(--seq5)", community: "var(--seq4)", retailer: "var(--seq3)", news: "var(--seq2)", other: "#c9c4b6", owned: "var(--good)", "rival-owned": "var(--div-neg)" };
  const kindRows = byDesc(kinds);
  cards.push(lensCard("cites", "Lens 04 · Citation mix", "Where the answers come from", `${cites.length} citations across the answers in scope, classified by the kind of site. Owned = ${OWN}; rival-owned = ${bs.filter(b => b.id !== s).map(b => ownedOf(b)[0]).join(", ")}.`, donut(kindRows.map(([k, v]) => ({ label: KIND_L[k] || k, v, color: KIND_C[k] || "#ccc" })), { total: cites.length, label: String(cites.length), sub: "citations" }), `${SL}-owned pages are ${pct((kinds.owned || 0) / kindTot)} of what the engines cite; editorial reviews are ${pct((kinds.editorial || 0) / kindTot)}. The answer is written from the review layer, so that is where the programme spends its effort.`));
  // per domain: citations, engines, and — per answer that cites it — which brands that answer names
  const hosts = {}; for (const c of cites) { if (!c.host) continue; hosts[c.host] ||= { n: 0, named: 0, qids: new Set(), eng: new Set(), aids: new Set(), by: Object.fromEntries(bs.map(b => [b.id, 0])) }; const h = hosts[c.host]; h.n++; if (c.named) h.named++; h.qids.add(c.qid); h.eng.add(c.engine); if (!h.aids.has(c.aid)) { h.aids.add(c.aid); for (const b of bs) if (c.by[b.id]) h.by[b.id]++; } }
  const topHosts = Object.entries(hosts).sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  window.__hosts = hosts;
  const citingAnswers = uniq(cites.map(c => c.aid)); const citingNamed = uniq(cites.filter(c => c.named).map(c => c.aid)).length; const sonyAvg = citingAnswers.length ? citingNamed / citingAnswers.length : null;
  const bsOrd = [sb, ...bs.filter(b => b.id !== s)].filter(Boolean);
  const gapHosts = topHosts.filter(([, v]) => { const na = v.aids.size; const sr = na ? v.by[s] / na : 0; return sonyAvg != null && sr < sonyAvg && bs.some(b => b.id !== s && v.by[b.id] / na > sr); }).slice(0, 3);
  cards.push(lensCard("hosts", "Lens 05 · Source map", `The sites the engines trust for ${CAT} questions — and who they carry`, `The most-cited domains, how many engines cite them, and for each brand the share of answers citing the domain that name it. A domain that carries the rivals but not ${SL} is an outreach target. Tap a row for every answer that cites it.`, (() => { const mxN = Math.max(1, ...topHosts.map(([, v]) => v.n)); return `<div class="tblwrap"><table class="t wrap hostmap"><thead><tr><th>Domain</th><th>Citations</th><th class="num">Engines</th>${bsOrd.map(b => `<th class="bh ${b.id === s ? "subj" : ""}"><i class="sw" style="background:${b.color}"></i>${esc(b.label)} named</th>`).join("")}</tr></thead><tbody>${topHosts.map(([h, v]) => { const na = v.aids.size; return `<tr class="tap" onclick="openHost('${esc(h)}')"><td class="dom">${esc(h)}<small class="note" style="display:block;font-weight:500">in ${na} answer${na === 1 ? "" : "s"}</small></td><td><span class="mbar cite"><i style="width:${(v.n / mxN * 100).toFixed(1)}%"></i></span><span class="tnum">${v.n}</span></td><td class="num">${v.eng.size}<small class="note">/${S.engines.size}</small></td>${bsOrd.map(b => { const r = na ? v.by[b.id] / na : null; return `<td class="bc ${b.id === s ? "subj" : ""}"><span class="bcell ${b.id === s && sonyAvg != null && r != null && r < sonyAvg ? "lo" : ""}" style="--sw:${b.color};--w:${r == null ? 0 : (r * 100).toFixed(0)}%" title="${esc(b.label)} named in ${v.by[b.id]} of the ${na} answers citing ${esc(h)}"><i></i><b>${pct(r)}</b></span></td>`; }).join("")}</tr>`; }).join("")}</tbody></table></div><div class="note" style="margin-top:8px">Across all ${citingAnswers.length} answers that cite anything, ${SL} is named in ${pct(sonyAvg)}; a ${SL} cell in amber sits below that average.</div>`; })(), `${topHosts.slice(0, 3).map(([h]) => `<b>${esc(h)}</b>`).join(", ")} carry the category. ${gapHosts.length ? `${gapHosts.map(([h, v]) => { const na = v.aids.size; const best = bs.filter(b => b.id !== s).map(b => [b.id, v.by[b.id] / na]).sort((x, y) => y[1] - x[1])[0]; return `<b>${esc(h)}</b> names ${SL} in ${pct(v.by[s] / na)} of its answers but ${esc(brandLabel(best[0]))} in ${pct(best[1])}`; }).join("; ")} — those are the sources to earn a placement on.` : `No heavily-cited source carries a rival ahead of ${SL} in this scope.`}`));
  // 6 citation gap — per answer: how many answers cite the domain and never name Sony
  const gap = Object.entries(hosts).map(([h, v]) => ({ h, n: v.aids.size, notNamed: v.aids.size - v.by[s] })).filter(x => x.n >= 4).sort((a, b) => b.notNamed - a.notNamed || b.n - a.n).slice(0, 8);
  cards.push(lensCard("gap", `Lens 06 · Where ${SL} is missing`, `Answers that cite a source and leave ${SL} out`, `For the most-cited domains, the number of answers that cite the domain without naming ${SL} at all. Each is an answer an earned placement on that site could change; tap a domain for those answers.`, barRows(Object.fromEntries(gap.map(x => [x.h, x.notNamed])), { fmt: (v) => `${v} ans.`, onclick: "openHost" }), `${gap[0] ? `<b>${esc(gap[0].h)}</b> is cited in ${gap[0].notNamed} answers that never mention ${SL} — the largest single gap.` : ""} Each row is a specific outreach target: a review, a “best ${CAT}” list or a thread where the model that should be there is not.`));
  // 14 citations by engine — each engine reads a different web
  const KIND_ORDER = ["editorial", "community", "retailer", "owned", "rival-owned", "news", "other"];
  const engRows = vEng.map(e => { const ce = cites.filter(c => c.engine === e); const k = {}; for (const c of ce) k[c.kind] = (k[c.kind] || 0) + 1; const hs = {}; for (const c of ce) hs[c.host] = (hs[c.host] || 0) + 1; const nA = A.filter(a => a.engine === e).length; return { e, n: ce.length, per: nA ? ce.length / nA : null, kinds: KIND_ORDER.filter(x => k[x]).map(x => [x, k[x]]), top: byDesc(hs).slice(0, 4), hostsN: Object.keys(hs).length }; });
  const byPer = engRows.filter(r => r.per != null).sort((a, b) => b.per - a.per); const commShare = engRows.map(r => [r.e, r.n ? (r.kinds.find(k => k[0] === "community") || [0, 0])[1] / r.n : 0]).sort((a, b) => b[1] - a[1])[0];
  cards.push(lensCard("byengine", "Lens 14 · Citations by engine", "Each engine reads a different web", "How many sources each engine cites per answer, what kind of sites they are, and the domains it leans on most. Tap a domain for the answers citing it.", engRows.map(r => `<div class="engrow"><div class="rl">${esc(engL[r.e])}<small>${r.n} citations · ${n1(r.per)} per answer · ${r.hostsN} domains</small></div><div>${r.n ? `<div class="kstack">${r.kinds.map(([k, v]) => `<span style="width:${(v / r.n * 100).toFixed(1)}%;background:${KIND_C[k] || "#ccc"}" title="${esc(KIND_L[k] || k)} ${v} (${pct(v / r.n)})"></span>`).join("")}</div>` : '<div class="note">no citations captured on this path</div>'}<div class="legend" style="margin-top:6px">${r.top.map(([h, v]) => `<span class="tap" onclick="openHost('${esc(h)}')"><b>${esc(h)}</b> ${v}</span>`).join("")}</div></div></div>`).join("") + `<div class="legend" style="margin-top:10px">${KIND_ORDER.filter(k => kinds[k]).map(k => `<span><i style="background:${KIND_C[k] || "#ccc"}"></i>${esc(KIND_L[k] || k)}</span>`).join("")}</div>`, `${byPer.length ? `${esc(engL[byPer[0].e])} cites the most per answer (${n1(byPer[0].per)}) and ${esc(engL[byPer[byPer.length - 1].e])} the fewest (${n1(byPer[byPer.length - 1].per)}).` : ""} ${commShare && commShare[1] ? `${esc(engL[commShare[0]])} leans hardest on community sources (${pct(commShare[1])} of its citations).` : ""} An engine's answer can only be moved through the sites that engine reads.`));
  // 15 the brands' own pages — the one source each brand controls outright
  const ownOf = (h) => bs.find(b => isOwnedHost(b, h));
  const own = {}; for (const b of bs) own[b.id] = { n: 0, aids: new Set(), eng: new Set(), qids: new Set() }; for (const c of cites) { const b = ownOf(c.host); if (!b) continue; own[b.id].n++; own[b.id].aids.add(c.aid); own[b.id].eng.add(c.engine); own[b.id].qids.add(c.qid); }
  window.__own = own;
  const ownCounts = Object.fromEntries(bs.map(b => [b.id, own[b.id].n]));
  cards.push(lensCard("owned", "Lens 15 · The brands' own pages", "How often each brand's own site is in the answer", `Citations of ${bs.map(b => ownedOf(b)[0]).join(", ")} across the ${citingAnswers.length} answers that cite anything. A brand's own page in the citations is the one source it controls outright — and the engines mostly write from the review layer instead.`, barRows(ownCounts, { fmt: (v) => `${v} cites`, onclick: "openOwn" }) + `<div class="note" style="margin-top:8px">${bs.map(b => `${esc(b.label)}: in ${own[b.id].aids.size} of ${citingAnswers.length} answers, on ${own[b.id].eng.size} engine${own[b.id].eng.size === 1 ? "" : "s"}`).join(" · ")}.</div>`, `${SL}'s own pages are cited ${own[s].n} times — ${standingPhrase(ownCounts, s, "brands")} — in ${pct(citingAnswers.length ? own[s].aids.size / citingAnswers.length : null)} of citing answers. ${(() => { const st = standing(ownCounts, s); return st && st.leader !== s ? `${esc(brandLabel(st.leader))}'s site is cited ${own[st.leader].n} times.` : ""; })()} Owned pages move an answer only when they are the kind of page the engines already cite: comparison and spec pages, not campaign pages.`));
  // 7 products named — one row per model however the reader wrote it ("C6 OLED", "LG C6" and
  // "C6" fold into one), on the brand-neutral base, a model counting once per answer. Sorted by
  // raw string this once read BRAVIA 8 II 21 beside "C6 OLED" 21 with LG's other spellings lower
  // down; folded, the LG C5 and C6 lead (Aashish, 2026-09-22).
  const prods = {}; for (const a of AC) for (const b of bs) { const m = mention(a, b); if (m && m.product) { const raw = m.product.replace(/\s+/g, " ").trim(); const c = canonModel(b.id, raw) || raw; const k = `${b.id}|${c}`; prods[k] ||= { n: 0, q: new Set(), e: new Set(), raw: {} }; prods[k].n++; prods[k].q.add(a.queryId); prods[k].e.add(a.engine); prods[k].raw[raw] = (prods[k].raw[raw] || 0) + 1; } }
  const prodAll = Object.entries(prods).sort((a, b) => b[1].n - a[1].n || b[1].q.size - a[1].q.size); const prodRows = prodAll.slice(0, 14);
  cards.push(lensCard("products", "Lens 07 · Product level", "Which models the engines actually name", `Brand share is not model share. The models the engines put in front of a shopper on the ${cq.length} brand-neutral questions (${AC.length} answers); a model counts once per answer, however it is spelled.`, `<div class="tblwrap"><table class="t"><thead><tr><th>Model</th><th>Brand</th><th class="num">Answers</th><th class="num">Questions</th><th class="num">Engines</th></tr></thead><tbody>${prodRows.map(([k, v]) => { const [b, p] = k.split("|"); const spellings = byDesc(v.raw); return `<tr class="tap ${b === s ? "subj" : ""}" title="as written: ${esc(spellings.map(([r, n]) => `${r} (${n})`).join(", "))}" onclick="openModelProof(${JSON.stringify([...v.q]).replace(/"/g, "&quot;")}, '${esc(p)}')"><td>${esc(p)}</td><td><i class="sw" style="background:${brandColor(b)}"></i>${esc(brandLabel(b))}</td><td class="num"><b>${v.n}</b></td><td class="num">${v.q.size}<small class="note">/${cq.length}</small></td><td class="num">${v.e.size}<small class="note">/${S.engines.size}</small></td></tr>`; }).join("")}</tbody></table></div><div class="note" style="margin-top:8px">Hover a row for the spellings folded into it; tap it for every answer that names the model.</div>`, (() => { const top = prodAll[0]; const sonyP = prodAll.filter(([k]) => k.startsWith(s + "|")); const modelCounts = Object.fromEntries(prodAll.map(([k, v]) => [k, v.n])); return `${top ? `<b>${esc(top[0].split("|")[1])}</b> (${esc(brandLabel(top[0].split("|")[0]))}) is the most-named model: ${top[1].n} answers across ${top[1].q.size} questions.` : ""} ${sonyP.length ? `${SL}'s most-named is <b>${esc(sonyP[0][0].split("|")[1])}</b> at ${sonyP[0][1].n} — ${standingPhrase(modelCounts, sonyP[0][0], "models named")}.` : `No ${SL} model is named on these questions.`} A model that isn't named cannot be bought on the engine's recommendation — the catalogue beside lists what should be.`; })()));
  // 8 attributes — the hero of its own page: every cell opens to the answers and the sentences
  const attrs = D.attrs;
  const attrNet = (bid, at, eng) => { let pos = 0, neg = 0; for (const a of A) { if (eng && a.engine !== eng) continue; for (const x of (a.attributes?.[bid] || [])) if (x.attr === at) { if (x.polarity === "-") neg++; else pos++; } } return { pos, neg, net: pos - neg }; };
  const cells = bs.map(b => attrs.map(at => attrNet(b.id, at).net));
  const mx = Math.max(1, ...cells.flat().map(Math.abs)); const fmtNet = (v) => v === 0 ? "" : (v > 0 ? "+" : "") + v;
  cards.push(lensCard("attrs", "Lens 08 · Attribute association", "What the engines say each brand is good (and bad) at", `Positive minus negative attribute mentions across the ${A.length} answers in scope. Green is praised, red is criticised, deeper is more. Tap a cell for the answers and the sentences behind it.`, heat(bs.map(b => b.label), attrs.map(attrHead), cells, { fmt: fmtNet, colorFor: (v) => divColor(v, mx), cls: "big", rowW: `${Math.min(150, Math.max(110, 12 + Math.max(...bs.map(b => b.label.length)) * 9.2))}px`, colw: "minmax(66px,1fr)", cellAttr: (i, j) => { const x = attrNet(bs[i].id, attrs[j]); return `onclick="openAttr('${bs[i].id}',${j})" title="${esc(bs[i].label)} · ${esc(attrs[j])}: praised in ${x.pos}, criticised in ${x.neg} — tap for the answers"`; } }) + `<div class="hlegend"><span>criticised · −${mx}</span><i class="ramp"></i><span>+${mx} · praised</span></div>`, (() => { const i = bs.findIndex(b => b.id === s); const row = cells[i] || []; const best = attrs.map((a, j) => [a, row[j]]).sort((x, y) => y[1] - x[1]); const rivalsLead = attrs.map((a, j) => [a, Math.max(...cells.map((r, k) => k === i ? -99 : r[j])) - (row[j] || 0)]).filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, 3); const negs = best.filter(x => x[1] < 0); return `${SL}'s strongest associations are ${best.slice(0, 2).map(x => `<b>${esc(x[0])}</b>`).join(" and ")}${negs.length ? `; it nets negative on ${negs.map(x => `<b>${esc(x[0])}</b> (${x[1]})`).join(", ")}` : ""}. Rivals lead most clearly on ${rivalsLead.map(x => esc(x[0])).join(", ") || "nothing in this scope"}. Those are the attributes ${SL}'s own content and reviews need to argue for.`; })()));
  // 8b Sony, both sides of every attribute — a net score can hide a split
  const sonyRows = attrs.map((at, j) => ({ at, j, ...attrNet(s, at) })).sort((x, y) => y.net - x.net); const mxPN = Math.max(1, ...sonyRows.flatMap(r => [r.pos, r.neg]));
  const negAttrs = sonyRows.filter(r => r.net < 0); const splitAttrs = sonyRows.filter(r => r.pos >= 3 && r.neg >= 3);
  cards.push(lensCard("attrbal", `Lens 08b · ${SL}, praised and criticised`, "Both sides of every attribute", `For each attribute, how many engine answers praise ${SL} for it (right, green) and how many criticise it (left, red). A net score can hide a split; this cannot. Tap a row for the answers.`, `<div class="dbars">${sonyRows.map(r => `<div class="dbar" onclick="openAttr('${s}',${r.j})" title="praised ${r.pos} · criticised ${r.neg} — tap for the answers"><span class="dl">${esc(r.at)}</span><span class="neg"><i style="width:${(r.neg / mxPN * 100).toFixed(1)}%"></i>${r.neg ? `<em>${r.neg}</em>` : ""}</span><span class="pos"><i style="width:${(r.pos / mxPN * 100).toFixed(1)}%"></i>${r.pos ? `<em>${r.pos}</em>` : ""}</span><span class="dv" style="color:${r.net < 0 ? "var(--risk)" : r.net > 0 ? "var(--good)" : "var(--mute)"}">${r.net > 0 ? "+" : ""}${r.net}</span></div>`).join("")}</div><div class="hlegend" style="justify-content:space-between"><span>← criticised · ${sum(sonyRows.map(r => r.neg))} mentions</span><span>net</span><span>praised · ${sum(sonyRows.map(r => r.pos))} mentions →</span></div>`, `${negAttrs.length ? `The engines criticise ${SL} more than they praise it on ${negAttrs.map(r => `<b>${esc(r.at)}</b> (${r.neg} against ${r.pos})`).join(", ")}.` : `No attribute nets negative for ${SL} in this scope.`} ${splitAttrs.length ? `${splitAttrs.map(r => `<b>${esc(r.at)}</b>`).join(", ")} ${splitAttrs.length === 1 ? "is" : "are"} argued both ways — the answers decide it on the model, not the brand.` : ""}`));
  // 8c where the rivals lead — the argument Sony's content has to make
  const leadRows = attrs.map((at, j) => { const rows = bs.map(b => ({ b, ...attrNet(b.id, at) })).sort((x, y) => y.net - x.net); const sonyR = rows.find(x => x.b.id === s) || { net: 0 }; return { at, j, leader: rows[0], sony: sonyR, gap: rows[0].net - sonyR.net, sonyLeads: rows[0].b.id === s && (!rows[1] || rows[0].net > rows[1].net) }; });
  const rivalsLead = leadRows.filter(x => x.leader.b.id !== s && x.gap > 0).sort((a, b) => b.gap - a.gap); const sonyLeads = leadRows.filter(x => x.sonyLeads);
  cards.push(lensCard("attrlead", "Lens 08c · Where the rivals lead", "The attributes to argue for", `Every attribute where a rival is credited more than ${SL}: who leads, its net, ${SL}'s net and the gap between them. Tap a row for the leader's answers on that attribute.`, `<div class="tblwrap"><table class="t"><thead><tr><th>Attribute</th><th>Leads</th><th class="num">Leader net</th><th class="num">${SL} net</th><th class="num">Gap</th></tr></thead><tbody>${rivalsLead.map(x => `<tr class="tap" onclick="openAttr('${x.leader.b.id}',${x.j})"><td>${esc(x.at)}</td><td><i class="sw" style="background:${x.leader.b.color}"></i>${esc(x.leader.b.label)}</td><td class="num">${fmtNet(x.leader.net) || 0}</td><td class="num">${fmtNet(x.sony.net) || 0}</td><td class="num" style="color:var(--risk);font-weight:700">${x.gap}</td></tr>`).join("") || `<tr><td colspan="5" class="note">No attribute where a rival leads ${SL}.</td></tr>`}</tbody></table></div><div class="note" style="margin-top:8px">${SL} leads outright on ${sonyLeads.length ? sonyLeads.map(x => `<b>${esc(x.at)}</b>`).join(", ") : "no attribute"}.</div>`, `${rivalsLead[0] ? `The widest gap is <b>${esc(rivalsLead[0].at)}</b>: ${esc(rivalsLead[0].leader.b.label)} nets ${fmtNet(rivalsLead[0].leader.net)} to ${SL}'s ${fmtNet(rivalsLead[0].sony.net) || 0}.` : ""} A gap closes in the sources the engines cite — reviews and comparison pages that make the case — not in ${SL}'s own copy.`));
  // 8d Sony by engine — a criticism on one engine points at that engine's sources
  const engCells = vEng.map(e => attrs.map(at => attrNet(s, at, e).net)); const mxE = Math.max(1, ...engCells.flat().map(Math.abs));
  cards.push(lensCard("attreng", `Lens 08d · ${SL} by engine`, `Which engine says what about ${SL}`, `${SL}'s net attribute score on each engine. A criticism that lives on one engine points at that engine's sources; one on every engine points at the category's reviews. Tap a cell for that engine's answers.`, heat(vEng.map(e => engL[e]), attrs.map(attrHead), engCells, { fmt: fmtNet, colorFor: (v) => divColor(v, mxE), cls: "big", rowW: "110px", colw: "minmax(66px,1fr)", cellAttr: (i, j) => { const x = attrNet(s, attrs[j], vEng[i]); return `onclick="openAttr('${s}',${j},'${vEng[i]}')" title="${esc(engL[vEng[i]])} · ${esc(attrs[j])}: praised in ${x.pos}, criticised in ${x.neg} — tap for the answers"`; } }) + `<div class="hlegend"><span>criticised · −${mxE}</span><i class="ramp"></i><span>+${mxE} · praised</span></div>`, (() => { const worst = negAttrs[0]; if (!worst) return `No engine nets negative on any ${SL} attribute in this scope.`; const per = vEng.map(e => [e, attrNet(s, worst.at, e)]).filter(([, x]) => x.neg > 0).sort((a, b) => b[1].neg - a[1].neg); return `On <b>${esc(worst.at)}</b> the criticism comes from ${per.map(([e, x]) => `${esc(engL[e])} (${x.neg})`).join(", ")} — ${per.length >= vEng.length - 1 ? "every engine says it, so it is the category's reviews talking" : "not every engine, so it is those engines' sources talking"}.`; })()));
  // 9 claims
  const claims = A.flatMap(a => (a.subjectClaims || []).map(c => ({ ...c, engine: a.engine, qid: a.queryId }))); const ctypes = {}; for (const c of claims) ctypes[c.type] = (ctypes[c.type] || 0) + 1;
  const conflicts = claimConflicts(A); window.__claims = claims; window.__conflicts = conflicts;
  // the audit is the page's point, so the claims are on the page: every claim, with whether it is
  // checkable (the reader extracted a value), whether engines conflict on it, and whether more than
  // one engine asserts the same value — filters on the left, the scrolling list on the right
  const normP = (p) => (p || "").toLowerCase().replace(/[^a-z0-9]/g, ""); const normV = canonClaimValue;
  const confBy = Object.fromEntries(conflicts.map(c => [c.key, c])); const agreeBy = {};
  for (const c of claims) { if (!c.value || !c.product) continue; const k = `${normP(c.product)}|${c.type}|${normV(c.value)}`; (agreeBy[k] ||= new Set()).add(c.engine); }
  const rows = claims.map((c, i) => { const ck = c.value && c.product ? `${normP(c.product)}|${c.type}` : null; const conf = ck ? confBy[ck] : null; const agreed = c.value && c.product ? agreeBy[`${normP(c.product)}|${c.type}|${normV(c.value)}`].size : 0; return { ...c, i, conflict: conf ? conf.values : null, agreed }; });
  window.__claimRows = rows; window.__clf = window.__clf || { show: "all", eng: "all" };
  const nAgreed = rows.filter(r => r.agreed >= 2).length, nConf = rows.filter(r => r.conflict).length, nCheck = rows.filter(r => r.value).length;
  const typeOrder = Object.entries(ctypes).sort((a, b) => b[1] - a[1]);
  const ctl = `<aside class="cctl"><div class="cstats"><div class="cstat"><b class="tnum">${claims.length}</b><span>claims about ${SL}</span></div><div class="cstat"><b class="tnum">${nCheck}</b><span>carry a checkable value</span></div><div class="cstat risk"><b class="tnum">${nConf}</b><span>in a conflict — same model, same fact, different values (${conflicts.length} pairs)</span></div><div class="cstat good"><b class="tnum">${nAgreed}</b><span>asserted with the same value by 2+ engines</span></div></div>
    <div class="eyebrow">Show</div><div class="cchips" id="clShow">${[["all", "All", claims.length], ["conflict", "Conflicting", nConf], ["agreed", "Agreed by 2+", nAgreed], ["checkable", "Checkable", nCheck], ...typeOrder.map(([k, v]) => [k, k, v])].map(([k, l, n]) => `<button type="button" class="cchip ${k === window.__clf.show ? "on" : ""}" data-k="${k}" onclick="claimFilter('show','${k}')">${esc(l)} <small>${n}</small></button>`).join("")}</div>
    <div class="eyebrow">Engine</div><div class="cchips" id="clEng">${[["all", "All"], ...[...S.engines].map(e => [e, engL[e]])].map(([k, l]) => `<button type="button" class="cchip ${k === window.__clf.eng ? "on" : ""}" data-k="${k}" onclick="claimFilter('eng','${k}')">${esc(l)}</button>`).join("")}</div>
    <p class="note" style="margin-top:10px">Checkable = the reader extracted a value (a price, a figure, a name) ${SL} can verify. Conflicting rows are marked red and list the competing values. Tap a row for every engine's full answer to that question.</p></aside>`;
  cards.push(lensCard("claims", "Lens 09 · Claim audit", `What the engines assert about ${SL}`, `${claims.length} statements extracted from the answers in scope — prices, specs, awards, comparisons. Every one is either true, out of date or wrong, and ${SL} is the only party that can say which.`, `<div class="claimsx">${ctl}<div class="clist fullpage" id="claimList"></div></div>`, `A verified truth-set (${catCopy().truthSet}) is the first deliverable of the programme; the correction route runs through the cited sources, since no engine has a correction desk. ${nConf ? `The ${nConf} conflicting claims are where to start: on the same model and fact the engines already disagree, so one of them is wrong today.` : ""}`));
  // 10 volatility
  if (D.volatility && D.volatility.runs.length >= 2) {
    const runs = D.volatility.runs; const pairs = {}; for (const r of runs) for (const a of r.answers) { if (!S.engines.has(a.engine)) continue; const k = `${a.queryId}|${a.engine}`; (pairs[k] ||= []).push({ named: a.brands.some(b => b.id === s), pick: a.topPick || "" }); }
    const rows = Object.entries(pairs).filter(([, v]) => v.length >= 2); const stableNamed = rows.filter(([, v]) => uniq(v.map(x => x.named)).length === 1).length; const stablePick = rows.filter(([, v]) => uniq(v.map(x => x.pick)).length === 1).length;
    const perQ = {}; for (const [k, v] of rows) { const [qid, e] = k.split("|"); (perQ[qid] ||= {})[e] = v; }
    const volEngines = uniq(runs.flatMap(r => r.answers.map(a => a.engine))).filter(e => S.engines.has(e));
    cards.push(lensCard("vol", "Lens 10 · Answer volatility", "Ask the same question three times", `${runs.length} independent passes of ${Object.keys(perQ).length} questions on ${volEngines.map(e => engL[e]).join(" and ") || "the engines"}, on the same day (the other engines' passes are queued). Whether ${SL}'s presence and the top pick hold from run to run.`, `<div class="grid2" style="gap:10px">${stat(`${SL} presence stable`, pct(rows.length ? stableNamed / rows.length : null), `${stableNamed} of ${rows.length} question × engine pairs agree across all ${runs.length} runs`)}${stat("Top pick stable", pct(rows.length ? stablePick / rows.length : null), `${stablePick} of ${rows.length} pairs return the same top pick every run`)}</div><div class="tblwrap" style="margin-top:12px"><table class="t"><thead><tr><th>Question</th>${[...S.engines].map(e => `<th class="num">${esc(engL[e])}</th>`).join("")}</tr></thead><tbody>${Object.entries(perQ).map(([qid, byE]) => `<tr><td>${esc((q[qid]?.text || qid).slice(0, 60))}</td>${[...S.engines].map(e => { const v = byE[e]; if (!v) return '<td class="num">—</td>'; const k = v.filter(x => x.named).length; return `<td class="num" title="top picks: ${v.map(x => x.pick || "none").join(", ")}">${k}/${v.length}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div><div class="note" style="margin-top:6px">Cells: runs (out of ${runs.length}) in which ${SL} was named. Hover for the top pick each run.</div>`, `A single pass is a coin toss on the unstable rows. That is why the console's default is three runs and the production proposal is seven — and why we report a range, not a point.`));
  } else cards.push(lensCard("vol", "Lens 10 · Answer volatility", "Ask the same question three times", "Three independent passes of eight questions on each engine, on the same day.", '<div class="withheld-card"><b>Withheld</b><p>Volatility passes are still being captured — this lens fills in when they land, and shows nothing until then.</p></div>', null));
  // 11 drift
  if (PREV && DTO) {
    const d = driftSummary(); const AT = activeAnswers(DTO); const stRows = D.stages.map(st => ({ st, prev: shareOf(stageAnswers(st.id, activeAnswers(PREV)))[s], cur: shareOf(stageAnswers(st.id, AT))[s] }));
    cards.push(lensCard("drift", "Lens 11 · Drift", `What moved since ${PREV.basis}`, `The same ${activeQueries().length} questions, the same engines, the same reader, the same path (the engines' APIs with web search, as the July launch report used) — captured ${PREV.basis} and ${DTO.basis}. Any difference is the engines changing their minds, not our method.`, `<div class="tblwrap"><table class="t"><thead><tr><th>Stage</th><th class="num">${esc(PREV.basis)}</th><th class="num">${esc(DTO.basis)}</th><th class="num">Change</th></tr></thead><tbody>${stRows.map(r => `<tr><td>${esc(r.st.label)}</td><td class="num">${pct(r.prev)}</td><td class="num">${pct(r.cur)}</td><td class="num" style="color:${r.cur - r.prev > 0 ? "var(--good)" : r.cur - r.prev < 0 ? "var(--crit)" : "inherit"}">${r.prev == null || r.cur == null ? "—" : (r.cur - r.prev >= 0 ? "+" : "") + ((r.cur - r.prev) * 100).toFixed(0) + " pts"}</td></tr>`).join("")}<tr class="subj"><td>Brand-neutral questions (${esc(compareLabel())})</td><td class="num">${pct(d.prevShare)}</td><td class="num">${pct(d.curShare)}</td><td class="num">${(d.curShare - d.prevShare >= 0 ? "+" : "") + ((d.curShare - d.prevShare) * 100).toFixed(0)} pts</td></tr></tbody></table></div><div class="note" style="margin-top:8px">${d.gained.length} questions gained a ${SL} mention on at least one engine, ${d.lost.length} lost one. <a href="#" onclick="openMovers();return false">See the movers →</a></div>`, `Drift is the measurement that turns a snapshot into a programme: it is what a monthly cadence reports, and what the targets below are set against.`));
  } else cards.push(lensCard("drift", "Lens 11 · Drift", "What moved since the last capture", "The same questions, engines and reader on two dates.", '<div class="withheld-card"><b>Withheld</b><p>The second capture is running today; this lens fills in when it lands.</p></div>', null));
  // 11b UI vs API — same day, same questions, two paths
  if (APIC && CUR.enginePaths) {
    const uiEng = Object.entries(CUR.enginePaths).filter(([e, x]) => x.path === "ui" && S.engines.has(e)).map(([e]) => e);
    if (uiEng.length) {
      const U = compareAnswers().filter(a => uiEng.includes(a.engine)); const P = compareAnswers(APIC).filter(a => uiEng.includes(a.engine));
      const rows = uiEng.map(e => { const u = U.filter(a => a.engine === e), p = P.filter(a => a.engine === e); const qs = uniq([...u, ...p].map(a => a.queryId)); let both = 0, uiOnly = 0, apiOnly = 0, neither = 0; for (const qid of qs) { const nu = u.some(a => a.queryId === qid && mention(a, sb)), np = p.some(a => a.queryId === qid && mention(a, sb)); if (nu && np) both++; else if (nu) uiOnly++; else if (np) apiOnly++; else neither++; } const tu = topPickShare(u), tp2 = topPickShare(p); return { e, uShare: shareOf(u)[s], pShare: shareOf(p)[s], uPres: presenceOf(u)[s], pPres: presenceOf(p)[s], uPick: tu.out[s], pPick: tp2.out[s], both, uiOnly, apiOnly, neither, n: qs.length }; });
      cards.push(lensCard("uiapi", "Lens 11b · Consumer app vs API", "Same question, two doors", `The measured read uses the consumer app; the live console and most dashboards use the model API with web search. Both captured ${CUR.basis.slice(0, 10)} on the same ${compareQueries().length} brand-neutral questions. How far apart are they for ${SL}?`, `<div class="tblwrap"><table class="t wrap"><thead><tr><th>Engine</th><th class="num">Share · app</th><th class="num">Share · API</th><th class="num">Named · app</th><th class="num">Named · API</th><th class="num">Top pick · app</th><th class="num">Top pick · API</th><th class="num">Agree on ${SL}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(engL[r.e])}</td><td class="num">${pct(r.uShare)}</td><td class="num">${pct(r.pShare)}</td><td class="num">${r.uPres.n}/${r.uPres.of}</td><td class="num">${r.pPres.n}/${r.pPres.of}</td><td class="num">${pct(r.uPick)}</td><td class="num">${pct(r.pPick)}</td><td class="num" title="both ${r.both} · app only ${r.uiOnly} · API only ${r.apiOnly} · neither ${r.neither}">${pct(r.n ? (r.both + r.neither) / r.n : null)}</td></tr>`).join("")}</tbody></table></div><div class="note" style="margin-top:8px">“Agree on ${SL}” = questions where both doors either name ${SL} or both don't. Hover for the split.</div>`, `${rows.map(r => `${engL[r.e]}: ${SL} ${pct(r.uShare)} in the app vs ${pct(r.pShare)} through the API`).join("; ")}. A vendor that reads only one door reports one of these numbers as if it were the other. We read both and say which is which.`));
    }
  }
  // 12 Google AI Overview + organic
  if (D.googleAI && D.engines.some(e => e.id === "google-aio")) {
    const g = D.googleAI; const rows = g.rows.filter(r => !r.failed && compareQueries().some(x => x.id === r.queryId)); const aio = rows.filter(r => r.aiOverview);
    const aioBrand = {}; for (const b of bs) aioBrand[b.id] = aio.filter(r => b.custom ? firstIdx(r.text, b) >= 0 : r.brands && r.brands[b.id] != null).length;
    const org = {}; for (const b of bs) org[b.id] = 0; let orgTot = 0; for (const r of rows) for (const o of r.organic || []) { if (o.brand && org[o.brand] != null) { org[o.brand]++; orgTot++; } }
    const orgShare = Object.fromEntries(bs.map(b => [b.id, orgTot ? org[b.id] / orgTot : null])); const aiShare = shareOf(compareAnswers());
    const gh = {}; for (const r of aio) for (const src of r.sources || []) { const h = (src.url || "").split("/")[2]?.replace(/^www\./, ""); if (h) gh[h] = (gh[h] || 0) + 1; }
    cards.push(lensCard("aio", "Lens 12 · Google AI Overview vs organic", "Where Google puts an AI answer, and who it names", `Google shows an AI Overview on ${aio.length} of ${rows.length} brand-neutral questions in scope. Below, brand presence inside those overviews, beside the classic organic top-10 share for the same questions.`, `<div class="grid2" style="gap:14px"><div><div class="eyebrow" style="margin-bottom:6px">named in the AI Overview (of ${aio.length})</div>${barRows(Object.fromEntries(bs.map(b => [b.id, aio.length ? aioBrand[b.id] / aio.length : null])), { onclick: "openAIO" })}</div><div><div class="eyebrow" style="margin-bottom:6px">share of Google organic top-10 (brand hits)</div>${barRows(orgShare)}</div></div><div class="note" style="margin-top:8px">Overview sources: ${byDesc(gh).slice(0, 5).map(([h, n]) => `${esc(h)} ${n}`).join(" · ") || "none captured"}.</div>`, `${SL} holds ${pct(orgShare[s])} of the organic top-10 but ${pct(aiShare[s])} of the AI answer on the three chat engines and appears in ${aioBrand[s]} of ${aio.length} AI Overviews — ${orgShare[s] != null && aiShare[s] != null && orgShare[s] > aiShare[s] ? "search strength is not carrying into AI answers" : "AI answers are at least keeping pace with search"}. The two are different systems with different sources, and the programme treats them as such.`));
  }
  // 13 crawler access
  if (D.crawlerAccess) {
    const cr = D.crawlerAccess; const bots = ["OAI-SearchBot", "ChatGPT-User", "GPTBot", "PerplexityBot", "Google-Extended", "Claude-SearchBot", "ClaudeBot", "Bingbot", "meta-externalagent", "Amazonbot"]; const KL = Object.assign({ retail: "Retail", editorial: "Editorial", community: "Community" }, Object.fromEntries(S.brands.map(b => [b.id, b.label])));
    cards.push(lensCard("crawl", "Lens 13 · Crawler access", "Can the engines even read the pages?", `robots.txt of ${cr.sites.length} sites that matter for ${CAT} answers, read ${cr.capturedAt.slice(0, 10)}, against the crawlers each engine uses. A blocked search crawler means that site cannot be cited by that engine at all.`, `<div class="tblwrap"><table class="t" style="font-size:12px"><thead><tr><th>Site</th><th>Kind</th>${bots.map(b => `<th style="font-size:9.5px;writing-mode:vertical-rl;transform:rotate(180deg);padding:6px 4px">${esc(b)}</th>`).join("")}<th>llms.txt</th></tr></thead><tbody>${cr.sites.map(x => `<tr class="${x.kind === subjectId() ? "subj" : ""}"><td>${esc(x.host.replace(/^www\./, ""))}</td><td class="note">${KL[x.kind] || x.kind.replace(/^\w/, ch => ch.toUpperCase())}</td>${bots.map(b => { const v = x.bots?.[b]; const st = v ? v.state : "unknown"; const col = st === "blocked" ? "var(--crit)" : st === "partial" ? "var(--warn)" : st === "open" ? "var(--good)" : "var(--line)"; return `<td style="text-align:center" title="${esc(b)}: ${st}${v?.rule ? " (" + v.rule + ")" : ""}"><span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:${col}"></span></td>`; }).join("")}<td>${x.llmsTxt ? "yes" : x.llmsTxt === false ? "no" : "—"}</td></tr>`).join("")}</tbody></table></div><div class="legend"><span><i style="background:var(--good);border-radius:99px"></i>open</span><span><i style="background:var(--warn);border-radius:99px"></i>partial</span><span><i style="background:var(--crit);border-radius:99px"></i>blocked</span></div>`, (() => { const amazon = cr.sites.find(x => x.host.includes("amazon")); const cnet = cr.sites.find(x => x.host.includes("cnet")); const sony = cr.sites.filter(x => x.kind === subjectId()); const sonyBlocks = sony.flatMap(x => Object.values(x.bots || {})).filter(v => v.state === "blocked").length; return `${sony.map(x => x.host.replace(/^www\./, "")).join(" and ")} ${sonyBlocks ? `carry ${sonyBlocks} blocking rules` : "block no AI crawler"} — access is not ${SL}'s problem. ${amazon && Object.values(amazon.bots || {}).filter(v => v.state === "blocked").length >= 8 ? "Amazon blocks every AI crawler, so Amazon PDP content never reaches ChatGPT or Perplexity; Best Buy's does." : ""} ${cnet && Object.values(cnet.bots || {}).some(v => v.state !== "open") ? `CNET restricts the search crawlers, so its reviews cannot carry ${SL} into those engines — which sites can matters as much as what they say.` : ""}`; })()));
  }
  for (const [id, html] of Object.entries(LENS)) { const h = $("lens-" + id); if (h) h.innerHTML = html; }
  renderClaimList();   // the claim list lives inside the placed Lens 09 card
  CATCOPY = D.catCopy || CATCOPY_BY[D.category] || CATCOPY_BY.tv;
  $("roadmap").innerHTML = [
    ["Prompt demand", `How many people actually ask each question — from opt-in panels or ${SL}'s own search-console AI impressions — so the bank is weighted by demand, not by our judgement.`],
    ["AI referral traffic", `Sessions arriving on ${OWN} from chatgpt.com, perplexity.ai and Gemini (GA4 referrer + utm), joined to the questions above.`],
    ["Bot crawl logs", `Which pages OAI-SearchBot, PerplexityBot and Claude-SearchBot actually fetch on ${OWN}, from the CDN logs — the difference between “allowed” and “read”.`],
    ["Shopping surfaces", `ChatGPT Shopping cards, Google's Shopping Graph and Amazon Rufus: whether the ${PL} the engine recommends is in stock, priced and rated where the engine points.`],
    ["Retail shelf join", "The Atlas retail lane already measures shelf share, price and stock on Amazon and Best Buy; joining it answers whether an AI recommendation can be fulfilled."],
    ["Markets & languages", "The same bank in the UK, Germany and Japan: engines answer differently by locale and native-language queries favour local sources."],
    ["Sub-brand roll-up", `${CATCOPY.subBrands} are strong entities on their own; whether they accrue to the ${SL} parent in the engines' framing is measurable and currently isn't.`],
    ["Persona cuts", `The same question as ${CATCOPY.personas} — engines change the pick with the persona, and ${SL}'s strength differs by each.`],
  ].map(([t, p]) => `<div class="card"><span class="kicker mute">connects to</span><h3>${t}</h3><p>${p}</p></div>`).join("");
}
// the claim list: filtered by the chips, conflicts first, every row opens the question's answers
function renderClaimList() {
  const host = $("claimList"); if (!host) return; const f = window.__clf; const rows = window.__claimRows || []; const q = qById(); const engL = Object.fromEntries(D.engines.map(e => [e.id, e.label]));
  const keep = rows.filter(r => (f.eng === "all" || r.engine === f.eng) && (f.show === "all" || (f.show === "conflict" ? !!r.conflict : f.show === "agreed" ? r.agreed >= 2 : f.show === "checkable" ? !!r.value : r.type === f.show)));
  const ord = (r) => (r.conflict ? 0 : 1) * 10 + (r.value ? 0 : 1);
  keep.sort((a, b) => ord(a) - ord(b) || (b.agreed - a.agreed) || a.i - b.i);
  const MAX = 400;
  host.innerHTML = `<div class="clhead"><span>${keep.length} claim${keep.length === 1 ? "" : "s"}${keep.length > MAX ? ` · first ${MAX} shown` : ""}</span><span class="note">conflicts first, then checkable values · tap a claim for who said what</span></div>` + (keep.slice(0, MAX).map(r => `<div class="cl ${r.conflict ? "conf" : ""}" onclick="openClaimRow(${r.i})"><span class="ctag t-${esc(r.type)}">${esc(r.type)}</span><div class="cb"><div class="ct">${esc(r.claim)}</div><div class="cm">${r.product ? `<b>${esc(r.product)}</b> · ` : ""}${esc(engL[r.engine] || r.engine)} · “${esc((q[r.qid]?.text || "").slice(0, 64))}${(q[r.qid]?.text || "").length > 64 ? "…" : ""}”</div></div><div class="cf">${r.conflict ? `<span class="cflag risk" title="${esc(r.conflict.length)} values for this model and fact across engines: ${esc(r.conflict.join(" · "))}">conflict · ${r.conflict.slice(0, 3).map(esc).join(" / ")}${r.conflict.length > 3 ? ` +${r.conflict.length - 3}` : ""}</span>` : ""}${r.agreed >= 2 ? `<span class="cflag good">agreed · ${r.agreed} engines</span>` : ""}${r.value ? `<span class="cflag val">${esc(r.value)}</span>` : `<span class="cflag mute">qualitative</span>`}</div></div>`).join("") || '<div class="note" style="padding:14px">No claims match these filters.</div>');
  document.querySelectorAll("#clShow .cchip").forEach(b => b.classList.toggle("on", b.dataset.k === f.show)); document.querySelectorAll("#clEng .cchip").forEach(b => b.classList.toggle("on", b.dataset.k === f.eng));
}
window.claimFilter = (kind, val) => { window.__clf[kind] = val; renderClaimList(); };
// ── claim drill-down: who claimed what, and where in the answer (Aashish, 2026-09-22) ──────
// A tapped claim opens to every claim on the same model and fact: one card per engine with the
// value(s) it asserted and the questions each came from, then the tapped question's answers
// with the engines that make the claim open first, the claim's value marked in their text.
const normClaimP = (p) => (p || "").toLowerCase().replace(/[^a-z0-9]/g, ""); const normClaimV = canonClaimValue;
// a value as the engine may have written it: "$1,998.00" also matches "$1,998", "1998" and "$1998.00"
function valueRegex(v) {
  const s = String(v || "").trim(); if (!s) return null;
  const m = /^\$?\s*([\d,]+)(?:\.(\d+))?\s*$/.exec(s);
  if (m) { const digits = m[1].replace(/,/g, ""); if (!digits) return null; return new RegExp(`(?<![\\d.])\\$?\\s?${digits.split("").join(",?")}(?:\\.\\d{1,2})?(?![\\d])`, "g"); }
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
}
// mark matches in the text of an HTML fragment only — never inside a tag or an href
const hlValues = (html, rxs) => html.split(/(<[^>]+>)/).map(seg => seg.startsWith("<") ? seg : rxs.reduce((t, rx) => t.replace(rx, (w) => `<mark class="clm">${w}</mark>`), seg)).join("");
window.openClaimRow = (i, qidOverride) => {
  // The tapped question in the same layout as every other proof drawer (Aashish, 2026-09-22: "the
  // original layout, just add the tag"): one accordion per engine, the value that engine asserted
  // for this model and fact tagged beside its name and marked in its text. Green = a value two or
  // more engines agree on, red = one engine alone; the engines that make the claim start open.
  const rows = window.__claimRows || []; const r = rows[i]; if (!r) return;
  const q = qById(); const engL = Object.fromEntries(D.engines.map(e => [e.id, e.label])); const qid = qidOverride || r.qid;
  const key = r.product && r.value ? `${normClaimP(r.product)}|${r.type}` : null;
  const related = key ? rows.filter(x => x.product && x.value && `${normClaimP(x.product)}|${x.type}` === key) : [r];
  const distinct = uniq(related.map(x => normClaimV(x.value))); const conflicting = distinct.length > 1;
  const valEngines = {}; for (const x of related) (valEngines[normClaimV(x.value)] ||= new Set()).add(x.engine);
  const flag = (v) => conflicting ? ((valEngines[normClaimV(v)] || new Set()).size >= 2 ? "good" : "risk") : "val";
  const ans = CUR.answers.filter(a => a.queryId === qid && S.engines.has(a.engine) && a.run === 1); const hl = brandsOn();
  const cards = ans.map(a => {
    const mine = related.filter(x => x.qid === a.queryId && x.engine === a.engine);
    const seen = new Set(); const tags = mine.filter(x => { const k = normClaimV(x.value) || x.claim; if (seen.has(k)) return false; seen.add(k); return true; }).map(x => `<span class="cflag ${flag(x.value)}" title="${esc(x.claim)}">${esc(x.value || x.claim)}</span>`).join("");
    const rxs = mine.map(x => valueRegex(x.value)).filter(Boolean);
    const ms = hl.map(b => ({ b, m: mention(a, b) })).filter(x => x.m).sort((x, y) => (x.m.rank || 9) - (y.m.rank || 9));
    const peek = esc(String(a.text || "").replace(/[#*_`>\[\]]+/g, " ").replace(/\(https?:[^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 240));
    return `<details class="eng" ${mine.length ? "open" : ""}><summary><div class="eh"><span class="en">${esc(engL[a.engine] || a.engine)}${tags ? `<span class="ctags">${tags}</span>` : ""}</span><span class="bchips">${ms.map(({ b, m }) => `<span class="bchip ${b.id === subjectId() ? "sub" : ""} ${m.sentiment || ""}"><i class="sw" style="width:8px;height:8px;border-radius:2px;background:${b.color}"></i>${esc(b.label)}<span class="r">#${m.rank || "?"}${m.recommended ? " · pick" : ""}${m.product ? " · " + esc(m.product) : ""}${m.textMatch ? " · text match" : ""}</span></span>`).join("") || '<span class="note">no tracked brand named</span>'}</span></div><div class="peek"><span class="pk">${peek || "(empty answer)"}</span><span class="seemore">See more ▾</span></div></summary>
      <div class="txt full">${hlValues(md(a.text, hl), rxs)}</div>
      ${a.sources?.length ? `<div class="cites" style="margin-top:8px">${a.sources.slice(0, 8).map(x => `<span><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.host || x.title)}</a><span class="kd">${esc(x.kind || "")}</span></span>`).join("")}</div>` : ""}${evidenceStrip(a)}</details>`;
  }).join("");
  openModal(`<h2>“${esc(q[qid]?.text || qid)}”</h2><p class="lede">${esc(stageLabel(q[qid]?.stage))} · ${esc(q[qid]?.focus || "")} question · ${ans.length} engine answer${ans.length === 1 ? "" : "s"} · tapped claim: <b>${esc(r.product || "")}${r.product ? " · " : ""}${esc(r.type)}</b>${conflicting ? ` — the engines give ${distinct.length} values (${distinct.map(esc).join(" · ")}); green is a value two or more engines agree on, red one engine alone` : ""}. Each engine's value is tagged beside its name and marked in its text.</p>${askRow(q[qid]?.text || "", true)}${cards}`);
};
window.openH2H = (mode) => { const vsQ = activeQueries().filter(x => x.focus === "vs"); const A = activeAnswers().filter(a => vsQ.some(x => x.id === a.queryId)); const s = subjectId();
  const keep = mode === "none" ? A.filter(a => !a.topPick) : mode === "committed" ? A.filter(a => a.topPick) : mode && mode !== "all" && S.brands.some(b => b.id === mode) ? A.filter(a => a.topPick === mode) : A;
  const qids = uniq(keep.map(a => a.queryId));
  proof({ title: mode === "none" ? "Head-to-head · answers with no verdict" : mode === "committed" ? "Head-to-head · answers that commit to one brand" : mode && mode !== "all" && S.brands.some(b => b.id === mode) ? `Head-to-head · answers that pick ${brandLabel(mode)}` : "Head-to-head questions · every answer", lede: `${qids.length} of the ${vsQ.length} questions that name ${SL} against a rival directly; ${keep.length} answers${mode === "none" ? " where the engine would not choose" : mode === "committed" ? ` where the engine commits — ${SL} in ${keep.filter(a => a.topPick === s).length}` : ""}.`, qids }); };
window.openAgree = (mode) => { const A = activeAnswers(); const byQ = {}; for (const a of A) (byQ[a.queryId] ||= []).push(a); const qids = Object.entries(byQ).filter(([, arr]) => arr.length >= 2).filter(([, arr]) => { const p = uniq(arr.map(a => a.topPick || "")); return mode === "sony" ? (p.length === 1 && p[0] === subjectId()) : (p.length === 1 && p[0]); }).map(([q]) => q); proof({ title: mode === "sony" ? `Questions where every engine picks ${SL}` : "Questions where the engines agree", lede: `${qids.length} questions.`, qids }); };
window.openHost = (h) => { const A = activeAnswers(); const qids = uniq(A.filter(a => (a.sources || []).some(x => x.host === h)).map(a => a.queryId)); proof({ title: `${h} · every answer that cites it`, lede: `${qids.length} questions where at least one engine cited ${h}. ${SL} highlighted where named.`, qids }); };
window.openClaims = (mode) => { const claims = window.__claims || []; const conf = window.__conflicts || []; const q = qById(); const engL = Object.fromEntries(D.engines.map(e => [e.id, e.label]));
  const confHtml = conf.map(c => `<div class="qblock"><div class="qt">${esc(c.product)} · ${esc(c.type)}</div><div class="qm">${c.values.length} different values across engines</div>${c.claims.map(x => `<div class="eng"><div class="eh"><span class="en">${esc(engL[x.engine] || x.engine)}</span><span class="note">${esc((q[x.queryId]?.text || "").slice(0, 70))}</span></div><div class="txt"><p>${esc(x.claim)} <b>→ ${esc(x.value)}</b></p></div></div>`).join("")}</div>`).join("");
  const allHtml = `<div class="tblwrap"><table class="t"><thead><tr><th>Type</th><th>Claim</th><th>Model</th><th>Engine</th></tr></thead><tbody>${claims.slice(0, 200).map(x => `<tr><td class="note">${esc(x.type)}</td><td>${esc(x.claim)}</td><td class="note">${esc(x.product || "")}</td><td class="note">${esc(engL[x.engine] || x.engine)}</td></tr>`).join("")}</tbody></table></div>`;
  openModal(`<h2>${mode === "conflicts" ? "Claims that conflict between engines" : `Every claim the engines make about ${SL}`}</h2><p class="lede">${mode === "conflicts" ? `${conf.length} model-and-fact pairs where engines give different values. For ${SL} to verify; the fix runs through the sources each engine cites.` : `${claims.length} statements extracted by the reader from the answers in scope — a verification list, not a verdict.`}</p>${mode === "conflicts" ? (confHtml || '<p class="note">No conflicts in the current scope.</p>') : allHtml}`); };
window.openOwn = (b) => { const own = (window.__own || {})[b]; if (!own) return; const qids = uniq([...own.qids]); proof({ title: `${brandLabel(b)}'s own pages · every answer that cites them`, lede: `${qids.length} questions where at least one engine cited a ${b}.com page (${own.n} citations across ${own.aids.size} answers).`, qids }); };
// ── attribute drill-down: the answers behind a cell, with the sentences that carry the judgement ──
// The reader model tagged each answer's attributes per brand with a polarity; it did not keep the
// sentence. So the modal lists every answer the reader tagged, shows its polarity, and highlights
// the sentences that name the brand and the attribute's words — found by keyword, and said so.
// short column heads for the heat maps; the full attribute name stays everywhere else
const ATTR_SHORT = { "picture quality": "Picture", brightness: "Brightness", "black levels / contrast": "Blacks", "colour accuracy": "Colour", "motion / sports": "Motion", "gaming features": "Gaming", sound: "Sound", "smart platform": "Platform", design: "Design", "price / value": "Price", reliability: "Reliability", "warranty / support": "Warranty", "availability / stock": "Stock", "processing / upscaling": "Processing",
  // phone attributes (the long ones collided as column heads on the 14-column heat)
  "battery life": "Battery", "software / updates": "Updates", "design / build": "Design" };
const attrHead = (a) => ATTR_SHORT[a] || a;
const ATTR_KW = {
  "picture quality": ["picture quality", "image quality", "picture", "pq"], brightness: ["bright", "nits", "brightness", "glare", "sunlit"], "black levels / contrast": ["black level", "blacks", "contrast"], "colour accuracy": ["colour", "color", "accura", "tone"],
  "motion / sports": ["motion", "sports", "judder", "120hz", "144hz", "refresh", "blur"], "gaming features": ["gaming", "gamer", "game", "hdmi 2.1", "vrr", "input lag", "ps5", "xbox", "allm"], sound: ["sound", "audio", "speaker", "acoustic", "bass", "atmos"],
  "smart platform": ["google tv", "tizen", "webos", "smart platform", "smart tv platform", "interface", "operating system", " os ", "apps", "ads"], design: ["design", "thin", "slim", "bezel", "stand", "looks", "aesthetic", "build"],
  "price / value": ["price", "value", "expensive", "cheap", "cost", "$", "afford", "budget", "pricey", "premium", "worth"], reliability: ["reliab", "durab", "longev", "long-term", "long term", "quality control", "fail", "issue", "lifespan"],
  "warranty / support": ["warranty", "support", "service", "customer"], "availability / stock": ["availab", "stock", "discontinued", "hard to find", "sold out"], "processing / upscaling": ["processing", "processor", "upscal", "cognitive", "xr ", "ai picture"],
};
function attrExcerpt(text, b, kws) {
  const plain = String(text || "").replace(/\[([^\]]+)\]\((https?:[^)]*)\)/g, "$1").replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();
  const sents = plain.split(/(?<=[.!?])\s+(?=[A-Z“"(])|\s+[-•]\s+/).map(x => x.trim()).filter(x => x.length > 12);
  const low = (x) => x.toLowerCase(); const hasB = (x) => aliasesOf(b).some(a => low(x).includes(a.trim().toLowerCase())); const hasK = (x) => kws.some(k => low(x).includes(k));
  let pick = sents.filter(x => hasB(x) && hasK(x)), mode = "both";
  if (!pick.length) { pick = sents.filter(hasK); mode = "kw"; }
  if (!pick.length) { pick = sents.filter(hasB); mode = "brand"; }
  pick = pick.slice(0, 4);
  if (!pick.length) return `<p class="note">No sentence matched by keyword — open the full answer.</p>`;
  const rx = (w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hl = (x) => { let t = esc(x); for (const k of kws) t = t.replace(new RegExp(`(${rx(k)}[a-z]*)`, "gi"), '<mark class="kw">$1</mark>'); for (const a of aliasesOf(b)) t = t.replace(new RegExp(`(^|[^A-Za-z>])(${rx(a)})(?=[^A-Za-z<]|$)`, "gi"), (m0, p, w) => `${p}<mark class="${b.id === subjectId() ? "hl" : "hlr"}">${w}</mark>`); return t; };
  return pick.map(x => `<p>${hl(x)}</p>`).join("") + (mode !== "both" ? `<p class="note">${mode === "kw" ? "these sentences mention the attribute; the brand is named elsewhere in the answer" : "these sentences name the brand; the attribute is phrased differently in this answer"}</p>` : "");
}
window.openAttr = (bId, j, eng) => {
  const at = D.attrs[j]; const b = S.brands.find(x => x.id === bId); if (!at || !b) return;
  const A = activeAnswers().filter(a => !eng || a.engine === eng); const q = qById(); const engL = Object.fromEntries(D.engines.map(e => [e.id, e.label]));
  const hits = []; for (const a of A) for (const x of (a.attributes?.[bId] || [])) if (x.attr === at) hits.push({ a, pol: x.polarity === "-" ? "neg" : "pos" });
  const pos = hits.filter(h => h.pol === "pos").length, neg = hits.length - pos; const kws = ATTR_KW[at] || [at.toLowerCase()];
  const byQ = {}; for (const h of hits) (byQ[h.a.queryId] ||= []).push(h);
  const order = Object.entries(byQ).sort((x, y) => (y[1].filter(h => h.pol === "neg").length - x[1].filter(h => h.pol === "neg").length) || (y[1].length - x[1].length));
  const blocks = order.map(([qid, hs]) => `<div class="qblock"><div class="qt">“${esc(q[qid]?.text || qid)}”</div><div class="qm">${esc(stageLabel(q[qid]?.stage))} · ${esc(q[qid]?.focus || "")} question · ${hs.length} engine${hs.length === 1 ? "" : "s"} read <b>${esc(at)}</b> for ${esc(b.label)}: ${hs.filter(h => h.pol === "pos").length} praised, ${hs.filter(h => h.pol === "neg").length} criticised</div>${askRow(q[qid]?.text || "", true)}${hs.map(h => `<details class="eng ${h.pol}"><summary><div class="eh"><span class="en">${esc(engL[h.a.engine] || h.a.engine)}</span><span class="polchip ${h.pol}">${h.pol === "neg" ? "criticised" : "praised"}</span></div><div class="excerpt">${attrExcerpt(h.a.text, b, kws)}</div><div class="peek"><span class="seemore">Full answer ▾</span></div></summary><div class="txt full">${md(h.a.text, brandsOn())}</div>${evidenceStrip(h.a)}</details>`).join("")}</div>`).join("");
  openModal(`<h2>${esc(b.label)} · ${esc(at)}${eng ? ` · ${esc(engL[eng] || eng)}` : ""}</h2><p class="lede">${hits.length} engine answers in scope tag ${esc(b.label)} on <b>${esc(at)}</b>: <b style="color:var(--good)">${pos} praised</b>, <b style="color:var(--risk)">${neg} criticised</b>, net ${pos - neg > 0 ? "+" : ""}${pos - neg}. Questions with criticism first. The praised/criticised reading is the reader model's; the highlighted sentences are the ones in each answer that mention ${esc(b.label)} and the attribute, found by keyword.</p>${blocks || '<p class="note">No answer in scope tags this attribute for this brand.</p>'}`);
};
window.openAIO = (b) => { const g = D.googleAI; const q = qById(); const rows = g.rows.filter(r => !r.failed && r.aiOverview && activeQueries().some(x => x.id === r.queryId)); openModal(`<h2>Google AI Overview · ${rows.length} questions</h2><p class="lede">The overview text as captured from google.com (${g.capturedAt.slice(0, 10)}), with tracked brands highlighted and the sources Google showed.</p>${rows.map(r => `<div class="qblock"><div class="qt">“${esc(q[r.queryId]?.text || r.queryId)}”</div><div class="eng"><div class="txt full">${md(r.text, brandsOn())}</div>${r.sources?.length ? `<div class="cites" style="margin-top:8px">${r.sources.slice(0, 8).map(s => `<span><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc((s.url || "").split("/")[2] || s.title)}</a></span>`).join("")}</div>` : ""}</div></div>`).join("")}`); };
function driftSummary() { const s = subjectId(); const sb = S.brands.find(b => b.id === s); const A = activeAnswers(DTO), P = activeAnswers(PREV), AC = compareAnswers(DTO), PC = compareAnswers(PREV); const namedIn = (arr) => { const m = {}; for (const a of arr) { m[a.queryId] ||= 0; if (mention(a, sb)) m[a.queryId]++; } return m; }; const nc = namedIn(A), np = namedIn(P); const qids = uniq([...Object.keys(nc), ...Object.keys(np)]); return { prevShare: shareOf(PC)[s], curShare: shareOf(AC)[s], prevPres: presenceOf(PC)[s], curPres: presenceOf(AC)[s], gained: qids.filter(q => (nc[q] || 0) > 0 && !(np[q] > 0)), lost: qids.filter(q => (np[q] || 0) > 0 && !(nc[q] > 0)) }; }
window.openMovers = () => { const d = driftSummary(); const q = qById(); openModal(`<h2>Movers since ${PREV.basis} (API path, like for like)</h2><p class="lede">Questions where ${SL}'s presence changed on at least one engine between the two captures.</p><h3 style="font-size:18px;margin:10px 0 6px">Gained a ${SL} mention (${d.gained.length})</h3><ul>${d.gained.map(x => `<li>${esc(q[x]?.text || x)}</li>`).join("") || "<li>none</li>"}</ul><h3 style="font-size:18px;margin:14px 0 6px">Lost a ${SL} mention (${d.lost.length})</h3><ul>${d.lost.map(x => `<li>${esc(q[x]?.text || x)}</li>`).join("") || "<li>none</li>"}</ul>`); };
function renderProgramme() {
  const A = activeAnswers(); const s = subjectId(); const sb = S.brands.find(b => b.id === s); const bs = brandsOn();
  const cites = A.flatMap(a => (a.sources || []).map(x => ({ ...x, named: !!mention(a, sb) }))); const hosts = {}; for (const c of cites) { hosts[c.host] ||= { n: 0, named: 0 }; hosts[c.host].n++; if (c.named) hosts[c.host].named++; }
  const top = Object.entries(hosts).sort((a, b) => b[1].n - a[1].n); const gap = top.filter(([, v]) => v.n >= 4).map(([h, v]) => ({ h, gap: v.n - v.named, rate: v.named / v.n })).sort((a, b) => b.gap - a.gap).slice(0, 4);
  const comm = cites.filter(c => c.kind === "community"); const commNamed = comm.filter(c => c.named).length;
  const claims = A.flatMap(a => a.subjectClaims || []); const conflicts = claimConflicts(A);
  const stagesShare = D.stages.map(st => ({ st, v: shareOf(stageAnswers(st.id, A))[s], p: presenceOf(stageAnswers(st.id, A))[s] }));
  const aw = stagesShare[0], dec = stagesShare[stagesShare.length - 1];
  const tp = topPickShare(compareAnswers()); const vsA = A.filter(a => activeQueries().some(x => x.id === a.queryId && x.focus === "vs")); const vsWin = vsA.filter(a => a.topPick === s).length;
  const prods = {}; for (const a of A) { const m = mention(a, sb); if (m && m.product) prods[m.product] = (prods[m.product] || 0) + 1; } const named = byDesc(prods).map(([p]) => p.toLowerCase());
  const unnamed = D.catalog?.products?.length ? catalogCoverage(A, sb, D.catalog.products).filter(r => !r.n).map(r => r.p.label) : [];
  const attrs = D.attrs; const net = (b, at) => { let n = 0; for (const a of A) for (const x of (a.attributes?.[b] || [])) if (x.attr === at) n += x.polarity === "-" ? -1 : 1; return n; };
  const attrGaps = attrs.map(at => ({ at, sony: net(s, at), best: Math.max(...bs.filter(b => b.id !== s).map(b => net(b.id, at))) })).filter(x => x.best > x.sony).sort((a, b) => (b.best - b.sony) - (a.best - a.sony)).slice(0, 3);
  const neg = attrs.map(at => ({ at, n: A.reduce((k, a) => k + (a.attributes?.[s] || []).filter(x => x.attr === at && x.polarity === "-").length, 0) })).sort((a, b) => b.n - a.n)[0];
  const cr = D.crawlerAccess; const sonySites = cr ? cr.sites.filter(x => x.kind === subjectId()) : []; const rivalsLlms = cr ? cr.sites.filter(x => x.llmsTxt && x.kind !== subjectId() && !["retail", "editorial", "community"].includes(x.kind)).map(x => x.host.replace(/^www\./, "")) : [];
  const g = D.engines.some(e => e.id === "google-aio") ? D.googleAI : null; const gRows = g ? g.rows.filter(r => !r.failed) : []; const aio = gRows.filter(r => r.aiOverview); const aioSony = aio.filter(r => r.brands?.[s] != null).length;
  const pp = {}; for (const r of gRows) for (const p of r.popularProducts || []) if (p.brand) pp[p.brand] = (pp[p.brand] || 0) + 1; const ppTot = sum(Object.values(pp));
  $("phases").innerHTML = [["Days 0–30", "Diagnose & unblock", "Baseline on seven runs per question. Verify every claim the engines make. Fix access, feeds and entity hygiene — the things that stop a right answer from being retrievable."], ["Days 30–60", "Earn the sources", `Place ${PL} in the reviews, lists, videos and threads the engines actually cite, starting with the gap list. Correct wrong facts at the source.`], ["Days 60–90", "Own the comparison", "Publish the pages that answer the head-to-head and use-case questions directly: comparison tables, spec sheets, answer-first structure, kept fresh."], ["Ongoing", "Measure & defend", "Monthly read on the full bank, weekly on the decision questions, drift and volatility reported with ranges. Targets reviewed each quarter."]].map(([d, t, p]) => `<div class="phase"><div class="ph">${d}</div><h3>${t}</h3><p>${p}</p></div>`).join("");
  const acts = [
    { ph: "0–30", t: "Verify what the engines say, then correct it at the source", why: "Engines paraphrase the review layer. A wrong price or spec in three answers usually traces to one stale page. No engine runs a correction desk, so the route is: fix the cited page, then re-run.", trig: `The capture holds <b>${claims.length} claims about ${SL}</b> (${Object.entries(claims.reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ")}) and <b>${conflicts.length} that conflict</b> between engines on the same model and fact. ${SL}'s product team signs off a truth-set; we chase each wrong claim to its source.`, owner: `${SL} product marketing + BrandContext`, effort: "2 weeks", kpi: "Lens 09 → 0 conflicting claims; wrong claims corrected within 30 days", ev: `Working practice from the corrections literature: <a href="https://ziptie.ai/blog/how-to-fix-incorrect-ai-brand-information/" target="_blank" rel="noopener">no official correction portal exists</a>; fixing the cited pages is the route. Feedback channels: Google AI Overview “report a problem”, OpenAI's inaccuracy request, Bing Webmaster Tools.` },
    { ph: "0–30", t: "Access, feeds and entity hygiene", why: "A site that blocks OAI-SearchBot is not shown in ChatGPT search; crawlers don't run JavaScript; product feeds are the source of truth for price and stock in shopping answers. Cheap, and it removes the ceiling on everything else.", trig: `${sonySites.map(x => x.host.replace(/^www\./, "")).join(" and ")} ${cr ? `block no AI crawler in robots.txt, but electronics.${OWN} answers non-browser clients with a 403 — the bot manager needs checking against OAI-SearchBot, PerplexityBot and Claude-SearchBot from the CDN logs` : "— crawler audit pending"}. ${rivalsLlms.length ? `${rivalsLlms.join(", ")} publish an llms.txt; ${SL} doesn't (low value, see below, but it's a hygiene marker buyers ask about).` : ""} Google's Shopping Graph and ChatGPT Shopping read merchant feeds, so ${PL} price and stock must be right in Merchant Center and the retailer feeds first.`, owner: `${SL} web platform + retail ops`, effort: "2–3 weeks", kpi: "Lens 13 all green; crawl-log proof of search-bot fetches on product pages", ev: `<a href="https://developers.openai.com/api/docs/bots" target="_blank" rel="noopener">OpenAI crawler docs</a> · <a href="https://vercel.com/blog/the-rise-of-the-ai-crawler" target="_blank" rel="noopener">Vercel: AI crawlers don't render JS</a> · <a href="https://developers.google.com/search/docs/appearance/ai-features" target="_blank" rel="noopener">Google: no special files needed, keep Merchant Center current</a>` },
    { ph: "30–60", t: "Earn placement in the sources that write the answer", why: `Third-party listicles produced 86% of source mentions in two field experiments; brand mentions on the web correlate with AI visibility far more than links do. The engines cite a short list of sites for ${CAT} questions — the work is being present, current and well-framed on that list.`, trig: `The most-cited sources in scope: ${top.slice(0, 4).map(([h, v]) => `<b>${esc(h)}</b> (${v.n}, ${SL} named ${pct(v.named / v.n)})`).join(", ")}. The gap list — cited most where ${SL} is absent — starts with ${gap.map(x => `<b>${esc(x.h)}</b> (${x.gap})`).join(", ")}. Each is a named editor, a specific “best ${CAT}” list or a review to secure a ${PL} in.`, owner: `${SL} PR / reviews programme + BrandContext outreach`, effort: "6 weeks, then continuous", kpi: `Lens 05 “${SL} named” on the top-5 sources up; Lens 06 gap list shrinking`, ev: `<a href="https://searchengineland.com/geo-experiments-challenge-conventional-ai-visibility-advice-488342" target="_blank" rel="noopener">SEL field experiments: listicles 85.8% of mentions</a> · <a href="https://ahrefs.com/blog/ai-brand-visibility-correlations" target="_blank" rel="noopener">Ahrefs, 75,000 brands: web/YouTube mentions correlate 0.66–0.74</a>` },
    { ph: "30–60", t: "Video and community layer", why: "YouTube and Reddit are the two largest citation sources for product questions on Google's AI surfaces and Perplexity; engines read transcripts, descriptions and chapter titles. Reddit reaches the engines through licensing, not through robots.txt.", trig: `Community sources are ${pct(cites.length ? comm.length / cites.length : null)} of citations in scope and ${SL} is named in ${pct(comm.length ? commNamed / comm.length : null)} of the answers that cite them. Priority: transcripts and chapter titles on ${PL} review and comparison videos; presence in the r/4kTV-style threads the engines quote.`, owner: `${SL} social + creator programme`, effort: "4 weeks to first placements", kpi: `Lens 04 community share with ${SL} named rising`, ev: `<a href="https://obsurfable.com/resources/reports/top-domains-cited-by-llms-august-2026" target="_blank" rel="noopener">Obsurfable, Aug 2026: YouTube/Reddit top cited domains</a> · <a href="https://www.trygeometrics.com/blog/youtube-geo-optimize-videos-for-ai" target="_blank" rel="noopener">engines read transcripts, not video</a>` },
    { ph: "60–90", t: "Own the comparison and the use case", why: "Comparison tables draw about 2.5× the citations of prose and 44% of cited content answers in the first paragraph. The head-to-head and use-case questions are where a shopper is closest to buying and where a single well-structured page can be the source.", trig: `${SL} wins <b>${vsWin} of ${vsA.length}</b> head-to-head answers and is the top pick in ${pct(tp.out[s])} of committed answers. Rivals lead the engines' framing on ${attrGaps.map(x => `<b>${esc(x.at)}</b>`).join(", ") || "no attribute in scope"}${neg && neg.n ? `; the most frequent criticism of ${SL} is <b>${esc(neg.at)}</b> (${neg.n})` : ""}. ${unnamed.length ? `Models in the catalogue the engines never name: ${unnamed.slice(0, 4).map(esc).join(", ")}.` : ""}`, owner: `${SL} content + BrandContext`, effort: "8 weeks", kpi: "Lens 02 win rate and Lens 01 top-pick share up; Lens 07 every current model named", ev: `<a href="https://whitehat-seo.co.uk/blog/ai-content-strategy-chatgpt-citations" target="_blank" rel="noopener">Growth Memo / SEL, 3M responses: tables 2.5×, answer-first 44%</a> · <a href="https://www.aleydasolis.com/en/ai-search/ai-search-optimization-checklist/" target="_blank" rel="noopener">Aleyda Solis: decision-support content</a>` },
    { ph: "60–90", t: "Show up before the shopper knows what to buy", why: `Awareness questions (“best ${CAT} in 2026”) are answered from category guides the engines already trust. Presence there is earned in the source layer, not on ${OWN}.`, trig: `${SL}'s share is <b>${pct(aw.v)}</b> at ${aw.st.label.toLowerCase()} (named in ${aw.p.n}/${aw.p.of}) against <b>${pct(dec.v)}</b> at ${dec.st.label.toLowerCase()} (named in ${dec.p.n}/${dec.p.of}). ${g ? `Google's AI Overview appears on ${aio.length} of ${gRows.length} questions and names ${SL} in ${aioSony}; ${ppTot ? ` Google's “popular products” carousel gives ${SL} ${pct((pp[s] || 0) / ppTot)} of its slots.` : ""}` : ""}`, owner: `${SL} PR + BrandContext`, effort: "continuous", kpi: "Console funnel: awareness share and presence up quarter on quarter", ev: `<a href="https://substack.com/@kevinindig/note/c-231952797" target="_blank" rel="noopener">Kevin Indig, 1.2M responses: repeat winners are broad category guides</a>` },
    { ph: "Ongoing", t: "Measure like it's a market, not a screenshot", why: "Identical prompts return different sources day to day; a stable brand estimate needs about seven runs per prompt. We report ranges and drift, weight the bank by real prompt demand, and re-run in front of you.", trig: `This page's read is ${D.volatility ? `${D.volatility.runs.length} passes on the volatility set and one pass on the full bank` : "one pass on the full bank"} across ${uniq(A.map(a => a.queryId)).length} questions; production is 7 passes, daily on the decision questions, monthly on the whole bank, with ${SL}'s GA4 and search-console AI impressions joined in.`, owner: "BrandContext", effort: "standing", kpi: "Lens 10 ranges reported; Lens 11 monthly drift", ev: `<a href="https://arxiv.org/abs/2604.07585" target="_blank" rel="noopener">arXiv 2604.07585: ≥7 runs per prompt per day</a> · <a href="https://www.semrush.com/blog/the-ghost-citations-study/" target="_blank" rel="noopener">Semrush: 62% of citations carry no brand mention</a>` },
  ];
  $("actions").innerHTML = acts.map(a => `<div class="act"><span class="kicker ${a.ph === "Ongoing" ? "good" : ""}">Days ${a.ph}</span><h3>${a.t}</h3><div class="why">${a.why}</div><div class="trig"><span class="lab">${SL} now</span>${a.trig}</div><div class="meta"><span>Owner <b>${a.owner}</b></span><span>Effort <b>${a.effort}</b></span><span>Judged on <b>${a.kpi}</b></span></div><div class="ev">Evidence: ${a.ev}</div></div>`).join("");
  $("dont").innerHTML = [["Schema markup as a visibility lever", "Adding structured data to 1,885 pages moved AI citations by −4.6% (AI Overviews), +2.4% (AI Mode) and +2.2% (ChatGPT) — statistically nothing. Schema stays for shopping feeds and rich results, not as a GEO promise.", "https://ahrefs.com/blog/schema-ai-citations"], ["llms.txt as a fix", "Google says Search doesn't use it; 97% of 38,000 llms.txt files received zero requests in a month. We publish one because buyers ask, and we say what it is.", "https://ahrefs.com/blog/llmstxt-study/"], ["“Add statistics and quotes” GEO tactics", "The 2024 GEO paper's +30–40% came from a simulated engine; on real engines the NeurIPS 2025 benchmark found most such tactics ineffective or negative, and the gains are zero-sum as adopters increase.", "https://arxiv.org/abs/2506.11097"], ["Keyword stuffing and AI-written bulk content", "Scored about 10% worse in the same benchmark, and the 5-times-per-day citation churn means thin pages fall out within weeks.", "https://arxiv.org/html/2311.09735v3"], ["A single daily screenshot as measurement", "Identical prompts share only 34–42% of their sources day to day. A point estimate from one run is not a number a programme can be judged on.", "https://arxiv.org/abs/2604.07585"], ["Backlinks as the lever", "Across 75,000 brands, backlinks were the weakest correlate of AI visibility; mentions on the web and on YouTube were the strongest.", "https://ahrefs.com/blog/ai-brand-visibility-correlations"]].map(([t, p, u]) => `<div class="card"><h3>${t}</h3><p>${p}</p><p class="note" style="margin-top:8px"><a href="${u}" target="_blank" rel="noopener">source</a></p></div>`).join("");
  const rows = [["Share of AI answer (brand-neutral questions)", pct(shareOf(compareAnswers())[s]), "sources · comparison content"], ["Presence at awareness", pct(aw.p.rate), "category guides · earned placement"], ["Top-pick share", pct(tp.out[s]), "comparison pages · reviews"], ["Head-to-head win rate", pct(vsA.length ? vsWin / vsA.length : null), "comparison pages"], [`${SL} named on the top-5 sources`, pct((() => { const t5 = top.slice(0, 5); const n = sum(t5.map(([, v]) => v.n)); return n ? sum(t5.map(([, v]) => v.named)) / n : null; })()), "outreach · reviews programme"], ["Conflicting claims", String(conflicts.length), "truth-set · source corrections"]];
  $("targets").innerHTML = `<table class="t targets"><thead><tr><th>Metric</th><th class="num">Measured now</th><th class="num">Target · 90 days</th><th>Lever</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num"><input placeholder="set" aria-label="target for ${esc(r[0])}"></td><td class="note">${r[2]}</td></tr>`).join("")}</tbody></table>`;
}
const VENDORS = [
  ["Profound", "9 engines incl. ChatGPT, Perplexity, Gemini, AI Overviews/AI Mode, Copilot, Claude, Grok, DeepSeek", "Daily browser capture", "Visibility Score, Share of Voice, Citation Authority, Prompt Volumes from opt-in panels, Shopping (ChatGPT) visibility & attribute accuracy, Agent Analytics (bot logs)", "Content briefs, FactCheck agent, Strategic Actions, Context Manager", "Starter $99/mo · Growth $399/mo · Enterprise custom (est. $2–5K+/mo)", "Walmart, Target, Comcast; $1.8B valuation Sep 2026"],
  ["Peec AI", "ChatGPT, AI Overviews, AI Mode, Perplexity, Gemini, Copilot; add-ons Claude, Grok, DeepSeek, Amazon Rufus", "UI scraping", "Visibility %, Position, Sentiment, SoV, Citations, Prompt Volume (beta), AI Shopping win rate & pricing accuracy", "Actions by source type, gap analysis, crawlability vs 40+ bots", "$95 / $245 / $495 per month by prompts", "Zalando, Hugo Boss, TUI"],
  ["Evertune", "11+ incl. ChatGPT, Gemini, AI Mode, AIO, Meta AI, Claude, Copilot, Perplexity, DeepSeek", "API + consumer app; every prompt sampled 100× per model", "AI Brand Index, AI Brand Score, Share of Answer, Word Association, EverPanel prompt demand, Shopping Intelligence with retail-partner attribution", "GEO prompt testing, content activation, bot analytics", "Reported ~$800/mo Pro (unverified)", "Roku, Canada Goose, WPP"],
  ["Bluefish AI", "ChatGPT, Google AI, Claude, Perplexity, Amazon Rufus", "Undisclosed, “millions of prompts daily”", "AI Visibility, Favorability, Safety; AI Accuracy — every claim verified against a Brand Vault; campaign-level Collections", "Agentic Campaigns generating tactics per engine", "Quote only; third parties estimate $150–500K/yr", "Adidas, American Express, Ulta, LVMH"],
  ["Brandlight", "13 claimed incl. ChatGPT, Gemini, Perplexity, Copilot, Grok, Claude, AIO/AI Mode", "Undisclosed", "Brandlight Score, Visibility (direct / unaided / competitive), query intent, crawl frequency, publisher partnership ROI", "Content, Partnerships, Technical Health, Agentic Commerce modules", "Enterprise", "LG, Volkswagen Group, Kimberly-Clark, Estée Lauder"],
  ["Scrunch AI (Sitecore)", "ChatGPT, Claude, Gemini, Perplexity, AIO/AI Mode, Meta", "Browser automation + APIs", "Presence with position band, SoV, sentiment, citations, persona and geography cuts, content diagnostics for claims/pricing/specs", "Agent Experience Platform serving machine-readable page versions", "$250–500/mo self-serve; Enterprise", "Lenovo, Skims, Crunchbase"],
  ["Athena HQ", "11 incl. ChatGPT, Perplexity, AIO, AI Mode, Gemini, Claude, Copilot, Grok, DeepSeek, Meta AI, Mistral", "Undisclosed", "GEO Score, SoV, citation rate, recommendation frequency, sentiment, Oracle hallucination detection (Enterprise)", "On/off-page actions, robots/llms.txt management, citation engine", "Free · $295/mo · Enterprise", "SoFi, Coinbase, Hearst"],
  ["Otterly.ai", "ChatGPT, AIO, Perplexity, Copilot; AI Mode, Gemini, Claude add-ons", "Browser capture", "Brand Coverage, Brand Visibility Index, Citations, Position, Sentiment, ads detection", "GEO audit: crawlability, content checker, query fan-out", "$29 / $189 / $489 per month", "40,000+ users; Gartner Cool Vendor"],
  ["Goodie", "13 incl. ChatGPT, Claude, Perplexity, Gemini, Copilot, Grok, Meta AI, AIO, AI Mode, Alexa Shopping, Walmart Sparky", "Undisclosed", "Mentions, citations, sentiment, competitive share, prompt research, agent analytics", "Optimization actions, content studio, attribution", "$399 / $999 per month; Enterprise", "SteelSeries, Dermalogica, Lancôme"],
  ["Semrush → Adobe Brand Visibility", "ChatGPT, Gemini, Perplexity, AIO, AI Mode", "UI capture; 317M-prompt database", "AI Visibility Score, mentions, citations, SoV, sentiment, topic opportunities; Adobe adds agentic-traffic detection and edge optimisation", "AI site audit for 8 crawlers; one-click AEM deployment", "$99/mo per domain; Adobe quote-only", "Gartner Market Guide vendor"],
  ["Ahrefs Brand Radar", "ChatGPT, Perplexity, Gemini, Copilot, AIO, AI Mode, Grok", "Public web interfaces, monthly re-test", "Mentions, Citations, AI Share of Voice, Estimated Impressions weighted by Google volume", "Custom prompt tracking, pay per check", "From €47/mo", "Octopus Energy"],
  ["Similarweb AI Search", "ChatGPT, Perplexity, Gemini, AI Mode (+ traffic for Copilot, Claude, DeepSeek, Grok)", "Clickstream panel", "Brand visibility, actual AI referral traffic, prompt and citation analysis, sentiment", "—", "$99/mo for 150 prompts", "—"],
  ["Conductor", "ChatGPT, Perplexity, AIO, Copilot", "API-first", "Mentions, citations, SoV, sentiment by persona and intent stage, AI crawler activity from logs, AI referral → conversion", "Creator + agents, MCP/data API", "Usage-based credits", "Sonos (single-person SEO team)"],
  ["BrightEdge AI Catalyst", "AIO, ChatGPT, Perplexity, Gemini, Claude", "Generative Parser; Copilot prompt research", "Persona/intent/decision-stage mapping, sentiment & attribute analysis", "Included in BrightEdge subscriptions", "Enterprise", "“57% of Fortune 100”"],
];
const VENDOR_SOURCES = ["https://www.tryprofound.com/features/answer-engine-insights", "https://www.tryprofound.com/features/prompt-volumes", "https://www.tryprofound.com/features/shopping", "https://techcrunch.com/2026/09/15/aeo-startup-profound-hits-unicorn-valuation-raises-180m-series-d-7-months-after-last-round/", "https://peec.ai/ai-instructions", "https://www.evertune.ai/platform/methodology", "https://www.evertune.ai/resources/faq", "https://www.prnewswire.com/news-releases/bluefish-launches-ai-accuracy-bringing-brand-verification-to-ai-channels-for-the-first-time-302762378.html", "https://brandlight.ai/", "https://scrunch.com/pricing", "https://www.athenahq.ai/pricing", "https://visible.seranking.com/blog/otterly-ai-review/", "https://higoodie.com/pricing/", "https://www.semrush.com/kb/1607-semrush-ai-visibility-data", "https://news.adobe.com/news/2026/06/introducing-adobe-brand-visibility", "https://ahrefs.com/blog/brand-radar-methodology/", "https://aisearch.similarweb.com/", "https://www.conductor.com/customer-stories/sonos/", "https://www.conductor.com/academy/consumer-discretionary-aeo-geo-benchmarks/", "https://www.brightedge.com/ai-catalyst", "https://www.semrush.com/news/463886-semrush-an-adobe-company-named-in-gartner-market-guide-for-answer-engine-visibility-tools/"];
// the few sentences whose nouns are the category's, not the brand's
const CATCOPY_BY = {
  tv: { claimKinds: "price, panel, port and brightness", journey: "size and room, then technology, then brand, then model, then where to buy", subBrands: "PlayStation, WH-1000XM and BRAVIA", personas: "a console gamer, a home-cinema buyer or a bright-room family", rivalsExample: "Hisense, Vizio, anyone", truthSet: "prices, panel types, HDMI 2.1 counts, peak brightness" },
  phone: { claimKinds: "price, chip, camera, battery and update-window", journey: "platform and budget, then camera and battery, then brand, then model, then carrier or retailer", subBrands: "Galaxy S, Z Fold and Z Flip", personas: "a camera-first buyer, a mobile gamer or an iPhone switcher", rivalsExample: "Nothing, Xiaomi, anyone", truthSet: "prices, chipsets, camera specs, battery capacities, update windows" },
};
const catCopy = () => D.catCopy || CATCOPY_BY[D.category] || CATCOPY_BY.tv;
let CATCOPY = CATCOPY_BY.tv;
function renderLandscape() {
  CATCOPY = D.catCopy || CATCOPY_BY[D.category] || CATCOPY_BY.tv;
  $("vendors").innerHTML = `<table class="t vend"><thead><tr><th>Vendor</th><th>Engines</th><th>Capture</th><th>Distinctive metrics</th><th>Execution</th><th>Pricing</th><th>Named customers</th></tr></thead><tbody>${VENDORS.map(v => `<tr>${v.map((c, i) => `<td>${i === 0 ? esc(c) : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="note" style="margin-top:10px">Compiled 18 Sep 2026 from the vendors' own pages and press; pricing as published or, where marked, third-party estimates. Gartner formalised the category in March 2026 (Market Guide for Answer Engine Visibility Tools) and sizes it at $481M (2024) → $729M (2031). Consolidation this year: Adobe acquired Semrush, Sitecore acquired Scrunch, HubSpot acquired XFunnel.</p>`;
  $("vendorSources").innerHTML = VENDOR_SOURCES.map(u => `<li><a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, "")}</a></li>`).join("");
  $("diff").innerHTML = [["Retail shelf ↔ AI answer", `Shopping modules stop at which retailer owns the checkout inside ChatGPT. Nobody joins the AI recommendation to whether that ${PL} is in stock, priced and rated at Best Buy and Amazon — the Atlas retail lane already measures that, so the join is a report, not a build.`], ["Model-level claim accuracy", `Bluefish and Athena verify brand claims; none is built around a SKU spec sheet. Lens 09 reads every ${CATCOPY.claimKinds} claim per model and flags the conflicts.`], ["The buying funnel, as a shopper walks it", `Vendors tag by persona or intent; none frames the ${CAT} journey — ${CATCOPY.journey} — with stage-specific share. The console does.`], ["Sampled, with a range", "Only one vendor reports sampling error; every other “visibility %” is one run per prompt per day. We run the same question several times and report the spread."], ["Live, in the room", "Every product on the list is yesterday's batch in a dashboard. This one runs the buyer's own question on the engines while they watch, with the full answer and the reader's extraction beside it."], ["Parent and sub-brand", `${CATCOPY.subBrands} are strong entities; whether they accrue to the ${SL} parent in the engines' framing is a measurement no vendor exposes and one this bank can add.`]].map(([t, p]) => `<div class="card"><span class="kicker good">white space</span><h3>${t}</h3><p>${p}</p></div>`).join("");
}
function renderMethod() {
  const caps = Object.values(D.captures).sort((a, b) => a.basis.localeCompare(b.basis));
  $("methodBody").innerHTML = `
    <h3>Captures</h3><ul>${caps.map(c => `<li><b>${esc(c.basis)}</b> — ${c.n} engine answers to ${D.bank.length} questions on ${c.engines.map(e => e.label).join(", ")}; ${esc(c.engineSource || "")}. Read by <code>${esc(c.extractor || "the launch-report extractor")}</code>.</li>`).join("")}
      ${D.volatility ? `<li><b>Volatility</b> — ${D.volatility.runs.length} independent passes of ${uniq(D.volatility.runs[0].answers.map(a => a.queryId)).length} questions on each engine (${D.volatility.runs.map(r => (r.capturedAt || "").slice(0, 10)).join(", ")}).</li>` : ""}
      ${D.googleAI && D.engines.some(e => e.id === "google-aio") ? `<li><b>Google</b> — ${D.googleAI.n} google.com result pages captured ${D.googleAI.capturedAt.slice(0, 10)} (${esc(D.googleAI.source)}): AI Overview presence and text, organic top-10, “popular products”, people-also-ask.</li>` : ""}
      ${D.crawlerAccess ? `<li><b>Crawler access</b> — robots.txt and llms.txt of ${D.crawlerAccess.sites.length} sites read ${D.crawlerAccess.capturedAt.slice(0, 10)}, parsed for ${D.crawlerAccess.bots.length} crawler user-agents.</li>` : ""}</ul>
    <h3>Engines: measured vs live</h3><ul>${CUR.enginePaths ? `<li><b>Engine paths in the current read</b> — ${Object.entries(CUR.enginePaths).map(([e, x]) => `${D.engines.find(y => y.id === e)?.label || e}: ${x.path === "ui" ? "consumer-UI sessions" : "API path"} (${x.n} questions)${x.why ? " — " + esc(x.why) : ""}`).join("; ")}.</li>` : ""}<li>The measured lenses use Bright Data's real consumer-UI sessions on chatgpt.com, perplexity.ai and gemini.google.com, as a US shopper, with the citations the interface showed. One session per question per pass; a batch takes minutes per engine.</li><li>Live runs use the same engines' model APIs with web search on (GPT-5.4, Gemini 2.5 Flash, Perplexity Sonar, Claude Sonnet) through one fan-out, in seconds. Claude has no consumer-UI scraper, so its measured lane is Claude's API with its own web search — the retrieval the Claude app uses — and it is labelled as such. Third-party tests find the API and the consumer app can differ in the sources they pull; a live answer is a real answer from that model today, and the page labels which path produced it.</li></ul>
    <h3>Reading the answers</h3><ul><li>One reader model per question extracts, for every engine answer: the tracked brands named, the order of first mention, whether a brand is framed as the top pick, the sentiment, the specific model, the attributes attached to each brand, and every checkable claim about ${SL}. The same reader runs on every capture date, so drift is the engines changing, not the reader.</li><li>A brand added in the console is read by text match on the captured answers (presence and order only) until the next capture reads it properly. It is labelled as such wherever it appears.</li><li>Share of AI answer = Σ over answers of (1 ÷ position) × favourability (positive 1, neutral or mixed 0.6, negative 0.2), normalised across the selected brands. Presence = questions where at least one engine names the brand. Top pick = the single brand an answer most recommends, when it commits to one.</li></ul>
    <h3>Evidence</h3><ul><li>Consumer-app answers keep the page source the session returned; it is rendered offline (scripts and network disabled) into the image behind “show the real session”, with the capture time, country, whether the app ran a web search, whether the shopping module was on screen, and the model the app reported. API-path answers keep the model id and the request time.</li><li>Every answer carries a SHA-256 fingerprint of its text and a raw record; the raw capture files are downloadable from the Evidence card so the figures can be recomputed outside this page.</li><li>“Ask it yourself” opens the engines with the same question. The answer may differ from the capture: Lens 10 measures how often it does.</li></ul>
    <h3>Rules this page obeys</h3><ul><li>Every figure is computed from the payload in the browser; change the scope and it recomputes. No superlative is typed — “first”, “joint third” are read from the same object as the number.</li><li>A lens whose data source is not connected shows no number. Nothing is illustrative.</li><li>Every tile opens to its receipt: the questions, each engine's full answer, the citations and the arithmetic.</li><li>External figures in the programme are attributed inline to their study; they are the literature's numbers, not ours.</li></ul>
    <h3>Limits</h3><ul><li>US market, English, one pass per question on the full bank (three on the volatility set). Personalisation and memory are off in the captured sessions; a signed-in shopper may see a different answer.</li><li>Engine answers vary run to run; the volatility lens quantifies how much for this bank. Treat single-run differences under that spread as noise.</li><li>The question bank is ours, weighted by judgement. Weighting it by real prompt demand is the first roadmap item.</li></ul>
    <p class="note" style="margin-top:14px">Payload generated ${esc(D.generatedAt.slice(0, 16).replace("T", " "))} UTC · BrandContext Atlas.</p>`;
}
let _token = null, WARM = null, LIVE_ANSWERS = [], LIVE_Q = "";
async function token() {
  if (_token) return _token;
  const SDK = "https://www.gstatic.com/firebasejs/11.0.2";
  const [{ initializeApp, getApps }, { getAuth, signInAnonymously }] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
  const app = getApps().length ? getApps()[0] : initializeApp({ apiKey: "AIzaSyDWw1rB68sh02LhXsTVup0Q6A6UakLXRl0", authDomain: "bravo-platform-bc.firebaseapp.com", projectId: "bravo-platform-bc" });
  const cred = await signInAnonymously(getAuth(app)); _token = await cred.user.getIdToken(); return _token;
}
const PERSONAS_BY_CAT = {
  phone: { camera: "You are helping a shopper who cares most about photos and video from their phone. Answer with specific product/model recommendations and brief reasons, in under 180 words.", gamer: "You are helping a shopper who plays demanding mobile games and wants the best performance and battery. Answer with specific product/model recommendations and brief reasons, in under 180 words.", switcher: "You are helping a long-time iPhone user thinking about switching to Android. Answer with specific product/model recommendations and brief reasons, in under 180 words.", value: "You are helping a value-first shopper who wants the best phone for the money. Answer with specific product/model recommendations and brief reasons, in under 180 words." },
};
const PERSONAS_TV = { gamer: "You are helping a shopper who mainly games on a PS5 and Xbox Series X. Answer with specific product/model recommendations and brief reasons, in under 180 words.", cinema: "You are helping a shopper building a dark-room home cinema who cares about HDR and sound. Answer with specific product/model recommendations and brief reasons, in under 180 words.", bright: `You are helping a family buying a ${CAT} for a bright living room with lots of daytime viewing. Answer with specific product/model recommendations and brief reasons, in under 180 words.`, value: `You are helping a value-first shopper who wants the best ${CAT} for the money. Answer with specific product/model recommendations and brief reasons, in under 180 words.` };
const fmtClock = (iso) => { try { return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const isToday = (iso) => { try { return new Date(iso).toDateString() === new Date().toDateString(); } catch { return false; } };
function renderLive() {
  const engL = Object.fromEntries(D.engines.map(e => [e.id, e.label]));
  const warmRows = WARM?.results || [];
  const picks = warmRows.length ? [] : [...D.bank.filter(q => q.stage === "decision").slice(0, 2), ...D.bank.filter(q => q.stage === "evaluation" && q.focus === "vs").slice(0, 1), ...D.bank.filter(q => q.stage === "consideration").slice(0, 2)];
  $("liveSuggest").innerHTML = (warmRows.length ? `<span class="note" style="width:100%">Demo shortlist · answers captured ${isToday(WARM.warmedAt) ? "today" : fmtTime(WARM.warmedAt).split(",")[0]} at ${fmtClock(WARM.warmedAt)} through the same live path — tap one to show it instantly, then re-run it live.</span>` : "")
    + warmRows.map((r, i) => `<span class="chip warm" onclick="showWarm(${i})" title="captured ${esc(fmtTime(r.at))}">${esc(r.question.slice(0, 64))}${r.question.length > 64 ? "…" : ""}<small>${esc(fmtClock(r.at))}</small></span>`).join("")
    + picks.map(q => `<span class="chip" onclick="document.getElementById('liveQ').value=${JSON.stringify(q.text).replace(/"/g, "&quot;")}">${esc(q.text.slice(0, 64))}${q.text.length > 64 ? "…" : ""}</span>`).join("")
    + S.customQ.map(q => `<span class="chip" onclick="document.getElementById('liveQ').value=${JSON.stringify(q.text).replace(/"/g, "&quot;")}">${esc(q.text.slice(0, 64))}</span>`).join("");
  $("liveEngines").innerHTML = D.liveConfig.engines.map(e => `<span class="chip ${S.liveEngines.has(e) ? "on" : ""}" style="--sw:var(--accent)" onclick="toggleLiveEngine('${e}')"><i class="sw"></i>${esc(engL[e] || e)}</span>`).join("") + `<span class="note" style="align-self:center">${S.liveEngines.size} engine${S.liveEngines.size === 1 ? "" : "s"} · ${S.liveEngines.has("gpt") && S.liveEngines.size >= 3 ? "about 12–15 s" : S.liveEngines.size <= 2 ? "about 8–13 s" : "about 10–15 s"}</span>`;
}
window.toggleLiveEngine = (e) => { S.liveEngines.has(e) ? S.liveEngines.delete(e) : S.liveEngines.add(e); if (!S.liveEngines.size) S.liveEngines.add(e); renderLive(); };
window.showWarm = (i) => {
  const r = WARM.results[i]; if (!r) return;
  $("liveQ").value = r.question; $("liveError").hidden = true; $("liveProgress").innerHTML = `<b>captured ${isToday(r.at) ? "today" : fmtTime(r.at)} at ${esc(fmtClock(r.at))}</b> · ${esc(r.path)} · ${Math.round(r.elapsedMs / 1000)} s when captured · <button class="more" onclick="runLive()">▶ re-run live now</button>`;
  LIVE_Q = r.question; LIVE_ANSWERS = r.engines.map(e => ({ ...e })); renderLiveResult({ question: r.question, at: r.at, engines: LIVE_ANSWERS, extraction: { method: "llm" }, warm: true });
  const lh = "#" + pageDef("live").hash; if (location.hash !== lh) location.hash = lh;
};
function liveCard(e, s) {
  return `<div class="ans" id="live-${esc(e.id)}"><div class="eh"><span class="en">${esc(e.label)}<small>${esc(e.via || e.model || "")}${e.tMs ? ` · ${(e.tMs / 1000).toFixed(1)} s` : ""}</small></span>${e.topPick ? `<span class="bchip ${e.topPick === s ? "sub" : ""}">top pick · ${esc(brandLabel(e.topPick))}</span>` : ""}</div>
    ${e.error ? `<div class="note" style="color:var(--crit)">${esc(e.error)}</div>` : ""}
    <div class="bchips">${(e.brands || []).slice().sort((a, b) => (a.rank || 9) - (b.rank || 9)).map(b => `<span class="bchip ${b.id === s ? "sub" : ""} ${b.sentiment || ""}"><i class="sw" style="width:8px;height:8px;border-radius:2px;background:${brandColor(b.id)}"></i>${esc(brandLabel(b.id))}<span class="r">#${b.rank || "?"}${b.recommended ? " · pick" : ""}${b.product ? " · " + esc(b.product) : ""}${b.sentiment ? ` · <span class="s">${esc(b.sentiment)}</span>` : ""}${b.textMatch ? " · text match" : ""}</span></span>`).join("") || (e.text ? '<span class="note">no tracked brand named</span>' : "")}</div>
    <div class="txt">${md(e.text, S.brands.filter(b => b.on))}</div>
    ${e.subjectClaims?.length ? `<div class="note"><b>Claims about ${SL}:</b> ${e.subjectClaims.map(c => esc(c.claim)).join(" · ")}</div>` : ""}
    ${e.sources?.length ? `<div class="cites">${e.sources.slice(0, 8).map(x => `<span><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.host || x.title)}</a></span>`).join("")}</div>` : (e.text ? '<div class="note">no citations returned</div>' : "")}
    <div class="evd"><span class="evk">Evidence</span>${esc(e.via || "")}${e.model ? ` · ${esc(e.model)}` : ""}${e.costUsd != null ? ` · $${Number(e.costUsd).toFixed(4)}` : ""}${e.sha256 ? ` · sha256 ${esc(e.sha256.slice(0, 12))}…` : ""} <button class="more" onclick="toggleEv(this)">raw record</button><pre class="evraw" hidden>${esc(JSON.stringify({ engine: e.id, model: e.model, via: e.via, sources: (e.sources || []).map(x => x.url), text: e.text }, null, 1))}</pre></div></div>`;
}
function renderLiveSummary(out) {
  const s = subjectId(); const eng = out.engines.filter(e => e.text); const named = eng.filter(e => e.brands?.some(b => b.id === s)); const ranks = eng.map(e => e.brands?.find(b => b.id === s)?.rank).filter(x => x);
  const picks = eng.map(e => e.topPick).filter(Boolean); const pickSony = picks.filter(p => p === s).length; const cited = uniq(eng.flatMap(e => (e.sources || []).map(x => x.host))).length;
  $("liveSum").hidden = false; $("liveSum").innerHTML = stat(`${SL} named`, `${named.length}<small>/ ${eng.length}</small>`, `engines naming ${SL} in this answer`) + stat("Position", ranks.length ? n1(sum(ranks) / ranks.length) : "—", "average order of first mention") + stat("Top pick", picks.length ? `${pickSony}<small>/ ${picks.length}</small>` : "—", picks.length ? `engines whose single top pick is ${SL}` : "reader still running") + stat("Sources", String(cited), "distinct domains cited across engines");
}
function renderLiveResult(out) {
  const s = subjectId(); LIVE_ANSWERS = out.engines; LIVE_Q = out.question || $("liveQ").value;
  $("liveOut").innerHTML = askRow(LIVE_Q, true) + out.engines.map(e => liveCard(e, s)).join("");
  renderLiveSummary(out);
}
function patchLiveCard(e) { const s = subjectId(); const el = $(`live-${e.id}`); if (el) el.outerHTML = liveCard(e, s); else $("liveOut").insertAdjacentHTML("beforeend", liveCard(e, s)); renderLiveSummary({ engines: LIVE_ANSWERS }); }
async function readSSE(resp, onEvent) {
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); let ev = "message", data = ""; for (const ln of chunk.split("\n")) { if (ln.startsWith("event:")) ev = ln.slice(6).trim(); else if (ln.startsWith("data:")) data += ln.slice(5).trim(); } if (data) { try { onEvent(ev, JSON.parse(data)); } catch {} } } }
}
async function runLive() {
  const question = $("liveQ").value.trim(); if (question.length < 8) { $("liveQ").focus(); return; }
  const btn = $("runLive"); btn.disabled = true; $("liveError").hidden = true; $("liveSum").hidden = true; $("liveOut").innerHTML = askRow(question, true); const t0 = Date.now();
  const engines = [...S.liveEngines]; const engL = Object.fromEntries(D.engines.map(e => [e.id, e.label])); LIVE_Q = question; LIVE_ANSWERS = [];
  const arrived = new Set();
  const tick = setInterval(() => { const waiting = engines.filter(e => !arrived.has(e)).map(e => engL[e]); $("liveProgress").innerHTML = `<span class="dot"></span>${arrived.size ? `${arrived.size} of ${engines.length} answered` : `asking ${engines.map(e => engL[e]).join(", ")}`}${waiting.length && arrived.size ? ` · waiting on ${waiting.join(", ")}` : ""} … ${((Date.now() - t0) / 1000).toFixed(0)} s`; }, 400);
  try {
    const PERSONAS = PERSONAS_BY_CAT[D.category] || PERSONAS_TV; const base = { question, engines, market: S.market, subject: subjectId(), category: D.category, brands: S.brands.filter(b => b.on).map(b => ({ id: b.id, label: b.label, aliases: aliasesOf(b) })), persona: PERSONAS[S.persona] || null };
    const hdr = window.__ccBoot ? { "Content-Type": "application/json", ...(window.__CC_AUTH ? { Authorization: window.__CC_AUTH } : {}) } : { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` };
    let out = null;
    // 1. stream from the function's own URL (no 60 s hosting cut-off, answers as they land)
    if (D.liveConfig.directUrl) {
      try {
        const r = await fetch(D.liveConfig.directUrl, { method: "POST", headers: hdr, body: JSON.stringify({ ...base, mode: "stream" }) });
        if (r.ok && (r.headers.get("content-type") || "").includes("text/event-stream")) {
          await readSSE(r, (ev, data) => { if (ev === "answer") { arrived.add(data.id); LIVE_ANSWERS.push(data); patchLiveCard(data); } else if (ev === "done") out = data; else if (ev === "error") throw new Error(data.message); });
          if (!out) throw new Error("stream ended without a result");
        } else if (r.status === 404 || r.status === 405) out = null; else if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || j.error || `HTTP ${r.status}`); }
      } catch (e) { if (!/Failed to fetch|NetworkError|stream ended/.test(e.message)) throw e; out = null; }
    }
    // 2. the hosting rewrite, fast mode (alias read), one response
    if (!out) {
      const r = await fetch(D.liveConfig.endpoint, { method: "POST", headers: hdr, body: JSON.stringify({ ...base, mode: "engines" }) });
      if (r.status === 404 || r.status === 405 || r.status === 503) throw new Error("the live fan-out endpoint (geoLive) is not deployed on this site yet — see docs/insights/AI-VISIBILITY.md for the two deploy commands");
      const raw = await r.text(); try { out = JSON.parse(raw); } catch { throw new Error(`HTTP ${r.status} from the engine endpoint`); }
      if (!r.ok) throw new Error(out.message || out.error || `HTTP ${r.status}`);
      LIVE_ANSWERS = out.engines; renderLiveResult(out);
    }
    clearInterval(tick);
    const tEngines = ((Date.now() - t0) / 1000).toFixed(1);
    $("liveProgress").innerHTML = `answers in <b>${tEngines} s</b> · ${esc(out.path || "")}${out.runId ? ` · run ${esc(out.runId)}` : ""} · <span class="dot" style="background:var(--accent)"></span>reader refining positions and claims…`;
    renderLiveSummary({ engines: LIVE_ANSWERS });
    if (!S.customQ.some(q => q.text === question) && !D.bank.some(q => q.text === question)) { S.customQ.push({ id: "live-" + Date.now(), stage: "decision", text: question, custom: true, focus: "live" }); renderCfg(); }
    // 3. the reader, off the critical path
    try {
      const answers = LIVE_ANSWERS.filter(e => e.text).map(e => ({ id: e.id, text: e.text }));
      const rx = await fetch(D.liveConfig.directUrl || D.liveConfig.endpoint, { method: "POST", headers: hdr, body: JSON.stringify({ question, mode: "extract", subject: base.subject, category: base.category, brands: base.brands, answers }) });
      const ex = await rx.json();
      if (rx.ok && ex.engines) { for (const e of ex.engines) { const a = LIVE_ANSWERS.find(x => x.id === e.id); if (!a) continue; if (e.brands?.length) a.brands = e.brands; a.topPick = e.topPick || ""; a.subjectClaims = e.subjectClaims || []; patchLiveCard(a); } $("liveProgress").innerHTML = `answers in <b>${tEngines} s</b> · reader done in ${((Date.now() - t0) / 1000).toFixed(1)} s (${esc(ex.extraction?.model || "")})${out.runId ? ` · run ${esc(out.runId)}` : ""}`; }
      else $("liveProgress").innerHTML = `answers in <b>${tEngines} s</b> · reader unavailable, brands shown by text match${out.runId ? ` · run ${esc(out.runId)}` : ""}`;
    } catch { $("liveProgress").innerHTML = `answers in <b>${tEngines} s</b> · reader unavailable, brands shown by text match`; }
    const rec = $("liveRecentList"); $("liveRecent").hidden = false; rec.insertAdjacentHTML("afterbegin", `<div class="note" style="padding:5px 0;border-bottom:1px solid var(--line2)">${esc(new Date().toLocaleTimeString())} · “${esc(question.slice(0, 60))}” · ${tEngines} s · ${LIVE_ANSWERS.map(e => `${esc(e.label)}: ${e.brands?.some(b => b.id === subjectId()) ? `${SL} named` : `no ${SL}`}`).join(" · ")}</div>`);
  } catch (e) { clearInterval(tick); $("liveProgress").textContent = ""; $("liveError").hidden = false; $("liveError").textContent = `The live run didn't complete: ${e.message}. The measured lenses above are unaffected.`; }
  btn.disabled = false;
}
window.runLive = runLive;

// ── pages: static templates with hosts the renderers write into ──────────────
const LIVE_PLACEHOLDER = { tv: "e.g. Which 65-inch TV should I buy for a bright living room under $2,000?", phone: "e.g. Which phone should I buy for the best camera under $1,000?" };
const TPL = {
  overview: () => `${intro('<span id="ovLead">—</span>', '<div class="ovcap" id="ovAside"></div>')}
    <div class="grid g4 lead-kpis" id="ovKpis"></div>
    <div class="grid g23">${card({ title: "Share of AI Answer Through the Funnel", sub: "Weighted share of the engines' answers at each stage of the buying journey. Tap a stage for its questions and every answer behind them.", tag: "Measured", tagCls: "good", slot: "ovFunnel" })}${card({ title: "By Engine", sub: "Share of answer on each engine for the selected brands, read on the brand-neutral questions. Tap an engine for every answer it gave.", tag: "Measured", tagCls: "good", slot: "ovEngines" })}</div>
    <h2 class="sec">The Read Today</h2><div class="reads" id="ovReads"></div>
    <h2 class="sec">What This Console Does</h2>
    <div class="grid g3 trio">
      <section class="card tint"><span class="kicker">Measure</span><h3>Every shopper question, every engine, every stage of the funnel.</h3><ul><li>A bank of ${D.bank.length} shopper questions from broad discovery to “which one do I buy”, mapped to Attention → Interest → Desire → Action.</li><li>Real consumer sessions on each engine where a session can be captured, the engine's own API with web search where it cannot — the answer a shopper sees, with the engine's own citations.</li><li>Thirteen lenses computed from the captured answers: presence, position, recommendation, citations, products, attributes, claims, volatility, drift, app-versus-API, crawler access.</li></ul><a class="more" href="#${pageDef("funnel").hash}">Open the funnel →</a></section>
      <section class="card tint"><span class="kicker">Configure</span><h3>Change the questions, the competitors or the engines and every page recomputes.</h3><ul><li>Switch stages or single questions off; add a question of your own and run it live.</li><li>Add or remove competitors — ${catCopy().rivalsExample} — and the funnel, the pivot and every lens re-read from the raw answers.</li><li>Pick the engines that matter, the market, the persona and the sampling depth.</li></ul><button class="more" onclick="openScope()">Change the scope →</button></section>
      <section class="card tint"><span class="kicker good">Optimise</span><h3>A 90-day programme from diagnosis to earned sources to owned comparison content.</h3><ul><li>Which sources each engine trusts for ${CAT} questions, and where ${SL} is absent from them.</li><li>What the engines assert about ${SL} that ${SL} should verify or correct.</li><li>Access, feeds and entity hygiene — the levers with evidence, and the ones the market oversells.</li></ul><a class="more" href="#${document.body.dataset.payloadWb ? pageDef("programme").hash : pageDef("method").hash}">${document.body.dataset.payloadWb ? "See the programme →" : "How this was built →"}</a></section>
    </div>
    <div class="foot" id="ovFoot"></div>`,
  // the funnel carries the rivals' shares on the brand-neutral stages, so the stage × brand
  // pivot is gone; the engine stack sits below it; the question bank opens from the top bar
  funnel: () => `${intro('<span id="funnelRead">—</span>')}
    <div class="grid g23">${card({ title: "The Funnel", sub: `${SL}'s share of the AI answer at each stage, with the rivals beside it where the questions name no brand. Tap a tier for the proof.`, tag: "Measured", tagCls: "good", slot: "funnelViz" })}<div class="stack-v">${card({ title: "Presence & Position", sub: "How often each brand is named, where it first appears, and how often it is the single top pick — on the brand-neutral questions (the count is under the table).", tag: "Measured", tagCls: "good", slot: "presenceViz" })}${card({ title: "Share of Answer by Engine", sub: "The same questions, split by engine — the engines differ because their sources do. Tap an engine for every answer it gave.", tag: "Measured", tagCls: "good", slot: "engineViz" })}</div></div>`,
  sources: () => `${intro('<span id="srcLead">—</span>')}
    <div class="grid g2"><div id="lens-cites"></div><div id="lens-gap"></div></div>
    <div class="grid g2"><div id="lens-byengine"></div><div id="lens-owned"></div></div>
    <div id="lens-hosts"></div>
    <div id="lens-crawl"></div>`,
  attrs: () => `${intro('<span id="attrLead">—</span>')}
    <div id="lens-attrs"></div>
    <div class="grid g2"><div id="lens-attrbal"></div><div id="lens-attrlead"></div></div>
    <div id="lens-attreng"></div>`,
  products: () => `${intro('<span id="prodLead">—</span>')}
    <div class="grid g2"><div id="lens-pick"></div><div id="lens-h2h"></div></div>
    <div class="grid g2"><div id="lens-products"></div>${card({ title: "Catalogue Coverage", sub: `The ${PL} line-up from the instance brief against the models the engines actually name, on every question in scope. A model no engine names cannot be bought on an engine's recommendation.`, tag: "Measured", tagCls: "good", slot: "catalog" })}</div>`,
  claims: () => `${intro('<span id="claimsLead">—</span>')}<div id="lens-claims"></div>`,
  change: () => `${intro('<span id="chgLead">—</span>')}<div id="lens-drift"></div><div id="lens-vol"></div>`,
  live: () => `${intro('Type any shopper question, pick the engines, and read the real answers as they come back — <b>with the brands, positions, sentiment and citations extracted on the spot</b>. Answers land in about 10–15 seconds; the demo shortlist shows instantly.')}
    <section class="card"><div class="livebox"><div>
      <textarea id="liveQ" placeholder="${LIVE_PLACEHOLDER[D.category] || `e.g. Which ${CAT} should I buy under $1,000?`}"></textarea>
      <div class="liveq" id="liveSuggest"></div>
      <div class="chips" id="liveEngines" style="margin-top:12px"></div>
      <div class="runrow"><button class="btn" id="runLive">▶ Run live</button><span class="progress" id="liveProgress"></span></div>
      <div id="liveError" class="note" style="color:var(--risk);margin-top:8px" hidden></div>
      <div class="livesum" id="liveSum" hidden></div>
      <div class="liveout" id="liveOut"></div>
    </div><div class="liveside">
      <div class="card"><span class="kicker mute">What happens when you press run</span><ol><li>The question goes to each engine's live API with web search on — the same models behind the consumer apps — and each answer appears the moment it lands, usually 7–15 seconds.</li><li>Each answer comes back with the engine's citations; the tracked brands are marked instantly by text match.</li><li>A reader model then refines the read — order, top pick, framing, model named, claims about ${SL} — a few seconds later, without holding up the answers.</li><li>The run is stored with its record, so a demo is reproducible afterwards.</li></ol></div>
      <div class="card"><span class="kicker mute">Live vs measured</span><p class="note" style="font-size:12px;color:var(--soft)">The measured pages come from real consumer-UI sessions captured in batches (minutes per engine). Live runs use the engines' APIs so an answer arrives while you're talking. The two can differ — that difference is itself a finding, and the Evidence page measures it.</p></div>
      <div class="card" id="liveRecent" hidden><span class="kicker mute">Recent live runs</span><div id="liveRecentList"></div></div>
    </div></div></section>`,
  evidence: () => `${intro('Nothing on this console is a paraphrase. <b>Each measured answer carries the engine\'s own record</b> — the real session where a consumer app was read, the model id and a fingerprint of the answer text where an API was — and every shopper question can be re-asked on the engines from any phone in the room.')}
    <div class="grid g4" id="evKpis"></div>
    <div class="grid g2">${card({ title: "Check It Yourself", sub: "Open a question on the engines with one tap. Answers vary run to run — Change Over Time measures how much — the point is that the captured ones are real.", slot: "evHow" })}${card({ title: "Evidence Bundle", sub: "The raw capture files behind every figure, downloadable so the numbers can be recomputed outside this page.", slot: "evBundle" })}</div>
    ${card({ title: "Browse the Receipts", sub: "Every question in scope with the path each engine's answer came through. Tap a row for the full answers, the reader's extraction, the session image and the raw record.", tag: "Measured", tagCls: "good", slot: "evBrowse" })}
    ${card({ title: "How Evidence Is Kept", html: `<div class="method"><ul><li>Consumer-app answers keep the page source the session returned; it is rendered offline (scripts and network disabled) into the image behind “show the real session”, with the capture time, country, whether the app ran a web search, whether the shopping module was on screen, and the model the app reported.</li><li>API-path answers keep the model id and the request time.</li><li>Every answer carries a SHA-256 fingerprint of its text and a raw record; the raw capture files above let the figures be recomputed outside this page.</li><li>“Ask it yourself” opens the engines with the same question. The answer may differ from the capture: the volatility lens measures how often it does.</li></ul></div>` })}
    <div id="lens-uiapi"></div>`,
  programme: () => `${intro(`Ninety days, four phases, each action tied to a lens and to the evidence for why it works. <b>The ${SL}-specific triggers are computed from the capture</b>, so they change with the scope.`)}
    <div class="phases" id="phases"></div><div class="actions" id="actions"></div>
    <h2 class="sec">What We Deliberately Don't Sell</h2><div class="dont" id="dont"></div>
    ${card({ title: "Targets · Set Them in the Room", sub: `Current values are measured on this console; targets are ${SL}'s to set. The lever column names what moves each one.`, html: '<div class="tblwrap" id="targets"></div>' })}`,
  landscape: () => `${intro('Who sells AI-visibility measurement today, what each measures, and the white space this console occupies. <b>Compiled from the vendors\' own documentation and press</b>, 18 September 2026.')}
    ${card({ title: "The Vendor Map", sub: `${VENDORS.length} platforms: engines covered, capture method, distinctive metrics, execution features, pricing and named customers.`, html: '<div class="tblwrap" id="vendors"></div><details class="src"><summary>Sources for the vendor table</summary><ul id="vendorSources"></ul></details>' })}
    <h2 class="sec">Where This Console Stands Apart</h2><div class="diff" id="diff"></div>`,
  method: () => `${intro('How each number on this console was produced, and the rules it obeys. <b>Every figure is computed in the browser from the captured answers</b>; change the scope and it recomputes.')}
    ${card({ title: "Method & Provenance", html: '<div class="method" id="methodBody"></div>' })}
    <h2 class="sec">Lenses That Connect to ${SL}'s Own Data</h2><p class="mini" style="text-align:center;margin:-6px 0 12px">Measured once the source is connected — shown here without numbers on purpose.</p><div class="roadmap" id="roadmap"></div>
    ${WB ? `<div class="subsec" id="sub-wbmethod"><h2 class="sec">The Workbench: What It Is and What Anchors It</h2>${TPL_WB.method()}</div>` : ""}`,
  // workbench pages: the simulated programme, grouped so the rail stays short. Each group
  // is one page of sections with a jump row; every section is the workbench's own template.
  scorecard: () => wbPage("scorecard"),
  diagnose: () => wbPage("diagnose"),
  earn: () => wbPage("earn"),
  measure: () => wbPage("measure"),
};
const WBSECS = {
  scorecard: [{ id: "scorecard", title: "Programme Scorecard" }],
  diagnose: [{ id: "baseline", title: "Baseline & Sampling" }, { id: "truthset", title: "Truth-Set & Claims" }, { id: "access", title: "Access & Feeds" }, { id: "listing", title: "Listing Readiness" }, { id: "catalogue", title: "Catalogue Presence" }],
  earn: [{ id: "sources", title: "Source Placement" }, { id: "content", title: "Comparison & Use-Case Content" }, { id: "community", title: "Community & Video" }, { id: "shopping", title: "Shopping Surfaces" }],
  measure: [{ id: "trajectory", title: "Outcome Trajectory" }, { id: "deliverables", title: "Deliverables Ledger" }],
};
function wbPage(key) {
  if (!WB) return withheld("The workbench payload did not load, so the simulated programme is withheld on this page. The measured console pages are unaffected.");
  const secs = WBSECS[key];
  const jump = secs.length > 1 ? `<div class="subnav" aria-label="Sections on this page"><span class="sl">On this page</span>${secs.map(x => `<button type="button" onclick="jumpTo('sub-${x.id}')">${esc(x.title)}</button>`).join("")}</div>` : "";
  return jump + secs.map((x, i) => `<div class="subsec" id="sub-${x.id}">${i ? `<h2 class="sec">${esc(x.title)}</h2>` : ""}${TPL_WB[x.id]()}</div>`).join("");
}

// ── shared computations for the page leads ───────────────────────────────────
function pathsSentence() {
  const ep = CUR.enginePaths || {};
  const ui = Object.entries(ep).filter(([e, x]) => x.path === "ui" && S.engines.has(e)).map(([e]) => engLabel(e));
  const api = Object.entries(ep).filter(([e, x]) => x.path !== "ui" && S.engines.has(e)).map(([e]) => engLabel(e));
  return [ui.length ? `real consumer sessions on ${ui.join(" and ")}` : "", api.length ? `API with web search on ${api.join(" and ")}` : ""].filter(Boolean).join(" · ");
}
function hostStats(A, sb) { const hosts = {}; for (const a of A) { const named = !!mention(a, sb); for (const x of (a.sources || [])) { if (!x.host) continue; hosts[x.host] ||= { n: 0, named: 0, eng: new Set() }; hosts[x.host].n++; if (named) hosts[x.host].named++; hosts[x.host].eng.add(a.engine); } } return hosts; }
function stageRead(A) { const s = subjectId(); return D.stages.map(x => { const sa = stageAnswers(x.id, A); const sh = shareOf(sa); return { ...x, cmp: isCompareStage(x.id), shareAll: sh, share: sh[s], pres: presenceOf(sa)[s] }; }); }
// a rank is only a rank where the brands compete on the same questions; where they name Sony, say so
const stageRank = (x) => x.cmp ? rankPhrase(x.shareAll, subjectId()) : `questions name ${SL}`;
function volatilityRead() {
  if (!D.volatility || D.volatility.runs.length < 2) return null; const s = subjectId();
  const runs = D.volatility.runs; const pairs = {}; for (const r of runs) for (const a of r.answers) { if (!S.engines.has(a.engine)) continue; const k = `${a.queryId}|${a.engine}`; (pairs[k] ||= []).push({ named: a.brands.some(b => b.id === s), pick: a.topPick || "" }); }
  const rows = Object.entries(pairs).filter(([, v]) => v.length >= 2); if (!rows.length) return null;
  const stableNamed = rows.filter(([, v]) => uniq(v.map(x => x.named)).length === 1).length; const stablePick = rows.filter(([, v]) => uniq(v.map(x => x.pick)).length === 1).length;
  return { runs: runs.length, pairs: rows.length, named: stableNamed / rows.length, pick: stablePick / rows.length };
}
const deltaChip = (prev, cur, title) => { if (prev == null || cur == null) return ""; const d = (cur - prev) * 100; const cls = d >= 0.5 ? "up" : d <= -0.5 ? "dn" : "flat"; return `<span class="delta ${cls}" title="${esc(title || "")}">${cls === "up" ? "▲" : cls === "dn" ? "▼" : "•"} ${Math.abs(d).toFixed(0)} pts</span>`; };

// ── overview ─────────────────────────────────────────────────────────────────
function renderOverview() {
  const A = activeAnswers(); const s = subjectId(); const sb = S.brands.find(b => b.id === s); const bs = brandsOn();
  const AC = compareAnswers();   // brand comparisons: the brand-neutral questions only
  const sh = shareOf(AC), pr = presenceOf(AC), tp = topPickShare(AC); const nQ = uniq(AC.map(a => a.queryId)).length;
  const rk = avgRank(AC, sb); const rankObj = Object.fromEntries(bs.map(b => [b.id, b.custom ? null : -(avgRank(AC, b) ?? 99)])); const presObj = Object.fromEntries(bs.map(b => [b.id, pr[b.id].rate]));
  const drift = PREV && DTO ? driftSummary() : null;
  const dchip = drift ? deltaChip(drift.prevShare, drift.curShare, `Like for like on the engines' API path, ${monthLabel(PREV.basis)} → ${monthLabel(DTO.basis)}: ${pct(drift.prevShare)} → ${pct(drift.curShare)}`).replace("</span>", ` since ${esc(monthLabel(PREV.basis))} · API path</span>`) : "";
  $("ovKpis").innerHTML =
    kpi({ label: "Share of AI answer", dot: sb.color, value: pct(sh[s]), rank: rankChip(sh, s), delta: dchip, note: `${nQ} brand-neutral questions × ${S.engines.size} engine${S.engines.size === 1 ? "" : "s"} · presence × position × favourability`, onclick: "openShareProof()" }) +
    kpi({ label: "Named in", dot: sb.color, value: String(pr[s]?.n ?? "—"), unit: `/ ${pr[s]?.of ?? "—"} questions`, rank: rankChip(presObj, s), note: `brand-neutral questions where at least one engine names ${SL}`, onclick: `openPresenceProof('${s}')` }) +
    kpi({ label: "Average position", dot: sb.color, value: rk == null ? "—" : n1(rk), rank: rankChip(rankObj, s), note: "order of first mention when named · lower is better", onclick: `openPresenceProof('${s}')` }) +
    kpi({ label: "Top pick", dot: sb.color, value: pct(tp.out[s]), rank: rankChip(tp.out, s), note: `of ${tp.n} brand-neutral answers that commit to one brand`, onclick: `openPickProof('${s}')` });
  const st = stageRead(A); const first = st[0], last = st[st.length - 1];
  const dir = first.share != null && last.share != null ? (last.share > first.share ? "rises" : last.share < first.share ? "falls" : "holds") : null;
  const engSh = Object.fromEntries([...S.engines].map(e => [e, shareOf(AC.filter(a => a.engine === e))[s]])); const engRows = byDesc(Object.fromEntries(Object.entries(engSh).filter(([, v]) => v != null))); const engBest = engRows[0], engWorst = engRows[engRows.length - 1];
  $("ovLead").innerHTML = AC.length ? `<b>${esc(D.subjectLabel)} holds ${pct(sh[s])} of the weighted AI answer</b> across the ${nQ} brand-neutral shopper questions (${esc(compareLabel())}) on ${S.engines.size} engine${S.engines.size === 1 ? "" : "s"} — ${standingPhrase(sh, s, "brands tracked")} — and is named in ${pr[s].n} of ${pr[s].of} of them.${dir ? ` Its share <b>${dir} through the funnel</b>: ${st.map(x => `${esc(x.label)} ${pct(x.share)}`).join(" → ")}.` : ""}${engBest ? ` Strongest on ${esc(engLabel(engBest[0]))} (${pct(engBest[1])})${engRows.length > 1 ? `, weakest on ${esc(engLabel(engWorst[0]))} (${pct(engWorst[1])})` : ""}.` : ""}` : "No brand-neutral stage in scope — switch Awareness or Consideration back on from the Scope panel to compare brands; the funnel below still reads per stage.";
  $("ovAside").innerHTML = `<div class="k">Capture</div><div class="v">${esc(fmtDate(CUR.capturedAt || CUR.basis))}</div><div class="n">${esc(D.market)} · ${esc(pathsSentence())}${D.evidenceSummary?.sessions ? ` · ${D.evidenceSummary.sessions} real sessions on file` : ""}</div>`;
  const widths = [100, 86, 72, 58];
  $("ovFunnel").innerHTML = `<div class="funnelviz">${st.map((x, i) => `<div class="ftier" style="width:${widths[i] || 50}%;background:linear-gradient(120deg,var(--accent),color-mix(in srgb,var(--accent) ${55 + i * 10}%,#8ab4f8))" onclick="openStageProof('${x.id}')"><span class="fn">${esc(x.label)}<small>${esc(x.aida)}</small></span><span style="text-align:right"><span class="fp tnum">${pct(x.share)}</span><div class="fq">named in ${x.pres?.n ?? 0}/${x.pres?.of ?? 0} · ${stageRank(x)}</div></span></div>`).join("")}<div class="fcap">${esc(D.subjectLabel)}'s share of the weighted AI answer · ${bs.length} brands · ${S.engines.size} engines</div></div>`;
  $("ovEngines").innerHTML = ([...S.engines].map(e => { const sa = AC.filter(a => a.engine === e); return `<div class="srow" onclick="openEngineProof('${e}')"><div class="rl">${esc(engLabel(e))}<small>${uniq(sa.map(a => a.queryId)).length} answers · ${rankPhrase(shareOf(sa), s)}</small></div><div>${stackBar(shareOf(sa))}</div></div>`; }).join("") || withheld("No engine selected.")) + compareFoot();
  // the read today — every sentence is computed, and its tone with it
  const reads = []; const shSt = standing(sh, s);
  if (shSt) { const rows = byDesc(Object.fromEntries(Object.entries(sh).filter(([, v]) => v != null))); reads.push({ tone: shSt.rank === 1 ? "good" : shSt.rank === 2 ? "watch" : "risk", text: `${esc(D.subjectLabel)} is <b>${standingPhrase(sh, s, "brands")}</b> on share of the AI answer at ${pct(sh[s])}; ${shSt.leader === s ? (rows[1] ? `${esc(brandLabel(rows[1][0]))} is next at ${pct(rows[1][1])}` : "no other brand is in scope") : `${esc(brandLabel(shSt.leader))} leads at ${pct(sh[shSt.leader])}`}.` }); }
  if (dir) reads.push({ tone: dir === "rises" ? "good" : dir === "falls" ? "risk" : "watch", text: `Share <b>${dir === "rises" ? "strengthens" : dir === "falls" ? "weakens" : "holds"} as shoppers get closer to buying</b>: ${pct(first.share)} at ${esc(first.label.toLowerCase())} (${stageRank(first)}) against ${pct(last.share)} at the ${esc(last.label.toLowerCase())} (${stageRank(last)}).` });
  if (tp.n) { const tSt = standing(tp.out, s); if (tSt) reads.push({ tone: tSt.rank === 1 ? "good" : tSt.rank === 2 ? "watch" : "risk", text: `Being named is not being recommended: ${SL} is the <b>single top pick in ${pct(tp.out[s])}</b> of the ${tp.n} answers that commit to one brand — ${rankPhrase(tp.out, s)}.` }); }
  if (engRows.length >= 2) { const firsts = [...S.engines].filter(e => { const st_ = standing(shareOf(AC.filter(a => a.engine === e)), s); return st_ && st_.rank === 1; }).length; reads.push({ tone: firsts === S.engines.size ? "good" : firsts ? "watch" : "risk", text: `${SL} <b>leads on ${firsts} of ${S.engines.size} engines</b>. Strongest on ${esc(engLabel(engBest[0]))} (${pct(engBest[1])}), weakest on ${esc(engLabel(engWorst[0]))} (${pct(engWorst[1])}) — the programme is engine-specific because the sources are.` }); }
  const hosts = hostStats(A, sb); const hostRows = Object.entries(hosts).sort((a, b) => b[1].n - a[1].n); const cTot = sum(hostRows.map(([, v]) => v.n)); const cNamed = sum(hostRows.map(([, v]) => v.named)); const top = hostRows[0];
  const owned = A.flatMap(a => a.sources || []).filter(x => x.kind === "owned").length;
  if (top) reads.push({ tone: top[1].named / top[1].n >= (cTot ? cNamed / cTot : 0) ? "good" : "watch", text: `The engines lean on <b>${esc(top[0])}</b> more than any other source (${top[1].n} citations across ${top[1].eng.size} engine${top[1].eng.size === 1 ? "" : "s"}); ${SL} is named in ${pct(top[1].named / top[1].n)} of the answers that cite it, against ${pct(cTot ? cNamed / cTot : null)} across all sources. ${SL}-owned pages are ${pct(cTot ? owned / cTot : null)} of citations — the answer is written from the review layer.` });
  const claims = A.flatMap(a => a.subjectClaims || []); const conflicts = claimConflicts(A);
  if (claims.length) reads.push({ tone: conflicts.length ? "watch" : "good", text: `The engines make <b>${claims.length} checkable claims about ${SL}</b> — prices, specs, awards, comparisons — and ${conflicts.length} of them conflict between engines on the same model and fact. ${SL} is the only party that can say which are true.` });
  const cr = D.crawlerAccess; if (cr) { const sonySites = cr.sites.filter(x => x.kind === subjectId()); const sonyBlocked = sonySites.flatMap(x => Object.values(x.bots || {})).filter(v => v.state === "blocked").length; const amazon = cr.sites.find(x => x.host.includes("amazon")); const amazonBlocked = amazon ? Object.values(amazon.bots || {}).filter(v => v.state === "blocked").length : 0; const bestbuy = cr.sites.find(x => x.host.includes("bestbuy")); const bbOpen = bestbuy ? Object.values(bestbuy.bots || {}).every(v => v.state !== "blocked") : null; reads.push({ tone: sonyBlocked ? "risk" : "good", text: `${sonySites.map(x => esc(x.host.replace(/^www\./, ""))).join(" and ")} ${sonyBlocked ? `<b>carry ${sonyBlocked} blocking rules</b> for AI crawlers` : "<b>leave every AI crawler open</b>"} in robots.txt.${amazon && amazonBlocked >= 8 ? ` Amazon blocks ${amazonBlocked} of ${Object.keys(amazon.bots || {}).length}, so ${SL}'s Amazon listings never reach ChatGPT or Perplexity${bbOpen ? " — Best Buy's do" : ""}.` : ""}` }); }
  if (drift && drift.prevShare != null && drift.curShare != null) { const d = drift.curShare - drift.prevShare; reads.push({ tone: d >= 0.005 ? "good" : d <= -0.005 ? "risk" : "watch", text: `Since ${esc(monthLabel(PREV.basis))}, like for like on the API path, ${SL}'s share moved from <b>${pct(drift.prevShare)} to ${pct(drift.curShare)}</b> and its presence from ${drift.prevPres.n}/${drift.prevPres.of} to ${drift.curPres.n}/${drift.curPres.of} questions; ${drift.gained.length} questions gained a ${SL} mention and ${drift.lost.length} lost one.` }); }
  const vol = volatilityRead(); if (vol) reads.push({ tone: vol.named >= 0.8 ? "good" : vol.named >= 0.6 ? "watch" : "risk", text: `Across ${vol.runs} passes of the volatility set, ${SL}'s presence holds on <b>${pct(vol.named)}</b> of question × engine pairs and the top pick on ${pct(vol.pick)} — a single pass is a sketch, which is why the production cadence is seven.` });
  const word = { good: "Strength", watch: "Watch", risk: "Risk" };
  $("ovReads").innerHTML = reads.map(r => `<div class="read ${r.tone}"><span class="rt">${word[r.tone]}</span><p>${r.text}</p></div>`).join("") || withheld("Nothing in scope to read.");
  $("ovFoot").innerHTML = `<span>Payload generated ${esc(D.generatedAt.slice(0, 16).replace("T", " "))} UTC</span><span>Every figure is computed in the browser from the captured answers; no superlative is typed.</span><span>BrandContext Atlas</span>`;
}

// ── engines ──────────────────────────────────────────────────────────────────
function renderEngines() {
  if (!$("engKpis")) return;   // the Engines page folded into the funnel page (2026-09-22); the renderer stays for any page that still hosts it
  const A = compareAnswers(); const s = subjectId(); const sb = S.brands.find(b => b.id === s); const bs = brandsOn();
  const per = [...S.engines].map(e => { const sa = A.filter(a => a.engine === e); return { e, sa, sh: shareOf(sa), pr: presenceOf(sa), tp: topPickShare(sa), ep: CUR.enginePaths?.[e] }; });
  $("engKpis").innerHTML = per.map(x => kpi({ label: engLabel(x.e), dot: sb.color, value: pct(x.sh[s]), rank: rankChip(x.sh, s), delta: `<span class="delta neu" title="${esc(x.ep?.why || x.ep?.via || "")}">${x.ep ? (x.ep.path === "ui" ? "consumer app" : "API path") : "measured"}</span>`, note: `${SL} named in ${x.pr[s]?.n ?? 0}/${x.pr[s]?.of ?? 0} · top pick in ${pct(x.tp.out[s])} of ${x.tp.n} committed answers`, onclick: `openEngineProof('${x.e}')` })).join("") || withheld("No engine selected.");
  const lead = (obj) => { const rows = Object.entries(obj).filter(([, v]) => v != null); const mx = Math.max(...rows.map(r => r[1])); return rows.filter(r => r[1] === mx).map(r => r[0]); };
  const all = shareOf(A);
  $("engScore").innerHTML = per.length ? `<div class="tblwrap"><table class="t"><thead><tr><th>Brand</th>${per.map(x => `<th class="num">${esc(engLabel(x.e))}</th>`).join("")}<th class="num">All engines</th></tr></thead><tbody>${bs.map(b => `<tr class="${b.id === s ? "subj" : ""}"><td><i class="sw" style="background:${b.color}"></i>${esc(b.label)}${b.custom ? ' <span class="note">text match</span>' : ""}</td>${per.map(x => `<td class="num" style="cursor:pointer" onclick="openEngineProof('${x.e}')">${lead(x.sh).includes(b.id) ? `<b>${pct(x.sh[b.id])}</b>` : pct(x.sh[b.id])}</td>`).join("")}<td class="num">${lead(all).includes(b.id) ? `<b>${pct(all[b.id])}</b>` : pct(all[b.id])}</td></tr>`).join("")}</tbody></table></div><div class="note" style="margin-top:8px">Bold = leads that engine. Share = presence × 1/position × favourability, normalised across the selected brands.</div>${compareFoot()}` : withheld("No engine selected.");
  const rows = per.filter(x => x.sh[s] != null).sort((a, b) => b.sh[s] - a.sh[s]); const firsts = per.filter(x => { const st = standing(x.sh, s); return st && st.rank === 1; }).length;
  $("engLead").innerHTML = rows.length ? `<b>${esc(D.subjectLabel)}'s share of the AI answer on the ${compareQueries().length} brand-neutral questions runs from ${pct(rows[rows.length - 1].sh[s])} on ${esc(engLabel(rows[rows.length - 1].e))} to ${pct(rows[0].sh[s])} on ${esc(engLabel(rows[0].e))}</b>; it leads on ${firsts} of ${per.length} engine${per.length === 1 ? "" : "s"}. The read uses ${esc(pathsSentence())} — the Scope panel says why each path was used.` : "No engine selected — switch one on from the Scope panel.";
}

// ── question bank ────────────────────────────────────────────────────────────
// the bank as a list: every question by stage, how many engines name Sony and pick it
function qbankHtml(openAll) {
  const A = activeAnswers(); const s = subjectId(); const sb = S.brands.find(b => b.id === s);
  return D.stages.filter(st => S.stagesOn.has(st.id)).map((st, i) => {
    const qs = activeQueries().filter(q => q.stage === st.id);
    const rows = qs.map(q => { const ans = A.filter(a => a.queryId === q.id); const named = ans.filter(a => mention(a, sb)).length; const picks = ans.map(a => a.topPick).filter(Boolean); return { q, n: ans.length, named, picks: picks.length, sonyPicks: picks.filter(p => p === s).length }; });
    const namedQ = rows.filter(r => r.named).length;
    return `<div class="qb ${openAll || i === 0 ? "open" : ""}"><div class="qbh" onclick="this.parentElement.classList.toggle('open')"><span>${esc(st.label)} <span class="mini">· ${esc(st.aida)}${isCompareStage(st.id) ? "" : ` · questions name ${SL}`}</span></span><span class="mini">${qs.length} question${qs.length === 1 ? "" : "s"} · ${SL} named in ${namedQ}</span></div><div class="qbl">${rows.map(r => `<div class="qi tap" onclick="openQuestion('${r.q.id}')"><span>${esc(r.q.text)}</span><span class="fx">${esc(r.q.focus)}</span><span class="n">${r.named}/${r.n} name ${SL}${r.picks ? ` · pick ${SL} ${r.sonyPicks}/${r.picks}` : ""}</span></div>`).join("") || '<div class="note" style="padding:8px 0">No questions on in this stage.</div>'}</div></div>`;
  }).join("") || withheld("Every stage is switched off.");
}
function renderQuestionBank() {
  const host = $("qbank"); if (host) host.innerHTML = qbankHtml(false);
  const dr = $("qbankDrawer"); if (dr) dr.innerHTML = qbankHtml(true);   // the drawer, if it is open, follows a scope change
}
// the bank opens from the top bar (Aashish, 2026-09-22) instead of taking a card on the funnel page
window.openQbank = () => { closeScope(); openDrawerWB("Question bank", `${activeQueries().length} of ${D.bank.length} questions in scope, by stage — how many engines name ${SL} and how many pick it. Tap a question for every engine's full answer; change the bank from Scope.`, `<div id="qbankDrawer">${qbankHtml(true)}</div>`); };
window.openQuestion = (id) => { const q = qById()[id]; if (!q) return; proof({ title: `“${q.text}”`, lede: `${esc(stageLabel(q.stage))} · ${esc(q.focus)} question · every engine's answer, the reader's extraction, and the receipt behind each.`, qids: [id] }); };

// ── catalogue coverage ───────────────────────────────────────────────────────
// One computation for the lens and the programme trigger. A model is named when the answer's
// text carries it; the reader's extracted product is a second route for spellings the pattern
// misses. The reader extracts ONE product per brand per answer, so an answer listing "S26, S26+
// and S26 Ultra" surfaced only one of them and the catalogue called the S26+ never named
// (2026-09-22). The line prefix ("Galaxy", "BRAVIA") is optional only for a lettered core
// ("S26+", "Z Fold 8"): a bare "8 II" would match any "8 II" in the text.
function catalogCoverage(A, sb, products) {
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const plEsc = rx(PL.toLowerCase());
  const labels = products.map(p => p.label.toLowerCase());
  const patFor = (lab) => {
    const coreRaw = lab.replace(new RegExp(`^${plEsc}\\s+`), ""); const core = rx(coreRaw).replace(/\s+/g, "\\s*"); const optional = coreRaw !== lab && /^[a-z]/.test(coreRaw);
    const longer = labels.filter(o => o !== lab && o.startsWith(lab + " ")).map(o => rx(o.slice(lab.length).trim()).replace(/\s+/g, "\\s*"));
    const stop = [...longer, "ii", "iii", "iv", "ultra", "plus", "\\+", "fe", "edge", "pro", "max", "mini"].filter(x => !lab.endsWith(" " + x.replace(/\\/g, "")));
    return new RegExp(`\\b${optional ? `(?:${plEsc}\\s*)?` : `${plEsc}\\s*`}${core}(?!\\w)(?!\\s*(?:${stop.join("|")})(?!\\w))`, "i");
  };
  return products.map(p => { const re = patFor(p.label.toLowerCase()); const hits = A.filter(a => { if (re.test(a.text || "")) return true; const m = mention(a, sb); return !!(m && m.product && re.test(m.product)); }); return { p, n: hits.length, qids: uniq(hits.map(a => a.queryId)), eng: uniq(hits.map(a => a.engine)) }; }).sort((a, b) => b.n - a.n);
}
function renderCatalog() {
  const A = activeAnswers(); const s = subjectId(); const sb = S.brands.find(b => b.id === s); const products = D.catalog?.products || [];
  if (!products.length) { $("catalog").innerHTML = withheld("No catalogue in the instance brief."); return; }
  const rows = catalogCoverage(A, sb, products);
  // the reader's extracted products still drive the "models the brief does not list" read
  const named = []; for (const a of A) { const m = mention(a, sb); if (m && m.product) named.push({ p: m.product.toLowerCase().replace(/\s+/g, " ").trim(), engine: a.engine, qid: a.queryId }); }
  const labels = products.map(p => p.label.toLowerCase());
  const covered = rows.filter(r => r.n).length; const never = rows.filter(r => !r.n).map(r => r.p.label);
  // models the engines name that the brief does not list — a computed observation for Sony to confirm, not a verdict
  const canon = (p) => canonModel(s, p);
  const outside = {}; for (const x of named) { const c = canon(x.p); if (!c) continue; if (labels.includes(c.toLowerCase())) continue; outside[c] = (outside[c] || 0) + 1; }
  const outRows = byDesc(outside);
  $("catalog").innerHTML = `<div class="tblwrap"><table class="t"><thead><tr><th>Model</th><th>Family</th><th class="num">Launch MSRP</th><th class="num">Named</th><th class="num">Engines</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.n ? "tap" : ""}" ${r.n ? `onclick="openModelProof(${JSON.stringify(r.qids).replace(/"/g, "&quot;")}, '${esc(r.p.label)}')"` : ""}><td style="white-space:nowrap"><b>${esc(r.p.label)}</b></td><td class="note">${esc(r.p.family || "")}</td><td class="num">${r.p.msrp ? "$" + r.p.msrp.toLocaleString() : "—"}</td><td class="num">${r.n ? r.n : '<span class="tag risk">never</span>'}</td><td class="num">${r.eng.length ? r.eng.map(e => esc(engLabel(e))).join(", ") : "—"}</td></tr>`).join("")}</tbody></table></div>
    <div class="sowhat"><span class="lab">So what</span>The engines name <b>${covered} of ${products.length}</b> models in the brief${never.length ? `; never named: <b>${never.map(esc).join(", ")}</b>` : ""}.${outRows.length ? ` They also name models the brief does not list — ${outRows.slice(0, 4).map(([k, v]) => `<b>${esc(k)}</b> (${v})`).join(", ")} — for ${SL} to confirm against the current line-up: the engines may be ahead of the brief, or wrong.` : ""}</div>`;
}
window.openModelProof = (qids, label) => proof({ title: `${label} · every answer that names it`, lede: `${qids.length} questions where at least one engine names the ${label}.`, qids });

// ── page leads for sources, products, change ─────────────────────────────────
function renderPageLeads() {
  const A = activeAnswers(); const s = subjectId(); const sb = S.brands.find(b => b.id === s); const bs = brandsOn();
  // sources
  const hosts = hostStats(A, sb); const hostRows = Object.entries(hosts).sort((a, b) => b[1].n - a[1].n); const cTot = sum(hostRows.map(([, v]) => v.n)); const top3 = hostRows.slice(0, 3); const top3N = sum(top3.map(([, v]) => v.n));
  const kinds = {}; for (const a of A) for (const x of (a.sources || [])) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  $("srcLead").innerHTML = cTot ? `The engines cite <b>${hostRows.length} distinct domains</b> across the answers in scope, and ${top3.map(([h]) => esc(h)).join(", ")} carry ${pct(top3N / cTot)} of all ${cTot} citations. ${SL}-owned pages are ${pct((kinds.owned || 0) / cTot)}; editorial reviews ${pct((kinds.editorial || 0) / cTot)}; retailers ${pct((kinds.retailer || 0) / cTot)}. The answer is written from the review layer, so that is where the programme spends its effort.` : "No citations in scope.";
  // products — models folded to one spelling each, on the brand-neutral base
  const prods = {}; for (const a of compareAnswers()) for (const b of bs) { const m = mention(a, b); if (m && m.product) { const raw = m.product.replace(/\s+/g, " ").trim(); const k = `${b.id}|${canonModel(b.id, raw) || raw}`; prods[k] = (prods[k] || 0) + 1; } } const prodRows = byDesc(prods); const sonyRows = prodRows.filter(([k]) => k.startsWith(s + "|"));
  const tp = topPickShare(compareAnswers()); const vsA = A.filter(a => activeQueries().some(x => x.id === a.queryId && x.focus === "vs")); const vsWin = vsA.filter(a => a.topPick === s).length; const vsNone = vsA.filter(a => !a.topPick).length;
  if ($("prodLead")) $("prodLead").innerHTML = A.length ? `${SL} is the single top pick in <b>${pct(tp.out[s])}</b> of the ${tp.n} brand-neutral answers that commit to one brand — ${standingPhrase(tp.out, s)}${vsA.length ? ` — and wins <b>${vsWin} of ${vsA.length}</b> head-to-head answers, with ${vsNone} giving no verdict` : ""}. ${prodRows[0] ? `The most-named model on those questions is <b>${esc(prodRows[0][0].split("|")[1])}</b> (${esc(brandLabel(prodRows[0][0].split("|")[0]))}, ${prodRows[0][1]} answers)${sonyRows[0] ? `; ${SL}'s is ${esc(sonyRows[0][0].split("|")[1])} (${sonyRows[0][1]})` : ""}.` : ""} Every bar and cell on this page opens to the questions and answers behind it.` : "No answers in scope.";
  // attributes — the page lead is computed from the same cells as the heat map
  if ($("attrLead")) { const attrs = D.attrs; const net = (bid, at) => { let n = 0; for (const a of A) for (const x of (a.attributes?.[bid] || [])) if (x.attr === at) n += x.polarity === "-" ? -1 : 1; return n; };
    const sonyNet = attrs.map(at => [at, net(s, at)]).sort((x, y) => y[1] - x[1]); const negs = sonyNet.filter(x => x[1] < 0);
    const leadBy = attrs.map(at => { const rows = bs.map(b => [b.id, net(b.id, at)]).sort((x, y) => y[1] - x[1]); return { at, leader: rows[0][0], gap: rows[0][1] - net(s, at) }; }).filter(x => x.leader !== s && x.gap > 0).sort((x, y) => y.gap - x.gap);
    const tagged = A.filter(a => (a.attributes?.[s] || []).length).length;
    $("attrLead").innerHTML = A.length ? `Across the ${A.length} answers in scope, ${tagged} attach at least one attribute to ${SL}. The engines credit ${SL} most with <b>${esc(sonyNet[0][0])}</b> (net ${sonyNet[0][1] > 0 ? "+" : ""}${sonyNet[0][1]}) and <b>${esc(sonyNet[1][0])}</b> (${sonyNet[1][1] > 0 ? "+" : ""}${sonyNet[1][1]}); ${negs.length ? `its net-negative attribute${negs.length === 1 ? " is" : "s are"} ${negs.map(x => `<b>${esc(x[0])}</b> (${x[1]})`).join(", ")}` : "no attribute nets negative"}. ${leadBy.length ? `Rivals lead on ${leadBy.slice(0, 3).map(x => `${esc(x.at)} (${esc(brandLabel(x.leader))}, +${x.gap})`).join(", ")}.` : ""} Tap any cell for the answers behind it, with the sentences that carry the judgement.` : "No answers in scope."; }
  // claims
  if ($("claimsLead")) { const claims = A.flatMap(a => a.subjectClaims || []); const conflicts = claimConflicts(A); const checkable = claims.filter(c => c.value).length; const types = byDesc(claims.reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {}));
    $("claimsLead").innerHTML = claims.length ? `The engines make <b>${claims.length} statements about ${SL}</b> across the answers in scope — ${types.slice(0, 3).map(([t, n]) => `${n} on ${esc(t)}`).join(", ")} — and ${checkable} carry a value ${SL} can check. <b>${conflicts.length} model-and-fact pairs conflict</b> between engines, so on those at least one engine is wrong today. Filter on the left, read on the right; every row opens to the answer it came from.` : "No claims in scope."; }
  // change
  const drift = PREV && DTO ? driftSummary() : null; const vol = volatilityRead();
  const parts = [];
  if (drift && drift.prevShare != null && drift.curShare != null) parts.push(`On the like-for-like API path, <b>${SL}'s share moved from ${pct(drift.prevShare)} in ${esc(monthLabel(PREV.basis))} to ${pct(drift.curShare)} in ${esc(monthLabel(DTO.basis))}</b> on the same ${compareQueries().length} brand-neutral questions, engines and reader.`);
  if (vol) parts.push(`Across ${vol.runs} same-day passes, ${SL}'s presence holds on ${pct(vol.named)} of question × engine pairs and the top pick on ${pct(vol.pick)} — treat single-run differences under that spread as noise.`);
  $("chgLead").innerHTML = parts.join(" ") || "The second capture and the volatility passes are still running; this page fills in when they land.";
}

// ── evidence ─────────────────────────────────────────────────────────────────
function renderEvidencePage() {
  const A = CUR.answers; const s = subjectId(); const sb = S.brands.find(b => b.id === s);
  const gpt = A.filter(a => a.engine === "gpt" && a.evidence?.image); const gem = A.filter(a => a.engine === "gemini" && a.evidence?.image);
  const ws = gpt.filter(a => a.evidence.webSearchTriggered).length, shop = gpt.filter(a => a.evidence.shoppingVisible).length;
  const gemModels = uniq(gem.map(a => a.evidence.appModel).filter(Boolean));
  const apiA = A.filter(a => a.path !== "ui"); const apiRows = uniq(apiA.map(a => `${engLabel(a.engine)}: ${a.evidence?.model || "API"}`));
  $("evKpis").innerHTML =
    kpi({ label: "Real sessions on file", value: String(gpt.length + gem.length), note: `ChatGPT ${gpt.length} and Gemini ${gem.length} page captures, rendered as images with a fingerprint of the answer text` }) +
    kpi({ label: "ChatGPT ran a web search", value: String(ws), unit: `/ ${gpt.length}`, note: `answers where the app triggered search; the shopping module was on screen in ${shop}` }) +
    kpi({ label: "Gemini sessions", value: String(gem.length), note: gemModels.length ? `the app reported ${esc(gemModels.join(", "))}` : "app model not reported" }) +
    kpi({ label: "API-path answers", value: String(apiA.length), note: apiRows.map(esc).join(" · ") || "none — every answer came from a consumer session" });
  const samples = [D.bank.find(q => q.stage === "awareness"), D.bank.find(q => q.stage === "evaluation" && q.focus === "vs"), D.bank.find(q => q.stage === "decision")].filter(Boolean);
  $("evHow").innerHTML = samples.map(q => `<div class="qblock" style="margin-bottom:10px"><div class="qt">“${esc(q.text)}”</div><div class="qm">${esc(stageLabel(q.stage))} · ${esc(q.focus)} question</div>${askRow(q.text, true)}</div>`).join("") + `<div class="note">Gemini has no prefill link — paste the question. Every question in the bank carries the same links on its receipt.</div>`;
  const bundle = D.evidenceSummary?.bundle || [];
  $("evBundle").innerHTML = bundle.length ? `<table class="t"><thead><tr><th>File</th><th class="num">Size</th></tr></thead><tbody>${bundle.map(b => `<tr><td><a href="${esc(b.path)}" download style="color:var(--accent);font-weight:600;text-decoration:none">${esc(b.file)}</a></td><td class="num">${Math.round(b.bytes / 1024)} KB</td></tr>`).join("")}</tbody></table><div class="note" style="margin-top:10px">Every answer carries a SHA-256 of its text; the same fingerprint is in the raw files, so any figure on this console can be recomputed and matched.</div>` : withheld("No bundle published with this payload.");
  const engs = [...S.engines]; const qs = activeQueries();
  $("evBrowse").innerHTML = `<div class="tblwrap tall"><table class="t"><thead><tr><th>Stage</th><th>Question</th>${engs.map(e => `<th>${esc(engLabel(e))}</th>`).join("")}</tr></thead><tbody>${qs.map(q => { const ans = A.filter(a => a.queryId === q.id && a.run === 1); return `<tr class="tap" onclick="openQuestion('${q.id}')"><td class="note">${esc(stageLabel(q.stage))}</td><td>${esc(q.text)}</td>${engs.map(e => { const a = ans.find(x => x.engine === e); if (!a) return '<td class="note">—</td>'; const named = !!mention(a, sb); return `<td><span class="evpill ${a.evidence?.image ? "ui" : "api"}" title="${esc(PATH_LABEL[a.path] || a.path || "")}${a.evidence?.capturedAt ? " · " + esc(fmtTime(a.evidence.capturedAt)) : ""}">${a.evidence?.image ? "session" : "API"}${named ? ` · ${SL}` : ""}</span></td>`; }).join("")}</tr>`; }).join("")}</tbody></table></div><div class="note" style="margin-top:8px">“session” = a real consumer-app session with its page image on file; “API” = the engine's API with web search, with the model id. “${SL}” marks answers where ${SL} is named.</div>`;
}
const pctW = (x, d = 0) => x == null || Number.isNaN(x) ? "—" : Number(x).toFixed(d) + "%";
const n0 = (x) => x == null ? "—" : Math.round(x).toLocaleString("en-US");
const usd = (x) => x == null ? "—" : "$" + Math.round(x).toLocaleString("en-US");
const fmtShort = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

let WB = null, W = 8;
const SUBJ = () => WB.meta.subject;
const wbBrand = (id) => WB.dims.brands.find(b => b.id === id) || { label: id, color: "#80868b" };
const week = (n = W) => WB.dims.weeks[n];
const wk = (arr, n = W) => arr.find(x => x.week === n) || arr[n];
const at = (series, n = W) => series[Math.min(n, series.length - 1)];
const isMeasured = (n = W) => n === 0;
const tagFor = (n = W) => isMeasured(n) ? `<span class="tag good">Measured · week 0</span>` : `<span class="tag warn">Modelled · week ${n}</span>`;

// ── computed superlatives ────────────────────────────────────────────────────
const wbDelta = (a, b, unit = " pts", invert = false) => { if (a == null || b == null) return ""; const d = b - a; const good = invert ? d < 0 : d > 0; const cls = Math.abs(d) < 0.05 ? "flat" : good ? "up" : "dn"; return `<span class="delta ${cls}">${d > 0 ? "▲" : d < 0 ? "▼" : "•"} ${Math.abs(d).toFixed(unit === " pts" ? 1 : 0)}${unit} since week 0</span>`; };

// ── workbench shell pieces (the rail, routing and pages are the console's) ──
function cardW(o) { return `<section class="card${o.cls ? " " + o.cls : ""}"${o.id ? ` id="${o.id}"` : ""}><div class="card-h"><div class="ct"><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.tag ? `<div class="ca">${o.tag}</div>` : ""}</div>${o.atlas ? atlasStrip(o.atlas) : ""}${o.slot ? `<div id="${o.slot}"></div>` : ""}${o.html || ""}</section>`; }
function kpiW(o) { return `<div class="kpi${o.onclick ? " tap" : ""}"${o.onclick ? ` onclick="${o.onclick}" role="button" tabindex="0"` : ""}><div class="kl">${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ""}${esc(o.label)}</div><div class="kv">${o.value}${o.unit ? `<small>${o.unit}</small>` : ""}</div><div class="kf">${o.delta || ""}${o.rank || ""}${o.tag || ""}</div>${o.note ? `<div class="kn">${o.note}</div>` : ""}</div>`; }
const atlasStrip = (lanes) => `<div class="atlas"><span class="al">Atlas feeds this</span>${lanes.length ? lanes.map(l => `<span class="lane"><i></i>${esc(l)}</span>`).join("") : '<span class="lane none"><i></i>AI lane only — no Atlas join</span>'}</div>`;
const stageChip = (s, list) => { const i = list.indexOf(s); return `<span class="stage ${s === "planned" ? "planned" : "s" + Math.min(4, i + 1)}">${esc(s)}</span>`; };
const verdictChip = (v) => `<span class="verdict ${v.replace(/\s+/g, "-")}">${esc(v)}</span>`;
const wkline = (series, n = W, invert = false) => { const mx = Math.max(...series.filter(v => v != null), 1); return `<div class="wkline" title="week by week">${series.map((v, i) => `<i class="${i <= n ? "on" : ""} ${i === WB.meta.pilotEndWeek ? "pilot" : ""}" style="height:${Math.max(8, (invert ? (1 - v / mx) : v / mx) * 100)}%"></i>`).join("")}</div>`; };
const tbl = (cols, rows, opts = {}) => `<div class="tblwrap ${opts.tall ? "tall" : ""}"><table class="t ${opts.cls || ""}"><thead><tr>${cols.map(c => `<th class="${c.num ? "num" : ""}">${c.label}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr class="${r._cls || ""}" ${r._onclick ? `onclick="${r._onclick}" style="cursor:pointer"` : ""}>${cols.map(c => `<td class="${c.num ? "num" : ""} ${c.wrap ? "wrap" : ""}">${c.get(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const phaseBar = () => `<div class="phasebar">${WB.dims.weeks.map(w => `<span class="${w.phase.replace(/[^a-z]/g, "")} ${w.n === W ? "now" : ""}" title="${esc(w.label)} · ${esc(w.phase)}"></span>`).join("")}</div><div class="phaselab"><span>W0 baseline</span><span>W8 pilot end</span><span>W12</span></div>`;
const laneNote = (s) => `<div class="note" style="margin-top:8px">${s}</div>`;
const sowhat = (s) => `<div class="sowhat"><span class="lab">So what</span>${s}</div>`;

// ── drawer ───────────────────────────────────────────────────────────────────
function openDrawerWB(title, sub, html) { $("drTitle2").textContent = title; $("drSub2").textContent = sub || ""; $("drBody2").innerHTML = html; $("drawer2").classList.add("on"); $("scrim").classList.add("on"); $("drX2").focus(); }
function closeDrawerWB() { $("drawer2").classList.remove("on"); $("scrim").classList.remove("on"); if (window.CC) CC.hideTip(); }
window.openDeliverable = (id) => { const d = WB.deliverables.find(x => x.id === id); if (!d) return; const rows = WB.dims.weeks.map(w => ({ w, v: d.series[w.n] })); openDrawerWB(d.label, `${d.group} · ${d.owner} · ${d.cadence}`, `<div class="prose sm"><p>${esc(d.what)}</p></div>${atlasStrip(d.atlas)}<div class="grid2" style="gap:10px;margin-bottom:12px"><div class="stat static"><div class="k">Baseline</div><div class="v">${d.start ?? "—"}<small>${esc(d.unit)}</small></div></div><div class="stat static"><div class="k">Target</div><div class="v">${d.target ?? "—"}<small>${esc(d.unit)}</small></div></div></div>${tbl([{ label: "Week", get: r => `${esc(r.w.label)} <span class="kv-note">${fmtShort(r.w.date)}</span>` }, { label: d.kpi, num: true, get: r => `${r.v ?? "—"}${r.w.n === 0 ? ' <span class="tag good">measured</span>' : ""}` }], rows)}<p class="note" style="margin-top:10px">Week 0 is measured; every later week is the simulation.</p>`); };
window.openClaim = (id) => { const r = WB.truthSet.price.rows.find(x => x.id === id); if (!r) return; const c = WB.truthSet.corrections.find(x => x.id === id); openDrawerWB(`${r.product} · ${usd(r.value)}`, `${esc(wbBrand(r.engine).label || r.engine)} · claim ${r.id}`, `<div class="prose sm"><p>“${esc(r.claim)}”</p><p>Asked as: <i>${esc(r.question)}</i></p></div><p><b>Atlas verdict</b> ${verdictChip(r.verdict)}</p><p class="note">${esc(r.detail)}</p><p class="note"><b>Cited sources:</b> ${r.hosts.map(esc).join(", ") || "none returned"}</p>${c ? `<p class="note"><b>Correction:</b> filed week ${c.filedWeek}${c.confirmedWeek != null ? `, confirmed on re-read week ${c.confirmedWeek}` : ", not yet confirmed by week 12"} (simulated).</p>` : ""}`); };
window.openPlacement = (host) => { const p = WB.sources.pipeline.find(x => x.host === host); if (!p) return; openDrawerWB(host, `${p.kind} · ${p.citations} citations · ${SL} named in ${p.namedRate}%`, `<div class="prose sm"><p><b>The ask.</b> ${esc(p.ask)}.</p><p><b>What Atlas brings to the pitch.</b> ${esc(p.evidence)}.</p></div>${tbl([{ label: "Week", get: r => esc(r.w.label) }, { label: "Stage", get: r => stageChip(r.s, WB.dims.stagesPlacement) }], WB.dims.weeks.map(w => ({ w, s: p.weekly[w.n] })))}<p class="note" style="margin-top:10px">Stages after week 0 are simulated.</p>`); };

// ── pages ────────────────────────────────────────────────────────────────────
const TPL_WB = {
  scorecard: () => `${intro('<span id="scLead">—</span>', `<div class="ovcap" style="min-width:300px"><div class="k">Programme clock</div><div class="v" id="scClock">—</div><div id="scPhase">${phaseBar()}</div></div>`)}
    <div class="grid g4" id="scKpis"></div>
    <div class="grid g2">${cardW({ title: "Ledger A · What We Control", sub: "Deliverables the programme guarantees. Each is a closed item a buyer can audit: baseline, where it stands as of the selected week, target.", tag: '<span class="tag acc">Pilot criteria</span>', slot: "scLedgerA" })}${cardW({ title: "Ledger B · Outcomes With the Band", sub: "The engine-side measures, reported with the sampling band the volatility read gives. A move counts only when it clears the band.", tag: '<span class="tag acc">Reported honestly</span>', slot: "scLedgerB" })}</div>
    <h2 class="sec">The Read</h2><div class="reads" id="scReads"></div>
    <h2 class="sec">Where Atlas Does the Work</h2><div class="grid g3" id="scAtlas"></div>
    <div class="foot" id="scFoot"></div>`,
  baseline: () => `${intro('<span id="blLead">—</span>')}
    <div class="grid g4" id="blKpis"></div>
    <div class="grid g2">${cardW({ title: "Share by Funnel Stage", sub: "Weighted share of the AI answer per stage, every brand. Measured at week 0.", tag: '<span class="tag good">Measured</span>', slot: "blFunnel" })}${cardW({ title: "Share by Engine", sub: "The same share per engine. The programme is engine-specific because the sources are.", tag: '<span class="tag good">Measured</span>', slot: "blEngines" })}</div>
    <div class="grid g2">${cardW({ title: "Sampling Plan", sub: "One pass per question is a sketch; seven passes per question per day is the published threshold for a stable brand estimate. The band is what the volatility read measured for this bank.", atlas: [], slot: "blSampling" })}${cardW({ title: "Question Bank & Demand Weights", sub: "The bank by stage, and how many questions carry a demand weight from retail search terms and site search as of the selected week.", atlas: ["Retail search terms", "Web traffic"], slot: "blBank" })}</div>`,
  truthset: () => `${intro('<span id="tsLead">—</span>')}
    <div class="grid g4" id="tsKpis"></div>
    ${cardW({ title: "Price Claims Against the Atlas Ladder", sub: `Every price the engines put on a ${PL}, checked against the shelf price Atlas holds per retailer and its history. Tap a row for the claim, the question and the cited sources.`, tag: '<span class="tag warn">Verdicts modelled on the re-based Atlas ladder</span>', atlas: ["Pricing", "Catalogue"], slot: "tsTable" })}
    <div class="grid g2">${cardW({ title: "Specs, Awards and Comparisons", sub: "Claims that are not prices: the product team signs them off against the truth-set. The split shown is the simulation's.", tag: '<span class="tag warn">Modelled</span>', atlas: ["Catalogue"], slot: "tsOther" })}${cardW({ title: "Correction Pipeline", sub: "Each wrong or stale claim traced to the page the engine cited, a correction filed there, and confirmed when a re-read returns the true value.", tag: '<span class="tag warn">Modelled after week 0</span>', atlas: ["Pricing"], slot: "tsPipe" })}</div>
    ${cardW({ title: "Corrections by Week", sub: "Corrections filed at the cited page, and corrections confirmed when a re-read returns the true value.", slot: "tsLine" })}`,
  access: () => `${intro('<span id="acLead">—</span>')}
    <div class="grid g4" id="acKpis"></div>
    <div class="grid g2">${cardW({ title: "Crawler Access", sub: "robots.txt of the brand's own domains and the retailers that carry it, against the crawlers each engine uses for search. A blocked search crawler means that site cannot be cited by that engine at all.", tag: '<span class="tag good">Measured</span>', atlas: [], slot: "acCrawl" })}${cardW({ title: "Access Findings", sub: "What the audit found and where each finding stands as of the selected week.", atlas: [], slot: "acFind" })}</div>
    ${cardW({ title: "Feed Audit Against the Shelf", sub: `Every ${PL} listing Atlas tracks: the price and stock on the shelf beside what the merchant feed says. Shopping surfaces read the feed, so a mismatch is a wrong answer waiting to be written.`, tag: '<span class="tag warn">Feed values modelled; shelf from Atlas</span>', atlas: ["Pricing", "Availability", "Carriage"], slot: "acFeed" })}`,
  listing: () => `${intro('<span id="lsLead">—</span>')}
    ${cardW({ title: "Readiness by Retailer", sub: "Whether the engines can read the retailer at all, how much of the line-up it carries, how often it is in stock, how complete the PDPs are, and the price index. Readiness combines them; a blocked retailer scores zero however good its pages.", tag: '<span class="tag warn">Readability measured; the rest from Atlas</span>', atlas: ["PDP content", "Carriage", "Availability", "Pricing"], slot: "lsTable" })}
    <div class="grid g2">${cardW({ title: "Where the Listing Work Lands", sub: `The PDP fields Atlas scores on the readable retailer with the most weight, average across the ${PL} line-up.`, atlas: ["PDP content"], slot: "lsFields" })}${cardW({ title: "Readiness by Week", sub: "Readiness per retailer as the listing content lands.", atlas: ["PDP content"], slot: "lsLine" })}</div>`,
  catalogue: () => `${intro('<span id="ctLead">—</span>')}
    ${cardW({ title: "The Line-Up Against the Engines", sub: `Each ${PL} family Atlas tracks: where it is carried, its shelf weight, stock and page quality, and how often the engines name it. Priority is shelf weight × the share of questions where it is never named.`, tag: '<span class="tag warn">Naming measured at week 0; shelf from Atlas</span>', atlas: ["Carriage", "Shelf share", "Availability", "Pricing", "PDP content"], slot: "ctTable" })}
    <div class="grid g2">${cardW({ title: "Presence Priority", sub: "Which families the programme works on first.", slot: "ctPrio" })}${cardW({ title: "Named by Week", sub: "Mentions per family as the content and placements land.", slot: "ctLine" })}</div>`,
  sources: () => `${intro('<span id="soLead">—</span>')}
    <div class="grid g4" id="soKpis"></div>
    <div class="grid g2">${cardW({ title: "The Sources That Write the Answer", sub: `The most-cited domains in the capture, how many engines cite them, and how often ${SL} is named in the answers that cite them.`, tag: '<span class="tag good">Measured</span>', atlas: [], slot: "soTop" })}${cardW({ title: "Placement Pipeline", sub: `The gap list, worked. Each target is cited most where ${SL} is absent; the ask and the Atlas evidence for the pitch are beside it. Tap a row for the week-by-week stage.`, tag: '<span class="tag warn">Stages modelled after week 0</span>', atlas: ["Voice of Customer", "Pricing"], slot: "soPipe" })}</div>
    ${cardW({ title: `${SL} Named on the Top-Five Sources`, sub: "The named rate across the five most-cited domains, week by week.", slot: "soLine" })}`,
  content: () => `${intro('<span id="cnLead">—</span>')}
    <div class="grid g4" id="cnKpis"></div>
    ${cardW({ title: "Attributes to Argue", sub: "Where rivals lead the engines' framing, beside what real buyers say in reviews. A gap in the engines that buyers do not share is a content brief; a gap buyers share is a product note.", tag: '<span class="tag warn">Engine side measured; buyer side from Atlas</span>', atlas: ["Voice of Customer"], slot: "cnArgue" })}
    <div class="grid g2">${cardW({ title: "Comparison Pages", sub: "One page per head-to-head question, with a live price table and review evidence. Today's pick per engine is measured; the status is the simulation.", atlas: ["Pricing", "Voice of Customer", "Catalogue"], slot: "cnPages" })}${cardW({ title: "Use-Case Guides", sub: "The questions shoppers ask before they know the model, argued with what buyers say.", atlas: ["Voice of Customer"], slot: "cnGuides" })}</div>`,
  community: () => `${intro('<span id="cmLead">—</span>')}
    <div class="grid g4" id="cmKpis"></div>
    <div class="grid g2">${cardW({ title: "Community Sources in the Capture", sub: `YouTube and Reddit domains the engines cited, and how often ${SL} was named in those answers.`, tag: '<span class="tag good">Measured</span>', slot: "cmHosts" })}${cardW({ title: "Video and Thread Pipeline", sub: "Transcripts, chapter titles and thread answers; each carries review-aspect evidence from Atlas.", tag: '<span class="tag warn">Modelled after week 0</span>', atlas: ["Voice of Customer"], slot: "cmPipe" })}</div>`,
  shopping: () => `${intro('<span id="shLead">—</span>')}
    <div class="grid g4" id="shKpis"></div>
    ${cardW({ title: "Can the Recommendation Be Fulfilled?", sub: `For each ${PL} family: where it is carried, whether it is in stock, the shelf price, and whether the engines can read that retailer. A recommendation that points to a blocked or out-of-stock listing is a lost sale the engine cannot see.`, tag: '<span class="tag warn">Shelf from Atlas; feed completeness modelled</span>', atlas: ["Carriage", "Availability", "Pricing"], slot: "shTable" })}
    ${cardW({ title: "Fulfilment and Feed Completeness by Week", sub: "Recommendations fulfillable where the engine points, and merchant-feed completeness, as the feed work lands.", slot: "wbShLine" })}`,
  trajectory: () => `${intro('<span id="trLead">—</span>')}
    <div class="grid g5" id="trKpis"></div>
    ${cardW({ title: "Share of AI Answer by Week", sub: `${SL} against the set. Week 0 is measured; the rest is drawn inside the sampling band. The dotted region is the pilot.`, tag: '<span class="tag warn">Modelled after week 0</span>', slot: "wbTrLine" })}
    ${cardW({ title: "Every Outcome by Week", sub: "The five outcome series with the band. A cell in bold has cleared the seven-pass band against week 0.", slot: "trTable" })}`,
  deliverables: () => `${intro('<span id="dlLead">—</span>')}
    ${cardW({ title: "The AEO Process, Item by Item", sub: "Every deliverable the programme runs: what it is, which Atlas lane feeds it, who owns it, its cadence, and where its measure stands as of the selected week. Tap a row for the week-by-week series.", slot: "dlTable" })}`,
  method: () => `${intro('<span id="mtLead">—</span>')}
    ${cardW({ title: "What This Workbench Is", html: `<div class="prose sm" id="mtBody"></div>` })}
    ${cardW({ title: "The Anchor Ledger", sub: "Lane by lane: what was actually measured, the capture it came from, and which part of the simulation it pins. A lane with no anchor is marked as such rather than left looking like the rest.", tag: '<span class="tag acc">Read this first</span>', slot: "mtAnchors" })}
    ${cardW({ title: "How Atlas Feeds Each Deliverable", sub: "The join, deliverable by deliverable.", slot: "mtJoin" })}
    ${cardW({ title: "The Products This Sits Beside", html: `<div class="prose sm" id="mtLinks"></div>` })}`,
};

// ── renderers ────────────────────────────────────────────────────────────────
function renderScorecard() {
  const s = SUBJ(); const T = WB.trajectory.series; const w = week(); const A = WB.ledger.A, B = WB.ledger.B;
  const shareNow = at(T.share.data), presNow = at(T.presence.data), pickNow = at(T.topPick.data), h2hNow = at(T.h2hWin.data);
  const shareSet = Object.fromEntries([[s, shareNow], ...Object.entries(WB.trajectory.rivalShare).map(([b, v]) => [b, at(v)])]);
  const doneA = WB.deliverables.filter(d => d.invert ? at(d.series) <= d.target : at(d.series) >= d.target).length;
  const clearedB = Object.values(T).filter(x => Math.abs(at(x.data) - x.data[0]) > WB.trajectory.bands.sevenPass).length;
  $("scLead").innerHTML = W === 0 ? `<b>Week 0 is the measured baseline.</b> ${esc(WB.meta.subjectLabel)} holds ${pctW(shareNow, 1)} of the weighted AI answer — ${standingPhrase(shareSet, s, "brands")} — and is named in ${WB.baseline.presence[s].n} of ${WB.baseline.presence[s].of} questions. Everything after this week is the simulated programme; move the week to see it.` : `<b>As of ${esc(w.label.toLowerCase())} (${esc(fmtDate(w.date))}), the simulation has closed ${doneA} of ${WB.deliverables.length} controlled deliverables</b> and ${clearedB} of ${Object.keys(T).length} outcome measures have moved beyond the ±${WB.trajectory.bands.sevenPass}-point sampling band. ${SL}'s share of the AI answer reads ${pctW(shareNow, 1)} (${rankPhrase(shareSet, s)}), against ${pctW(T.share.data[0], 1)} measured at week 0.`;
  $("scClock").textContent = `${w.label} · ${fmtDate(w.date)}`; $("scPhase").innerHTML = phaseBar();
  $("scKpis").innerHTML = kpiW({ label: T.share.label, dot: wbBrand(s).color, value: pctW(shareNow, 1), rank: rankChip(shareSet, s), delta: W ? wbDelta(T.share.data[0], shareNow) : "", tag: W ? "" : '<span class="tag good">measured</span>', note: `band ±${WB.trajectory.bands.sevenPass} pts at seven passes` }) + kpiW({ label: "Named in", dot: wbBrand(s).color, value: pctW(presNow, 0), unit: "of questions", delta: W ? wbDelta(T.presence.data[0], presNow) : "", note: `${WB.baseline.presence[s].n} of ${WB.baseline.presence[s].of} at week 0` }) + kpiW({ label: "Top-pick share", dot: wbBrand(s).color, value: pctW(pickNow, 1), delta: W ? wbDelta(T.topPick.data[0], pickNow) : "", note: `of ${WB.baseline.topPick.n} answers that commit to one brand at week 0` }) + kpiW({ label: "Head-to-head win rate", dot: wbBrand(s).color, value: pctW(h2hNow, 0), delta: W ? wbDelta(T.h2hWin.data[0], h2hNow) : "", note: `${WB.baseline.h2h.win} of ${WB.baseline.h2h.n} answers at week 0; ${WB.baseline.h2h.undecided} undecided` });
  $("scLedgerA").innerHTML = tbl([{ label: "Deliverable", get: r => `<b>${esc(r.label)}</b><div class="kv-note">${esc(r.group)} · ${esc(r.kpi)}</div>` }, { label: "Base", num: true, get: r => r.baseline ?? "—" }, { label: `W${W}`, num: true, get: r => `<b>${at(WB.deliverables.find(d => d.id === r.id).series) ?? "—"}</b>` }, { label: "Target", num: true, get: r => r.target ?? "—" }, { label: "", get: r => { const d = WB.deliverables.find(x => x.id === r.id); const v = at(d.series); const ok = d.invert ? v <= d.target : v >= d.target; return `<span class="${ok ? "done" : "open"}">${ok ? "done" : "open"}</span>`; } }], A.map(r => ({ ...r, _onclick: `openDeliverable('${r.id}')` })), { cls: "ledger" }) + laneNote(`${doneA} of ${A.length} closed as of ${esc(w.label.toLowerCase())}; the pilot's own line is week ${WB.meta.pilotEndWeek}. Tap a row for the series.`);
  $("scLedgerB").innerHTML = tbl([{ label: "Outcome", get: r => `<b>${esc(r.label)}</b><div class="kv-note">${esc(r.unit)}</div>` }, { label: "W0", num: true, get: r => pctW(r.baseline, 1) }, { label: `W${W}`, num: true, get: r => `<b>${pctW(at(T[r.id].data), 1)}</b>` }, { label: "Change", num: true, get: r => { const d = at(T[r.id].data) - r.baseline; return `${d >= 0 ? "+" : ""}${d.toFixed(1)}` } }, { label: "Band", num: true, get: r => `<span class="band">±${r.band}</span>` }, { label: "", get: r => { const c = Math.abs(at(T[r.id].data) - r.baseline) > r.band; return `<span class="${c ? "done" : "open"}">${c ? "cleared" : "inside band"}</span>`; } }], B, { cls: "ledger" }) + laneNote(`The band is ±${WB.trajectory.bands.sevenPass} points at seven passes per question (±${WB.trajectory.bands.onePass} at one), from the measured volatility read. Movement inside it is noise and is reported as such.`);
  const word = { good: "Strength", watch: "Watch", risk: "Risk" };
  const reads = [...WB.reads.overview];
  const worst = WB.deliverables.filter(d => !(d.invert ? at(d.series) <= d.target : at(d.series) >= d.target)).slice(0, 3);
  if (W && worst.length) reads.push({ tone: "watch", text: `Still open as of ${w.label.toLowerCase()}: ${worst.map(d => `<b>${esc(d.label)}</b> (${at(d.series)} of ${d.target}${d.unit ? " " + esc(d.unit) : ""})`).join(", ")}.` });
  $("scReads").innerHTML = reads.map(r => `<div class="read ${r.tone}"><span class="rt">${word[r.tone]}</span><p>${r.text}</p></div>`).join("");
  const ts = WB.truthSet.price, ls = WB.listing.find(l => l.rid === "bestbuy"), am = WB.listing.find(l => l.rid === "amazon");
  $("scAtlas").innerHTML = [
    { k: "Truth", lanes: ["Pricing", "Availability", "Catalogue"], t: "Claims verified against the shelf, automatically", p: `${ts.total} price claims in the capture; ${ts.matches} match the Atlas ladder, ${ts.stale} are stale, ${ts.wrong} are wrong, ${ts.sizeNotTracked} name a size Atlas does not track here. No GEO vendor holds the ladder to check against.`, href: "#truthset" },
    { k: "Listing", lanes: ["PDP content", "Carriage", "Availability"], t: "Work where the engines can read", p: `${(() => { const L = WB.listing; const shut = L.filter(l => l.readable.state === "blocked"); const open = L.filter(l => l.readable.state === "open"); return `${shut.length ? `${shut.map(l => esc(l.retailer)).join(", ")} ${shut.length === 1 ? "blocks" : "block"} the AI search crawlers` : "No audited retailer blocks the AI search crawlers"}${open.length ? `; ${open.map(l => `${esc(l.retailer)} is open and scores ${l.readiness}`).join(", ")} on readiness` : ""}.`; })()} The PDP fields Atlas already scores say what to fix on the listings that count.`, href: "#listing" },
    { k: "Content", lanes: ["Voice of Customer"], t: "Argue with what buyers say", p: `${WB.content.argue.length} attributes where rivals lead the engines' framing, each beside the review-aspect score real buyers give. A gap the engines have and buyers do not is a content brief.`, href: "#content" },
  ].map(x => `<section class="card tint"><span class="kicker">${x.k}</span><h3 style="font-size:15px;margin:8px 0 6px">${x.t}</h3><p style="font-size:12.5px;color:var(--soft);line-height:1.5;margin:0 0 10px">${x.p}</p>${atlasStrip(x.lanes)}<a class="more" href="${x.href}">Open →</a></section>`).join("");
  $("scFoot").innerHTML = `<span>Week 0 measured ${esc(fmtDate(WB.baseline.capturedAt))} · weeks 1–12 simulated</span><span>Every figure recomputes from the weekly series for the selected week; no superlative is typed.</span><span>BrandContext Atlas</span>`;
}

function renderBaseline() {
  const s = SUBJ(); const b = WB.baseline; const bs = WB.dims.brands;
  const rankObj = Object.fromEntries(bs.map(x => [x.id, b.avgRank[x.id] == null ? null : -b.avgRank[x.id]]));
  $("blLead").innerHTML = `<b>The programme starts from a measured baseline</b>: ${b.answers} engine answers to ${b.questions} shopper questions on ${b.engines.length} engines, captured ${esc(fmtDate(b.capturedAt))}. Brand comparisons are read on the ${b.compare ? b.compare.questions : b.questions} brand-neutral questions${b.compare ? ` (${esc(b.compare.stages.join(" and "))})` : ""}; the questions that name ${SL} are read per stage. ${esc(WB.meta.subjectLabel)} is ${rankPhrase(b.share, s)} on share (${pctW(b.share[s], 1)}), ${rankPhrase(Object.fromEntries(bs.map(x => [x.id, b.presence[x.id].rate])), s)} on presence, and ${rankPhrase(b.topPick.out, s)} on top-pick share. The first deliverable re-runs the bank at seven passes so every figure carries a band.`;
  $("blKpis").innerHTML = kpiW({ label: "Share of AI answer", dot: wbBrand(s).color, value: pctW(b.share[s], 1), rank: rankChip(b.share, s), tag: '<span class="tag good">measured</span>', note: "presence × position × favourability" }) + kpiW({ label: "Named in", dot: wbBrand(s).color, value: String(b.presence[s].n), unit: `/ ${b.presence[s].of}`, rank: rankChip(Object.fromEntries(bs.map(x => [x.id, b.presence[x.id].rate])), s), note: `questions where at least one engine names ${SL}` }) + kpiW({ label: "Average position", dot: wbBrand(s).color, value: b.avgRank[s] ?? "—", rank: rankChip(rankObj, s), note: "order of first mention when named" }) + kpiW({ label: "Top pick", dot: wbBrand(s).color, value: pctW(b.topPick.out[s], 1), rank: rankChip(b.topPick.out, s), note: `of ${b.topPick.n} answers that commit to one brand` });
  if (window.CC) { const neutral = b.compare ? b.compare.stages : WB.dims.stages.map(st => st.id); CC.funnel($("blFunnel"), { stages: WB.dims.stages.map(st => ({ label: st.label, note: neutral.includes(st.id) ? st.aida : `${st.aida} · questions name ${SL}, rivals n/a`, bars: bs.map(x => ({ label: x.label, value: b.stageShare[st.id][x.id], color: x.color, subject: x.id === s })).filter(x => x.value != null) })), fmtV: (v) => pctW(v, 0) }); }
  $("blEngines").innerHTML = tbl([{ label: "Engine", get: r => `<b>${esc(r.label)}</b><div class="kv-note">${esc(r.path === "ui" ? "consumer app" : "API with web search")}</div>` }, ...bs.map(x => ({ label: x.label, num: true, get: r => { const sh = b.engineShare[r.id]; const lead = Math.max(...Object.values(sh)); return sh[x.id] === lead ? `<b>${pctW(sh[x.id], 0)}</b>` : pctW(sh[x.id], 0); } }))], b.engines) + laneNote("Bold = leads that engine.");
  const dem = WB.deliverables.find(d => d.id === "demand"); const base = WB.deliverables.find(d => d.id === "baseline");
  $("blSampling").innerHTML = `<div class="grid2" style="gap:10px"><div class="stat static"><div class="k">Band at one pass</div><div class="v">±${WB.trajectory.bands.onePass}<small>pts</small></div><div class="n">presence held on ${b.volatility ? b.volatility.presenceStable + "% of " + b.volatility.pairs + " question × engine pairs across " + b.volatility.runs + " passes" : "—"}</div></div><div class="stat static"><div class="k">Band at seven passes</div><div class="v">±${WB.trajectory.bands.sevenPass}<small>pts</small></div><div class="n">the production cadence; every outcome on the scorecard carries this band</div></div></div><div class="note" style="margin-top:12px"><b>As of ${esc(week().label.toLowerCase())}:</b> ${at(base.series)} of ${base.target} questions read at seven passes${W === 0 ? " — the baseline re-run lands in week 1" : ""}.</div>${b.drift ? `<div class="note" style="margin-top:6px"><b>Drift already on file:</b> like for like on the API path, ${SL}'s share moved from ${pctW(b.drift.share[0], 1)} (${esc(b.drift.from)}) to ${pctW(b.drift.share[1], 1)} (${esc(b.drift.to)}).</div>` : ""}`;
  const stageCounts = WB.dims.stages.map(st => ({ st, n: WB.baseline.questions ? null : null }));
  $("blBank").innerHTML = `<div class="grid2" style="gap:10px"><div class="stat static"><div class="k">Questions in the bank</div><div class="v">${b.questions}</div><div class="n">${WB.dims.stages.map(st => esc(st.label)).join(" · ")}</div></div><div class="stat static"><div class="k">Carrying a demand weight</div><div class="v">${at(dem.series)}<small>/ ${dem.target}</small></div><div class="n">${W < 5 ? "weighting starts in week 5, once the retail search terms and site search are joined" : "weighted by retail search terms and site search"}</div></div></div>${sowhat("A bank weighted by judgement over-reads the questions we found interesting. Atlas already holds retail search-term volumes per category; joining them makes the read proportional to what shoppers actually ask.")}`;
}

function renderTruthset() {
  const ts = WB.truthSet; const p = ts.price; const wkv = wk(ts.weekly);
  $("tsLead").innerHTML = `The engines make <b>${ts.price.total + ts.other.total} checkable claims about ${esc(WB.meta.subjectLabel)}</b> in the capture. The ${p.total} prices are the ones Atlas can check without a human: ${p.matches} match the shelf ladder, ${p.stale} are stale, ${p.wrong} are wrong, ${p.sizeNotTracked} name a size this instance does not track, ${p.unverifiable + p.notInCatalogue} cannot be checked. As of ${esc(week().label.toLowerCase())}, ${wkv.verified} claims are verified, ${wkv.filed} corrections are filed and ${wkv.confirmed} are confirmed on re-read.`;
  $("tsKpis").innerHTML = kpiW({ label: "Claims verified", value: String(wkv.verified), unit: `/ ${ts.price.total + ts.other.total}`, tag: tagFor(), note: "prices by Atlas, the rest by the product team" }) + kpiW({ label: "Wrong or stale prices", value: String(p.wrong + p.stale), unit: `/ ${p.total}`, tag: '<span class="tag warn">modelled ladder</span>', note: `${p.wrong} wrong · ${p.stale} stale · ${p.matches} match` }) + kpiW({ label: "Corrections filed", value: String(wkv.filed), unit: `/ ${ts.corrections.length}`, tag: tagFor(), note: "each at the page the engine cited" }) + kpiW({ label: "Confirmed on re-read", value: String(wkv.confirmed), unit: `/ ${ts.corrections.length}`, tag: tagFor(), note: "the engine now returns the true value" });
  const order = { wrong: 0, stale: 1, matches: 2, "size not tracked": 3, unverifiable: 4, "not in catalogue": 5 };
  const rows = p.rows.slice().sort((a, b) => order[a.verdict] - order[b.verdict] || (b.value || 0) - (a.value || 0));
  $("tsTable").innerHTML = tbl([{ label: "Model", get: r => `<b>${esc(r.family || r.product)}</b>${r.family && r.family !== r.product ? `<div class="kv-note">${esc(r.product)}</div>` : ""}` }, { label: "Engine says", num: true, get: r => usd(r.value) }, { label: "Engine", get: r => esc(WB.dims.engines.find(e => e.id === r.engine)?.label || r.engine) }, { label: "Atlas verdict", get: r => verdictChip(r.verdict) }, { label: "Detail", wrap: true, get: r => esc(r.detail) }, { label: "Cited", get: r => esc((r.hosts[0] || "—")) }], rows.map(r => ({ ...r, _onclick: `openClaim('${r.id}')`, _cls: r.verdict === "wrong" ? "subj" : "" })), { tall: true }) + laneNote(`The command-centre ladder is re-based to the September street price the engines agree on for each family (the same “scale to the latest capture” rule the command centre applies), so verdicts read against a plausible shelf. In production the ladder is Atlas's live one and the verdict is computed, not modelled.`);
  const o = ts.other.verdicts;
  $("tsOther").innerHTML = `<div class="grid3" style="gap:10px">${[["Confirmed", o.confirmed, "var(--good)"], ["Out of date", o["out of date"], "var(--warn)"], ["Wrong", o.wrong, "var(--risk)"]].map(([k, v, c]) => `<div class="stat static"><div class="k">${k}</div><div class="v" style="color:${c}">${W === 0 ? "—" : v}</div><div class="n">${W === 0 ? "signed off in week 1" : `of ${ts.other.total} non-price claims`}</div></div>`).join("")}</div>${sowhat(`Every one of these is true, out of date, or wrong, and only ${esc(WB.meta.subjectLabel)} can say which. The truth-set is the first deliverable because every later one (corrections, comparison pages, listing content) writes from it.`)}`;
  $("tsPipe").innerHTML = tbl([{ label: "Claim", get: r => `<b>${esc(r.product)}</b><div class="kv-note">${esc(WB.dims.engines.find(e => e.id === r.engine)?.label || r.engine)} · ${esc(r.verdict)}</div>` }, { label: "Cited page", get: r => esc(r.host) }, { label: "Status", get: r => W < r.filedWeek ? '<span class="stage planned">queued</span>' : r.confirmedWeek != null && W >= r.confirmedWeek ? `<span class="stage s4">confirmed W${r.confirmedWeek}</span>` : `<span class="stage s2">filed W${r.filedWeek}</span>` }], ts.corrections.map(c => ({ ...c, _onclick: `openClaim('${c.id}')` }))) + laneNote("No engine runs a correction desk: the route is the cited page, then a re-read.");
  if (window.CC) CC.line($("tsLine"), { height: 220, x: WB.dims.weeks.map(w => w.date), series: [{ id: "filed", label: "Corrections filed", color: "#fbbc04", data: ts.weekly.map(w => w.filed) }, { id: "confirmed", label: "Confirmed on re-read", color: "#1e8e3e", data: ts.weekly.map(w => w.confirmed) }], fmtV: (v) => n0(v), fmtY: (v) => n0(v) });
}

function renderAccess() {
  const ac = WB.access; const cr = WB.baseline.crawler; const BOTS = ["OAI-SearchBot", "ChatGPT-User", "GPTBot", "PerplexityBot", "Google-Extended", "Claude-SearchBot", "ClaudeBot", "Bingbot", "Amazonbot"];
  const sites = cr.sites.filter(x => [subjectId(), "retail"].includes(x.kind));
  const openFeed = wk(ac.feed.weekly).open; const bot = W < ac.bot403.fixedWeek;
  $("acLead").innerHTML = `<b>Access is not ${esc(WB.meta.subjectLabel)}'s problem in robots.txt</b>: ${ac.sonySites.map(s => esc(s.host)).join(" and ")} block ${sum(ac.sonySites.map(s => s.blocked))} AI crawler rules. The findings are elsewhere: ${ac.bot403.fixedWeek === 0 ? "no bot manager turning AI crawlers away" : `a bot manager that answers non-browser clients with a 403${bot ? " (open)" : ` (fixed week ${ac.bot403.fixedWeek})`}`}, ${WB.listing.filter(l => l.readable.state === "blocked").map(l => esc(l.retailer)).join(" and ") || "no retailer"} blocking the AI search crawlers, and ${ac.feed.mismatches} feed rows that disagree with the shelf${openFeed ? ` (${openFeed} still open)` : " (all closed)"}.`;
  $("acKpis").innerHTML = kpiW({ label: `Blocking rules on ${SL} domains`, value: String(sum(ac.sonySites.map(s => s.blocked))), tag: '<span class="tag good">measured</span>', note: "robots.txt against every engine's crawlers" }) + kpiW({ label: "Access findings open", value: String((bot ? 1 : 0)), tag: tagFor(), note: bot ? "the 403 to non-browser clients" : "bot manager fixed; crawl-log proof on file" }) + kpiW({ label: "Feed mismatches open", value: String(openFeed), unit: `/ ${ac.feed.rows.length} rows`, tag: tagFor(), note: "price or stock in the feed ≠ the shelf" }) + kpiW({ label: "Rivals publishing llms.txt", value: String(ac.llmsRivals.length), tag: '<span class="tag good">measured</span>', note: `${ac.llmsRivals.map(esc).join(", ") || "none"} — a hygiene marker, not a lever` });
  $("acCrawl").innerHTML = `<div class="tblwrap"><table class="t" style="font-size:12px"><thead><tr><th>Site</th>${BOTS.map(b => `<th style="font-size:9px;writing-mode:vertical-rl;transform:rotate(180deg);padding:6px 3px">${esc(b)}</th>`).join("")}</tr></thead><tbody>${sites.map(x => `<tr class="${x.kind === subjectId() ? "subj" : ""}"><td>${esc(x.host.replace(/^www\./, ""))}<div class="kv-note">${esc(x.kind)}</div></td>${BOTS.map(b => { const st = x.bots?.[b]?.state || "unknown"; return `<td style="text-align:center" title="${esc(b)}: ${st}"><span class="readab ${st === "blocked" ? "blocked" : st === "partial" ? "partial" : st === "open" ? "open" : "na"}" style="margin:0"></span></td>`; }).join("")}</tr>`).join("")}</tbody></table></div><div class="legend"><span><i style="background:var(--good);border-radius:99px"></i>open</span><span><i style="background:var(--warn);border-radius:99px"></i>partial</span><span><i style="background:var(--risk);border-radius:99px"></i>blocked</span></div>`;
  $("acFind").innerHTML = `<div class="reads">${[
    { tone: bot ? "risk" : "good", text: `<b>${esc(ac.bot403.host)}</b> ${esc(ac.bot403.finding)}. ${ac.bot403.fixedWeek === 0 ? "Nothing to fix." : bot ? "Open — the search crawlers cannot fetch product pages until the bot manager allows OAI-SearchBot, PerplexityBot and Claude-SearchBot." : `Fixed in week ${ac.bot403.fixedWeek}; crawl-log proof of fetches by the search crawlers on file.`}` },
    (() => { const shut = WB.listing.filter(l => l.readable.state === "blocked").map(l => l.retailer); const open = WB.listing.filter(l => l.readable.state === "open").map(l => l.retailer); return { tone: shut.length ? "watch" : "good", text: shut.length ? `<b>${shut.map(esc).join(", ")} ${shut.length === 1 ? "blocks" : "block"} the AI search crawlers</b>, so those listings never reach the engines${open.length ? `; ${open.map(esc).join(", ")}'s do` : ""}. Listing work lands on the readable retailers and the feeds carry the rest.` : `<b>No audited retailer blocks the AI search crawlers.</b> Listing work lands wherever the shopper buys.` }; })(),
    { tone: "good", text: `<b>Feeds:</b> ${ac.feed.mismatches} of ${ac.feed.rows.length} SKU × retailer rows disagreed with the shelf at week 0; ${openFeed} open as of ${esc(week().label.toLowerCase())}.` },
    { tone: "watch", text: `<b>llms.txt:</b> ${ac.llmsRivals.length ? `${ac.llmsRivals.map(esc).join(", ")} publish one; ${SL} does not.` : "no rival publishes one."} Google says Search does not use it and 97% of 38,000 files received no requests in a month; we publish one because buyers ask, and say what it is.` },
  ].map(r => `<div class="read ${r.tone}"><span class="rt">${{ good: "Closed", watch: "Watch", risk: "Open" }[r.tone]}</span><p>${r.text}</p></div>`).join("")}</div>`;
  $("acFeed").innerHTML = tbl([{ label: "Model", get: r => `<b>${esc(r.model)}</b>` }, { label: "Retailer", get: r => esc(r.retailer) }, { label: "Shelf price", num: true, get: r => usd(r.shelfPrice) }, { label: "Feed price", num: true, get: r => r.feedPrice !== r.shelfPrice ? `<span style="color:var(--risk);font-weight:700">${usd(r.feedPrice)}</span>` : usd(r.feedPrice) }, { label: "Shelf stock", get: r => r.inStock == null ? "—" : r.inStock ? "in stock" : "out" }, { label: "Feed stock", get: r => r.feedInStock == null ? "—" : r.feedInStock !== r.inStock ? `<span style="color:var(--risk);font-weight:700">${r.feedInStock ? "in stock" : "out"}</span>` : (r.feedInStock ? "in stock" : "out") }, { label: "Status", get: r => r.fixedWeek == null ? '<span class="stage s4">matches</span>' : W >= r.fixedWeek ? `<span class="stage s4">fixed W${r.fixedWeek}</span>` : '<span class="stage s2">mismatch</span>' }], ac.feed.rows) + laneNote("The shelf columns are the Atlas ladder and stock series (the command centre's, re-based); the feed columns are the simulation. In production both are read daily and the diff is the deliverable.");
}

function renderListing() {
  const L = WB.listing; const bb = L.find(l => l.rid === "bestbuy"); const ranked = L.slice().sort((a, b) => wk(b.weekly).readiness - wk(a.weekly).readiness);
  $("lsLead").innerHTML = `<b>${esc(ranked[0].retailer)} is the readiest retailer</b> at ${wk(ranked[0].weekly).readiness} of 100 as of ${esc(week().label.toLowerCase())}; ${ranked.filter(l => l.readable.state === "blocked").map(l => esc(l.retailer)).join(", ") || "none"} ${ranked.filter(l => l.readable.state === "blocked").length === 1 ? "is" : "are"} blocked to the search crawlers whatever the page quality. Listing content, reviews and specs go where the engines can read; the feeds carry the rest.`;
  $("lsTable").innerHTML = tbl([{ label: "Retailer", get: r => `<b>${esc(r.retailer)}</b><div class="kv-note">weight ${pctW(r.weight * 100, 0)} of category sales</div>` }, { label: "AI-readable", get: r => `<span class="readab ${r.readable.state === "not audited" ? "na" : r.readable.state}"></span>${esc(r.readable.state)}${r.readable.blocked != null ? ` <span class="kv-note">(${r.readable.blocked}/${r.readable.of} search bots blocked)</span>` : ""}` }, { label: "Carries", num: true, get: r => `${r.carried}/${r.of}` }, { label: "In stock", num: true, get: r => pctW(r.stockPct, 0) }, { label: "PDP score", num: true, get: r => r.pdpAvg == null ? "—" : `${wk(r.weekly).pdp}${W ? ` <span class="kv-note">(${r.pdpAvg})</span>` : ""}` }, { label: "Price index", num: true, get: r => r.priceIdx == null ? "—" : pctW(r.priceIdx, 0) }, { label: "Readiness", num: true, get: r => `<b>${wk(r.weekly).readiness}</b>` }], L.map(l => ({ ...l, _cls: l.rid === "bestbuy" ? "subj" : "" }))) + laneNote("Readiness = readability × (0.5 × PDP score + 0.3 × in-stock rate + 0.2 × share of the line-up carried). Readability is measured from robots.txt; the rest is the Atlas lanes.");
  if (window.CC && bb?.fields.length) CC.hbars($("lsFields"), { rows: bb.fields.map(f => ({ label: f.label, sub: `${f.avg} of ${f.max}`, value: f.avg / f.max * 100, color: f.avg / f.max >= 0.8 ? "#1e8e3e" : f.avg / f.max >= 0.5 ? "#fbbc04" : "#d93025" })), fmtV: (v) => pctW(v, 0) }); else $("lsFields").innerHTML = '<div class="withheld-card"><b>Withheld</b><p>No PDP scores for the readable retailer.</p></div>';
  if (window.CC) CC.line($("lsLine"), { height: 220, x: WB.dims.weeks.map(w => w.date), series: L.filter(l => l.readable.state !== "blocked").map(l => ({ id: l.rid, label: l.retailer, color: { bestbuy: "#1a73e8", walmart: "#fbbc04", target: "#ea4335", newegg: "#9334e6", amazon: "#80868b" }[l.rid] || "#80868b", data: l.weekly.map(w => w.readiness) })), max: 100, fmtV: (v) => n0(v), fmtY: (v) => n0(v) });
}

function renderCatalogue() {
  const C = WB.catalogue; const never = C.filter(c => c.named === 0);
  $("ctLead").innerHTML = `Atlas tracks <b>${C.length} ${PL} families</b> for this instance. At week 0 the engines name ${C.filter(c => c.named > 0).length} of them at least once; ${never.length ? `${never.map(c => `<b>${esc(c.family)}</b>`).join(", ")} ${never.length === 1 ? "is" : "are"} never named` : "every family is named"}. Priority is shelf weight × the share of questions where a family is absent, so the programme works on <b>${esc(C[0].family)}</b> first (priority ${C[0].priority}).`;
  $("ctTable").innerHTML = tbl([{ label: "Family", get: r => `<b>${esc(r.family)}</b><div class="kv-note">${esc(r.tier)} · launch ${usd(r.msrp)}</div>` }, { label: "Carried at", wrap: true, get: r => r.carriedAt.map(esc).join(", ") || "—" }, { label: "Shelf weight", num: true, get: r => pctW(r.shelfWeight, 0) }, { label: "In stock", num: true, get: r => pctW(r.stockPct, 0) }, { label: "Shelf price", num: true, get: r => usd(r.shelfPrice) }, { label: "PDP", num: true, get: r => r.pdpAvg ?? "—" }, { label: "Named W0", num: true, get: r => `${r.named} <span class="kv-note">in ${r.namedQuestions} q</span>` }, { label: `Named W${W}`, num: true, get: r => `<b>${wk(r.weekly).named}</b>` }, { label: "Priority", num: true, get: r => `<b>${r.priority}</b>` }], C.map(c => ({ ...c, _cls: c.named === 0 ? "subj" : "" })));
  if (window.CC) CC.hbars($("ctPrio"), { rows: C.map(c => ({ label: c.family, sub: `named ${c.named} · shelf weight ${c.shelfWeight}%`, value: c.priority, color: c.named === 0 ? "#d93025" : "#1a73e8" })), fmtV: (v) => n0(v) });
  if (window.CC) CC.line($("ctLine"), { height: 220, x: WB.dims.weeks.map(w => w.date), series: C.map((c, i) => ({ id: c.family, label: c.family, color: ["#1a73e8", "#9334e6", "#ea4335", "#fbbc04", "#1e8e3e", "#12b5cb", "#80868b"][i % 7], data: c.weekly.map(w => w.named) })), fmtV: (v) => n0(v), fmtY: (v) => n0(v) });
}

function renderSources() {
  const S = WB.sources; const w = wk(S.weekly);
  $("soLead").innerHTML = `The engines cite <b>${S.top[0] ? esc(S.top[0].host) : "—"} more than any other source</b> (${S.top[0]?.n ?? "—"} of ${S.total} citations). ${SL} is named in ${pctW(S.top5Named, 0)} of the answers that cite the top five at week 0${W ? `, ${pctW(w.top5Named, 0)} as of ${esc(week().label.toLowerCase())}` : ""}. The placement pipeline works the sources cited most where ${SL} is absent; Atlas supplies the review-aspect and price evidence each pitch needs.`;
  $("soKpis").innerHTML = kpiW({ label: `${SL} named on top-5 sources`, value: pctW(w.top5Named, 0), delta: W ? wbDelta(S.top5Named, w.top5Named) : "", tag: tagFor(), note: "answers citing the five most-cited domains" }) + kpiW({ label: "Placements live", value: String(w.live), unit: `/ ${S.pipeline.length}`, tag: tagFor(), note: `a ${PL} in the list, review or thread` }) + kpiW({ label: "Placements cited", value: String(w.cited), unit: `/ ${S.pipeline.length}`, tag: tagFor(), note: "an engine has cited the placed page" }) + kpiW({ label: "Owned pages in citations", value: pctW((S.kinds.owned || 0) / S.total * 100, 0), tag: '<span class="tag good">measured</span>', note: "the answer is written from the review layer" });
  $("soTop").innerHTML = tbl([{ label: "Domain", get: r => esc(r.host) }, { label: "Kind", get: r => `<span class="kv-note">${esc(r.kind)}</span>` }, { label: "Citations", num: true, get: r => r.n }, { label: "Engines", num: true, get: r => r.engines }, { label: `${SL} named`, num: true, get: r => pctW(r.named / r.n * 100, 0) }], S.top);
  $("soPipe").innerHTML = tbl([{ label: "Target", get: r => `<b>${esc(r.host)}</b><div class="kv-note">${esc(r.kind)} · ${r.citations} citations · ${SL} named ${r.namedRate}%</div>` }, { label: "Gap", num: true, get: r => r.gap }, { label: "The ask", wrap: true, get: r => esc(r.ask) }, { label: `Stage W${W}`, get: r => stageChip(r.weekly[W], WB.dims.stagesPlacement) }], S.pipeline.map(p => ({ ...p, _onclick: `openPlacement('${esc(p.host)}')` })));
  if (window.CC) CC.line($("soLine"), { height: 200, x: WB.dims.weeks.map(w => w.date), series: [{ id: "top5", label: `${SL} named on top-5`, color: "#1a73e8", data: S.weekly.map(x => x.top5Named) }], min: 50, max: 100, zero: false, fmtV: (v) => pctW(v, 0), fmtY: (v) => v + "%" });
}

function renderContent() {
  const C = WB.content; const w = wk(C.weekly); const comp = C.pages.filter(p => p.kind === "comparison"), use = C.pages.filter(p => p.kind === "use-case");
  const ST = WB.dims.statusContent;
  $("cnLead").innerHTML = `<b>${SL} wins ${WB.baseline.h2h.win} of ${WB.baseline.h2h.n} head-to-head answers at week 0</b> and the engines refuse to pick in ${WB.baseline.h2h.undecided}. Comparison tables draw about 2.5× the citations of prose (Growth Memo / SEL), so one page per head-to-head question, answer-first, with a live price table from Atlas and review evidence from Voice of Customer, is the lever. As of ${esc(week().label.toLowerCase())}: ${w.live} pages live, ${w.cited} cited, head-to-head win rate ${pctW(w.h2hWin, 0)}.`;
  $("cnKpis").innerHTML = kpiW({ label: "Comparison pages live", value: String(comp.filter(p => ["live", "cited"].includes(p.weekly[W])).length), unit: `/ ${comp.length}`, tag: tagFor() }) + kpiW({ label: "Use-case guides live", value: String(use.filter(p => ["live", "cited"].includes(p.weekly[W])).length), unit: `/ ${use.length}`, tag: tagFor() }) + kpiW({ label: "Pages cited by an engine", value: String(w.cited), tag: tagFor(), note: "a binary event we can observe" }) + kpiW({ label: "Head-to-head win rate", value: pctW(w.h2hWin, 0), delta: W ? wbDelta(C.weekly[0].h2hWin, w.h2hWin) : "", tag: tagFor() });
  $("cnArgue").innerHTML = tbl([{ label: "Attribute", get: r => `<b>${esc(r.attr)}</b>` }, { label: `Engines · ${SL} net`, num: true, get: r => (r.engineNet > 0 ? "+" : "") + r.engineNet }, { label: "Engines · best rival", num: true, get: r => (r.rivalBest > 0 ? "+" : "") + r.rivalBest }, { label: "Gap", num: true, get: r => `<b>${r.gap}</b>` }, { label: `Buyers · ${SL}`, num: true, get: r => r.voc ? r.voc[subjectId()] ?? "—" : "—" }, { label: "Buyers · best rival", num: true, get: r => r.voc ? r.voc.best ?? "—" : "—" }, { label: "Read", wrap: true, get: r => !r.voc || r.voc[subjectId()] == null ? "no review aspect mapped" : r.voc[subjectId()] >= r.voc.best - 3 ? `<b>content brief</b> — buyers rate ${SL} level or better; the engines have not read it` : "product note — buyers agree with the engines" }], C.argue) + laneNote("Engine side: net positive minus negative attribute mentions in the capture (measured). Buyer side: the review-aspect score in the command centre's Voice of Customer lane (0–100, extrapolated around measured captures).");
  const picksCell = (p) => Object.entries(p.todayPicks || {}).map(([e, pk]) => `<span class="kv-note">${esc(WB.dims.engines.find(x => x.id === e)?.label || e)}: ${pk ? esc(wbBrand(pk).label) : "—"}</span>`).join("<br>");
  $("cnPages").innerHTML = tbl([{ label: "Question", wrap: true, get: r => `<b>${esc(r.question)}</b>` }, { label: "Today's picks", wrap: true, get: picksCell }, { label: `${SL} wins`, num: true, get: r => `${r.todayWins}/${r.todayOf}` }, { label: `Status W${W}`, get: r => stageChip(r.weekly[W], ST) }], comp);
  $("cnGuides").innerHTML = tbl([{ label: "Guide", wrap: true, get: r => `<b>${esc(r.question)}</b><div class="kv-note">${esc(r.atlas)}</div>` }, { label: `Status W${W}`, get: r => stageChip(r.weekly[W], ST) }], use) + sowhat(`Awareness is where ${SL} is weakest (fourth of four at week 0) and where category guides are answered from the review layer. These guides exist to be cited, not to rank.`);
}

function renderCommunity() {
  const C = WB.community; const w = wk(C.weekly);
  $("cmLead").innerHTML = `Community sources are <b>${pctW(C.share, 1)} of citations</b> in the capture and ${SL} is named in ${pctW(C.named, 0)} of the answers that cite them. YouTube and Reddit are the two largest citation sources for product questions on Google's AI surfaces and Perplexity; engines read transcripts, descriptions and chapter titles, and Reddit reaches them through licensing, not robots.txt. As of ${esc(week().label.toLowerCase())}: ${w.live} items live, ${SL} named in ${pctW(w.namedRate, 0)} of community citations.`;
  $("cmKpis").innerHTML = kpiW({ label: "Community share of citations", value: pctW(C.share, 1), tag: '<span class="tag good">measured</span>' }) + kpiW({ label: `${SL} named in community citations`, value: pctW(w.namedRate, 0), delta: W ? wbDelta(C.weekly[0].namedRate, w.namedRate) : "", tag: tagFor() }) + kpiW({ label: "Items live", value: String(w.live), unit: `/ ${C.items.length}`, tag: tagFor() }) + kpiW({ label: "Reddit reaches the engines via", value: "licence", tag: '<span class="tag acc">context</span>', note: "robots.txt says Disallow: /; Google and OpenAI pay for the data" });
  $("cmHosts").innerHTML = C.hosts.length ? tbl([{ label: "Domain", get: r => esc(r.host) }, { label: "Citations", num: true, get: r => r.n }, { label: "Engines", num: true, get: r => r.engines }, { label: `${SL} named`, num: true, get: r => pctW(r.named / r.n * 100, 0) }], C.hosts) : '<div class="withheld-card"><b>Withheld</b><p>No community domain was cited in the capture.</p></div>';
  $("cmPipe").innerHTML = tbl([{ label: "Item", wrap: true, get: r => `<b>${esc(r.title)}</b><div class="kv-note">${esc(r.kind)} · ${esc(r.atlas)}</div>` }, { label: `Status W${W}`, get: r => stageChip(r.weekly[W], WB.dims.statusContent) }], C.items);
}

function renderShopping() {
  const S = WB.shopping; const del = WB.deliverables.find(d => d.id === "shopping"); const feedAvg = Math.round(sum(S.map(s => wk(s.weekly).feedComplete)) / S.length);
  $("shLead").innerHTML = `ChatGPT Shopping and Google's Shopping Graph read merchant feeds, and the engines cite retailers directly in only ${pctW((WB.sources.kinds.retailer || 0) / WB.sources.total * 100, 0)} of citations. So the shopping question is whether <b>the ${PL} an engine recommends is carried, in stock and at the claimed price where the engine points</b>. As of ${esc(week().label.toLowerCase())}, ${pctW(at(del.series), 0)} of recommendations are fulfillable and feeds are ${pctW(feedAvg, 0)} complete.`;
  $("shKpis").innerHTML = kpiW({ label: "Recommendations fulfillable", value: pctW(at(del.series), 0), delta: W ? wbDelta(del.series[0], at(del.series)) : "", tag: tagFor(), note: "carried, in stock, at the claimed price, on a readable retailer" }) + kpiW({ label: "Feed completeness", value: pctW(feedAvg, 0), tag: tagFor(), note: "required and recommended fields present" }) + kpiW({ label: "Retailer citations", value: pctW((WB.sources.kinds.retailer || 0) / WB.sources.total * 100, 0), tag: '<span class="tag good">measured</span>', note: "why the feed matters more than the PDP prose" }) + kpiW({ label: "Families tracked", value: String(S.length), tag: '<span class="tag acc">Atlas</span>' });
  $("shTable").innerHTML = `<div class="tblwrap"><table class="t"><thead><tr><th>Family</th>${WB.dims.retailers.map(r => `<th>${esc(r.label)}</th>`).join("")}<th class="num">Feed complete</th><th class="num">Fulfillable</th></tr></thead><tbody>${S.map(s => `<tr><td><b>${esc(s.family)}</b></td>${s.rows.map(r => `<td>${!r.carried ? '<span class="kv-note">not carried</span>' : `<span class="readab ${r.readable === "not audited" ? "na" : r.readable}" title="${esc(r.readable)} to the search crawlers"></span>${r.inStock === false ? '<span style="color:var(--risk);font-weight:700">out</span>' : usd(r.price)}`}</td>`).join("")}<td class="num">${pctW(wk(s.weekly).feedComplete, 0)}</td><td class="num"><b>${pctW(wk(s.weekly).fulfilled, 0)}</b></td></tr>`).join("")}</tbody></table></div>` + laneNote("Dot = whether the search crawlers can read that retailer (measured). Price and stock from the Atlas lanes; feed completeness and fulfilment are the simulation.");
  if (window.CC) CC.line($("wbShLine"), { height: 200, x: WB.dims.weeks.map(w => w.date), series: [{ id: "ful", label: "Fulfillable", color: "#1a73e8", data: del.series }, { id: "feed", label: "Feed completeness", color: "#fbbc04", data: WB.dims.weeks.map(w => Math.round(sum(S.map(s => s.weekly[w.n].feedComplete)) / S.length)) }], max: 100, fmtV: (v) => pctW(v, 0), fmtY: (v) => v + "%" });
}

function renderTrajectory() {
  const T = WB.trajectory; const s = SUBJ(); const band = T.bands.sevenPass;
  const cleared = Object.entries(T.series).filter(([, x]) => Math.abs(at(x.data) - x.data[0]) > band);
  $("trLead").innerHTML = `Every outcome starts at the measured week 0 and is drawn forward inside the band the volatility read gives: <b>±${band} points at seven passes per question</b> (±${T.bands.onePass} at one). As of ${esc(week().label.toLowerCase())}, ${cleared.length} of ${Object.keys(T.series).length} measures have cleared it${cleared.length ? `: ${cleared.map(([, x]) => esc(x.label.toLowerCase())).join(", ")}` : ""}. The shapes are the simulation's; the levels are pinned.`;
  $("trKpis").innerHTML = Object.entries(T.series).map(([k, x]) => kpiW({ label: x.label, dot: wbBrand(s).color, value: pctW(at(x.data), 1), delta: W ? wbDelta(x.data[0], at(x.data)) : "", tag: Math.abs(at(x.data) - x.data[0]) > band ? '<span class="tag good">cleared band</span>' : '<span class="tag">inside band</span>', note: x.unit })).join("");
  if (window.CC) CC.line($("wbTrLine"), { height: 260, x: WB.dims.weeks.map(w => w.date), series: [{ id: s, label: wbBrand(s).label, color: wbBrand(s).color, data: T.series.share.data.map((v, i) => i <= W ? v : null) }, ...Object.entries(T.rivalShare).map(([b, v]) => ({ id: b, label: wbBrand(b).label, color: wbBrand(b).color, data: v.map((x, i) => i <= W ? x : null) }))], bands: [{ start: WB.dims.weeks[0].date, end: WB.dims.weeks[WB.meta.pilotEndWeek].date, label: "pilot" }], min: 0, max: 50, fmtV: (v) => pctW(v, 1), fmtY: (v) => v + "%" });
  $("trTable").innerHTML = `<div class="tblwrap"><table class="t"><thead><tr><th>Outcome</th>${WB.dims.weeks.map(w => `<th class="num ${w.n === W ? "subj" : ""}">W${w.n}</th>`).join("")}</tr></thead><tbody>${Object.entries(T.series).map(([k, x]) => `<tr><td><b>${esc(x.label)}</b><div class="kv-note">±${band}</div></td>${x.data.map((v, i) => `<td class="num" style="${i > W ? "color:var(--mute)" : ""}">${Math.abs(v - x.data[0]) > band && i <= W ? `<b>${pctW(v, 1)}</b>` : pctW(v, 1)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` + laneNote("Grey cells are beyond the selected week. Week 0 is measured.");
}

function renderDeliverables() {
  const groups = ["Diagnose", "Fix", "Earn", "Own", "Measure"]; const done = WB.deliverables.filter(d => d.invert ? at(d.series) <= d.target : at(d.series) >= d.target).length;
  const lanesUsed = [...new Set(WB.deliverables.flatMap(d => d.atlas))];
  $("dlLead").innerHTML = `<b>${WB.deliverables.length} deliverables across five stages</b> make up the programme; ${WB.deliverables.filter(d => d.atlas.length).length} of them are fed by an Atlas lane (${lanesUsed.map(esc).join(", ")}). As of ${esc(week().label.toLowerCase())}, ${done} are closed against their target. Tap a row for the week-by-week series.`;
  $("dlTable").innerHTML = `<div class="tblwrap"><table class="t ledger"><thead><tr><th>Deliverable</th><th>Atlas lane</th><th>Owner · cadence</th><th class="num">Base</th><th class="num">W${W}</th><th class="num">Target</th><th>Weeks</th><th></th></tr></thead><tbody>${groups.map(g => `<tr><td colspan="8" style="background:#f6f7fa;font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--mute);font-weight:800;padding:6px 8px">${g}</td></tr>` + WB.deliverables.filter(d => d.group === g).map(d => { const v = at(d.series); const ok = d.invert ? v <= d.target : v >= d.target; return `<tr style="cursor:pointer" onclick="openDeliverable('${d.id}')"><td class="wrap"><b>${esc(d.label)}</b><div class="kv-note">${esc(d.kpi)}${d.unit ? " · " + esc(d.unit) : ""}</div></td><td class="wrap">${d.atlas.length ? d.atlas.map(l => `<span class="lane" style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:#0f4c81;background:#e8f1fb;border:1px solid #cfe0f3;border-radius:99px;padding:2px 8px;margin:1px"><i style="width:5px;height:5px;border-radius:50%;background:#1a73e8"></i>${esc(l)}</span>`).join("") : '<span class="kv-note">AI lane only</span>'}</td><td class="wrap"><span class="kv-note">${esc(d.owner)}<br>${esc(d.cadence)}</span></td><td class="num">${d.start ?? "—"}</td><td class="num"><b>${v ?? "—"}</b></td><td class="num">${d.target ?? "—"}</td><td style="min-width:110px">${wkline(d.series, W, !!d.invert)}</td><td><span class="${ok ? "done" : "open"}">${ok ? "done" : "open"}</span></td></tr>`; }).join("")).join("")}</tbody></table></div>`;
}

function renderMethodWB() {
  const dis = WB.meta.disclosure;
  $("mtLead").innerHTML = `<b>${esc(dis.headline)}</b> Week 0 is measured; weeks 1 to 12 are the simulation of a programme run with Atlas. The anchor ledger below says, lane by lane, which figures are pinned to a capture and which are modelled around them.`;
  $("mtBody").innerHTML = `<p>${esc(dis.body)}</p><p><b>Rules this workbench obeys.</b> Every figure recomputes from the weekly series for the selected week. Week 0 of every series is the measured capture, never a smoothed value. No superlative is typed. A lane with no anchor says so. Nothing on a client-facing page is a promise: the deliverables are the work; the outcome band is the honest shape of the result.</p>`;
  $("mtAnchors").innerHTML = `<div class="tblwrap"><table class="t"><thead><tr><th>Lane</th><th>What was measured</th><th>Source</th><th>What it pins</th></tr></thead><tbody>${dis.anchors.map(a => `<tr style="${a.unmeasured ? "background:#fef7e0" : a.modelled ? "background:#f8fafc" : ""}"><td class="wrap"><b>${esc(a.lane)}</b>${a.unmeasured ? ' <span class="tag risk">no anchor</span>' : a.modelled ? ' <span class="tag warn">modelled lane</span>' : ' <span class="tag good">measured</span>'}</td><td class="wrap">${esc(a.measured)}</td><td class="wrap"><span class="kv-note">${esc(a.source)}</span></td><td class="wrap">${esc(a.pins)}</td></tr>`).join("")}</tbody></table></div>`;
  $("mtJoin").innerHTML = tbl([{ label: "Deliverable", get: r => `<b>${esc(r.label)}</b><div class="kv-note">${esc(r.group)}</div>` }, { label: "Atlas lane", wrap: true, get: r => r.atlas.length ? r.atlas.map(esc).join(", ") : '<span class="kv-note">none — the AI lane alone</span>' }, { label: "What the join does", wrap: true, get: r => esc(r.what) }], WB.deliverables);
  $("mtLinks").innerHTML = `<p>The measured side of this workbench is the <a href="${esc(WB.links.console)}" target="_blank" rel="noopener">${SL} AI Visibility console</a>: ${WB.baseline.questions} questions, ${WB.dims.engines.length} engines, every answer with its receipt, and the live run. The Atlas side is the <a href="${esc(WB.links.commandCenter)}" target="_blank" rel="noopener">${SL} commercial command centre</a>: shelf, price, stock, delivery, PDP content and reviews, extrapolated around its own measured snapshots. This workbench is the join, run forward.</p>`;
}

// ── workbench: week control and re-render (routing, rail and drawers are wired by the console shell) ──
function buildWeekControl() {
  const quick = [[0, "Baseline"], [WB.meta.pilotEndWeek, `Pilot end · W${WB.meta.pilotEndWeek}`], [12, "Week 12"]];
  $("weekSeg").innerHTML = quick.map(([n, l]) => `<button type="button" data-w="${n}">${l}</button>`).join("");
  $("weekSel").innerHTML = WB.dims.weeks.map(w => `<option value="${w.n}">${w.label} · ${fmtShort(w.date)}</option>`).join("");
  $("weekSeg").querySelectorAll("button").forEach(b => b.onclick = () => setWeek(+b.dataset.w));
  $("weekSel").onchange = (e) => setWeek(+e.target.value);
  $("wbSimBtn").onclick = () => { if (page === "method") jumpTo("sub-wbmethod"); else { location.hash = "#" + pageDef("method").hash; setTimeout(() => jumpTo("sub-wbmethod"), 80); } };
}
function syncWeek() { $("weekSeg").querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.w === W)); $("weekSel").value = String(W); $("wbSimBtn").classList.toggle("on", W > 0); }
function setWeek(n) { W = Math.max(0, Math.min(12, n)); syncWeek(); rerenderWB(); }
function rerenderWB() {
  if (!WB) return;
  for (const f of [renderScorecard, renderBaseline, renderTruthset, renderAccess, renderListing, renderCatalogue, renderSources, renderContent, renderCommunity, renderShopping, renderTrajectory, renderDeliverables, renderMethodWB]) { try { f(); } catch (e) { console.error(`${f.name} failed`, e); } }
}
window.jumpTo = (id) => { const el = $(id); if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "start" }); };

// ── shell: pages, rail, routing, drawers, boot ──────────────────────────────
// One dashboard, two products on one rail: the Console (measured) above, the
// Workbench (the simulated programme) below. A page flagged `wb` swaps the top
// bar from the scope controls to the week control and the simulation chip.
// Embedded in the command centre (EMBED), the rail, routing and title belong to
// its shell: this module builds its pages, registers its groups, and answers the
// shell's route callback by showing the top-bar set the page needs.
const DEFAULT_HASH = /sony-aeo|workbench/.test(location.pathname) ? "#scorecard" : "#overview";
function buildPages() {
  let host = $("pages");
  if (EMBED) { host = document.createElement("div"); host.className = "aiv"; host.id = "aivPages"; host.style.display = "contents"; $("pages").appendChild(host); }
  host.insertAdjacentHTML("beforeend", PAGES.map(p => `<div class="page" id="pg-${p.hash}"><div class="stack-v">${TPL[p.id]()}</div></div>`).join(""));
}
function buildNav() {
  $("nav").innerHTML = NAV.filter(g => g.id !== "workbench" || document.body.dataset.payloadWb).map(g => `<div class="nav-grp"><h5>${g.label}</h5>${g.pages.map(p => `<a href="#${p.hash}" data-p="${p.hash}" title="${p.label}">${icon(p.icon)}<span>${p.label}</span>${p.pill ? `<span class="pill">${p.pill}</span>` : ""}</a>`).join("")}</div>`).join("");
  $("railToggle").onclick = () => { document.body.classList.toggle("rail-collapsed"); try { localStorage.setItem("aiv_rail", document.body.classList.contains("rail-collapsed") ? "1" : "0"); } catch {} };
  try { if (localStorage.getItem("aiv_rail") === "1") document.body.classList.add("rail-collapsed"); } catch {}
}
function showTopSets(def) {
  $("topConsole").hidden = !def || !!def.wb; $("topWB").hidden = !def || !def.wb || !WB;
}
const HASH_ALIAS = { engines: "funnel", "ai-engines": "ai-funnel" };   // the Engines page folded into the funnel page; old links still land
function route() {
  let id = (location.hash || DEFAULT_HASH).slice(1).split("?")[0]; if (HASH_ALIAS[id]) id = HASH_ALIAS[id];
  page = (PAGES.find(p => p.hash === id) || pageDef(DEFAULT_HASH.slice(1))).id; const def = pageDef(page);
  $("crumb").textContent = def.crumb; $("ptitle").textContent = def.title;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.p === def.hash));
  document.querySelectorAll("#pages .page").forEach(p => p.classList.toggle("on", p.id === "pg-" + def.hash));
  showTopSets(def);
  document.title = `${def.title} · ${D.subjectLabel} AI Visibility`;
  if (window.CC) CC.hideTip();
  window.scrollTo({ top: 0, behavior: "instant" });
}
// ── embedded in the command centre: two groups on its rail, its router calls back ──
const EMBED_GROUPS = () => {
  const grp = (id) => NAV.find(g => g.id === id).pages.filter(p => p.id !== "live" || D.liveConfig.engines.length);
  const crumb = (p) => p.crumb.replace(/^Console/, "AI Engine Visibility").replace(/^Workbench/, "AEO Workbench").replace(/^Context$/, "AI Engine Visibility · Context");
  const def = (p) => ({ id: p.hash, label: p.label, svg: I[p.icon], crumb: crumb(p), title: p.title, pill: p.pill, ext: "aiv", managed: true });
  // both groups sit right under the shell's Share of Mind group: at the foot of the rail they
  // were below the fold on a laptop and went unseen (Aashish, 2026-09-22)
  return [
    { id: "aiv-console", label: "AI Engine Visibility", ext: "aiv", after: "mind", pages: [...grp("console"), ...grp("context")].map(def) },
    { id: "aiv-workbench", label: "AEO Workbench", ext: "aiv", after: "mind", pages: grp("workbench").filter(p => WB || !p.wb).map(def) },
  ];
};
function onRouteEmbed(def) {
  const mine = def ? PAGES.find(p => p.hash === def.id) : null;
  if (mine) page = mine.id;
  showTopSets(mine);
  if (window.CC) CC.hideTip();
}
function registerWithCC() {
  // the shell's router knows only live page ids, so an old "#ai-engines" link is rewritten before it routes
  const fixAlias = () => { const h = location.hash.slice(1); if (HASH_ALIAS[h]) location.replace("#" + HASH_ALIAS[h]); };
  fixAlias(); window.addEventListener("hashchange", fixAlias);
  window.__CCEXT.register({ id: "aiv", groups: EMBED_GROUPS(), onRoute: onRouteEmbed });
}

window.openScope = () => { $("scopeDrawer").classList.add("on"); $("scrim").classList.add("on"); $("sdX").focus(); };
window.closeScope = () => { $("scopeDrawer").classList.remove("on"); $("scrim").classList.remove("on"); };
function closeAll() { closeScope(); closeDrawerWB(); closeModal(); }
function scopeChanged() { return S.qOff.size > 0 || S.stagesOn.size < D.stages.length || S.brands.some(b => !b.on || b.custom) || S.engines.size < D.engines.filter(e => e.measured && e.id !== "google-aio").length; }
function syncChrome() {
  $("scopeTxt").textContent = `${activeQueries().length} questions · ${brandsOn().length} brands · ${S.engines.size} engines`;
  if ($("qbankTxt")) $("qbankTxt").textContent = `Question bank · ${activeQueries().length}`;
  $("scopeBtn").classList.toggle("changed", scopeChanged());
  if (!EMBED) $("scWin").textContent = `${fmtDate(CUR.capturedAt || CUR.basis)} · ${D.market} · ${S.engines.size} engines`;
  if (D.evidenceSummary?.sessions) $("evChip").textContent = `${D.evidenceSummary.sessions} real sessions on file`;
}
function rerender() {
  for (const f of [renderCfg, syncChrome, renderCanvas, renderLenses, renderOverview, renderEngines, renderQuestionBank, renderCatalog, renderPageLeads, renderEvidencePage, renderProgramme]) {
    try { f(); } catch (e) { console.error(`${f.name} failed`, e); }
  }
}
function wire() {
  $("addQBtn").onclick = () => { const v = $("addQ").value.trim(); if (v.length < 8) return; S.customQ.push({ id: "custom-" + Date.now(), stage: "decision", text: v, custom: true, focus: "custom" }); $("addQ").value = ""; S.openStage = "decision"; renderCfg(); renderLive(); $("liveQ").value = v; };
  $("addBBtn").onclick = () => { const v = $("addB").value.trim(); if (!v) return; const id = v.toLowerCase().replace(/[^a-z0-9]/g, ""); if (S.brands.some(b => b.id === id)) return; S.brands.push({ id, label: v, color: ["#2a9d6f", "#80868b", "#8c6d1f", "#3f6b8a"][S.brands.filter(b => b.custom).length % 4], on: true, custom: true, aliases: [v.toLowerCase()] }); $("addB").value = ""; rerender(); };
  $("resetCfg").onclick = () => { initState(); rerender(); renderLive(); };
  $("pMarket").onchange = (e) => { S.market = e.target.value; }; $("pPersona").onchange = (e) => { S.persona = e.target.value; }; $("pRuns").onchange = (e) => { S.runs = +e.target.value; renderCfg(); };
  $("runLive").onclick = runLive;
  $("scopeBtn").onclick = openScope; $("sdX").onclick = closeScope; $("drX2").onclick = closeDrawerWB;
  if ($("qbankBtn")) $("qbankBtn").onclick = openQbank;
  // listeners, not onclick: the command centre's shell has its own handlers on the same scrim and keys
  $("scrim").addEventListener("click", closeAll);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  if (!EMBED) window.addEventListener("hashchange", route);
}
const loadJson = (url) => fetch(url, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
(async () => {
  const body = document.body.dataset;
  const shell = window.__ccBoot ? await window.__ccBoot.catch(() => null) : null;
  if (window.__ccBoot && !(shell && shell.aiConsole)) return;
  if (shell && shell.aeoWorkbench) body.payloadWb = "embedded";
  const [pc, pw] = await Promise.allSettled([
    shell ? Promise.resolve(shell.aiConsole) : loadJson(body.payloadAi || body.payload),
    shell && shell.aeoWorkbench ? Promise.resolve(shell.aeoWorkbench) : body.payloadWb && !shell ? loadJson(body.payloadWb) : Promise.reject(new Error("no workbench payload declared")),
  ]);
  if (pc.status !== "fulfilled") { console.error(pc.reason); $("pages").insertAdjacentHTML("beforeend", `<div class="withheld-card"><b>Payload</b><p>The payload failed to load (${esc(pc.reason?.message || pc.reason)}).</p></div>`); return; }
  try {
    D = CC.googlePalette(pc.value); setSubjectCopy();
    CUR = D.captures[D.current]; PREV = D.driftPair ? D.captures[D.driftPair.from] : null; DTO = D.driftPair ? D.captures[D.driftPair.to] : null; APIC = D.apiCurrent ? D.captures[D.apiCurrent] : null;
    // the workbench payload is optional: without it the workbench pages withhold, the console is untouched
    if (pw.status === "fulfilled") { WB = CC.googlePalette(pw.value); W = WB.meta.pilotEndWeek; const qw = new URLSearchParams(location.search).get("w"); if (qw != null && !isNaN(+qw)) W = Math.max(0, Math.min(12, +qw)); }
    else if (body.payloadWb) console.error("workbench payload", pw.reason);
    initState(); buildPages(); wire(); rerender(); renderLive(); renderLandscape(); renderMethod();
    if (WB) { buildWeekControl(); syncWeek(); rerenderWB(); }
    if (EMBED) registerWithCC(); else { buildNav(); route(); }
  } catch (e) { console.error(e); $("pages").insertAdjacentHTML("beforeend", `<div class="withheld-card"><b>Payload</b><p>The page failed to build (${esc(e.message)}).</p></div>`); }
})();
