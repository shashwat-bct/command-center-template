(function () {
  const r1 = (v) => Math.round(v * 10) / 10;
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  function deliveryReads(p, reads) {
    const weekly = p.delivery && p.delivery.weekly;
    const cities = (p.dims && p.dims.cities) || [];
    if (!weekly || !cities.length) return reads;
    const subject = p.meta && p.meta.subject;
    const mine = new Set(((p.dims && p.dims.models) || []).filter((m) => m.brand === subject).map((m) => m.id));
    const byCity = cities.map((c) => {
      const vals = Object.entries(weekly).filter(([k]) => { const [mid, , city] = k.split("|"); return city === c.id && mine.has(mid); }).flatMap(([, s]) => (s || []).filter((v) => v != null));
      return { c, v: mean(vals) };
    }).filter((x) => x.v != null).sort((a, b) => a.v - b.v);
    if (byCity.length < 2) return reads;
    const best = byCity[0], worst = byCity[byCity.length - 1], spread = worst.v - best.v;
    const city = spread < 0.5
      ? { tone: "good", text: `The promise holds nationally: every metro sits within ${r1(spread)} days of ${best.c.label}, the fastest at ${r1(best.v)} days.` }
      : { tone: spread >= 1 ? "risk" : "watch", text: `The promise is not national: ${worst.c.label} waits ${r1(worst.v)} days against ${r1(best.v)} in ${best.c.label} — a ${r1(spread)}-day spread on the same catalogue.` };
    return reads.map((r) => (/^The promise (is not national|holds nationally)/.test(r.text) ? city : /fastest of the \d|is the fastest/.test(r.text) && !/second|third|fourth|fifth/.test(r.text) ? { ...r, tone: "good" } : r));
  }

  function shelfReads(reads) {
    return reads.map((r) => {
      const m = r.text.match(/^Presence concentrates where the intent is specific — "([^"]+)" returns (.+?) in ([\d.]+)% of the grid, against ([\d.]+)% on the weakest term\.$/);
      if (!m || +m[3] - +m[4] >= 2) return r;
      return { tone: "watch", text: `Presence is even across the search terms — ${m[4]}% to ${m[3]}% of the grid — so no single term is carrying ${m[2]}, and none is a hole.` };
    });
  }

  function distributionReads(reads) {
    return reads.map((r) => {
      const m = r.text.match(/changed state inside the quarter: (\d+) dropped/);
      if (!m) return r;
      const dropped = +m[1];
      return { ...r, tone: dropped ? "risk" : "watch" };
    });
  }

  const money = (reads) => reads.map((r) => ({ ...r, text: r.text.replace(/\$(\d[\d,]*)\.(\d)(?!\d)/g, "$$$1.$20") }));

  /**
   * Corrects the read sentences a stored build carries: the delivery metro read is recomputed from
   * the delivery figures the page shows, and a few tones and thresholds are brought in line with the
   * builder's current rules.
   */
  function reviseReads(p) {
    const reads = p && p.reads;
    if (!reads) return p;
    if (reads.delivery) reads.delivery = deliveryReads(p, reads.delivery);
    if (reads.shelf) reads.shelf = shelfReads(reads.shelf);
    if (reads.distribution) reads.distribution = distributionReads(reads.distribution);
    for (const k of Object.keys(reads)) if (Array.isArray(reads[k])) reads[k] = money(reads[k]);
    return p;
  }

  window.CCREADS = { reviseReads };
})();
