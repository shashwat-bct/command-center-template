/* ===========================================================================
   CARD HELP + ASK — the "?" in the corner of every card
   ---------------------------------------------------------------------------
   Two things behind one affordance:

     hover   a definition of what the card is communicating — the measure, not
             the reading, so it stays true whatever the numbers do
     ask     a chat grounded in THIS CARD'S OWN DATA

   The grounding is the point. Every chart records the spec it was drawn from
   (see cco-charts.js), so the question goes to the model with the same series,
   rows and labels the reader is looking at — not a description of them. The
   prompt forbids outside knowledge and invented figures, and the disclosure
   travels with it, so an answer cannot quietly promote an extrapolation into a
   measurement.

   Everything here fails soft: no network, no token, no answer — the card is
   exactly as it was.
   =========================================================================== */
(function (root) {
"use strict";

// The project's public web API key, same one the analytics tracker and every
// report page uses. Anonymous sign-in is what /api/llm authenticates against.
const FB_KEY = "AIzaSyDWw1rB68sh02LhXsTVup0Q6A6UakLXRl0";
const MAXC = 7000;              // characters of card data sent with a question

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ── the singleton popover ─────────────────────────────────────────────── */
let pop = null, anchor = null, pinned = false, hideT = null, busy = false, thread = [];

function build() {
  if (pop) return pop;
  pop = document.createElement("div");
  pop.className = "qpop";
  pop.innerHTML = `
    <div class="qp-body">
      <h4 class="qp-t"></h4>
      <p class="qp-d"></p>
      <button type="button" class="qp-ask">Ask me any question</button>
    </div>
    <div class="qp-chat" hidden>
      <div class="qc-h"><b class="qc-t"></b><button type="button" class="qc-x" aria-label="Close">×</button></div>
      <div class="qc-msgs"></div>
      <form class="qc-in"><textarea rows="1" placeholder="Ask about this card…" aria-label="Ask about this card"></textarea>
        <button type="submit" class="qc-send" aria-label="Send">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M5 12h13M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button></form>
      <p class="qc-note">Answers come only from the data behind this card and the dashboard's own disclosure.</p>
    </div>`;
  document.body.appendChild(pop);

  pop.addEventListener("mouseenter", () => clearTimeout(hideT));
  pop.addEventListener("mouseleave", () => { if (!pinned) hideT = setTimeout(close, 180); });
  $(".qp-ask", pop).onclick = openChat;
  $(".qc-x", pop).onclick = close;
  $(".qc-in", pop).onsubmit = (e) => { e.preventDefault(); send(); };
  const ta = $(".qc-in textarea", pop);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(96, ta.scrollHeight) + "px"; });
  return pop;
}

/* ── open / place / close ──────────────────────────────────────────────── */
function openFor(btn) {
  clearTimeout(hideT);
  if (anchor === btn && pop && pop.classList.contains("on")) return;
  build();
  anchor = btn;
  pinned = false; thread = [];
  $(".qp-t", pop).textContent = btn.dataset.title || "About this card";
  $(".qp-d", pop).textContent = btn.dataset.help || "";
  $(".qc-t", pop).textContent = btn.dataset.title || "";
  $(".qc-msgs", pop).innerHTML = "";
  $(".qp-chat", pop).hidden = true;
  pop.classList.add("on"); pop.classList.remove("chatting");
  place();
}
function place() {
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const chatting = pop.classList.contains("chatting");
  const bodyW = 306, chatW = chatting ? 348 : 0, gap = chatting ? 10 : 0;
  const total = bodyW + chatW + gap;
  // The description sits under the "?"; the chat opens to its right, and the
  // pair shifts left only as far as it must to stay on screen.
  let x = r.right + window.scrollX - bodyW;
  const maxX = window.scrollX + document.documentElement.clientWidth - total - 14;
  if (x > maxX) x = maxX;
  if (x < window.scrollX + 14) x = window.scrollX + 14;
  pop.style.left = Math.round(x) + "px";
  pop.style.top = Math.round(r.bottom + window.scrollY + 9) + "px";
}
function close() {
  clearTimeout(hideT);
  if (!pop) return;
  pop.classList.remove("on", "chatting");
  $(".qp-chat", pop).hidden = true;
  anchor = null; pinned = false; thread = [];
}
function openChat() {
  if (!pop) return;
  pinned = true;
  $(".qp-chat", pop).hidden = false;
  pop.classList.add("chatting");
  place();
  if (!$(".qc-msgs .qm", pop)) {
    add("a", "Ask anything about this card — what it means, why it moved, how it compares. I answer from the numbers behind this card only.");
  }
  setTimeout(() => { const t = $(".qc-in textarea", pop); if (t) t.focus(); }, 40);
}

