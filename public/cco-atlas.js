/* Ask Atlas: a chat over the brand's prepared analyses, with saved conversations and a Claude fallback */
(function () {
"use strict";
const A = () => window.__ATLAS;
const THINK_MS = 10000;
const MAX_CHATS = 30;
const MATCH = {
  "black-friday": /black\s*friday|bfcm|cyber\s*monday|thanksgiving|holiday/i,
  "price-per-wipe": /per\s*wipe|per\s*100|unit\s*price|cheap|expensive|premium|value|pric(e|ing)\s*position/i,
  "big-deal-days": /prime|big\s*deal|deal\s*days|october\s*event/i,
  availability: /stock|availab|out\s*of|oos|unavailable|buyable/i,
  reviews: /review|rating|complain|love|hate|durab|soft|customer|shopper.*say/i,
  "ai-visibility": /\bai\b|chatgpt|gemini|claude|llm|engine|answer\s*share|mention/i,
};

let atlas = null, brand = "", subject = "", chats = [], current = null, busy = false;

const storeKey = () => `atlas_chats_${subject}`;
function load() { try { chats = JSON.parse(localStorage.getItem(storeKey()) || "[]"); } catch (e) { chats = []; } }
function save() { try { localStorage.setItem(storeKey(), JSON.stringify(chats.slice(0, MAX_CHATS))); } catch (e) {} }
const answerOf = (id) => atlas.answers.find((a) => a.id === id) || null;
const matchAnswer = (text) => { const exact = atlas.answers.find((a) => a.question.toLowerCase() === text.trim().toLowerCase()); if (exact) return exact; const hit = Object.keys(MATCH).find((id) => MATCH[id].test(text)); return hit ? answerOf(hit) : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function shell(host) {
  const { esc, svg } = A();
  host.innerHTML = `<div class="atl">
    <section class="atl-main"><div class="atl-stream" id="atlStream" aria-live="polite"></div>
      <form class="atl-input" id="atlForm"><div class="atl-box"><label for="atlQ" class="atl-sr">Ask Atlas</label>
        <textarea id="atlQ" rows="1" placeholder="Ask Atlas about ${esc(brand)}…"></textarea>
        <button type="submit" class="atl-send" id="atlSend" aria-label="Send">${svg("send")}</button></div></form>
    </section>
    <aside class="atl-side" aria-label="Conversation history">
      <button type="button" class="atl-new" id="atlNew">${svg("plus")}<span>New chat</span></button>
      <div class="atl-hist-wrap" id="atlHist"></div>
    </aside></div>`;
  const q = host.querySelector("#atlQ");
  q.addEventListener("input", () => { q.style.height = "auto"; q.style.height = Math.min(160, q.scrollHeight) + "px"; });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); host.querySelector("#atlForm").requestSubmit(); } });
  host.querySelector("#atlForm").addEventListener("submit", (e) => { e.preventDefault(); const t = q.value.trim(); if (!t || busy) return; q.value = ""; q.style.height = "auto"; ask(host, t); });
  host.querySelector("#atlNew").onclick = () => { if (busy) return; current = null; renderHist(host); renderChat(host); window.scrollTo({ top: 0 }); q.focus(); };
  renderHist(host); renderChat(host);
}

const DAY = 86_400_000;
function bucket(at) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t = start.getTime();
  return at >= t ? "Today" : at >= t - DAY ? "Yesterday" : at >= t - 7 * DAY ? "Previous 7 days" : "Older";
}

