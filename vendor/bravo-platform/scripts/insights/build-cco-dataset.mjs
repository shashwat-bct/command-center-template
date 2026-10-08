#!/usr/bin/env node
// =============================================================================
// COMMERCIAL COMMAND CENTER — extrapolated dataset builder (one per subject)
// =============================================================================
//   node scripts/insights/build-cco-dataset.mjs --brand sonos|sony
//
// WHAT THIS IS, SAID PLAINLY
// --------------------------
// Every measured lane we hold for a brand is a SNAPSHOT: one capture of shelf share,
// one capture of PDP promotions across five retailers, one capture of delivery
// promises across six cities, six monthly Keepa readings. A Chief Commercial
// Officer cannot plan off a snapshot. This builder answers the question "what
// would this look like after a quarter of continuous collection?" by taking the
// measured snapshot as the ANCHOR and extrapolating a 13-week daily panel around
// it, with seasonality, promotional cycles, stock episodes and competitive
// response.
//
// THE NUMBERS IN THE OUTPUT ARE SIMULATED, NOT MEASURED. That is the point of
// the artefact and it is disclosed on every screen of the dashboard that reads
// it. What is real is carried in meta.anchors: each anchor names the measured
// value, its source file, and the extrapolated series it pins. The simulation is
// constrained to land on the anchor at the anchor's date, so the shapes are
// invented but the levels are not free-floating.
//
// Deterministic: seeded PRNG, no Date.now() in the generated values. Re-running
// produces a byte-identical payload.
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const R = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// ── which instance is being built? ──────────────────────────────────────────
// One builder, one config per subject. The builder owns the simulation and every
// rule inside it; the config owns the world being simulated — the measured
// sources it is anchored to, the competitive set, the catalogue, and the
// mechanics that category actually runs. Adding a brand is a config file, never
// a second generator: two copies of this file would drift the moment one of them
// was fixed, and the fix would ship to one client and not the other.
const argOf = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const BRAND = argOf("brand", "sonos");
const CFG = (await import(`./cco/config-${BRAND}.mjs`)).default;
const { BRANDS, RETAILERS, CITIES, MODELS, ENGINES, STAGES, TERMS, CHANNELS, PROMO_TYPES, PROMO_FAMILIES, EVENTS, BASE_CARRIAGE, RETAILER_MECHANICS, PROMO_APPETITE, RETAILER_PRICE_BIAS, RETAILER_LEADTIME, CITY_LEADTIME, PROMPT_BANK, TRAFFIC_BASE, CHANNEL_MIX, mapFloorPct,
        PRICE_FLOOR_PCT, PRICE_DRIFT, TERM_BIAS, PAID_PUSH, SPONSORED_BASE, PDP_BRAND_LIFT,
        LAUNCH_PULL, TRAFFIC_ALL_EVENTS, TRAFFIC_TREND, ENGAGE, RATING_DRIFT, REVIEW_VELOCITY } = CFG;


// ── measured sources ────────────────────────────────────────────────────────
const LAUNCH = R(CFG.sources.launch);   // Keepa + reviews + AI answer share
const MULTI  = R(CFG.sources.multi);    // multi-retailer carriage + price matrix
const PROMO  = R(CFG.sources.promo);    // captured promotion verbatims
const DELIV  = R(CFG.sources.deliv);    // city delivery probes
// SimilarWeb, fetched through the Bright Data unlocker. Optional: an instance
// without a capture falls back to the config's modelled levels and says so.
let SW = null;
try { SW = R("data/web-traffic/profiles.json"); } catch { SW = null; }
const swAny = (b) => SW?.brands?.[b] || null;
// Whether a domain fairly stands for a brand depends on the CATEGORY being
// studied, not on the domain alone. lg.com is a defensible proxy in a
// television set, where TVs are a major LG line; in a cordless-vacuum set it is
// 36M visits led by appliances, phones and TVs against a vacuum brand's 0.5M,
// and it took 76% of "category traffic" on the first Shark build. So the
// capture records the reading and its own default judgement, and the instance
// may withhold it for its own set, with the reason stated on the page.
const swWithheld = (b) => (CFG.TRAFFIC_WITHHOLD || {})[b] || null;
const swOf  = (b) => { const v = swAny(b); return v && v.usable && !swWithheld(b) && v.usVisits ? v : null; };

// ── deterministic PRNG ──────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rngFor = (key) => mulberry32(hashStr(CFG.id + "-cco::" + key));
// gaussian-ish noise in [-1,1], concentrated near 0
const noise = (rnd) => (rnd() + rnd() + rnd() - 1.5) / 1.5;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

// ── calendar: 13 whole weeks ending Sunday 2026-08-23 ───────────────────────
const DAY = 86400000;
const END = CFG.WINDOW_END ? Date.parse(CFG.WINDOW_END + "T00:00:00Z") : Date.UTC(2026, 7, 23);
const WEEKS = 13, NDAYS = WEEKS * 7;        // 91 days
const START = END - (NDAYS - 1) * DAY;      // Mon 25 May 2026
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dates = Array.from({ length: NDAYS }, (_, i) => iso(START + i * DAY));
const dow = dates.map((d) => new Date(d + "T00:00:00Z").getUTCDay());       // 0=Sun
const monthOf = dates.map((d) => d.slice(0, 7));
const months = [...new Set(monthOf)];
const weekIndex = dates.map((_, i) => Math.floor(i / 7));
const weeks = Array.from({ length: WEEKS }, (_, w) => ({
  id: `W${String(w + 1).padStart(2, "0")}`,
  start: dates[w * 7], end: dates[w * 7 + 6],
  label: `${dates[w * 7].slice(5)} – ${dates[w * 7 + 6].slice(5)}`,
}));
const dIdx = Object.fromEntries(dates.map((d, i) => [d, i]));
const EVENTS_IN_WINDOW = EVENTS.filter((e) => dIdx[e.start] != null);

const BIDS = BRANDS.map((b) => b.id);

const RIDS = RETAILERS.map((r) => r.id);

const CIDS = CITIES.map((c) => c.id);

const MID = Object.fromEntries(MODELS.map((m) => [m.id, m]));
// Measured Amazon listings supplied by the instance: daily price, list, stock
// and offer count per model, sampled from the listing's own history.
const MEASURED_AMAZON = CFG.MEASURED_AMAZON || {};
const AMAZON_UNLISTED = new Set(CFG.AMAZON_UNLISTED || []);
const measuredFor = (key) => { const [mid, rt] = key.split("|"); return rt === "amazon" ? MEASURED_AMAZON[mid] || null : null; };


const PT = Object.fromEntries(PROMO_TYPES.map((p) => [p.id, p]));

const inEvent = (di, ev) => dates[di] >= ev.start && dates[di] <= ev.end;
const eventLift = (di, only) => {
  let l = 1;
  for (const e of EVENTS) { if (only && !only.includes(e.id)) continue; if (inEvent(di, e)) l *= e.lift; }
  return l;
};


// =============================================================================
// 1 · DISTRIBUTION — which model is carried where, and from when
// =============================================================================
// Anchor: the measured carriage matrix from the multi-retailer capture.
// "not readable" in the capture is a collection limit, not an absence, so those
// cells are extrapolated as carried-with-lower-confidence rather than as gaps.
const measuredCarriage = {};
for (const row of MULTI.matrix) measuredCarriage[`${row.model}|${row.retailer}`] = row.carriage;


// carriage[model|retailer] = 0/1 per day, plus the listing metadata around it
const carriage = {}, sellers = {}, buybox = {}, listings = [];
for (const m of MODELS) {
  for (const rt of RIDS) {
    const key = `${m.id}|${rt}`;
    const rnd = rngFor("carriage:" + key);
    if (rt === "amazon" && AMAZON_UNLISTED.has(m.id)) { carriage[key] = null; continue; }
    const real = measuredFor(key);
    if (real) {
      const arr = real.stock.map((v) => (v == null ? 0 : 1));
      if (!arr.some(Boolean)) { carriage[key] = null; continue; }
      carriage[key] = arr;
      const off = real.offers.filter((v) => v != null);
      sellers[key] = off.length ? Math.max(1, Math.round(off.at(-1))) : 1;
      const owned = (real.buybox || []).filter((v, i) => v != null && arr[i]);
      buybox[key] = owned.length ? r3(owned.filter((v) => v === 1).length / owned.length) : null;
      const first = arr.indexOf(1);
      listings.push({ model: m.id, brand: m.brand, retailer: rt, sellers: sellers[key], buybox: buybox[key], note: first > 0 ? { kind: "listed", day: dates[first] } : null, measured: true });
      continue;
    }
    const meas = m.measured ? undefined : measuredCarriage[key];
    let carried;
    if (meas === "carried") carried = true;
    else if (meas === "not carried") carried = false;
    else carried = rnd() < BASE_CARRIAGE[m.brand][rt];
    if (!carried) { carriage[key] = null; continue; }

    // A listing can appear or lapse mid-quarter — that is the point of watching.
    const arr = new Array(NDAYS).fill(1);
    const roll = rnd();
    let note = null;
    if (roll < 0.10) {                                  // came on shelf mid-window
      const on = 6 + Math.floor(rnd() * 50);
      for (let i = 0; i < on; i++) arr[i] = 0;
      note = { kind: "listed", day: dates[on] };
    } else if (roll < 0.16) {                           // dropped mid-window
      const off = 40 + Math.floor(rnd() * 40);
      for (let i = off; i < NDAYS; i++) arr[i] = 0;
      note = { kind: "delisted", day: dates[off] };
    } else if (roll < 0.24) {                           // brief lapse
      const s = 20 + Math.floor(rnd() * 55), len = 3 + Math.floor(rnd() * 9);
      for (let i = s; i < Math.min(NDAYS, s + len); i++) arr[i] = 0;
      note = { kind: "lapsed", day: dates[s], days: len };
    }
    // A cell the capture READ as carried was, definitionally, live on the capture
    // date. The listing-state simulation must not contradict that: BRAVIA 7 II
    // 65" was rolled as delisted on 2026-07-05 and then measured on shelf at Best
    // Buy on 2026-08-13, so the dashboard showed no price for a hero model whose
    // price we hold. Where the two disagree, the measurement wins.
    if (meas === "carried") {
      const capIdx = dIdx[MULTI.capturedAt.slice(0, 10)];
      if (capIdx != null && arr[capIdx] === 0) {
        if (note && note.kind === "delisted") { for (let i = capIdx; i < NDAYS; i++) arr[i] = 1; note.day = null; note = null; }
        else if (note && note.kind === "listed") { for (let i = 0; i <= capIdx; i++) arr[i] = 1; note = null; }
        else { arr[capIdx] = 1; if (note && note.kind === "lapsed") note = null; }
      }
    }
    carriage[key] = arr;
    const nSell = rt === "amazon" ? 3 + Math.floor(rnd() * 18) : rt === "newegg" ? 2 + Math.floor(rnd() * 9) : 1;
    sellers[key] = nSell;
    // Buy-box: on marketplaces the brand does not always own its own listing.
    buybox[key] = rt === "amazon" ? r3(clamp(0.94 - (nSell - 3) * 0.021 + noise(rnd) * 0.05, 0.42, 1))
                : rt === "newegg" ? r3(clamp(0.72 + noise(rnd) * 0.14, 0.3, 1)) : 1;
    listings.push({ model: m.id, brand: m.brand, retailer: rt, sellers: nSell, buybox: buybox[key], note });
  }
}
const isCarried = (mid, rt, di) => { const a = carriage[`${mid}|${rt}`]; return a ? a[di] === 1 : false; };
const pairs = Object.keys(carriage).filter((k) => carriage[k]);

// How willing each brand is to be discounted, straight off the measured Keepa
// discount rate, read straight off the payload rather than restated here.
const MEASURED_DISCOUNT = LAUNCH.pricing.discountRate;

// Captured PDP prices, and the day they were read. Both are needed while events
// are generated, not just when the ladder is scaled.
const capturedPrice = {};
for (const row of MULTI.matrix) if (typeof row.price === "number") capturedPrice[`${row.model}|${row.retailer}`] = row.price;
const capturedPriceDay = dIdx[MULTI.capturedAt.slice(0, 10)] ?? null;

