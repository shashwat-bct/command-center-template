  // 11a week by week (patch 8): every week of the bank, like for like; the persona and run filters
  // apply, the week filter does not (this lens is the weeks side by side)
  if (WEEKS().length >= 2 && sb) {
    const W = WEEKS().map(w => { const cap = lensCap(D.captures[w.key]); const A = activeAnswers(cap), AC = compareAnswers(cap); return { w, A, AC, sh: shareOf(AC), pr: presenceOf(AC), tp: topPickShare(AC).out }; });
    const n = W.length, lastW = W[n - 1], prevW = W[n - 2];
    const pts = (a, b) => { if (a == null || b == null) return "—"; const d = Math.round((b - a) * 100); return (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d) + " pts"; };
    const tone = (a, b) => a == null || b == null ? "inherit" : b - a >= 0.005 ? "var(--good)" : b - a <= -0.005 ? "var(--crit)" : "inherit";
    const row = (label, vals, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td>${label}</td>${vals.map(v => `<td class="num">${pct(v)}</td>`).join("")}<td class="num" style="color:${tone(vals[n - 2], vals[n - 1])}">${pts(vals[n - 2], vals[n - 1])}</td></tr>`;
    const sec = (t) => `<tr><td colspan="${n + 2}" style="padding-top:14px"><b>${t}</b></td></tr>`;
    const head = `<thead><tr><th></th>${W.map(x => `<th class="num">${esc(x.w.label)}</th>`).join("")}<th class="num">${esc(prevW.w.label)} → ${esc(lastW.w.label)}</th></tr></thead>`;
    const brandRows = [...bs].sort((x, y) => (lastW.sh[y.id] ?? 0) - (lastW.sh[x.id] ?? 0)).map(b => row(`<span class="dot" style="background:${b.color}"></span> ${esc(b.label)}`, W.map(x => x.sh[b.id]), b.id === s ? "subj" : ""));
    const engRows = vEng.map(e => row(esc(engL[e] || e), W.map(x => shareOf(x.AC.filter(a => a.engine === e))[s])));
    const stRows = D.stages.map(st => row(esc(st.label), W.map(x => shareOf(stageAnswers(st.id, x.A))[s])));
    const table = `<div class="tblwrap"><table class="t">${head}<tbody>${sec(`Share of voice · brand-neutral questions (${esc(compareLabel())})`)}${brandRows.join("")}${sec(`${SL} on brand-neutral questions`)}${row(`Named in at least one answer`, W.map(x => x.pr[s].rate))}${row(`Top pick, of answers that pick one`, W.map(x => x.tp[s]))}${sec(`${SL} share by engine`)}${engRows.join("")}${sec(`${SL} share by stage`)}${stRows.join("")}</tbody></table></div>`;
    // what happened each week, against the week before
    const namedQ = (arr) => new Set(arr.filter(a => mention(a, sb)).map(a => a.queryId));
    const leader = (x) => bs.reduce((m, b) => (x.sh[b.id] ?? -1) > (x.sh[m.id] ?? -1) ? b : m, bs[0]);
    const story = W.map((x, i) => {
      const L = leader(x);
      const lead = L.id === s ? `${SL} leads the category` : `${esc(L.label)} leads at ${pct(x.sh[L.id])}`;
      if (!i) return `<li><b>${esc(x.w.label)}</b> — ${SL} holds <b>${pct(x.sh[s])}</b> share of voice, is named on ${x.pr[s].n} of ${x.pr[s].of} brand-neutral questions and is the top pick in ${pct(x.tp[s])} of answers that pick one; ${lead}.</li>`;
      const p = W[i - 1]; const now = namedQ(x.A), then = namedQ(p.A);
      const gained = [...now].filter(k => !then.has(k)).length, lost = [...then].filter(k => !now.has(k)).length;
      const mover = bs.filter(b => b.id !== s).map(b => ({ b, d: (x.sh[b.id] ?? 0) - (p.sh[b.id] ?? 0) })).sort((u, v) => Math.abs(v.d) - Math.abs(u.d))[0];
      return `<li><b>${esc(x.w.label)}</b> — ${SL}'s share <span style="color:${tone(p.sh[s], x.sh[s])}">${pts(p.sh[s], x.sh[s])}</span> to <b>${pct(x.sh[s])}</b>; top pick ${pct(p.tp[s])} → ${pct(x.tp[s])}. ${gained} question${gained === 1 ? "" : "s"} gained a ${SL} mention and ${lost} lost one.${mover && Math.abs(mover.d) >= 0.005 ? ` Biggest rival move: ${esc(mover.b.label)} ${pts(0, mover.d)}.` : ""} ${lead}.</li>`;
    });
    const viz = table + `<h4 style="margin:16px 0 6px">What happened each week</h4><ul class="note" style="margin:0;padding-left:18px;line-height:1.6">${story.join("")}</ul>`;
    cards.push(lensCard("weeks", "Lens 11a · Week by week", `${SL}, week by week`, `The same ${activeQueries().length} questions, engines and reader every week, with the same collection method (both personas, three runs, US). The other pages pool all ${n} weeks; this lens reads them one at a time.`, viz,
      `From ${esc(prevW.w.label)} to ${esc(lastW.w.label)}, ${SL}'s share of voice went ${pct(prevW.sh[s])} → ${pct(lastW.sh[s])}. A move smaller than the run-to-run spread in Lens 10 is noise; one that holds for several weeks is a trend.`));
  }