function renderHist(host) {
  const { esc, svg } = A();
  const el = host.querySelector("#atlHist");
  if (!chats.length) { el.innerHTML = `<div class="atl-empty-hist">${svg("chat")}<b>No conversations yet</b><span>Pick a question or ask your own. Chats are saved in this browser.</span></div>`; return; }
  const groups = [];
  for (const c of chats) { const g = bucket(c.at); const last = groups[groups.length - 1]; if (last && last.g === g) last.list.push(c); else groups.push({ g, list: [c] }); }
  el.innerHTML = groups.map(({ g, list }) => `<h6>${g}</h6>${list.map((c) => `<div class="atl-hist ${current && current.id === c.id ? "on" : ""}" data-id="${esc(c.id)}">
      <button type="button" class="atl-hist-open" title="${esc(c.title)}"><span>${esc(c.title)}</span><small>${esc(new Date(c.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</small></button>
      <button type="button" class="atl-hist-del" aria-label="Delete this chat" title="Delete">${svg("trash")}</button></div>`).join("")}`).join("");
  el.querySelectorAll(".atl-hist").forEach((row) => {
    row.querySelector(".atl-hist-open").onclick = () => { if (busy) return; current = chats.find((c) => c.id === row.dataset.id) || null; renderHist(host); renderChat(host); };
    row.querySelector(".atl-hist-del").onclick = () => { if (busy) return; chats = chats.filter((c) => c.id !== row.dataset.id); if (current && current.id === row.dataset.id) current = null; save(); renderHist(host); renderChat(host); };
  });
}

function renderChat(host) {
  const { esc, svg, ICON } = A();
  const stream = host.querySelector("#atlStream");
  if (!current) {
    stream.innerHTML = `<div class="atl-hello"><h1>Hello, ${esc(brand)} team</h1><p>Ask about price, stock, reviews or AI visibility, or start from one of these analyses.</p>
      <div class="atl-sugg">${atlas.answers.map((a) => `<button type="button" class="atl-card" data-q="${esc(a.id)}"><b>${svg(ICON[a.id])}</b><span><span class="atl-tag">${esc(a.chip.split(" · ")[0])}</span><span class="atl-cq">${esc(a.question)}</span></span></button>`).join("")}</div></div>`;
    stream.querySelectorAll(".atl-card").forEach((b) => b.onclick = () => { if (!busy) ask(host, answerOf(b.dataset.q).question, b.dataset.q); });
    return;
  }
  stream.innerHTML = "";
  for (const m of current.msgs) stream.appendChild(msgNode(m));
}

function msgNode(m) {
  const { esc } = A();
  const wrap = document.createElement("div");
  if (m.role === "user") { wrap.className = "atl-u"; wrap.textContent = m.text; return wrap; }
  wrap.className = "atl-a";
  wrap.innerHTML = `<div class="atl-av">${A().svg("spark")}</div><div class="atl-body"></div>`;
  const body = wrap.querySelector(".atl-body");
  if (m.answer) fillAnswer(body, answerOf(m.answer), true);
  else body.innerHTML = m.error ? `<p class="atl-err">${esc(m.text)}</p>` : `<div class="atl-llm">${md(m.text)}</div>`;
  return wrap;
}

function md(text) {
  const { esc } = A();
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n{2,}/).map((p) => /^\s*[-•]\s/m.test(p)
    ? `<ul>${p.split(/\n/).filter((l) => l.trim()).map((l) => `<li>${l.replace(/^\s*[-•]\s*/, "")}</li>`).join("")}</ul>` : `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

function stepsHtml(a, done) {
  const { esc } = A();
  return `<details class="atl-think" ${done ? "" : "open"}><summary>${done ? `Analysed ${a.steps.length} steps` : "Analysing…"}<span class="atl-timer"></span></summary><ol>${a.steps.map((s) => `<li class="${done ? "done" : "wait"}"><i></i><span>${esc(s)}</span></li>`).join("")}</ol></details>`;
}

function fillAnswer(body, a, done) {
  const { esc, svg, kpisHtml, wwwHtml, insightHtml, actionsHtml, blocksHtml, drawCharts } = A();
  if (!a) { body.innerHTML = `<p class="atl-err">This analysis is no longer available.</p>`; return; }
  const r = blocksHtml(a.blocks, `chat-${a.id}-${Math.random().toString(36).slice(2, 7)}`);
  body.innerHTML = `${stepsHtml(a, done)}<p class="atl-head">${esc(a.headline)}</p>${kpisHtml(a.kpis)}${insightHtml(a)}${wwwHtml(a)}${r.html}${actionsHtml(a)}
    <div class="atl-actions"><a class="atl-report-btn" href="#${esc(a.link.page)}">View full report · ${esc(a.link.label)} ${svg("arrow")}</a><span class="atl-src">${esc(atlas.sources.join(" · "))}</span></div>`;
  drawCharts(body, r.keyed);
}

function newChat(title) {
  current = { id: `c${Date.now().toString(36)}`, title: title.slice(0, 90), at: Date.now(), msgs: [] };
  chats.unshift(current);
}

async function ask(host, text, picked) {
  busy = true;
  host.querySelector("#atlSend").disabled = true;
  host.querySelector("#atlNew").disabled = true;
  if (!current) newChat(picked ? answerOf(picked).chip : text);
  const stream = host.querySelector("#atlStream");
  if (current.msgs.length === 0) stream.innerHTML = "";
  const userMsg = { role: "user", text };
  current.msgs.push(userMsg); stream.appendChild(msgNode(userMsg));
  save(); renderHist(host);
  const a = picked ? answerOf(picked) : matchAnswer(text);
  const node = document.createElement("div");
  node.className = "atl-a busy";
  node.innerHTML = `<div class="atl-av">${A().svg("spark")}</div><div class="atl-body"></div>`;
  stream.appendChild(node);
  const body = node.querySelector(".atl-body");
  node.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  let msg;
  if (a) {
    body.innerHTML = stepsHtml(a, false);
    const items = body.querySelectorAll(".atl-think li"), timer = body.querySelector(".atl-timer"), t0 = Date.now();
    const tick = setInterval(() => { timer.textContent = `${((Date.now() - t0) / 1000).toFixed(1)}s`; }, 100);
    const per = reduced() ? 0 : THINK_MS / items.length;
    for (const li of items) { li.className = "run"; await sleep(per * (0.75 + Math.random() * 0.5)); li.className = "done"; }
    clearInterval(tick);
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    fillAnswer(body, a, true);
    const sum = body.querySelector(".atl-think summary");
    if (sum) sum.innerHTML = `Analysed ${a.steps.length} steps<span class="atl-timer">${took}s</span>`;
    msg = { role: "atlas", answer: a.id };
  } else {
    body.innerHTML = `<details class="atl-think" open><summary>Asking Claude with the ${A().esc(brand)} data…</summary><ol><li class="run"><i></i><span>Reading the prepared analyses and the question</span></li></ol></details>`;
    msg = await askClaude(text);
    body.innerHTML = msg.error ? `<p class="atl-err">${A().esc(msg.text)}</p>` : `<div class="atl-llm">${md(msg.text)}</div>`;
  }
  node.classList.remove("busy");
  current.msgs.push(msg); current.at = Date.now();
  chats = [current, ...chats.filter((c) => c.id !== current.id)];
  save(); renderHist(host);
  busy = false;
  host.querySelector("#atlSend").disabled = false;
  host.querySelector("#atlNew").disabled = false;
}

function context() {
  return atlas.answers.map((a) => `## ${a.question}\n${a.headline}\nWhat: ${a.what}\nWhy: ${a.why}\nWhen: ${a.when}\nFigures: ${a.kpis.map((k) => `${k.label} ${k.value}${k.note ? ` (${k.note})` : ""}`).join("; ")}`).join("\n\n");
}

async function askClaude(text) {
  const system = `You are Atlas, a commercial analyst for ${brand} (flushable wipes) against its competitors. Answer only from the analyses below, which come from ${atlas.sources.join(", ")}. Quote the figures as given. If the data does not cover the question, say so in one sentence and name the closest analysis you can offer. Write two to four short paragraphs or a short list, no headings, under 200 words.\n\n${context()}`;
  const history = current.msgs.filter((m) => m.role === "user" || (m.text && !m.error)).slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
  try {
    const res = await fetch("/api/llm", { method: "POST", headers: { "content-type": "application/json", ...(window.__CC_AUTH ? { authorization: window.__CC_AUTH } : {}) }, body: JSON.stringify({ system, messages: history, max_tokens: 1200, temperature: 0.2 }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { role: "atlas", error: true, text: res.status === 429 ? "Too many questions this hour on this link. Try one of the prepared analyses above." : `Atlas could not reach Claude (${json.message || res.status}). The six prepared analyses still work.` };
    const out = (json.content || []).map((c) => c.text || "").join("").trim();
    return out ? { role: "atlas", text: out } : { role: "atlas", error: true, text: "Claude returned an empty answer. Try rephrasing the question." };
  } catch (e) {
    return { role: "atlas", error: true, text: "Atlas could not reach Claude. Check the connection and try again." };
  }
}

function onRoute(def) {
  document.body.classList.toggle("atlas-on", !!def);
  if (!def) return;
  requestAnimationFrame(() => {
    const host = document.getElementById(`pg-${def.id}`);
    if (!host) return;
    if (!host.querySelector(".atl")) shell(host);
  });
}

function register() {
  const cc = window.__CC;
  if (!cc || !cc.D || !window.__CCEXT || !window.__ATLAS) return false;
  if (!cc.D.atlas || !cc.D.atlas.answers || !cc.D.atlas.answers.length) return true;
  atlas = cc.D.atlas; brand = cc.SUBJ || atlas.brand; subject = cc.S || "brand";
  load();
  window.__CCEXT.register({ id: "atlas", onRoute, groups: [{ id: "atlas", label: "Ask Atlas", ext: "atlas", after: "overview", pages: [
    { id: "atlas", label: "Ask Atlas", icon: "sparkle", crumb: "Ask Atlas", title: "Ask Atlas", ext: "atlas", managed: true },
  ] }] });
  return true;
}

const timer = setInterval(() => { if (register()) clearInterval(timer); }, 150);
})();