/* ── grounding: what this card actually holds ──────────────────────────── */
const r3 = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : v);
const DROP = /^(tip|fmt|on|color|soft|style|aria|height|width|legend|bands|ramp|invert|corner|zero|xZero|yZero|normalize|area|min|max)/;

// A spec is turned into compact JSON: functions, colours and presentation keys
// go, long arrays are thinned to 24 evenly spaced points and said to be thinned,
// numbers are rounded. What survives is labels and values — the same ones the
// chart drew.
function compact(v, depth) {
  if (v == null) return v;
  if (typeof v === "function" || v instanceof Node) return undefined;
  if (typeof v === "number") return r3(v);
  if (typeof v !== "object") return v;
  if (depth > 4) return undefined;
  if (Array.isArray(v)) {
    let a = v, note = null;
    if (a.length > 24) { const k = (a.length - 1) / 23; a = Array.from({ length: 24 }, (_, i) => v[Math.round(i * k)]); note = a.length; }
    const out = a.map((x) => compact(x, depth + 1)).filter((x) => x !== undefined);
    if (note) out.__thinned = v.length;
    return out;
  }
  const o = {};
  for (const k in v) {
    if (DROP.test(k)) continue;
    const c = compact(v[k], depth + 1);
    if (c !== undefined) o[k] = c;
  }
  return Object.keys(o).length ? o : undefined;
}
function specText(kind, spec) {
  const s = { ...spec };
  // A heatmap carries its values in a function; materialise the grid or the
  // card's whole substance would be missing from its own answer.
  if (typeof s.value === "function" && Array.isArray(s.rows) && Array.isArray(s.cols)) {
    try {
      s.grid = s.rows.map((rw) => ({ row: rw.label || rw.id,
        cells: s.cols.map((c) => ({ col: c.label || c.id, v: r3(s.value(rw, c)) })) }));
    } catch (e) {}
    delete s.value;
  }
  const c = compact(s, 0);
  const thin = Array.isArray(c && c.series) && c.series.some((x) => x && x.data && x.data.__thinned);
  return `CHART (${kind})${thin ? " — series thinned to 24 evenly spaced points from the full window" : ""}:\n${JSON.stringify(c)}`;
}
function tableText(tb) {
  const rows = [...tb.querySelectorAll("tr")].slice(0, 40).map((tr) =>
    [...tr.querySelectorAll("th,td")].map((td) => td.textContent.replace(/\s+/g, " ").trim()).join(" | "));
  const more = tb.querySelectorAll("tbody tr").length - 39;
  return `TABLE:\n${rows.join("\n")}${more > 0 ? `\n(+${more} further rows not listed)` : ""}`;
}
function cardContext(card, btn) {
  const L = [];
  L.push(`CARD: ${btn.dataset.title || ""}`);
  const sub = card.querySelector(".card-h p");
  if (sub) L.push(`SUB-LINE ON THE CARD: ${sub.textContent.trim()}`);
  if (btn.dataset.help) L.push(`WHAT THIS CARD MEASURES: ${btn.dataset.help}`);
  card.querySelectorAll("*").forEach((n) => { if (n.__ccSpec) { try { L.push(specText(n.__ccSpec.kind, n.__ccSpec.spec)); } catch (e) {} } });
  card.querySelectorAll("table").forEach((tb) => { try { L.push(tableText(tb)); } catch (e) {} });
  const notes = [...card.querySelectorAll("p.mini")].map((p) => p.textContent.trim()).filter(Boolean);
  if (notes.length) L.push(`FOOTNOTES ON THE CARD: ${notes.join(" ")}`);
  let out = L.join("\n\n");
  if (out.length > MAXC) out = out.slice(0, MAXC) + "\n…(truncated)";
  return out;
}
// The dashboard-level truth that must travel with any answer.
function frameContext() {
  const D = (root.__CC || {}).D;
  if (!D) return "";
  const m = D.meta || {}, dis = m.disclosure || {};
  const L = [];
  L.push(`DASHBOARD: ${m.title || ""} — ${m.category || ""}, ${m.market || "US"}, ${m.window ? `${m.window.start} to ${m.window.end}` : ""}.`);
  L.push(`DISCLOSURE (must be respected in every answer): ${dis.headline || ""} ${dis.body || ""}`);
  if (Array.isArray(dis.anchors)) L.push(`ANCHOR LEDGER — what is measured and what is modelled:\n` +
    dis.anchors.map((a) => `- ${a.lane}: measured — ${a.measured} | pins — ${a.pins}`).join("\n"));
  const page = (location.hash || "#scorecard").slice(1);
  const reads = (D.reads || {})[page === "scorecard" ? "overview" : page];
  if (Array.isArray(reads) && reads.length) L.push(`COMPUTED READS FOR THIS PAGE:\n` + reads.map((r) => `- (${r.tone}) ${r.text}`).join("\n"));
  return L.join("\n\n");
}