const promoEvents = [];
let pid = 0;
for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const m = MID[mid];
  const rnd = rngFor("promo:" + key);
  const mech = RETAILER_MECHANICS[rt];
  const mechIds = Object.entries(mech).flatMap(([k, w]) => Array(w).fill(k));
  const appetite = PROMO_APPETITE[m.brand];

  const real = measuredFor(key);
  if (real) {
    for (let i = 0; i < NDAYS; i++) {
      const depth = (j) => (real.price[j] != null && real.list[j] ? (1 - real.price[j] / real.list[j]) * 100 : 0);
      if (depth(i) < 3 || (i > 0 && depth(i - 1) >= 3)) continue;
      let end = i, deepest = depth(i);
      while (end + 1 < NDAYS && depth(end + 1) >= 3) { end++; deepest = Math.max(deepest, depth(end)); }
      const depthPct = r1(clamp(deepest, 3, 95));
      promoEvents.push({
        id: `p${++pid}`, brand: m.brand, model: mid, retailer: rt, type: "discount",
        start: dates[i], end: dates[end], days: end - i + 1, alwaysOn: false,
        depthPct, depthUsd: r2((real.list[i] * depthPct) / 100), addonUsd: 0, monthly: null, measured: true,
        onEvent: (EVENTS.find((ev) => dates[i] >= ev.start && dates[i] <= ev.end) || {}).id || null,
      });
    }
    continue;
  }

  // Always-on mechanics (protection, delivery, finance) run the whole window.
  for (const t of ["protection", "delivery", "financing", "bnpl", "trial", "card", "cashback"]) {
    if (!mech[t]) continue;
    if (rnd() > (t === "protection" || t === "delivery" ? 0.86 : 0.55)) continue;
    const faceVal =
      t === "protection" ? r2(clamp(m.street0 * (0.085 + rnd() * 0.055), 9.99, 79.99))
      : t === "delivery" ? 0
      : t === "card"     ? 50
      : t === "cashback" ? r2(m.street0 * 0.05)
      : 0;
    promoEvents.push({
      id: `p${++pid}`, brand: m.brand, model: mid, retailer: rt, type: t,
      start: dates[0], end: dates[NDAYS - 1], days: NDAYS, alwaysOn: true,
      depthUsd: t === "card" || t === "cashback" ? faceVal : 0,
      depthPct: t === "card" ? r1((faceVal / m.street0) * 100) : t === "cashback" ? 5 : 0,
      addonUsd: t === "protection" ? faceVal : 0,
      monthly: t === "financing" ? Math.round(m.street0 / 12) : t === "bnpl" ? r2(m.street0 / 4) : null,
    });
  }


  // Episodic price events — the ones a CCO plans against.
  const nEvents = Math.round((0.7 + appetite * 5.4) * (0.6 + rnd() * 0.9));
  const used = new Array(NDAYS).fill(0);
  for (let e = 0; e < nEvents; e++) {
    const type = pick(rnd, mechIds.filter((t) => ["discount", "clearance", "bundle", "tradein"].includes(t))) || "discount";
    // Events cluster on the retail calendar rather than falling uniformly.
    let s;
    const anchorRoll = rnd();
    if (anchorRoll < 0.52) {
      const ev = pick(rnd, EVENTS_IN_WINDOW.length ? EVENTS_IN_WINDOW : EVENTS);
      s = dIdx[ev.start] == null ? Math.floor(rnd() * (NDAYS - 5)) : clamp(dIdx[ev.start] - 2 + Math.floor(rnd() * 5), 0, NDAYS - 4);
    } else s = Math.floor(rnd() * (NDAYS - 5));
    const len = type === "clearance" ? 14 + Math.floor(rnd() * 30)
              : 3 + Math.floor(rnd() * (rnd() < 0.3 ? 18 : 8));
    const end = Math.min(NDAYS - 1, s + len - 1);
    let overlap = 0; for (let i = s; i <= end; i++) overlap += used[i];
    if (overlap > len * 0.4) continue;
    // We hold the shelf price this listing carried on the capture date. A
    // simulated markdown running across that day would put the dashboard below
    // a price we actually measured, which is what made three of twenty captured
    // prices fail to reproduce. The measurement wins: no price event may cover it.
    if (capturedPriceDay != null && capturedPrice[key] != null
        && s <= capturedPriceDay && end >= capturedPriceDay
        && ["discount", "clearance", "openbox"].includes(type)) continue;
    for (let i = s; i <= end; i++) used[i] = 1;

    // Depth is bounded by the brand's measured willingness to be discounted.
    // The multiplier is deliberately modest: Apple's measured 43.3% is a Keepa
    // read across listings that includes clearance stock, and amplifying it
    // produced a $126 HomePod — a world the measurement does not support.
    const ceiling = clamp(MEASURED_DISCOUNT[m.brand] * 100 * 1.35 + 3, 5, 34);
    let depthPct = type === "clearance" ? clamp(ceiling * (1.05 + rnd() * 0.34), 12, 42)
                 : type === "tradein"  ? r1(17 + rnd() * 7)
                 : type === "bundle"   ? clamp(6 + rnd() * 14, 5, 24)
                 // draw inside the ceiling rather than clamping at it — clamping
                 // piled eleven separate events onto exactly 34.0%
                 : 3 + rnd() * Math.max(1, ceiling - 3);
    // Prime Day and Black-Friday-shaped moments go deeper.
    if (inEvent(s, EVENTS.find((x) => x.id === "primeday"))) depthPct *= 1.3;
    depthPct = r1(clamp(depthPct, 2, 45));
    promoEvents.push({
      id: `p${++pid}`, brand: m.brand, model: mid, retailer: rt, type,
      start: dates[s], end: dates[end], days: end - s + 1, alwaysOn: false,
      depthPct, depthUsd: r2((m.street0 * depthPct) / 100), addonUsd: 0, monthly: null,
      onEvent: (EVENTS.find((ev) => dates[s] >= ev.start && dates[s] <= ev.end) || {}).id || null,
    });
  }
}
// day -> live price-affecting depth, per model|retailer
const promoDepthByDay = {};
for (const key of pairs) promoDepthByDay[key] = new Array(NDAYS).fill(0);
for (const p of promoEvents) {
  if (!["discount", "clearance"].includes(p.type)) continue;
  const key = `${p.model}|${p.retailer}`;
  if (!promoDepthByDay[key]) continue;
  for (let i = dIdx[p.start]; i <= dIdx[p.end]; i++) promoDepthByDay[key][i] = Math.max(promoDepthByDay[key][i], p.depthPct);
}

// =============================================================================
// 3 · PRICING — a daily street price per model per retailer
// =============================================================================
// Anchor: the captured PDP price for the nine matrix models, the Keepa street
// price for the 15 tracked ASINs, and each brand's measured discount rate.
// Prices step and hold — they do not drift — so the series is built as a ladder
// with promotional troughs cut into it.
const priceSeries = {}, listSeries = {}, discSeries = {};

for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const m = MID[mid];
  const real = measuredFor(key);
  if (real) {
    const price = real.price.map((v, i) => (isCarried(mid, rt, i) && v != null ? r2(v) : null));
    const lst = real.list.map((v, i) => (price[i] == null ? null : v ?? null));
    priceSeries[key] = price; listSeries[key] = lst;
    discSeries[key] = price.map((v, i) => (v == null || !lst[i] ? null : r1(clamp(((lst[i] - v) / lst[i]) * 100, 0, 95))));
    continue;
  }
  const rnd = rngFor("price:" + key);
  const anchor = (m.measured ? null : capturedPrice[key]) ?? r2(m.street0 * (1 + RETAILER_PRICE_BIAS[rt]));
  const list = m.msrp;
  // A floor bounds how far the MODEL may wander. It must never sit above a
  // price that was actually observed: LG's CordZero A949 was captured at $249.99
  // against a $999.99 list, and the 70% floor quietly lifted it to $549.99 —
  // the dashboard overruling the measurement it claims to be anchored to.
  const floorPct = PRICE_FLOOR_PCT[m.brand] ?? 0.7;
  const floorAbs = Math.min(list * floorPct, anchor);

  // Ladder: a base level that re-sets every 9–24 days by a small step.
  const base = new Array(NDAYS);
  let lvl = anchor * (1 + noise(rnd) * 0.03), hold = 0;
  for (let i = 0; i < NDAYS; i++) {
    if (hold <= 0) {
      hold = 9 + Math.floor(rnd() * 16);
      const drift = noise(rnd) * (PRICE_DRIFT[m.brand] ?? 0.024);
      lvl = clamp(lvl * (1 + drift), floorAbs, list * 1.02);
    }
    base[i] = lvl; hold--;
  }
  // Land the series on the captured value at the capture date.
  const capIdx = dIdx[MULTI.capturedAt.slice(0, 10)] ?? NDAYS - 11;
  if (capturedPrice[key] && !m.measured) { const adj = capturedPrice[key] / base[capIdx]; for (let i = 0; i < NDAYS; i++) base[i] *= adj; }

  const price = new Array(NDAYS), disc = new Array(NDAYS), lst = new Array(NDAYS);
  for (let i = 0; i < NDAYS; i++) {
    if (!isCarried(mid, rt, i)) { price[i] = null; disc[i] = null; lst[i] = null; continue; }
    const d = promoDepthByDay[key][i];
    const p = clamp(base[i] * (1 - d / 100), Math.min(list * 0.55, floorAbs), list * 1.05);
    price[i] = r2(p); lst[i] = list; disc[i] = r1(clamp(((list - p) / list) * 100, 0, 46));
  }
  priceSeries[key] = price; listSeries[key] = lst; discSeries[key] = disc;
}

// =============================================================================
// 4 · AVAILABILITY — in-stock by model x retailer x day, and by city
// =============================================================================
// Anchor: measured in-stock share from the audited Keepa record, per brand.
const MEASURED_INSTOCK = LAUNCH.retail.inStock;
const stockSeries = {}, stockEpisodes = [];
for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const m = MID[mid];
  const real = measuredFor(key);
  if (real) {
    const arr = real.stock.map((v, i) => (isCarried(mid, rt, i) && v === 1 ? 1 : 0));
    for (let i = 0; i < NDAYS; i++) {
      if (real.stock[i] !== 0 || (i > 0 && real.stock[i - 1] === 0)) continue;
      let j = i; while (j + 1 < NDAYS && real.stock[j + 1] === 0) j++;
      stockEpisodes.push({ model: mid, brand: m.brand, retailer: rt, start: dates[i], days: j - i + 1, afterPromo: false, measured: true });
    }
    stockSeries[key] = arr;
    continue;
  }
  const rnd = rngFor("stock:" + key);
  // The measured figure is the target, full stop. An earlier version added a
  // blanket +14 points "for other retailers" and then drew episodes at a rate
  // that never reached even that, so a brand measured at 62% in-stock rendered
  // at 93% — flattering the subject by thirty-one points on the one lane where
  // being wrong is most expensive. Episodes are now placed until the series
  // actually reaches the measured rate.
  const target = clamp(MEASURED_INSTOCK[m.brand] * (rt === "amazon" ? 1.0 : rt === "newegg" ? 0.94 : 0.98), 0.4, 1);
  const arr = new Array(NDAYS).fill(1);
  const wantOut = Math.round((1 - target) * NDAYS);
  let out = 0, guard = 0;
  while (out < wantOut && guard++ < 400) {
    const i = Math.floor(rnd() * NDAYS);
    if (arr[i] === 0) continue;
    const deep = Math.max(...promoDepthByDay[key].slice(Math.max(0, i - 5), i + 1), 0) > 14;
    const len = Math.min(1 + Math.floor(rnd() * (deep ? 9 : 5)), wantOut - out);
    let placed = 0;
    for (let j = i; j < Math.min(NDAYS, i + len); j++) { if (arr[j] === 1) { arr[j] = 0; placed++; } }
    if (!placed) continue;
    out += placed;
    stockEpisodes.push({ model: mid, brand: m.brand, retailer: rt, start: dates[i], days: placed, afterPromo: deep });
  }
  for (let k = 0; k < NDAYS; k++) if (!isCarried(mid, rt, k)) arr[k] = 0;
  stockSeries[key] = arr;
}
// City-level availability: same model, different local fulfilment. This has to
// perturb the listing's OWN rate, not draw independently against it — an
// independent Bernoulli draw compounded downward and put every city 15 points
// below the national figure computed from the same series.
const stockByCity = {};
for (const key of pairs) {
  // Over the days the listing was CARRIED — the national figure excludes days a
  // listing did not exist, and averaging those zeros in here reopened the gap.
  const [mid0, rt0] = key.split("|");
  let on = 0, tot = 0;
  for (let i = 0; i < NDAYS; i++) { if (!isCarried(mid0, rt0, i)) continue; tot++; if (stockSeries[key][i]) on++; }
  const base = tot ? on / tot : 0;
  for (const c of CIDS) {
    const rnd = rngFor(`stockcity:${key}:${c}`);
    stockByCity[`${key}|${c}`] = r3(clamp(base * (1 + noise(rnd) * 0.055), 0, 1));
  }
}

