// =============================================================================
// THE ANCHOR LEDGER — shared by every command-centre instance
// =============================================================================
// A function, not a literal, so every figure in it is read out of the source it
// describes. A ledger that restates its measurements by hand is the one place on
// this dashboard where a number could quietly stop being true: nothing validates
// prose, and the sentence outlives the capture it was written from.
// =============================================================================
export default (ctx) => {
  const { LAUNCH, MULTI, PROMO, pct } = ctx;
    const dr = LAUNCH.pricing.discountRate, ins = LAUNCH.retail.inStock;
    const L = Object.fromEntries(LAUNCH.brands.map((b) => [b.id, b.label]));
    const list = (o, f) => Object.keys(o).map((k) => `${L[k] || k} ${f(o[k])}`).join(", ");
    const mh = LAUNCH.modelHistory;
    const promoCount = PROMO.rows.reduce((a, r) => a + (r.promos || []).length, 0);
    // Where the instance shows more of the market than its capture read — a
    // retail estate extrapolated from one measured retailer, metros extrapolated
    // from one national promise — the ledger leads with that, in the reader's
    // terms, before any lane. The whole dashboard is a simulated forward view;
    // this row is where it says how far the simulation reaches.
    const cov = MULTI.coverage || {};
    const scopeRow = (cov.extrapolated || []).length ? [{
      lane: "Scope",
      measured: `MEASURED: ${(cov.measured || []).join("; ")}.`,
      source: `${MULTI.stem || "capture"} · ${String(MULTI.capturedAt).slice(0, 10)}`,
      pins: `EXTRAPOLATED FROM IT: ${(cov.extrapolated || []).join("; ")}. Those lanes are modelled around the measured anchors on the same machinery this dashboard uses everywhere else — read them as the shape a quarter would take, not as observations.`,
      extrapolated: true,
    }] : [];
    return [
      ...scopeRow,
      { lane: "Pricing", measured: `Street price, list price, discount rate and offer count for ${mh.models.length} Amazon listings across ${new Set(mh.models.map((m) => m.brand)).size} brands, monthly ${mh.months[0]} to ${mh.months.at(-1)}`,
        source: `audited price history · ${MULTI.stem ? "" : ""}${LAUNCH.event.id}`, pins: `Every daily price ladder is bounded by its brand's measured discount rate — ${list(dr, pct)}.` },
      { lane: "Pricing", measured: `PDP shelf price for ${MULTI.models.length} models across ${MULTI.retailers.length} retailers, captured ${MULTI.capturedAt.slice(0, 10)}`,
        source: "multi-retailer capture · .matrix", pins: "Each simulated ladder is scaled to land on the captured price at the capture date." },
      { lane: "Promotions", measured: `${promoCount} promotion verbatims across ${PROMO.rows.length} product pages, each located and outlined in the captured image`,
        source: "pdp-promo capture", pins: "The mechanic set, the per-retailer mix, and every promotion type shown." },
      { lane: "Distribution", measured: `Carriage state for ${MULTI.matrix.length} model-by-retailer cells`,
        source: "multi-retailer capture · .matrix.carriage", pins: "Carried and not-carried cells are held fixed; only 'not readable' cells are extrapolated." },
      { lane: "Availability", measured: `Share of days in the last audited month with a buyable Amazon offer — ${list(ins, pct)}`,
        source: "audited price-history record · .retail.inStock", pins: "The target in-stock rate each simulated episode series is drawn against." },
      { lane: "Delivery", measured: `${(MULTI.deliveryRows || []).length} delivery-promise readings across ${MULTI.models.length} models, ${MULTI.retailers.length} retailers and ${MULTI.delivery.cities.length} cities`,
        source: "delivery-cities probe + .deliveryRows", pins: "Week-one lead time for every model-retailer-city triple that was captured." },
      { lane: "Shelf", measured: `Share of the result grid per retailer per search term across ${MULTI.shelf.terms.length} terms, 3 passes`,
        source: "multi-retailer capture · .shelf.sov", pins: "The level each daily shelf-share series reverts to." },
      { lane: "AI answer", measured: `Share of the AI answer across ${Object.keys(LAUNCH.aiSearch.byEngine).length} engines by funnel stage. Any engine shown on the dashboard beyond those is modelled off their mean and is a column of illustration, not a measurement.`,
        source: "launch report · .aiSearch", pins: "The per-engine and per-stage level each daily series reverts to, for the engines that were captured." },
      { lane: "Voice", measured: `Amazon star rating weighted by rating count, and monthly aspect scores from captured reviews across ${LAUNCH.retail.aspects.aspects.length} aspects`,
        source: "launch report · .retail.rating / .retail.aspects", pins: "Rating levels, and every aspect month that had a real reading is passed through untouched." },
      (() => {
        // The traffic lane used to carry no anchor at all. It now carries one for
        // every brand whose own domain can stand for it, and withholds the rest.
        const sw = ctx.SW;
        if (!sw) return { lane: "Traffic", measured: "NOTHING. No traffic capture is present in this checkout.", source: "—", unmeasured: true,
          pins: "Levels sized to the order of magnitude a panel reports for these domains, and shaped by the same events as every other lane. Illustrative of the measure, not of the brand." };
        // Only this instance's own brands: the capture file holds every domain
        // read for every instance, and a ledger that listed them all would credit
        // this dashboard with measurements taken for another one.
        const mine = (ctx.BIDS || Object.keys(sw.brands)).map((id) => sw.brands[id]).filter(Boolean);
        const use = mine.filter((b) => b.usable && b.usVisits);
        const wide = use.filter((b) => b.proxyQuality === "multiLine");
        const held = mine.filter((b) => !b.usable);
        return { lane: "Traffic",
          measured: `Monthly visits, US share, bounce rate, pages per visit, visit duration, leading channel and country mix for ${use.length} of ${mine.length} brand domains — ${use.map((b) => `${b.domain} ${(b.visitsMonthly / 1e6).toFixed(1)}M`).join(", ")}. ` +
                    (held.length ? `${held.map((b) => b.domain).join(" and ")} captured but WITHHELD: the domain is not a fair proxy for the product line, so the whole lane is null for ${held.length === 1 ? "that brand" : "those brands"} rather than modelled. ` : "") +
                    (wide.length ? `${wide.map((b) => b.domain).join(" and ")} ${wide.length === 1 ? "is a whole-domain read" : "are whole-domain reads"}: real, but covering more than this category, and labelled that way wherever ${wide.length === 1 ? "it appears" : "they appear"}.` : ""),
          source: `public website traffic profile, ${String(sw.capturedAt).slice(0, 10)}`,
          pins: "The session level for each measured brand, its bounce, pages per visit and duration, its leading channel share, and its country mix. NOT the day-to-day shape — the profile publishes a monthly figure, so the movement across the quarter is still modelled — not the rest of the channel split, which sits behind a subscription, not add-to-cart, which is published nowhere, and not the retail product-page split, which is modelled from shelf presence and retailer weight." };
      })(),
    ];
  };