/* ── the ask ───────────────────────────────────────────────────────────── */
let TOKEN = null;
async function token() {
  if (TOKEN) return TOKEN;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) }).then((x) => x.json());
  if (!r.idToken) throw new Error("no token");
  TOKEN = r.idToken; return TOKEN;
}
// Enough markdown for an answer in a narrow panel and nothing more: bold,
// bullets, paragraphs. Everything is escaped first, so nothing the model
// returns can inject markup.
function md(t) {
  const lines = esc(t).split("\n");
  let out = "", list = false;
  for (const ln of lines) {
    const s = ln.trim();
    if (/^[-*•]\s+/.test(s)) { if (!list) { out += "<ul>"; list = true; } out += `<li>${s.replace(/^[-*•]\s+/, "")}</li>`; continue; }
    if (list) { out += "</ul>"; list = false; }
    if (s) out += `<p>${s}</p>`;
  }
  if (list) out += "</ul>";
  return out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}
function add(role, html) {
  const d = document.createElement("div");
  d.className = "qm " + role;
  d.innerHTML = html;
  const box = $(".qc-msgs", pop);
  box.appendChild(d); box.scrollTop = box.scrollHeight;
  return d;
}
async function send() {
  const ta = $(".qc-in textarea", pop);
  const q = (ta.value || "").trim();
  if (!q || busy || !anchor) return;
  const card = anchor.closest(".card");
  busy = true; ta.value = ""; ta.style.height = "auto";
  $(".qc-send", pop).disabled = true;
  add("q", esc(q));
  const think = add("a", `<span class="qthink"><i></i><i></i><i></i></span>`);
  try {
    const sys = [
      `You are the analyst who built this commercial command centre. A colleague is looking at ONE CARD on it and has a question about it.`,
      `Answer using ONLY the CARD DATA and the DASHBOARD CONTEXT below. Do not use outside knowledge. Do not invent, estimate or extrapolate a number that is not there — if it is not in the data, say so plainly and point to the closest thing that is.`,
      `This dashboard is an extrapolation: levels are pinned to a capture, day-to-day movement is modelled. Never present a modelled movement as an observed one, and if a figure sits in a lane the ledger says is modelled, say so in the same sentence.`,
      `Be short and executive-ready: one line of answer first, then the numbers behind it. You are rendering in a NARROW panel — short sentences and simple "- " bullets only, never a table. Do not mention how you were built or that you are an AI.`,
      ``,
      `DASHBOARD CONTEXT:`, frameContext(),
      ``,
      `CARD DATA:`, cardContext(card, anchor),
    ].join("\n");
    const msgs = thread.concat([{ role: "user", content: q }]);
    // A standalone copy is opened from a file, where "/api/llm" resolves to
// nothing. Point it back at the site it was exported from so Ask still works.
    const api = location.protocol === "http:" || location.protocol === "https:"
      ? "/api/llm" : (root.__CCO_API_BASE || "https://atlas.brandcontext.ai") + "/api/llm";
    const auth = api === "/api/llm" ? (root.__CC_AUTH || null) : "Bearer " + (await token());
    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ system: sys, messages: msgs, max_tokens: 700, temperature: 0.2 }),
    }).then((r) => r.json());
    const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) throw new Error("empty");
    think.innerHTML = md(text);
    thread = msgs.concat([{ role: "assistant", content: text }]).slice(-8);
  } catch (e) {
    think.innerHTML = `<span class="qerr">Couldn't reach the data service just now. Try again in a moment.</span>`;
  }
  busy = false;
  $(".qc-send", pop).disabled = false;
  const box = $(".qc-msgs", pop); box.scrollTop = box.scrollHeight;
}

/* ── wiring ────────────────────────────────────────────────────────────── */
document.addEventListener("mouseover", (e) => {
  const btn = e.target.closest && e.target.closest(".cardq");
  if (btn) { openFor(btn); return; }
  if (pop && pop.contains(e.target)) clearTimeout(hideT);
});
document.addEventListener("mouseout", (e) => {
  const btn = e.target.closest && e.target.closest(".cardq");
  if (!btn || pinned) return;
  if (pop && pop.contains(e.relatedTarget)) return;
  hideT = setTimeout(close, 180);
});
document.addEventListener("focusin", (e) => {
  const btn = e.target.closest && e.target.closest(".cardq");
  if (btn) openFor(btn);
});
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest(".cardq");
  if (btn) { openFor(btn); openChat(); return; }
  if (pinned && pop && !pop.contains(e.target)) close();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop && pop.classList.contains("on")) close(); });
window.addEventListener("resize", () => { if (pop && pop.classList.contains("on")) place(); });

root.CCASK = { close };
})(window);