// =============================================================================
// 5 · DELIVERY — promised lead time by model x retailer x city, weekly
// =============================================================================
// Anchor: the measured delivery rows in the multi-retailer capture, one per
// model x retailer x city triple that could be read.
const measuredDays = {};
for (const row of MULTI.deliveryRows || []) {
  // A row with no city belongs to the implicit national location — that is the
  // shape a single-retailer study produces, and its promise is measured even
  // though the metro behind it is not.
  const c = row.city == null ? { id: "national" } : CITIES.find((x) => x.label === row.city);
  if (c && typeof row.days === "number") measuredDays[`${row.model}|${row.retailer}|${c.id}`] = row.days;
}
const deliveryWeekly = {};   // model|retailer|city -> [13 medians]
// A study that probed no delivery locations still measured a promise — the
// national one the listing showed. Keying it under a single implicit location
// keeps the lane alive on its own measurement instead of emptying it, which is
// what produced a lead time of "0 days" on the first Shark build: no city, no
// series, a null read as a zero. The page withholds the metro cards on the same
// signal (dims.cities is empty) rather than drawing a one-column heatmap.
const DELIV_AT = CIDS.length ? CIDS : ["national"];
for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const realDays = rt === "amazon" ? (CFG.MEASURED_DELIVERY || {})[mid] : undefined;
  if (MID[mid].measured) {
    for (const c of DELIV_AT) deliveryWeekly[`${key}|${c}`] = Array.from({ length: WEEKS }, (_, w) => (w === WEEKS - 1 && realDays != null ? realDays : null));
    continue;
  }
  for (const c of DELIV_AT) {
    const rnd = rngFor(`deliv:${key}:${c}`);
    const anchor = MID[mid].measured ? undefined : measuredDays[`${mid}|${rt}|${c}`];
    const base = anchor ?? clamp(RETAILER_LEADTIME[rt] + (CITY_LEADTIME[c] ?? 0) + noise(rnd) * 0.9, 1, 9);
    const out = [];
    for (let w = 0; w < WEEKS; w++) {
      // Peak weeks stretch the promise; a stock-out stretches it hard.
      const di = w * 7 + 3;
      const peak = eventLift(di, ["primeday", "july4", "b2s"]) > 1.1 ? 0.8 : 0;
      const oos = stockSeries[key][di] ? 0 : 2.4;
      out.push(r1(clamp(base + peak + oos + noise(rnd) * 0.7, 1, 12)));
    }
    deliveryWeekly[`${key}|${c}`] = out;
  }
}

// =============================================================================
// 6 · SHELF VISIBILITY — share of the result grid, by retailer x term x day
// =============================================================================
// Anchor: measured shelf SOV per retailer per term from the multi-retailer
// capture's .shelf.sov, falling back to the launch report's own shelf figure.
const MEASURED_SHELF = LAUNCH.retail.shelfSov;              // % of the grid
const measuredByRetailer = {};
for (const [rt, v] of Object.entries(MULTI.shelf.sov || {})) {
  if (!v.byBrand) continue;
  measuredByRetailer[rt] = Object.fromEntries(Object.entries(v.byBrand).map(([b, o]) => [b, o.mean * 100]));
}
// A retailer the capture names in coverage.shelfNotComparable did not yield a
// comparable result grid, so its zeros are a collection limit and not an
// absence. One capture records that as state:"not comparable" and the other as
// state:"measured" with every brand on zero — which would put a hard 0.0% on
// screen for a shelf nobody could read. The coverage note is authoritative.
const NOT_COMPARABLE = new Set(
  (MULTI.coverage?.shelfNotComparable || [])
    .map((t) => String(t).trim().split(/[\s—-]/)[0].toLowerCase())
    .filter((id) => RIDS.includes(id))
    .concat(Object.entries(MULTI.shelf.sov || {}).filter(([, v]) => v && v.state === "not comparable").map(([k]) => k))
);
const shelfWithheld = [...NOT_COMPARABLE].map((id) => ({
  retailer: id,
  why: (MULTI.coverage?.shelfNotComparable || []).find((t) => String(t).toLowerCase().startsWith(id))
       || (MULTI.shelf.sov?.[id]?.why) || "no comparable result grid could be read",
}));

const shelfSeries = {};      // retailer|term|brand -> [91]
const shelfRank = {};        // retailer|term|brand -> [91]  (rank of best SKU)
const sponsoredShare = {};   // retailer|term|brand -> [91]
for (const rt of RIDS) {
  for (const t of TERMS) {
    for (const b of BIDS) {
      const key = `${rt}|${t.id}|${b}`;
      if (NOT_COMPARABLE.has(rt)) { shelfSeries[key] = null; shelfRank[key] = null; sponsoredShare[key] = null; continue; }
      const rnd = rngFor("shelf:" + key);
      // Where a retailer's grid was read, that reading is the anchor. Where it
      // was not, the brand's measured overall shelf is carried across and shaped
      // by how that brand actually sits in that retailer — otherwise every
      // unmeasured retailer draws the identical column, which is a picture of
      // our collection rather than of the market.
      const rb = (CFG.SHELF_RETAILER_BIAS || {})[rt];
      const anchor = measuredByRetailer[rt]?.[b] ?? ((MEASURED_SHELF[b] ?? 5) * ((rb && rb[b]) ?? 1));
      // Term bias says where a brand over-indexes, not that it has more shelf
      // overall. Normalising it to mean 1 across the term set keeps the relative
      // shape and puts the brand's mean back on its measured anchor; without
      // this, a brand favoured on two terms read 2.5x its measured share.
      const rawBias = TERMS.map((tt) => (TERM_BIAS[tt.id] || {})[b] ?? 1);
      const biasMean = rawBias.reduce((x, y) => x + y, 0) / rawBias.length;
      const termBias = ((TERM_BIAS[t.id] || {})[b] ?? 1) / biasMean;
      // The ceiling is 100 because a share of a result grid can be 100. It used
      // to be 62, and for a brand measured at two thirds of a retailer's grid the
      // high-bias terms hit the clamp, so the mean across terms could not reach
      // the level the capture set — TCL at Target read 57.6% against a measured
      // 66.8% for no reason but an arbitrary guard.
      const base = clamp(anchor * termBias, 0, 100);
      // A brand the capture found nowhere on this grid is not on this grid.
      // Event-week paid pressure must not push it onto one: a zero anchor stays
      // zero, or the dashboard asserts a presence the measurement denies.
      if (base <= 0.001) {
        shelfSeries[key] = new Array(NDAYS).fill(0);
        shelfRank[key] = new Array(NDAYS).fill(null);
        sponsoredShare[key] = new Array(NDAYS).fill(0);
        continue;
      }
      const s = [], rk = [], sp = [];
      let lvl = base * (1 + noise(rnd) * 0.16);
      for (let i = 0; i < NDAYS; i++) {
        // Paid pressure rises around retail events, squeezing organic share.
        const ev = eventLift(i, ["primeday", "july4", "memorial", "b2s"]);
        // A retailer promoting its own house brand on its own grid is a different
        // force from a brand buying placement, so it gets its own multiplier.
        const push = (b === rt ? (ev - 1) * 26 : (ev - 1) * 8 * (PAID_PUSH[b] ?? 1));
        lvl = clamp(lvl * 0.93 + base * 0.07 + noise(rnd) * base * 0.09, 0, 100);
        const v = clamp(lvl + push, 0, 100);
        s.push(r1(v));
        rk.push(v <= 0.2 ? null : Math.max(1, Math.round(clamp(46 / Math.max(v, 1.2) + noise(rnd) * 2, 1, 60))));
        sp.push(r1(clamp((SPONSORED_BASE[b] ?? 12) * ev + noise(rnd) * 7, 0, 92)));
      }
      // Noise around a level near zero can only push upward — it is clamped at 0
      // below and open above — so a brand measured at 1.3% of the grid drifted
      // to 2.0% and one measured at 0.3% to 1.0%. Re-centre the series on its
      // anchor: the shape, including the event-week paid pressure, is preserved
      // proportionally, and the mean lands where the capture put it.
      if (base > 0.05) {
        const got = s.reduce((x, y) => x + y, 0) / s.length;
        if (got > 0.001) { const k = base / got; for (let i = 0; i < s.length; i++) s[i] = r1(clamp(s[i] * k, 0, 100)); }
      }
      shelfSeries[key] = s; shelfRank[key] = rk; sponsoredShare[key] = sp;
    }
  }
}

// PDP / landing-page quality — the content behind the click.
const PDP_FIELDS = [
  { id: "images",   label: "Image count",        max: 9 },
  { id: "video",    label: "Video on page",      max: 3 },
  { id: "aplus",    label: "Enhanced content",   max: 1 },
  { id: "bullets",  label: "Feature bullets",    max: 7 },
  { id: "specs",    label: "Spec completeness",  max: 1 },
  { id: "reviews",  label: "Reviews syndicated", max: 1 },
  { id: "titleKw",  label: "Title keyword fit",  max: 1 },
];
const pdpScores = [];
for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const m = MID[mid];
  const rnd = rngFor("pdp:" + key);
  const realPdp = rt === "amazon" ? (CFG.MEASURED_PDP || {})[mid] : null;
  if (realPdp) {
    const score = Math.round((PDP_FIELDS.reduce((a, fld) => a + (realPdp[fld.id] ?? 0) / fld.max, 0) / PDP_FIELDS.length) * 100);
    pdpScores.push({ model: mid, brand: m.brand, retailer: rt, score, fields: { ...realPdp }, measured: true });
    continue;
  }
  if (m.measured) continue;
  const brandLift = PDP_BRAND_LIFT[m.brand] ?? 0.85;
  const retLift = { amazon: 1, bestbuy: 0.94, target: 0.88, walmart: 0.82, newegg: 0.7 }[rt];
  const f = {};
  for (const fld of PDP_FIELDS) {
    const q = clamp(brandLift * retLift + noise(rnd) * 0.30, 0.10, 1);
    f[fld.id] = fld.max === 1 ? (q > 0.78 ? 1 : 0) : Math.round(q * fld.max);
  }
  const score = Math.round((PDP_FIELDS.reduce((a, fld) => a + f[fld.id] / fld.max, 0) / PDP_FIELDS.length) * 100);
  pdpScores.push({ model: mid, brand: m.brand, retailer: rt, score, fields: f });
}

