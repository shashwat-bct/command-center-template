// Builds dashboard/public/ai-visibility.js from the command-center-template
// console (dashboard/vendor/ai-visibility.reference.js, copied unchanged from
// feat/measured-only-dashboards). Each patch must apply exactly once, so a new
// reference copy that moved the code fails loudly instead of half-patching.
//
//   node dashboard/patch-ai-visibility.mjs
//
// What changes:
//   1. The rail carries only the six AI Engine Visibility pages we use.
//   2. Persona and run filters: every answer carries both; the reference read
//      run 1 only, here the filters choose (default: all personas, all runs).
//   3. The volatility lens is built from the three runs of this capture, per
//      persona, instead of a separate volatility set.
//   4. Answer receipts name the persona and run beside the engine.
//   5. The live run, workbench, landscape and method pages are not built.
//   6. Short heat-map heads and highlight keywords for the wireless-speaker
//      attributes (the reference knows TV and phone ones only).
//   7. Retail audit pages (public/retail-audit.js): when the page declares a
//      retail payload, its groups join the rail (360° Scorecard first), their
//      pages are built and re-rendered with the console's, and the console's
//      answer filters are exposed to them as window.__AIV.
//   8. Weeks: every collection that asked the bank is a week. The pages read all
//      weeks pooled (a Week filter picks one); Change Over Time adds a
//      week-by-week lens and its drift lens compares the last two weeks.
//   9. Keyword search (public/keyword-search.js): an Explore group after the
//      console's, one page that finds every mention of a word in the answers,
//      read through window.__AIV like the retail pages.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;
let src = readFileSync(join(dir, "vendor", "ai-visibility.reference.js"), "utf8");

