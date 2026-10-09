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
//      run 1 only, here the filters choose (default: both personas, all runs).
//   3. The volatility lens is built from the three runs of this capture, per
//      persona, instead of a separate volatility set.
//   4. Answer receipts name the persona and run beside the engine.
//   5. The live run, workbench, landscape and method pages are not built.

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
// persona and run filters (this tool): RAW keeps the captures as loaded, CUR / PREV / DTO / APIC
// are the filtered views every page reads
const LV = { persona: "", run: 0 };
let RAW = null;
const lensCap = (cap) => cap && { ...cap, answers: cap.answers.filter(a => (!LV.persona || a.persona === LV.persona) && (!LV.run || a.run === LV.run)) };
function applyLens() {
  CUR = lensCap(RAW.cur); PREV = lensCap(RAW.prev); DTO = lensCap(RAW.dto); APIC = lensCap(RAW.apic);
  const byRun = {}; for (const a of RAW.cur.answers) if (!LV.persona || a.persona === LV.persona) (byRun[a.run] ||= []).push(a);
  const runs = Object.keys(byRun).sort();
  D.volatility = runs.length >= 2 ? { runs: runs.map(r => ({ run: "run " + r, capturedAt: RAW.cur.capturedAt, engineSource: RAW.cur.engineSource, answers: byRun[r] })) } : null;
}
const personaLabel = (id) => ((D.personas || []).find(p => p.id === id) || {}).label || id || "";
window.setLens = (k, v) => { LV[k] = k === "run" ? +v : v; applyLens(); rerender(); syncLensChrome(); };
function syncLensChrome() {
  document.querySelectorAll("[data-lens-k]").forEach(b => b.classList.toggle("on", String(LV[b.dataset.lensK]) === b.dataset.lensV));
}
function buildLensChrome() {
  const host = $("lensSet"); if (!host) return;
  const seg = (k, opts) => \`<div class="seg mini" role="group">\${opts.map(([v, l]) => \`<button data-lens-k="\${k}" data-lens-v="\${v}" onclick="setLens('\${k}','\${v}')">\${esc(l)}</button>\`).join("")}</div>\`;
  host.innerHTML = seg("persona", [["", "Both personas"], ...(D.personas || []).map(p => [p.id, p.label])]) + seg("run", [["0", "All runs"], ...Array.from({ length: D.runs || 1 }, (_, i) => [String(i + 1), "Run " + (i + 1)])]);
  syncLensChrome();
}`);

// 3 · volatility pairs are per persona
{
  const from = "const k = `${a.queryId}|${a.engine}`; (pairs[k] ||= []).push(";
  const n = src.split(from).length - 1;
  if (n !== 2) throw new Error(`patch "volatility pairs": expected 2 matches, found ${n}`);
  src = src.split(from).join("const k = `${a.queryId}|${a.engine}|${a.persona || \"\"}`; (pairs[k] ||= []).push(");
}

// 4 · receipts name persona and run
patch("proof labels", "${ans.map(a => engRow(a, { label: eng[a.engine] || a.engine, body: md(a.text, hl) })).join(\"\")}",
  "${[...ans].sort((x, y) => String(x.engine).localeCompare(y.engine) || String(x.persona).localeCompare(y.persona) || x.run - y.run).map(a => engRow(a, { label: `${eng[a.engine] || a.engine} · ${personaLabel(a.persona)} · run ${a.run}`, body: md(a.text, hl) })).join(\"\")}");
patch("qhead count", "named by ${named} of ${ans.length} engine${ans.length === 1 ? \"\" : \"s\"}", "named in ${named} of ${ans.length} answer${ans.length === 1 ? \"\" : \"s\"}");

// copy that described the reference's own capture history
patch("drift path", "the same path (the engines' APIs with web search, as the July launch report used)", "the same collection method (both personas, three runs, US)");
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
  ["vol lens day", "on the same day (the other engines' passes are queued)", "in this collection"],
  ["movers title", "(API path, like for like)", "(like for like)"],
  ["drift kpi", "Like for like on the engines' API path, ", "Like for like, "],
  ["drift read", "like for like on the API path, ${SL}'s share moved from <b>", "like for like, ${SL}'s share moved from <b>"],
  ["vol read", "Across ${vol.runs} passes of the volatility set,", "Across the ${vol.runs} runs of every question,"],
  ["vol cadence", "a single pass is a sketch, which is why the production cadence is seven.", "a single pass is a sketch, which is why every question is asked three times."],
]) patch(name, from, to);

patch("roadmap guard", '$("roadmap").innerHTML = [', 'if ($("roadmap")) $("roadmap").innerHTML = [');
patch("title", "document.title = `${def.title} · ${D.subjectLabel} AI Visibility`;", "document.title = `${def.title} · ${D.subjectLabel} ${CATS} · AI Visibility`;");

const header = `// GENERATED by dashboard/patch-ai-visibility.mjs from vendor/ai-visibility.reference.js
// (command-center-template, feat/measured-only-dashboards). Edit the patch script, not this file.\n`;
writeFileSync(join(dir, "public", "ai-visibility.js"), header + src);
console.log("ai-visibility.js written");