// =============================================================================
// 7 · AI VISIBILITY — share of the answer, by engine x stage x day
// =============================================================================
// Anchor: the measured AI share of voice from the launch report, with its
// per-engine and per-funnel-stage readings behind it.
const AI = LAUNCH.aiSearch;
const aiByEngineStage = {};   // engine|stage|brand -> [91]
for (const e of ENGINES) {
  for (const st of STAGES) {
    // sum-to-100 per engine/stage/day, so a gain for one brand is a loss for another
    const rawByBrand = {};
    for (const b of BIDS) {
      const key = `${e.id}|${st.id}|${b}`;
      const rnd = rngFor("ai:" + key);
      // A modelled engine is the mean of the measured ones, exactly as the
      // anchor ledger tells the reader — otherwise the dashboard can end up
      // reporting its strongest presence on its only uncaptured column.
      const measuredEngines = Object.keys(AI.byEngine || {});
      const isModelled = !AI.byEngine?.[e.id];
      const eng = isModelled
        ? (measuredEngines.length ? mean(measuredEngines.map((k) => AI.byEngine[k][b] ?? AI.overall[b] ?? 12)) : (AI.overall[b] ?? 12))
        : AI.byEngine[e.id][b] ?? AI.overall[b] ?? 12;
      const stg = AI.byStage[st.id]?.[b] ?? AI.overall[b] ?? 12;
      const anchor = (eng + stg) / 2 * (isModelled ? 0.94 : 1);
      const s = [];
      let lvl = anchor * (1 + noise(rnd) * 0.1);
      for (let i = 0; i < NDAYS; i++) {
        // Model refreshes and index updates move these in steps, not smoothly.
        // An engine that was never captured is modelled off the measured mean; it must
        // not wander further than the engines it is derived from, or the dashboard
        // ends up reporting its strongest presence on its only unmeasured column.
        const modelled = isModelled;
        const step = (i % (9 + (hashStr(key) % 6)) === 0) ? noise(rnd) * anchor * (modelled ? 0.18 : 0.42) : 0;
        // A launch lifts the subject's presence in evaluation and decision first.
        const lp = LAUNCH_PULL;
        const launchPull = (lp && b === lp.brand && lp.stages.includes(st.id) && dIdx[lp.from] != null && i >= dIdx[lp.from])
          ? Math.min(1, (i - dIdx[lp.from]) / lp.rampDays) * lp.points : 0;
        // Weak reversion: an answer share that snaps back to its anchor every day is
        // a straight line, and assistants do not behave that way between re-indexes.
        lvl = clamp(lvl * (modelled ? 0.965 : 0.988) + anchor * (modelled ? 0.035 : 0.012) + step + noise(rnd) * anchor * (modelled ? 0.03 : 0.06), anchor * 0.55, anchor * 1.6);
        s.push(clamp(lvl + launchPull, 0.4, 82));
      }
      rawByBrand[b] = s;
    }
    for (let i = 0; i < NDAYS; i++) {
      const tot = BIDS.reduce((a, b) => a + rawByBrand[b][i], 0);
      for (const b of BIDS) rawByBrand[b][i] = r1((rawByBrand[b][i] / tot) * 100);
    }
    for (const b of BIDS) aiByEngineStage[`${e.id}|${st.id}|${b}`] = rawByBrand[b];
  }
}
const aiOverall = {};   // brand -> [91]
for (const b of BIDS) {
  aiOverall[b] = dates.map((_, i) => {
    let s = 0, n = 0;
    for (const e of ENGINES) for (const st of STAGES) { s += aiByEngineStage[`${e.id}|${st.id}|${b}`][i]; n++; }
    return r1(s / n);
  });
}
const prompts = PROMPT_BANK.map(([stage, q], i) => {
  const rnd = rngFor("prompt:" + q);
  const present = {}, rank = {}, cited = {}, score = {};
  for (const b of BIDS) {
    const sov = aiByEngineStage[`${ENGINES[0].id}|${stage}|${b}`].at(-1);
    // A prompt is one draw, not the average. A brand with 39% answer share is
    // absent from roughly one prompt in six, and does not lead the rest of them.
    present[b] = rnd() < clamp(0.14 + sov / 52, 0.08, 0.88);
    score[b] = present[b] ? sov * (0.28 + rnd() * 2.1) : null;
    cited[b] = present[b] && rnd() < 0.55;
  }
  const order = BIDS.filter((b) => present[b]).sort((a, b) => score[b] - score[a]);
  order.forEach((b, k) => { rank[b] = k + 1; });
  for (const b of BIDS) if (!present[b]) rank[b] = null;
  return { id: `q${i + 1}`, stage, q, present, rank, cited, topBrand: order[0] || null };
});

const trafficDaily = {}, trafficChannels = {}, trafficDevice = {}, trafficEngage = {}, trafficGeo = {};
const trafficBasis = {};
for (const b of BIDS) {
  const sw = swOf(b), swAll = swAny(b);
  // A domain that is overwhelmingly something else cannot stand for the brand:
  // amazon.com is a retailer and apple.com is led by iPhone, so both their
  // visits and their on-site behaviour describe a different business. Withheld
  // outright rather than modelled, which is what the earlier build did.
  const held = swWithheld(b);
  if (swAll && (!swAll.usable || held)) {
    trafficDaily[b] = null; trafficChannels[b] = null; trafficEngage[b] = null;
    trafficGeo[b] = null; trafficDevice[b] = null;
    trafficBasis[b] = { state: "withheld", domain: swAll.domain, why: held || swAll.why };
    continue;
  }
  const rnd = rngFor("traffic:" + b);
  // Level from the capture where we have one; the daily SHAPE is modelled either
  // way, because the public page publishes a monthly figure and not a series.
  const base = sw ? Math.round(sw.usVisits / 30) : TRAFFIC_BASE[b];
  trafficBasis[b] = sw
    ? { state: "measured", domain: sw.domain, proxyQuality: sw.proxyQuality, why: sw.why || null,
        visitsMonthly: sw.visitsMonthly, usShare: sw.usShare, usVisits: sw.usVisits,
        bounce: sw.bounceRate, pages: sw.pagesPerVisit, duration: sw.visitDuration,
        leadChannel: sw.leadChannel || null, leadChannelPct: sw.leadChannelPct || null,
        note: "Monthly US visits from the published traffic profile; the day-to-day shape is modelled." }
    : { state: "modelled", note: "No capture for this domain — level sized, shape modelled." };
  const s = [];
  for (let i = 0; i < NDAYS; i++) {
    const wk = [0.92, 1.03, 1.05, 1.04, 1.02, 0.99, 0.95][dow[i]];   // Sun..Sat
    // A retailer-owned brand rides every event including the platform's own;
    // everyone else rides the retail calendar plus their own launch.
    const ev = eventLift(i, TRAFFIC_ALL_EVENTS.includes(b) ? null : EVENTS.filter((e) => e.kind !== "brand" || e.brand === b).map((e) => e.id));
    // Deep promotion in market pulls traffic; so does a rise in AI presence.
    const promoPull = 1 + (BIDS.includes(b) ? (avgDepthForBrand(b, i) / 100) * 1.6 : 0);
    const aiPull = 1 + (aiOverall[b][i] - aiOverall[b][0]) / 100 * 1.1;
    const trend = 1 + (i / NDAYS) * (TRAFFIC_TREND[b] ?? 0);
    s.push(base * wk * ev * promoPull * aiPull * trend * (1 + noise(rnd) * 0.055));
  }
  // Every lift above is multiplicative and none of them is below 1, so the shape
  // floats above the level it was built from — jbl averaged 65k sessions a day
  // against a captured 52k, and the ledger went on saying the level was pinned.
  // SimilarWeb publishes the most recent complete month, so the trailing 30 days
  // are what the capture describes: scale the whole series so that window lands
  // on it. The shape, and the movement across the quarter, are untouched.
  if (sw) {
    const tail = s.slice(-30), got = tail.reduce((x, y) => x + y, 0) / tail.length;
    if (got > 0) { const k = (sw.usVisits / 30) / got; for (let i = 0; i < s.length; i++) s[i] *= k; }
  }
  for (let i = 0; i < s.length; i++) s[i] = Math.round(s[i]);
  trafficDaily[b] = s;
  trafficChannels[b] = {};
  for (const ch of CHANNELS) {
    const r2n = rngFor(`traffic:${b}:${ch.id}`);
    // Only the leading channel's share is public; the rest of the split sits
    // behind a subscription. Where we have it, the leader takes the captured
    // share and the remainder is spread over the modelled mix.
    let share0 = CHANNEL_MIX[b][ch.id];
    if (sw && sw.leadChannelPct) {
      const leadId = { "Direct": "direct", "Organic Search": "organic", "Paid Search": "paid",
                       "Social": "social", "Referrals": "referral", "Mail": "email", "Display Ads": "display" }[sw.leadChannel];
      if (leadId && CHANNEL_MIX[b][leadId] != null) {
        const lead = sw.leadChannelPct / 100, restModelled = 1 - CHANNEL_MIX[b][leadId];
        share0 = ch.id === leadId ? lead : (CHANNEL_MIX[b][ch.id] / (restModelled || 1)) * (1 - lead);
      }
    }
    trafficChannels[b][ch.id] = s.map((v, i) => {
      // Paid spikes on the retail calendar; AI referral grows through the quarter.
      const evp = ch.id === "paid" ? eventLift(i, ["primeday", "july4", "b2s"]) : 1;
      const grow = ch.id === "aiRef" ? 1 + (i / NDAYS) * 0.86 : ch.id === "organic" ? 1 - (i / NDAYS) * 0.07 : 1;
      return Math.round(v * share0 * evp * grow * (1 + noise(r2n) * 0.08));
    });
  }
  const dr = rngFor("device:" + b);
  trafficDevice[b] = { mobile: r1(58 + noise(dr) * 7), desktop: 0, tablet: r1(5.4 + noise(dr) * 1.8) };
  trafficDevice[b].desktop = r1(100 - trafficDevice[b].mobile - trafficDevice[b].tablet);
  const er = rngFor("engage:" + b);
  // Bounce, pages per visit and duration are published per domain, so they come
  // straight from the capture and are only jittered day to day. Add-to-cart is
  // published nowhere and stays modelled — flagged as such in trafficBasis.
  const E = sw ? { bounce: sw.bounceRate, pages: sw.pagesPerVisit, duration: sw.visitDuration, addToCart: ENGAGE[b].addToCart } : ENGAGE[b];
  if (sw) trafficBasis[b].engagement = { bounce: "measured", pages: "measured", duration: "measured", addToCart: "modelled" };
  trafficEngage[b] = {
    bounce:        s.map((_, i) => r1(clamp(E.bounce + noise(er) * 2 - (avgDepthForBrand(b, i) / 10), 15, 85))),
    pagesPerVisit: s.map(() => r2(clamp(E.pages + noise(er) * 0.22, 1.05, 12))),
    duration:      s.map(() => Math.round(clamp(E.duration + noise(er) * 14, 30, 900))),
    addToCart:     s.map((_, i) => r2(clamp(E.addToCart * (1 + avgDepthForBrand(b, i) / 42) + noise(er) * 0.5, 0.4, 18))),
  };
  // SimilarWeb publishes a country mix, not a metro one, so the country mix is
  // what goes on the dashboard. The delivery and availability lanes keep their
  // six measured metros; the traffic lane does not get an invented one.
  trafficGeo[b] = sw ? sw.geo : null;
}
// mean live discount depth across a brand's carried pairs on day i
function avgDepthForBrand(b, i) {
  let s = 0, n = 0;
  for (const key of pairs) { const [mid] = key.split("|"); if (MID[mid].brand !== b) continue; s += promoDepthByDay[key][i]; n++; }
  return n ? s / n : 0;
}
// Retail PDP traffic: shelf presence x term volume x how sharp the price is.
const pdpTraffic = {};
// Shelf-share equivalent of "carried but invisible in search" — the floor below
// which the modelled product-page traffic does not fall while the listing lives.
const PDP_FLOOR = 0.5;
for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const m = MID[mid];
  const rnd = rngFor("pdptraffic:" + key);
  const rWeight = RETAILERS.find((r) => r.id === rt).weight;
  const tierW = { flagship: 0.55, premium: 0.85, core: 1.25, entry: 1.5 }[m.tier];
  pdpTraffic[key] = dates.map((_, i) => {
    if (!isCarried(mid, rt, i)) return 0;
    // Where the shelf could not be read, fall back to the brand's mean across the
    // retailers that could — the traffic lane needs a level, but the shelf lane
    // must not be given one it did not measure.
    const shelfAt = (r) => shelfSeries[`${r}|${TERMS[0].id}|${m.brand}`] ? r : null;
    const src = shelfAt(rt) || RIDS.find(shelfAt);
    const shelf = src ? TERMS.reduce((a, t) => a + (shelfSeries[`${src}|${t.id}|${m.brand}`][i] * t.vol), 0) / TERMS.length : 0;
    // A carried listing draws traffic even with no presence in the retailer's
    // search grid — direct navigation, brand search and off-site links all land
    // on the product page. Without this floor a measured zero on the shelf lane
    // (Sonos ranks nowhere at Target for the captured terms) became a claim that
    // the page gets no visits at all, on a lane that is modelled end to end.
    const shelfEq = Math.max(shelf, PDP_FLOOR);
    const ev = eventLift(i, null);
    const sharp = 1 + promoDepthByDay[key][i] / 46;
    return Math.round(clamp(shelfEq * 96 * rWeight * tierW * ev * sharp * (1 + noise(rnd) * 0.1), 0, 900000));
  });
}