function patch(name, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`patch "${name}": expected 1 match, found ${n}`);
  src = src.replace(from, to);
}
function patchRe(name, re, to) {
  const n = (src.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
  if (n !== 1) throw new Error(`patch "${name}": expected 1 match, found ${n}`);
  src = src.replace(re, to);
}

// 1 · the six pages
patchRe("nav", /const NAV = \[[\s\S]*?\n\];\n/, `const NAV = [
  { id: "console", label: "AI Engine Visibility", pages: [
    { id: "overview", label: "Executive Summary", icon: "grid", crumb: "AI Engine Visibility · Overview", title: "Executive Summary" },
    { id: "funnel", label: "Funnel & Engines", icon: "funnel", crumb: "AI Engine Visibility · Measure", title: "Funnel, Presence & Engines" },
    { id: "sources", label: "Sources & Access", icon: "link", crumb: "AI Engine Visibility · Measure", title: "Sources & Access" },
    { id: "attrs", label: "Brand Attributes", icon: "spark", crumb: "AI Engine Visibility · Measure", title: "What the Engines Say Each Brand Is Good At" },
    { id: "products", label: "Picks & Products", icon: "box", crumb: "AI Engine Visibility · Measure", title: "Recommendations & Products" },
    { id: "change", label: "Change Over Time", icon: "clock", crumb: "AI Engine Visibility · Measure", title: "Change Over Time" }] },
];
`);

// 2 · persona and run filters: the captures are filtered before any page reads them
for (const [name, from] of [
  ["activeAnswers run", "return cap.answers.filter(a => ids.has(a.queryId) && S.engines.has(a.engine) && a.run === 1);"],
  ["proof run", "const ans = cap.answers.filter(a => a.queryId === id && engines.includes(a.engine) && a.run === 1);"],
  ["claim row run", "const ans = CUR.answers.filter(a => a.queryId === qid && S.engines.has(a.engine) && a.run === 1);"],
]) patch(name, from, from.replace(" && a.run === 1", ""));

patch("lens state", "let S = null;                 // state", `let S = null;                 // state
// persona, run and week filters (this tool): RAW keeps the captures as loaded, CUR / PREV / DTO / APIC
// are the filtered views every page reads. The week filter narrows the pooled capture only; the
// drift lens always compares the last two weeks.
const LV = { persona: "", run: 0, week: 0 };
let RAW = null;
const WEEKS = () => D.weeks || [];
const lensCap = (cap, wk = 0) => cap && { ...cap, basis: wk ? \`Week \${wk}\` : cap.basis, answers: cap.answers.filter(a => (!LV.persona || a.persona === LV.persona) && (!LV.run || a.run === LV.run) && (!wk || a.week === wk)) };
function applyLens() {
  CUR = lensCap(RAW.cur, LV.week); PREV = lensCap(RAW.prev); DTO = lensCap(RAW.dto); APIC = lensCap(RAW.apic, LV.week);
  const byRun = {}; for (const a of RAW.cur.answers) if ((!LV.persona || a.persona === LV.persona) && (!LV.week || a.week === LV.week)) (byRun[a.run] ||= []).push(a);
  const runs = Object.keys(byRun).sort();
  D.volatility = runs.length >= 2 ? { runs: runs.map(r => ({ run: "run " + r, capturedAt: RAW.cur.capturedAt, engineSource: RAW.cur.engineSource, answers: byRun[r] })) } : null;
}
const personaLabel = (id) => ((D.personas || []).find(p => p.id === id) || {}).label || id || "";
window.setLens = (k, v) => { LV[k] = k === "run" || k === "week" ? +v : v; applyLens(); rerender(); syncLensChrome(); };
function syncLensChrome() {
  document.querySelectorAll("[data-lens-k]").forEach(b => b.classList.toggle("on", String(LV[b.dataset.lensK]) === b.dataset.lensV));
}
function buildLensChrome() {
  const host = $("lensSet"); if (!host) return;
  const seg = (k, opts) => \`<div class="seg mini" role="group">\${opts.map(([v, l]) => \`<button data-lens-k="\${k}" data-lens-v="\${v}" onclick="setLens('\${k}','\${v}')">\${esc(l)}</button>\`).join("")}</div>\`;
  host.innerHTML = seg("persona", [["", "All personas"], ...(D.personas || []).map(p => [p.id, p.label])]) + seg("run", [["0", "All runs"], ...Array.from({ length: D.runs || 1 }, (_, i) => [String(i + 1), "Run " + (i + 1)])])
    + (WEEKS().length > 1 ? seg("week", [["0", "All weeks"], ...WEEKS().map(w => [String(w.week), w.label])]) : "");
  syncLensChrome();
}`);

// 3 · volatility pairs are per persona
{
  const from = "const k = `${a.queryId}|${a.engine}`; (pairs[k] ||= []).push(";
  const n = src.split(from).length - 1;
  if (n !== 2) throw new Error(`patch "volatility pairs": expected 2 matches, found ${n}`);
  src = src.split(from).join("const k = `${a.queryId}|${a.engine}|${a.persona || \"\"}|${a.week || \"\"}`; (pairs[k] ||= []).push(");
}

// 4 · receipts name persona and run
patch("proof labels", "${ans.map(a => engRow(a, { label: eng[a.engine] || a.engine, body: md(a.text, hl) })).join(\"\")}",
  "${[...ans].sort((x, y) => (x.week || 0) - (y.week || 0) || String(x.engine).localeCompare(y.engine) || String(x.persona).localeCompare(y.persona) || x.run - y.run).map(a => engRow(a, { label: `${WEEKS().length > 1 ? `Week ${a.week} · ` : \"\"}${eng[a.engine] || a.engine} · ${personaLabel(a.persona)} · run ${a.run}`, body: md(a.text, hl) })).join(\"\")}");
patch("qhead count", "named by ${named} of ${ans.length} engine${ans.length === 1 ? \"\" : \"s\"}", "named in ${named} of ${ans.length} answer${ans.length === 1 ? \"\" : \"s\"}");

// copy that described the reference's own capture history
patch("drift path", "the same path (the engines' APIs with web search, as the July launch report used)", "the same collection method (every persona, three runs, US)");
patch("drift lead", "On the like-for-like API path, <b>", "Like for like, <b>");

// 5 · only the pages we build
patch("boot", "CUR = D.captures[D.current]; PREV = D.driftPair ? D.captures[D.driftPair.from] : null; DTO = D.driftPair ? D.captures[D.driftPair.to] : null; APIC = D.apiCurrent ? D.captures[D.apiCurrent] : null;",
  "RAW = { cur: D.captures[D.current], prev: D.driftPair ? D.captures[D.driftPair.from] : null, dto: D.driftPair ? D.captures[D.driftPair.to] : null, apic: D.apiCurrent ? D.captures[D.apiCurrent] : null }; applyLens();");
patch("boot pages", "initState(); buildPages(); wire(); rerender(); renderLive(); renderLandscape(); renderMethod();", "initState(); buildPages(); wire(); buildLensChrome(); rerender();");
patch("rerender list", "for (const f of [renderCfg, syncChrome, renderCanvas, renderLenses, renderOverview, renderEngines, renderQuestionBank, renderCatalog, renderPageLeads, renderEvidencePage, renderProgramme]) {",
  "for (const f of [renderCfg, syncChrome, renderCanvas, renderLenses, renderOverview, renderEngines, renderQuestionBank, renderCatalog, renderPageLeads]) {");
patchRe("wire addQ", /\n  \$\("addQBtn"\)\.onclick = [^\n]*/, "");
patch("wire params", "$(\"pMarket\").onchange = (e) => { S.market = e.target.value; }; $(\"pPersona\").onchange = (e) => { S.persona = e.target.value; }; $(\"pRuns\").onchange = (e) => { S.runs = +e.target.value; renderCfg(); };", "");
patch("wire live", "\n  $(\"runLive\").onclick = runLive;", "");
// copy that assumed a separate API-path drift capture and a separate volatility set
for (const [name, from, to] of [
  ["vol lens day", "on the same day (the other engines' passes are queued)", "within each week"],
  ["movers title", "(API path, like for like)", "(like for like)"],
  ["drift kpi", "Like for like on the engines' API path, ", "Like for like, "],
  ["drift read", "like for like on the API path, ${SL}'s share moved from <b>", "like for like, ${SL}'s share moved from <b>"],
  ["vol read", "Across ${vol.runs} passes of the volatility set,", "Across the ${vol.runs} runs of every question,"],
  ["vol cadence", "a single pass is a sketch, which is why the production cadence is seven.", "a single pass is a sketch, which is why every question is asked three times."],
]) patch(name, from, to);

// 6 · wireless-speaker attributes (banks/wireless-speakers.category.json)
patch("speaker heads", `"design / build": "Design" };`, `"design / build": "Design",
  // wireless-speaker attributes
  "sound quality": "Sound", "bass performance": "Bass", "volume and loudness": "Loudness", "bluetooth range": "Range", "multiroom support": "Multiroom", "app and smart features": "App", "voice assistant integration": "Voice", "water and dust resistance": "Rugged", "portability and size": "Portable", "connectivity options": "Connect", "build quality and durability": "Build", "value for money": "Value", "brand reliability and warranty": "Reliability" };`);
patch("speaker keywords", `const ATTR_KW = {\n`, `const ATTR_KW = {
  "sound quality": ["sound quality", "sound", "audio", "clarity", "detail", "balanced"], "bass performance": ["bass", "low end", "low-end", "woofer"], "volume and loudness": ["loud", "volume", "fill a room", "fills a room"], "bluetooth range": ["bluetooth", "range"],
  "multiroom support": ["multiroom", "multi-room", "whole-home", "whole home", "group", "airplay", "rooms"], "app and smart features": ["app", "smart", "trueplay", "eq", "setup"], "voice assistant integration": ["alexa", "siri", "google assistant", "voice", "assistant"],
  "water and dust resistance": ["waterproof", "water", "dust", "ip67", "ip68", "rugged", "pool"], "portability and size": ["portable", "portab", "compact", "size", "weight", "carry"], "connectivity options": ["wi-fi", "wifi", "bluetooth", "airplay", "spotify connect", "line-in", "hdmi", "usb-c"],
  "build quality and durability": ["build", "durab", "sturdy", "premium feel"], "value for money": ["price", "value", "expensive", "cheap", "cost", "$", "afford", "budget", "worth"], "brand reliability and warranty": ["reliab", "warranty", "support", "app update", "fail", "issue", "longev"],
`);
patch("roadmap guard", '$("roadmap").innerHTML = [', 'if ($("roadmap")) $("roadmap").innerHTML = [');
patch("title", "document.title = `${def.title} · ${D.subjectLabel} AI Visibility`;", "document.title = `${def.title} · ${D.subjectLabel} ${CATS} · AI Visibility`;");

// 7 · retail audit pages
patch("retail nav", "const PAGES = NAV.flatMap(g => g.pages);", "if (window.RetailAudit) RetailAudit.extendNav(NAV);\nconst PAGES = NAV.flatMap(g => g.pages);");
patch("retail icons", "${I[k] || I.grid}</svg>`;", "${I[k] || (window.RetailAudit && RetailAudit.icons[k]) || I.grid}</svg>`;");
patch("retail tpl", "<div class=\"stack-v\">${TPL[p.id]()}</div>", "<div class=\"stack-v\">${(TPL[p.id] || (() => RetailAudit.tpl(p.id)))()}</div>");
patch("retail default", `const DEFAULT_HASH = /sony-aeo|workbench/.test(location.pathname) ? "#scorecard" : "#overview";`,
  `const DEFAULT_HASH = /sony-aeo|workbench/.test(location.pathname) ? "#scorecard" : window.RetailAudit && RetailAudit.on ? "#ra-scorecard" : "#overview";`);
patch("retail rerender", "for (const f of [renderCfg, syncChrome, renderCanvas, renderLenses, renderOverview, renderEngines, renderQuestionBank, renderCatalog, renderPageLeads]) {",
  "for (const f of [renderCfg, syncChrome, renderCanvas, renderLenses, renderOverview, renderEngines, renderQuestionBank, renderCatalog, renderPageLeads, renderRetail]) {");
patch("retail api", "function rerender() {", `// the retail pages read the answers through the console, so its scope and lens filters apply to them
window.__AIV = { get D() { return D; }, activeAnswers: () => activeAnswers(), compareAnswers: () => compareAnswers(), shareOf: (a) => shareOf(a),
  compareLabel: () => compareLabel(), engLabel: (e) => engLabel(e), openQuestion: (id) => window.openQuestion(id) };
function renderRetail() { if (window.RetailAudit) RetailAudit.render(window.__AIV); }
function rerender() {`);
patch("retail route title", "document.title = `${def.title} · ${D.subjectLabel} ${CATS} · AI Visibility`;", "document.title = `${def.title} · ${D.subjectLabel} ${CATS} · ${def.id.startsWith(\"ra-\") ? \"Command Center\" : \"AI Visibility\"}`;");

// 8 · weeks: the pooled capture is the default, Change Over Time reads the weeks one by one
patch("weeks tpl", '<div id="lens-drift"></div><div id="lens-vol"></div>', '<div id="lens-weeks"></div><div id="lens-drift"></div><div id="lens-vol"></div>');
patch("weeks lens", "  // 11 drift\n", readFileSync(join(dir, "weeks-lens.js"), "utf8") + "  // 11 drift\n");
patch("weeks drift lede", " — captured ${PREV.basis} and ${DTO.basis}.", " — asked in ${PREV.basis} and again in ${DTO.basis}.");
patch("weeks drift withheld", "The second capture is running today; this lens fills in when it lands.", "This lens compares each week with the one before; it fills in from Week 2.");
patch("weeks drift chip", " · API path</span>`)", "</span>`)");
patch("weeks capture aside", '<div class="v">${esc(fmtDate(CUR.capturedAt || CUR.basis))}</div>', '<div class="v">${esc(WEEKS().length > 1 ? CUR.basis : fmtDate(CUR.capturedAt || CUR.basis))}</div>');
patch("weeks vol lead", "Across ${vol.runs} same-day passes,", "Across the ${vol.runs} runs of each question within a week,");
patch("weeks pool", "RAW = { cur: D.captures[D.current],", "for (const c of Object.values(D.captures)) if (c.pooledFrom) c.answers = c.pooledFrom.flatMap(k => D.captures[k].answers);\n  RAW = { cur: D.captures[D.current],");
patch("weeks drift chip scope", "const dchip = drift ? deltaChip(", "const dchip = drift && (!LV.week || LV.week === WEEKS().length) ? deltaChip(");
patch("weeks change lead", "const parts = [];", "const parts = WEEKS().length > 1 ? [`The other pages pool all ${WEEKS().length} weeks; this page reads them one at a time.`] : [];");

// 9 · keyword search: its group joins the rail after the console's, its page is built and re-rendered with the rest
patch("kw nav", "const PAGES = NAV.flatMap(g => g.pages);", "if (window.KeywordSearch) KeywordSearch.extendNav(NAV);\nconst PAGES = NAV.flatMap(g => g.pages);");
patch("kw icons", "(window.RetailAudit && RetailAudit.icons[k]) || I.grid", "(window.RetailAudit && RetailAudit.icons[k]) || (window.KeywordSearch && KeywordSearch.icons[k]) || I.grid");
patch("kw tpl", "(TPL[p.id] || (() => RetailAudit.tpl(p.id)))()", "(TPL[p.id] || (() => (p.id.startsWith(\"kw-\") ? KeywordSearch : RetailAudit).tpl(p.id)))()");
patch("kw api", "compareLabel: () => compareLabel(), engLabel: (e) => engLabel(e), openQuestion: (id) => window.openQuestion(id) };",
  "compareLabel: () => compareLabel(), engLabel: (e) => engLabel(e), openQuestion: (id) => window.openQuestion(id), openModal: (html) => openModal(html), md: (t) => md(t) };");
patch("kw render", "function renderRetail() { if (window.RetailAudit) RetailAudit.render(window.__AIV); }",
  "function renderRetail() { if (window.RetailAudit) RetailAudit.render(window.__AIV); if (window.KeywordSearch) KeywordSearch.render(window.__AIV); }");

const header = `// GENERATED by dashboard/patch-ai-visibility.mjs from vendor/ai-visibility.reference.js
// (command-center-template, feat/measured-only-dashboards). Edit the patch script, not this file.\n`;
writeFileSync(join(dir, "public", "ai-visibility.js"), header + src);
console.log("ai-visibility.js written");