// =============================================================================
// 9 · VOICE OF CUSTOMER — rating, review velocity, aspects
// =============================================================================
// Anchor: measured Amazon star ratings weighted by rating count, and the
// monthly aspect scores captured for the launch report.
const MEASURED_RATING = LAUNCH.retail.rating;
const ASPECTS = LAUNCH.retail.aspects.aspects;
// The aspect lane runs on its OWN twelve months, not the panel's thirteen weeks
// — that is the span that was captured, and showing four of them under a chart
// titled "over twelve months" was a claim the axis contradicted.
const ASPECT_MONTHS = [...new Set(Object.values(LAUNCH.retail.aspects.byBrand)
  .flatMap((v) => Object.values(v?.aspects || {}).flatMap((a) => Object.keys(a.byMonth || {}))))].sort();
const aspectByBrand = {}, aspectMeasured = {};
for (const b of BIDS) {
  const src = LAUNCH.retail.aspects.byBrand[b];
  // Apple's captured reviews carried too few aspect mentions to score
  // (basis: "insufficient"). Filling that in would falsify the sentence beside
  // the chart, which says an unscorable cell is withheld. So it is withheld.
  if (src && src.basis === "insufficient") { aspectByBrand[b] = null; aspectMeasured[b] = null; continue; }
  aspectByBrand[b] = {}; aspectMeasured[b] = {};
  for (const a of ASPECTS) {
    const rnd = rngFor(`aspect:${b}:${a}`);
    const meas = src?.aspects?.[a]?.byMonth;
    if (!meas) { aspectByBrand[b][a] = null; aspectMeasured[b][a] = null; continue; }
    aspectByBrand[b][a] = ASPECT_MONTHS.map((mo) => {
      if (meas[mo] != null) return meas[mo];                             // real reading
      return Math.round(clamp(Object.values(meas).at(-1) + noise(rnd) * 7, 24, 96));
    });
    aspectMeasured[b][a] = ASPECT_MONTHS.map((mo) => meas[mo] != null);
  }
}
const ratingSeries = {}, reviewVelocity = {};
for (const b of BIDS) {
  const rnd = rngFor("rating:" + b);
  const anchor = MEASURED_RATING[b];
  ratingSeries[b] = dates.map((_, i) => r2(clamp(anchor + noise(rnd) * 0.06 + (i / NDAYS) * (RATING_DRIFT[b] ?? 0), 3.2, 5)));
  reviewVelocity[b] = dates.map((_, i) => Math.round(clamp((REVIEW_VELOCITY[b] ?? 40) * eventLift(i, null) * (1 + noise(rnd) * 0.22), 0, 4000)));
  const realRating = (CFG.MEASURED_RATING || {})[b], realReviews = (CFG.MEASURED_REVIEWS || {})[b];
  if (realRating && realRating.some((v) => v != null)) {
    let last = null;
    ratingSeries[b] = realRating.map((v) => { last = v ?? last; return last == null ? null : r2(last); });
  }
  if (realReviews) reviewVelocity[b] = realReviews.map((v) => Math.max(0, Math.round(v ?? 0)));
}

// =============================================================================
// 10 · TOTAL COST OF OWNERSHIP — what the shopper pays, what the brand funds
// =============================================================================
// A shelf price is not what changes hands. Every live mechanic on a PDP moves
// the number in one direction or the other: a card offer and a trade-in pull it
// down, a protection plan pushes it up, and each is only taken by some share of
// buyers. This computes an attach-weighted effective outlay per model per
// retailer, and splits the give between the retailer and the brand.
const SERVICE = CFG.SERVICE || {};   // per-brand mandatory subscription, $/month
const tco = [];
for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const m = MID[mid];
  const shelf = priceSeries[key].at(-1);
  if (shelf == null) continue;
  // A price discount and a clearance markdown are ALREADY inside `shelf` — the
  // ladder cut them in. Counting them again here is the difference between a
  // bridge and a fantasy, so the bridge opens at MSRP, walks the shelf discount
  // once, and then applies only the mechanics that sit on top of the shelf price.
  const liveAtEnd = promoEvents.filter((p) => p.model === mid && p.retailer === rt
    && dIdx[p.start] <= NDAYS - 1 && dIdx[p.end] >= NDAYS - 1
    && !["discount", "clearance"].includes(p.type));
  const comps = [];
  let give = 0, addon = 0, brandFunded = 0;
  const shelfCut = r2(m.msrp - shelf);
  if (shelfCut > 0.5) brandFunded += shelfCut * PT.discount.costToBrand;
  for (const p of liveAtEnd) {
    const t = PT[p.type];
    if (!t) continue;
    // No mechanic's face value may exceed what is being paid for.
    const cap = shelf * 0.55;
    if (t.kind === "addon") {
      const v = p.addonUsd * t.attach;
      addon += v; comps.push({ type: p.type, label: t.label, dir: "up", face: p.addonUsd, attach: t.attach, weighted: r2(v) });
    } else if (p.depthUsd > 0) {
      const face = Math.min(p.depthUsd, cap);
      const v = face * t.attach;
      give += v; brandFunded += v * t.costToBrand;
      comps.push({ type: p.type, label: t.label, dir: "down", face: r2(face), attach: t.attach, weighted: r2(v) });
    } else if (t.kind === "value" || t.kind === "finance") {
      // Non-price mechanics still carry a cost; value it at its economic worth.
      const face = Math.min(cap, p.type === "delivery" ? 9.99 : p.type === "trial" ? 32 : p.type === "bnpl" ? r2(shelf * 0.045) : r2(shelf * 0.038));
      const v = face * t.attach;
      give += v * 0.5; brandFunded += v * t.costToBrand;
      comps.push({ type: p.type, label: t.label, dir: "down", face: r2(face), attach: t.attach, weighted: r2(v * 0.5), soft: true });
    }
  }
  const effective = r2(Math.max(shelf * 0.45, shelf - give + addon));
  // The give the funding split has to add up to is the shelf cut PLUS the
  // attach-weighted mechanics, because brandFunded is charged against both.
  const totalGive = Math.max(0, shelfCut) + give;
  tco.push({
    model: mid, brand: m.brand, retailer: rt, msrp: m.msrp,
    shelf: r2(shelf), shelfCut, give: r2(give), totalGive: r2(totalGive), addon: r2(addon), effective,
    outlay12: r2(effective + (SERVICE[m.brand] || 0) * 12),
    brandFunded: r2(Math.min(brandFunded, totalGive)), retailerFunded: r2(Math.max(0, totalGive - brandFunded)),
    vsMsrp: r1(((effective - m.msrp) / m.msrp) * 100),
    mechanics: liveAtEnd.length, comps,
  });
}

// =============================================================================
// 11 · PROMOTION STRATEGY — intensity, depth, mechanic mix, who moves first
// =============================================================================
const promoStrategy = {};
for (const b of BIDS) {
  const bp = pairs.filter((k) => MID[k.split("|")[0]].brand === b);
  let onDays = 0, carriedDays = 0, depthSum = 0, depthN = 0;
  for (const k of bp) for (let i = 0; i < NDAYS; i++) {
    const [mid, rt] = k.split("|");
    if (!isCarried(mid, rt, i)) continue;
    carriedDays++;
    if (promoDepthByDay[k][i] > 0) { onDays++; depthSum += promoDepthByDay[k][i]; depthN++; }
  }
  const evs = promoEvents.filter((p) => p.brand === b && !p.alwaysOn);
  const mix = {};
  for (const p of promoEvents.filter((x) => x.brand === b)) mix[p.type] = (mix[p.type] || 0) + (p.alwaysOn ? NDAYS : p.days);
  const mixTot = Object.values(mix).reduce((a, v) => a + v, 0) || 1;
  promoStrategy[b] = {
    intensity: r1(carriedDays ? (onDays / carriedDays) * 100 : 0),
    meanDepth: r1(depthN ? depthSum / depthN : 0),
    maxDepth: r1(Math.max(0, ...evs.map((e) => e.depthPct))),
    events: evs.length,
    meanDuration: r1(evs.length ? evs.reduce((a, e) => a + e.days, 0) / evs.length : 0),
    onEventShare: r1(evs.length ? (evs.filter((e) => e.onEvent).length / evs.length) * 100 : 0),
    mechanicMix: Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, r1((v / mixTot) * 100)])),
    mechanicsUsed: Object.keys(mix).length,
    retailerSpread: [...new Set(evs.map((e) => e.retailer))].length,
  };
}
// Price dispersion: how far apart the same model sits across retailers.
const dispersion = [];
for (const m of MODELS) {
  const ks = pairs.filter((k) => k.startsWith(m.id + "|"));
  if (ks.length < 2) continue;
  const perDay = dates.map((_, i) => {
    const vals = ks.map((k) => priceSeries[k][i]).filter((v) => v != null);
    if (vals.length < 2) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return { lo: r2(lo), hi: r2(hi), spread: r2(hi - lo), spreadPct: r1(((hi - lo) / hi) * 100), n: vals.length };
  });
  const live = perDay.filter(Boolean);
  dispersion.push({
    model: m.id, brand: m.brand,
    meanSpread: r2(live.reduce((a, d) => a + d.spread, 0) / (live.length || 1)),
    meanSpreadPct: r1(live.reduce((a, d) => a + d.spreadPct, 0) / (live.length || 1)),
    maxSpread: r2(Math.max(0, ...live.map((d) => d.spread))),
    series: perDay,
    byRetailer: Object.fromEntries(ks.map((k) => [k.split("|")[1], r2(mean(priceSeries[k].filter((v) => v != null)))])),
  });
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

const mapBreaches = [];
for (const key of pairs) {
  const [mid, rt] = key.split("|");
  const m = MID[mid];
  const floor = m.msrp * mapFloorPct[m.brand];
  let days = 0, worst = 0, first = null;
  for (let i = 0; i < NDAYS; i++) {
    const p = priceSeries[key][i];
    if (p == null || p >= floor) continue;
    days++; worst = Math.max(worst, r1(((floor - p) / floor) * 100));
    if (!first) first = dates[i];
  }
  if (days) mapBreaches.push({ model: mid, brand: m.brand, retailer: rt, days, worstPct: worst, floor: r2(floor), first });
}

// =============================================================================
// 12 · SCORECARDS — the same twelve measures at WBR, MBR and QBR cadence
// =============================================================================
const rangeMean = (arr, a, b) => { const s = arr.slice(a, b + 1).filter((v) => v != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
const rangeSum  = (arr, a, b) => arr.slice(a, b + 1).reduce((x, y) => x + (y || 0), 0);

function carriagePoints(b, a, z) {
  let on = 0, tot = 0;
  for (const m of MODELS.filter((x) => x.brand === b)) for (const rt of RIDS) {
    for (let i = a; i <= z; i++) { tot++; if (isCarried(m.id, rt, i)) on++; }
  }
  return tot ? (on / tot) * 100 : null;
}
function inStockRate(b, a, z) {
  let on = 0, tot = 0;
  for (const key of pairs) { const [mid, rt] = key.split("|"); if (MID[mid].brand !== b) continue;
    for (let i = a; i <= z; i++) { if (!isCarried(mid, rt, i)) continue; tot++; if (stockSeries[key][i]) on++; } }
  return tot ? (on / tot) * 100 : null;
}
function leadTimeDays(b, a, z) {
  const w0 = Math.floor(a / 7), w1 = Math.floor(z / 7);
  const v = [];
  for (const key of pairs) { const [mid] = key.split("|"); if (MID[mid].brand !== b) continue;
    for (const c of DELIV_AT) { const s = deliveryWeekly[`${key}|${c}`]; if (s) for (let w = w0; w <= w1; w++) if (s[w] != null) v.push(s[w]); } }
  return v.length ? mean(v) : null;
}
function shelfSov(b, a, z) {
  const v = [];
  for (const rt of RIDS) { if (NOT_COMPARABLE.has(rt)) continue;
    for (const t of TERMS) v.push(rangeMean(shelfSeries[`${rt}|${t.id}|${b}`], a, z)); }
  const live = v.filter((x) => x != null);
  return live.length ? mean(live) : null;
}
function priceIndex(b, a, z) {   // street as % of MSRP — 100 = never discounted
  const v = [];
  for (const key of pairs) { const [mid] = key.split("|"); const m = MID[mid]; if (m.brand !== b) continue;
    if (measuredFor(key)) {
      const ratios = [];
      for (let i = a; i <= z; i++) { const p = priceSeries[key][i], l = listSeries[key][i]; if (p != null && l) ratios.push((p / l) * 100); }
      if (ratios.length) v.push(mean(ratios));
      continue;
    }
    const p = rangeMean(priceSeries[key], a, z); if (p != null) v.push((p / m.msrp) * 100); }
  return v.length ? mean(v) : null;
}
function promoIntensity(b, a, z) {
  let on = 0, tot = 0;
  for (const key of pairs) { const [mid, rt] = key.split("|"); if (MID[mid].brand !== b) continue;
    for (let i = a; i <= z; i++) { if (!isCarried(mid, rt, i)) continue; tot++; if (promoDepthByDay[key][i] > 0) on++; } }
  return tot ? (on / tot) * 100 : null;
}
function promoDepth(b, a, z) {
  const v = [];
  for (const key of pairs) { const [mid] = key.split("|"); if (MID[mid].brand !== b) continue;
    for (let i = a; i <= z; i++) if (promoDepthByDay[key][i] > 0) v.push(promoDepthByDay[key][i]); }
  return v.length ? mean(v) : null;
}
function trafficShare(b, a, z) {
  // Share is computed only over the brands whose own domain can stand for them.
  // A set that withholds two of five is a narrower comparison, and saying so is
  // better than dividing by a retailer's whole-site traffic.
  if (!trafficDaily[b]) return null;
  const tot = BIDS.reduce((x, id) => x + (trafficDaily[id] ? rangeSum(trafficDaily[id], a, z) : 0), 0);
  return tot ? (rangeSum(trafficDaily[b], a, z) / tot) * 100 : null;
}
function pdpScore(b) {
  const v = pdpScores.filter((p) => p.brand === b).map((p) => p.score);
  return v.length ? mean(v) : null;
}

const METRICS = [
  { id: "trafficShare", group: "demand",       label: "Share of category traffic", unit: "%",    good: "up",   fn: trafficShare, fmt: (v) => r1(v) + "%" },
  { id: "sessions",     group: "demand",       label: "Sessions",                  unit: "",     good: "up",   fn: (b, a, z) => trafficDaily[b] ? rangeSum(trafficDaily[b], a, z) : null, fmt: (v) => fmtN(v) },
  { id: "aiSov",        group: "mind",         label: "AI share of answer",        unit: "%",    good: "up",   fn: (b, a, z) => rangeMean(aiOverall[b], a, z), fmt: (v) => r1(v) + "%" },
  { id: "shelfSov",     group: "visibility",   label: "Retail shelf share",        unit: "%",    good: "up",   fn: shelfSov, fmt: (v) => r1(v) + "%" },
  { id: "pdpScore",     group: "visibility",   label: "Landing-page score",        unit: "/100", good: "up",   fn: (b) => pdpScore(b), fmt: (v) => Math.round(v), static: true },
  { id: "carriage",     group: "distribution", label: "Distribution points",       unit: "%",    good: "up",   fn: carriagePoints, fmt: (v) => r1(v) + "%" },
  { id: "inStock",      group: "distribution", label: "In-stock rate",             unit: "%",    good: "up",   fn: inStockRate, fmt: (v) => r1(v) + "%" },
  { id: "leadTime",     group: "distribution", label: "Delivery promise",          unit: "d",    good: "down", fn: leadTimeDays, fmt: (v) => r1(v) + "d" },
  { id: "priceIndex",   group: "commercial",   label: "Price index vs MSRP",       unit: "%",    good: "up",   fn: priceIndex, fmt: (v) => r1(v) + "%" },
  { id: "promoIntensity", group: "commercial", label: "Days on promotion",         unit: "%",    good: "neutral", fn: promoIntensity, fmt: (v) => r1(v) + "%" },
  { id: "promoDepth",   group: "commercial",   label: "Mean discount depth",       unit: "%",    good: "neutral", fn: promoDepth, fmt: (v) => r1(v) + "%" },
  { id: "rating",       group: "voice",        label: "Review rating",             unit: "★",    good: "up",   fn: (b, a, z) => rangeMean(ratingSeries[b], a, z), fmt: (v) => r2(v) + "★" },
];
function fmtN(v) { return v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "k" : String(Math.round(v)); }

const PERIODS = [
  { id: "wbr", label: "Weekly",    long: "Weekly business review",    cur: [NDAYS - 7, NDAYS - 1],  prev: [NDAYS - 14, NDAYS - 8], curLabel: `Week of ${dates[NDAYS - 7]}`, prevLabel: `Week of ${dates[NDAYS - 14]}`, cmp: "vs prior week" },
  { id: "mbr", label: "Monthly",   long: "Monthly business review",   cur: [NDAYS - 28, NDAYS - 1], prev: [NDAYS - 56, NDAYS - 29], curLabel: `${dates[NDAYS - 28]} → ${dates[NDAYS - 1]}`, prevLabel: `${dates[NDAYS - 56]} → ${dates[NDAYS - 29]}`, cmp: "vs prior 4 weeks" },
  { id: "qbr", label: "Quarterly", long: "Quarterly business review", cur: [0, NDAYS - 1],          prev: null, deltaCur: [NDAYS - 30, NDAYS - 1], deltaPrev: [0, 29], curLabel: `${dates[0]} → ${dates[NDAYS - 1]}`, prevLabel: `${dates[0]} → ${dates[29]}`, cmp: "quarter exit vs quarter open" },
];

const scorecard = {};
for (const P of PERIODS) {
  scorecard[P.id] = {};
  for (const M of METRICS) {
    const [ca, cz] = P.cur;
    const dCur = P.deltaCur || P.cur, dPrev = P.deltaPrev || P.prev;
    const byBrand = {};
    for (const b of BIDS) {
      const value = M.fn(b, ca, cz);
      const cur = M.static ? value : M.fn(b, dCur[0], dCur[1]);
      const prev = M.static || !dPrev ? null : M.fn(b, dPrev[0], dPrev[1]);
      byBrand[b] = {
        value: value == null ? null : r2(value),
        prev: prev == null ? null : r2(prev),
        delta: prev == null || cur == null ? null : r2(cur - prev),
        deltaPct: prev ? r1(((cur - prev) / Math.abs(prev)) * 100) : null,
      };
    }
    // Rank is computed, never asserted, and honours the metric's good direction.
    const ranked = BIDS.filter((b) => byBrand[b].value != null)
      .sort((a, b) => M.good === "down" ? byBrand[a].value - byBrand[b].value : byBrand[b].value - byBrand[a].value);
    ranked.forEach((b, i) => {
      const tie = ranked.filter((x) => byBrand[x].value === byBrand[b].value).length;
      byBrand[b].rank = i + 1; byBrand[b].tied = tie > 1; byBrand[b].of = ranked.length;
    });
    scorecard[P.id][M.id] = byBrand;
  }
}
// A sparkline for each metric, at the granularity the period implies.
const trend = {};
for (const M of METRICS) {
  trend[M.id] = {};
  for (const b of BIDS) {
    trend[M.id][b] = M.static ? null : weeks.map((_, w) => {
      const v = M.fn(b, w * 7, w * 7 + 6);
      return v == null ? null : r2(v);
    });
  }
}

// =============================================================================
// 13 · READS — every claim computed from the series it sits beside
// =============================================================================
// The rule that governs this block: never type a superlative. `standing()` takes
// the same object the chart takes and returns the subject's position, ties
// handled, so a sentence cannot outlive the number it describes.
const L = Object.fromEntries(BRANDS.map((b) => [b.id, b.label]));
const SUBJ = L[CFG.subject];   // the subject's own label — never typed into a read
// A read that names the leader on a measure the subject already leads compares
// the brand to itself. `other()` returns the best OTHER brand, so the sentence
// has someone to be measured against.
function other(obj, subj, good = "up") {
  const ent = Object.entries(obj).filter(([k, v]) => k !== subj && v != null && !Number.isNaN(v));
  if (!ent.length) return null;
  ent.sort((a, b) => good === "down" ? a[1] - b[1] : b[1] - a[1]);
  return { id: ent[0][0], label: L[ent[0][0]], value: ent[0][1] };
}

// `good` orders the ranking; `words` names the ends of the scale so a rank on a
// descending measure reads as "the shallowest of the five", never as "first" —
// which on promotional depth would say the opposite of what the number means.
const ORD = ["first", "second", "third", "fourth", "fifth", "sixth"];
const ORDL = ["", "second-", "third-", "fourth-", "fifth-"];
function standing(obj, subj, good = "up", words = null) {
  const ent = Object.entries(obj).filter(([, v]) => v != null && !Number.isNaN(v));
  const sorted = ent.sort((a, b) => good === "down" ? a[1] - b[1] : b[1] - a[1]);
  const i = sorted.findIndex(([k]) => k === subj);
  if (i < 0) return { rank: null, of: sorted.length, phrase: "not in the set" };
  const val = sorted[i][1];
  const tied = sorted.filter(([, v]) => v === val).length;
  const of = sorted.length, last = i === of - 1;
  let phrase;
  if (words) {
    const w = last ? words[1] : i === 0 ? words[0] : ORDL[i] + words[0];
    phrase = `the ${w} of the ${of}`;
  } else {
    const ord = ORD[i] || `${i + 1}th`;
    phrase = i === 0 ? `first of the ${of}` : last ? `last of the ${of}` : `${ord} of the ${of}`;
  }
  if (tied > 1) phrase = "joint " + phrase.replace(/^the /, "");
  return { rank: i + 1, of, tied: tied > 1, phrase, leader: sorted[0][0], leaderVal: sorted[0][1],
           laggard: sorted[of - 1][0], laggardVal: sorted[of - 1][1], value: val, gap: r2(sorted[0][1] - val) };
}
const S = CFG.subject;
const q = (id) => Object.fromEntries(BIDS.map((b) => [b, scorecard.qbr[id][b].value]));
const reads = {};
if (!CFG.SKIP_READS) {

{ // ── overview
  const st = standing(q("trafficShare"), S), sa = standing(q("aiSov"), S), ss = standing(q("shelfSov"), S), sp = standing(q("priceIndex"), S);
  reads.overview = [
    { tone: "watch", text: `Over the 13 weeks ${SUBJ} holds ${r1(q("aiSov")[S])}% of the AI answer — ${sa.phrase} — against ${r1(q("shelfSov")[S])}% of the retail shelf, ${ss.phrase}. The brand is being recommended far more often than it is being seen on a result grid.` },
    { tone: "good",  text: `Price discipline is intact: ${SUBJ} transacts at ${r1(q("priceIndex")[S])}% of MSRP, ${sp.phrase}, while the set as a whole runs at ${r1(mean(BIDS.map((b) => q("priceIndex")[b])))}%.` },
    { tone: "watch", text: `Share of category traffic sits at ${r1(q("trafficShare")[S])}%, ${st.phrase}, and moved ${fmtDelta(scorecard.qbr.trafficShare[S].delta, "pp")} between the open and the close of the quarter.` },
    (() => { const eps = stockEpisodes.filter((e) => e.brand === S), post = eps.filter((e) => e.afterPromo).length;
      const stI = standing(q("inStock"), S);
      return { tone: stI.rank === 1 ? "good" : q("inStock")[S] >= 97 ? "watch" : "risk", text: `In-stock rate of ${r1(q("inStock")[S])}% is ${standing(q("inStock"), S).phrase}; ${eps.length} separate out-of-stock episode${eps.length === 1 ? "" : "s"} cost ${eps.reduce((a, e) => a + e.days, 0)} listing-days across the carried estate${post ? `, ${post} of them opening within five days of a discount deeper than 14%` : ""}.` }; })(),
  ];
}
function fmtDelta(v, unit = "") { if (v == null) return "flat"; const s = v > 0 ? "+" : ""; return `${s}${r1(v)}${unit}`; }

{ // ── traffic
  const measured = BIDS.filter((b) => trafficDaily[b]);
  const withheldB = BIDS.filter((b) => !trafficDaily[b]);
  const st = standing(q("trafficShare"), S);
  const aiRefFirst = mean(trafficChannels[S].aiRef.slice(0, 14)), aiRefLast = mean(trafficChannels[S].aiRef.slice(-14));
  const paidShare = Object.fromEntries(measured.map((b) => [b, (rangeSum(trafficChannels[b].paid, 0, NDAYS - 1) / rangeSum(trafficDaily[b], 0, NDAYS - 1)) * 100]));
  const basis = trafficBasis[S] || {};
  // A domain that spans several product lines is usable, but only with the
  // caveat said out loud: sony.com is PlayStation and cameras as well as
  // Bravia, so its visits are the brand's whole web presence, not the TV line.
  const wide = measured.filter((b) => (trafficBasis[b] || {}).proxyQuality === "multiLine");
  const wideNote = (b) => (trafficBasis[b] || {}).why || "";
  reads.traffic = [
    basis.state === "measured"
      ? { tone: "good", text: `${basis.domain} drew ${fmtN(basis.visitsMonthly)} visits worldwide last month, ${r1(basis.usShare)}% of them from the United States — ${fmtN(basis.usVisits)} US visits, measured rather than modelled. The day-to-day shape across the quarter is still modelled; the level is not.${basis.proxyQuality === "multiLine" ? ` Read it as the brand's whole web presence: ${wideNote(S)}` : ""}` }
      : { tone: "watch", text: `No traffic capture for this brand's domain — the level here is sized, not measured.` },
    (() => { const o = other(q("trafficShare"), S);
      const ex = withheldB.length
        ? ` ${withheldB.map((b) => L[b]).join(" and ")} ${withheldB.length === 1 ? "is excluded: its own domain is" : "are excluded: their own domains are"} not a fair proxy for the product line, so counting ${withheldB.length === 1 ? "it" : "them"} would divide by a business this category is only a corner of.`
        : "";
      const wideEx = wide.length
        ? ` The comparison is domain against domain, not product line against product line — ${wide.map((b) => L[b]).join(" and ")} ${wide.length === 1 ? "carries" : "carry"} several categories on the same site.`
        : "";
      return { tone: "watch", text: `${SUBJ} takes ${r1(q("trafficShare")[S])}% of the tracked brand-site visits, ${st.phrase}${o ? `; ${o.label} is the nearest of the rest on ${r1(o.value)}%` : ""}.` + ex + wideEx }; })(),
    { tone: "good",  text: `Assistant referrals grew from ${fmtN(aiRefFirst)} to ${fmtN(aiRefLast)} sessions a day across the quarter — a ${r1(((aiRefLast / aiRefFirst) - 1) * 100)}% rise, the fastest-growing channel in the mix.` },
    (() => { const worst = Object.entries(paidShare).sort((a, b) => b[1] - a[1])[0];
      return { tone: "watch", text: `Paid search carries ${r1(paidShare[S])}% of ${SUBJ} sessions, ${standing(paidShare, S, "down", ["least paid-dependent", "most paid-dependent"]).phrase}; ${L[worst[0]]} runs the most paid-dependent mix at ${r1(worst[1])}%.` }; })(),
  ];
}
{ // ── AI visibility
  const byEng = Object.fromEntries(ENGINES.map((e) => [e.id, mean(STAGES.map((st) => mean(aiByEngineStage[`${e.id}|${st.id}|${S}`])))]));
  const best = Object.entries(byEng).sort((a, b) => b[1] - a[1])[0], worst = Object.entries(byEng).sort((a, b) => a[1] - b[1])[0];
  const byStage = Object.fromEntries(STAGES.map((st) => [st.id, mean(ENGINES.map((e) => mean(aiByEngineStage[`${e.id}|${st.id}|${S}`])))]));
  const bs = Object.entries(byStage).sort((a, b) => b[1] - a[1])[0], ws = Object.entries(byStage).sort((a, b) => a[1] - b[1])[0];
  reads.ai = [
    { tone: "good", text: `${SUBJ} is ${standing(q("aiSov"), S).phrase} on share of the AI answer at ${r1(q("aiSov")[S])}%.` },
    { tone: "watch", text: `Presence is uneven by engine: ${ENGINES.find((e) => e.id === best[0]).label} returns ${SUBJ} in ${r1(best[1])}% of answers against ${r1(worst[1])}% on ${ENGINES.find((e) => e.id === worst[0]).label} — a ${r1(best[1] - worst[1])}-point spread on the same prompt set.` },
    { tone: "good", text: `The strongest funnel position is ${STAGES.find((s) => s.id === bs[0]).label.toLowerCase()} at ${r1(bs[1])}%, the weakest ${STAGES.find((s) => s.id === ws[0]).label.toLowerCase()} at ${r1(ws[1])}%.` },
  ];
}
{ // ── shelf
  const readable = RIDS.filter((rt) => !NOT_COMPARABLE.has(rt));
  const byRet = Object.fromEntries(readable.map((rt) => [rt, mean(TERMS.map((t) => mean(shelfSeries[`${rt}|${t.id}|${S}`])))]));
  const best = Object.entries(byRet).sort((a, b) => b[1] - a[1])[0], worst = Object.entries(byRet).sort((a, b) => a[1] - b[1])[0];
  const byTerm = Object.fromEntries(TERMS.map((t) => [t.id, mean(readable.map((rt) => mean(shelfSeries[`${rt}|${t.id}|${S}`])))]));
  const bt = Object.entries(byTerm).sort((a, b) => b[1] - a[1])[0];
  const spon = mean(readable.flatMap((rt) => TERMS.map((t) => mean(sponsoredShare[`${rt}|${t.id}|${S}`]))));
  const sponAll = Object.fromEntries(BIDS.map((b) => [b, mean(readable.flatMap((rt) => TERMS.map((t) => mean(sponsoredShare[`${rt}|${t.id}|${b}`]))))]));
  reads.shelf = [
    // Naming "the grid leader" is a self-comparison when the subject IS the
    // leader — the page read "puts Shark first of the 4; the grid leader is
    // Shark on 24.6%". other() returns the best of the REST, so the sentence
    // always has someone else in it.
    (() => { const o = other(q("shelfSov"), S);
      return { tone: "watch", text: `Shelf share of ${r1(q("shelfSov")[S])}% puts ${SUBJ} ${standing(q("shelfSov"), S).phrase}${o ? `; ${o.label} is the nearest of the rest on ${r1(o.value)}%` : ""}.` }; })(),
    (() => { const lo = Math.min(...Object.values(byTerm)), gap = bt[1] - lo, label = TERMS.find((t) => t.id === bt[0]).label;
      return gap >= 2
        ? { tone: "good", text: `Presence concentrates where the intent is specific — "${label}" returns ${SUBJ} in ${r1(bt[1])}% of the grid, against ${r1(lo)}% on the weakest term.` }
        : { tone: "watch", text: `Presence is even across the search terms — ${r1(lo)}% to ${r1(bt[1])}% of the grid — so no single term is carrying ${SUBJ}, and none is a hole.` }; })(),
    { tone: "risk",  text: `${r1(spon)}% of ${SUBJ} shelf presence is paid — ${standing(sponAll, S, "down", ["least paid-reliant", "most paid-reliant"]).phrase}. ${L[standing(sponAll, S, "down").laggard]} buys its way onto the grid at ${r1(standing(sponAll, S, "down").laggardVal)}%, which is why ${SUBJ} share moves against it in event weeks.` },
    { tone: "watch", text: `${RETAILERS.find((r) => r.id === worst[0]).label} reads thinnest for ${SUBJ} at ${r1(worst[1])}% of the grid, against ${r1(best[1])}% at ${RETAILERS.find((r) => r.id === best[0]).label} — a ${r1(best[1] - worst[1])}-point gap between the brand's best and worst shelf.` },
  ];
}
{ // ── distribution
  const cells = MODELS.filter((m) => m.brand === S).length * RIDS.length;
  const carried = pairs.filter((k) => MID[k.split("|")[0]].brand === S).length;
  const notes = listings.filter((l) => l.brand === S && l.note);
  const bb = mean(pairs.filter((k) => MID[k.split("|")[0]].brand === S).map((k) => buybox[k])) * 100;
  const bbAll = Object.fromEntries(BIDS.map((b) => [b, mean(pairs.filter((k) => MID[k.split("|")[0]].brand === b).map((k) => buybox[k])) * 100]));
  reads.distribution = [
    { tone: "watch", text: `${SUBJ} occupies ${carried} of ${cells} possible model-by-retailer cells — ${r1(q("carriage")[S])}% weighted for the days each listing was actually live, ${standing(q("carriage"), S).phrase}.` },
    { tone: notes.some((n) => n.note.kind === "delisted") ? "risk" : notes.length ? "watch" : "good",  text: `${notes.length} listing${notes.length === 1 ? "" : "s"} changed state inside the quarter: ${notes.filter((n) => n.note.kind === "delisted").length} dropped, ${notes.filter((n) => n.note.kind === "listed").length} appeared, ${notes.filter((n) => n.note.kind === "lapsed").length} lapsed and returned.` },
    { tone: "watch", text: `Buy-box ownership averages ${r1(bb)}% on the marketplaces, ${standing(bbAll, S).phrase} — every point lost is a sale credited to a reseller at a price the brand did not set.` },
  ];
}
{ // ── availability + delivery
  const eps = stockEpisodes.filter((e) => e.brand === S);
  const worstCity = Object.entries(Object.fromEntries(CIDS.map((c) => [c, mean(pairs.filter((k) => MID[k.split("|")[0]].brand === S).map((k) => mean(deliveryWeekly[`${k}|${c}`] || [])))]))).sort((a, b) => b[1] - a[1])[0];
  const bestCity = Object.entries(Object.fromEntries(CIDS.map((c) => [c, mean(pairs.filter((k) => MID[k.split("|")[0]].brand === S).map((k) => mean(deliveryWeekly[`${k}|${c}`] || [])))]))).sort((a, b) => a[1] - b[1])[0];
  const stIn = standing(q("inStock"), S);
  reads.availability = [
    { tone: stIn.rank === 1 ? "good" : q("inStock")[S] >= 97 ? "watch" : "risk",
      text: `In-stock rate of ${r1(q("inStock")[S])}% is ${stIn.phrase}; ${eps.length} out-of-stock episode${eps.length === 1 ? "" : "s"} cost ${eps.reduce((a, e) => a + e.days, 0)} listing-days over the quarter.` },
    (() => { const post = eps.filter((e) => e.afterPromo).length, longest = eps.slice().sort((a, b) => b.days - a.days)[0];
      return post
        ? { tone: "watch", text: `${post} of those ${eps.length} episodes opened within five days of a discount deeper than 14% — the promotion cleared the shelf faster than replenishment refilled it.` }
        : { tone: "good", text: `None of the ${eps.length} episode${eps.length === 1 ? "" : "s"} followed a deep discount, so these are replenishment gaps rather than promotions outrunning supply. The longest ran ${longest.days} days on ${MID[longest.model].label} at ${RETAILERS.find((r) => r.id === longest.retailer).label}, from ${longest.start}.` }; })(),
  ];
  reads.delivery = [
    (() => { const st2 = standing(q("leadTime"), S, "down", ["fastest", "slowest"]), o = other(q("leadTime"), S, "down");
      return q("leadTime")[S] == null
        ? { tone: "watch", text: `No delivery promise was captured for ${SUBJ} in this window, so the lane is withheld rather than estimated.` }
        // Two figures a tenth apart print as the same number, and "third-fastest
        // of the 4, against 5.8 days for Dyson" then reads as a contradiction.
        // Where they round to the same displayed value, say they are level.
        : { tone: st2.rank === 1 ? "good" : "watch", text: `The ${SUBJ} delivery promise averages ${r1(q("leadTime")[S])} days — ${st2.phrase}${o ? (r1(o.value) === r1(q("leadTime")[S]) ? `, level with ${o.label} at the same ${r1(o.value)} days` : `, against ${r1(o.value)} days for ${o.label}, the fastest of the rest`) : ""}.` }; })(),
    // The metro read only exists where a delivery probe was run. An instance
    // with no city dimension says why the sentence is missing rather than
    // asserting a spread across cities nobody measured.
    ...(CIDS.length && worstCity && bestCity && CITIES.find((c) => c.id === worstCity[0]) && CITIES.find((c) => c.id === bestCity[0])
      ? [(() => { const spread = worstCity[1] - bestCity[1], wl = CITIES.find((c) => c.id === worstCity[0]).label, bl = CITIES.find((c) => c.id === bestCity[0]).label;
          return spread < 0.5
            ? { tone: "good", text: `The promise holds nationally: every metro sits within ${r1(spread)} days of ${bl}, the fastest at ${r1(bestCity[1])} days.` }
            : { tone: spread >= 1 ? "risk" : "watch", text: `The promise is not national: ${wl} waits ${r1(worstCity[1])} days against ${r1(bestCity[1])} in ${bl} — a ${r1(spread)}-day spread on the same catalogue.` }; })()]
      : [{ tone: "watch", text: `Whether the promise holds across the country is not answered here: this study probed no delivery locations, so the lead time above is the national figure the listing showed and the metro spread behind it is withheld rather than modelled.` }]),
  ];
}
{ // ── pricing
  const pi = q("priceIndex"), st = standing(pi, S);
  const disp = dispersion.filter((d) => d.brand === S);
  const worst = disp.sort((a, b) => b.meanSpread - a.meanSpread)[0];
  const br = mapBreaches.filter((m) => m.brand === S);
  reads.pricing = [
    { tone: "good",  text: `${SUBJ} realises ${r1(pi[S])}% of MSRP across the quarter, ${st.phrase} — the category runs ${r1(mean(BIDS.map((b) => pi[b])))}% and ${L[Object.entries(pi).sort((a, b) => a[1] - b[1])[0][0]]} clears at ${r1(Math.min(...Object.values(pi)))}%.` },
    { tone: "watch", text: worst ? `${MID[worst.model].label} carries the widest cross-retailer spread at $${worst.meanSpread.toFixed(2)} on average and $${worst.maxSpread.toFixed(2)} at its widest — a shopper comparing two tabs sees two different brands.` : `Cross-retailer price spread stayed inside a dollar on every ${SUBJ} model.` },
    { tone: br.length ? "risk" : "good", text: br.length
        ? `${br.length} listing${br.length === 1 ? "" : "s"} traded below the ${Math.round(mapFloorPct[S] * 100)}% floor for ${br.reduce((a, x) => a + x.days, 0)} days in total, worst at ${Math.max(...br.map((x) => x.worstPct))}% under.`
        : `No ${SUBJ} listing traded below the ${Math.round(mapFloorPct[S] * 100)}% price floor at any point in the quarter.` },
  ];
}
{ // ── promotions
  const ps = promoStrategy;
  const inten = Object.fromEntries(BIDS.map((b) => [b, ps[b].intensity]));
  const dep = Object.fromEntries(BIDS.map((b) => [b, ps[b].meanDepth]));
  const sEv = promoEvents.filter((p) => p.brand === S && !p.alwaysOn);
  const topType = Object.entries(ps[S].mechanicMix).sort((a, b) => b[1] - a[1])[0];
  reads.promotions = [
    { tone: "good",  text: `${SUBJ} runs a price promotion on ${r1(inten[S])}% of carried listing-days — ${standing(inten, S, "down", ["least promoted", "most promoted"]).phrase}. ${L[standing(inten, S, "down").laggard]} is on promotion ${r1(standing(inten, S, "down").laggardVal)}% of the time.` },
    { tone: "watch", text: `When ${SUBJ} does promote it goes ${r1(dep[S])}% deep against a category mean of ${r1(mean(Object.values(dep)))}% — ${standing(dep, S, "down", ["shallowest", "deepest"]).phrase} on discount depth.` },
    { tone: "watch", text: `${r1(ps[S].onEventShare)}% of ${SUBJ} price events open inside a retail-calendar window, spread across ${ps[S].retailerSpread} retailers; ${sEv.length} episodic events ran in the quarter at a mean ${r1(ps[S].meanDuration)} days each.` },
    { tone: "watch", text: `The mechanic doing most of the work is ${PT[topType[0]].label.toLowerCase()} at ${r1(topType[1])}% of ${SUBJ} promotional days.` },
  ];
}
{ // ── TCO
  const sT = tco.filter((t) => t.brand === S);
  const gap = Object.fromEntries(BIDS.map((b) => { const t = tco.filter((x) => x.brand === b); return [b, t.length ? mean(t.map((x) => ((x.shelf - x.effective) / x.shelf) * 100)) : null]; }));
  const worst = sT.sort((a, b) => (b.shelf - b.effective) - (a.shelf - a.effective))[0];
  // A gap is a distance, so rank it by magnitude. Ranking the signed value put
  // the brand with the SMALLEST gap last and called it the widest of the set.
  const gapAbs = Object.fromEntries(Object.entries(gap).map(([k, v]) => [k, v == null ? null : Math.abs(v)]));
  const st = standing(gapAbs, S, "down", ["narrowest", "widest"]);
  const dir = gap[S] < 0 ? "understates" : "overstates";
  reads.tco = [
    (() => { const o = other(gapAbs, S, "up");
      const ratio = o ? o.value / Math.max(Math.abs(gap[S]), 0.05) : null;
      return { tone: "watch", text: `Attach-weighted, the shelf price ${dir} what a ${SUBJ} buyer actually pays by ${r1(Math.abs(gap[S]))}% — ${st.phrase}.` +
        (o && ratio >= 1.25 ? ` ${o.label} shows a ${r1(o.value)}% gap, ${r1(ratio)}x wider, so a shelf-price comparison against it is not a like-for-like read.`
           : o ? ` ${o.label} is the closest at ${r1(o.value)}%, so on this measure the set is tightly bunched and a shelf comparison is a fair one.` : "") }; })(),
    worst ? { tone: "watch", text: `${MID[worst.model].label} at ${RETAILERS.find((r) => r.id === worst.retailer).label} carries the widest single gap: $${r2(worst.shelf)} on the shelf against $${r2(worst.effective)} attach-weighted, of which $${r2(worst.brandFunded)} is funded by the brand rather than the retailer.` } : null,
    { tone: "good", text: `${sT.filter((t) => t.mechanics >= 3).length} of ${sT.length} ${SUBJ} listings carry three or more simultaneous mechanics. The more mechanics on a page, the less the shelf price says about the transaction — and the harder a competitor's headline price is to read straight.` },
  ].filter(Boolean);
}
{ // ── voice
  const rt = q("rating");
  reads.voice = [
    { tone: "good", text: `${SUBJ} rates ${r2(rt[S])}★, ${standing(rt, S).phrase}; ${L[standing(rt, S).leader]} leads on ${r2(standing(rt, S).leaderVal)}★.` },
    { tone: "watch", text: `Review velocity of ${fmtN(rangeSum(reviewVelocity[S], 0, NDAYS - 1))} over the quarter is ${standing(Object.fromEntries(BIDS.map((b) => [b, rangeSum(reviewVelocity[b], 0, NDAYS - 1)])), S).phrase} — a smaller base to defend the rating with.` },
  ];
}

}

// =============================================================================
// 14 · WRITE — with the anchor ledger that says what is real
// =============================================================================
const anchors = CFG.anchors({ LAUNCH, MULTI, PROMO, DELIV, SW, BIDS, r1, pct: (v) => r1(v * 100) + "%" });

const payload = {
  meta: {
    title: CFG.title,
    subtitle: "A quarter of continuous collection, extrapolated from the measured snapshot",
    subject: CFG.subject, subjectLabel: CFG.subjectLabel, category: CFG.category,
    brandMark: CFG.brandMark || null,
    market: CFG.market || "US", currency: CFG.currency || "USD",
    window: { start: dates[0], end: dates[NDAYS - 1], days: NDAYS, weeks: WEEKS },
    snapshotDates: { multiRetailer: MULTI.capturedAt, launchReport: LAUNCH.capturedAt, priceHistoryMonths: LAUNCH.modelHistory.months },
    disclosure: {
      short: "Simulated forward view",
      headline: "The figures on these screens are extrapolated, not measured.",
      body: "Every Sonos lane we hold today is a single capture. This dashboard answers what a quarter of continuous collection would look like: the measured snapshot is used as an anchor and a 13-week daily panel is simulated around it, with retail-calendar seasonality, promotional cycles, stock episodes and competitive response. Levels are pinned to what was measured; shapes are modelled. Nothing here should be read as a reported result.",
      anchors,
      paletteNote: CFG.paletteNote,
      // Declared so the synthetic-figure check can prove provenance instead of
      // guessing from value collisions. This payload is seeded to three decimal
      // places, and only 999 such values exist between 0 and 1, so a share of
      // them will match the dummy set by arithmetic alone. What settles the
      // question is the input list: read it, and the dummy dataset is not on it.
      generator: {
        script: "scripts/insights/build-cco-dataset.mjs",
        config: `scripts/insights/cco/config-${BRAND}.mjs`,
        inputs: [...Object.values(CFG.sources), ...(SW ? ["data/web-traffic/profiles.json"] : [])],
        // The paths actually consumed from each input. An upstream report can
        // carry a generated figure in a block this dashboard never opens — the
        // Shark report's Atlas summary cards are exactly that — and "the file it
        // came from is dirty" is then the wrong question. This makes the right
        // one checkable: is a generated figure inside what we read. Anything not
        // listed here is not read, and the check fails closed on the difference.
        reads: {
          [CFG.sources.launch]: ["capturedAt", "subject", "brands", "event", "aiSearch", "modelHistory",
                                 "pricing.discountRate", "retail.rating", "retail.inStock", "retail.shelfSov",
                                 "retail.aspects", "retail.leadTime", "retail.starBasis"],
          [CFG.sources.multi]:  ["capturedAt", "coverage", "matrix", "deliveryRows", "shelf.sov", "retailers", "models"],
          [CFG.sources.promo]:  ["rows", "capturedAt"],
        },
      },
    },
    sourceReports: CFG.sourceReports,
  },
  dims: {
    dates, weeks, months, dow,
    brands: BRANDS, retailers: RETAILERS, models: MODELS, cities: CITIES,
    engines: ENGINES, stages: STAGES, terms: TERMS, channels: CHANNELS,
    promoTypes: PROMO_TYPES, promoFamilies: PROMO_FAMILIES, aspectMonths: ASPECT_MONTHS, shelfWithheld, events: EVENTS, aspects: ASPECTS, pdpFields: PDP_FIELDS,
    metrics: METRICS.map(({ fn, fmt, ...m }) => m), periods: PERIODS,
  },
  traffic: { daily: trafficDaily, channels: trafficChannels, device: trafficDevice, engage: trafficEngage, geo: trafficGeo, pdp: pdpTraffic, basis: trafficBasis,
             capturedOn: SW && SW.capturedAt ? String(SW.capturedAt).slice(0, 10) : null },
  ai: { overall: aiOverall, byEngineStage: aiByEngineStage, prompts },
  shelf: { sov: shelfSeries, rank: shelfRank, sponsored: sponsoredShare, withheld: shelfWithheld },
  pdpScores,
  distribution: { carriage, sellers, buybox, listings },
  availability: { stock: stockSeries, byCity: stockByCity, episodes: stockEpisodes },
  delivery: { weekly: deliveryWeekly },
  pricing: { price: priceSeries, list: listSeries, discount: discSeries, dispersion, mapBreaches, mapFloorPct },
  promotions: { events: promoEvents, depthByDay: promoDepthByDay, strategy: promoStrategy },
  tco,
  voice: { rating: ratingSeries, velocity: reviewVelocity, aspects: aspectByBrand, aspectMeasured, aspectMonths: ASPECT_MONTHS },
  scorecard, trend, reads,
};

const OUT = resolve(ROOT, CFG.out);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));
const kb = (readFileSync(OUT).length / 1024).toFixed(0);

console.log(`✓ ${OUT.replace(ROOT + "/", "")}  ${kb} KB`);
console.log(`  window        ${dates[0]} → ${dates[NDAYS - 1]}  (${NDAYS} days · ${WEEKS} weeks)`);
console.log(`  brands ${BIDS.length} · models ${MODELS.length} · retailers ${RIDS.length} · cities ${CIDS.length} · engines ${ENGINES.length} · terms ${TERMS.length}`);
console.log(`  carried pairs ${pairs.length} · price points ${pairs.length * NDAYS}`);
console.log(`  promo events  ${promoEvents.length}  (${promoEvents.filter((p) => !p.alwaysOn).length} episodic, ${promoEvents.filter((p) => p.alwaysOn).length} always-on)`);
console.log(`  stock episodes ${stockEpisodes.length} · MAP breaches ${mapBreaches.length} · TCO rows ${tco.length}`);
console.log(`  scorecard ${Object.keys(scorecard).length} cadences x ${METRICS.length} measures x ${BIDS.length} brands`);
console.log(`  reads ${Object.values(reads).reduce((a, r) => a + r.length, 0)} computed across ${Object.keys(reads).length} drivers`);
