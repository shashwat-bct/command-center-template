// =============================================================================
// SONOS · commercial command centre configuration
// =============================================================================
// The measured sources this instance is anchored to, and every brand-, category-
// and catalogue-specific value the shared builder needs. The builder owns the
// simulation; this file owns the world it simulates.
// =============================================================================
import anchors from "./anchors.mjs";

export default {
  id: "sonos",
  subject: "sonos",
  subjectLabel: "Sonos",
  title: "Sonos · Commercial Command Center",
  category: "wireless and smart speakers",
  out: "public/sonos-command-center-data.json",
  // The wordmark that heads the rail. Black on transparent — the stylesheet
  // drives it to white for the dark rail.
  brandMark: "/brand-marks/sonos.png",
  sources: {
    launch: "public/sonos-speakers-launch-data.json",
    multi:  "public/sonos-retailers-data.json",
    promo:  "data/pdp-promo/sonos-multiretailer.json",
    deliv:  "data/delivery-cities/sonos.json",
  },
  sourceReports: [
    { label: "Sonos 2026 launch report", url: "https://atlas.brandcontext.ai/presentation/sonos-2026?autotour=1" },
    { label: "Sonos multi-retailer capture", url: "https://atlas.brandcontext.ai/presentation/sonos-2026-f16o0v-data#pricing" },
  ],

  BRANDS: [
    { id: "sonos",  label: "Sonos",         color: "#5b21b6", soft: "#ede9fe", subject: true },
    { id: "amazon", label: "Amazon Echo",   color: "#0891b2", soft: "#cffafe" },
    { id: "apple",  label: "Apple HomePod", color: "#2563eb", soft: "#dbeafe" },
    { id: "bose",   label: "Bose",          color: "#be123c", soft: "#ffe4e6" },
    { id: "jbl",    label: "JBL",           color: "#d97706", soft: "#fef3c7" },
  ],

  RETAILERS: [
    { id: "amazon",  label: "Amazon",   color: "#d97706", soft: "#fef3c7", weight: 0.44, kind: "marketplace" },
    { id: "bestbuy", label: "Best Buy", color: "#2563eb", soft: "#dbeafe", weight: 0.21, kind: "specialist" },
    { id: "target",  label: "Target",   color: "#be123c", soft: "#ffe4e6", weight: 0.13, kind: "mass" },
    { id: "walmart", label: "Walmart",  color: "#0891b2", soft: "#cffafe", weight: 0.16, kind: "mass" },
    { id: "newegg",  label: "Newegg",   color: "#5b21b6", soft: "#ede9fe", weight: 0.06, kind: "specialist" },
  ],

  CITIES: [
    { id: "nyc", label: "New York, NY",   zip: "10001", region: "Northeast", lat: 40.71, lon: -74.01, measured: true },
    { id: "lax", label: "Los Angeles, CA", zip: "90012", region: "West",      lat: 34.05, lon: -118.24, measured: true },
    { id: "chi", label: "Chicago, IL",    zip: "60601", region: "Midwest",   lat: 41.88, lon: -87.63, measured: true },
    { id: "hou", label: "Houston, TX",    zip: "77002", region: "South",     lat: 29.76, lon: -95.37, measured: true },
    { id: "den", label: "Denver, CO",     zip: "80202", region: "Mountain",  lat: 39.74, lon: -104.99, measured: true },
    { id: "mia", label: "Miami, FL",      zip: "33130", region: "South",     lat: 25.77, lon: -80.19, measured: true },
  ],

  MODELS: [
    { id: "era100",     brand: "sonos",  label: "Era 100",         tier: "core",     msrp: 249,    street0: 219,    anchored: true,  launched: "2023-03-28" },
    { id: "era300",     brand: "sonos",  label: "Era 300",         tier: "premium",  msrp: 479,    street0: 479,    anchored: true,  launched: "2023-03-28" },
    { id: "beamg2",     brand: "sonos",  label: "Beam (Gen 2)",    tier: "premium",  msrp: 499,    street0: 499,    anchored: true,  launched: "2021-10-05" },
    { id: "arcultra",   brand: "sonos",  label: "Arc Ultra",       tier: "flagship", msrp: 999,    street0: 999,    launched: "2024-10-29" },
    { id: "move2",      brand: "sonos",  label: "Move 2",          tier: "premium",  msrp: 449,    street0: 429,    launched: "2023-09-20" },
    { id: "roam2",      brand: "sonos",  label: "Roam 2",          tier: "entry",    msrp: 179,    street0: 159,    launched: "2024-05-21" },
    { id: "era100sl",   brand: "sonos",  label: "Era 100 SL",      tier: "entry",    msrp: 199,    street0: 189,    launched: "2026-03-31", isNew: true },
    { id: "echostudio", brand: "amazon", label: "Echo Studio",     tier: "premium",  msrp: 219.99, street0: 219.99, anchored: true,  launched: "2025-11-12" },
    { id: "echodotmax", brand: "amazon", label: "Echo Dot Max",    tier: "entry",    msrp: 99.99,  street0: 99.99,  anchored: true,  launched: "2025-11-12" },
    { id: "echospot",   brand: "amazon", label: "Echo Spot",       tier: "entry",    msrp: 79.99,  street0: 69.99,  launched: "2024-07-08" },
    { id: "echoshow8",  brand: "amazon", label: "Echo Show 8",     tier: "core",     msrp: 149.99, street0: 134.99, launched: "2025-02-26" },
    { id: "slmax",      brand: "bose",   label: "SoundLink Max",   tier: "premium",  msrp: 399,    street0: 309.99, anchored: true,  launched: "2024-05-16" },
    { id: "slrevp",     brand: "bose",   label: "SoundLink Revolve+", tier: "core",  msrp: 329,    street0: 254.99, anchored: true,  launched: "2021-04-15" },
    { id: "boses500",   brand: "bose",   label: "Smart Speaker 500", tier: "premium", msrp: 549,   street0: 399,    launched: "2018-09-27" },
    { id: "charge5",    brand: "jbl",    label: "JBL Charge 5",    tier: "core",     msrp: 179.95, street0: 134.95, anchored: true,  launched: "2021-04-01" },
    { id: "charge6",    brand: "jbl",    label: "JBL Charge 6",    tier: "core",     msrp: 199.95, street0: 149.95, anchored: true,  launched: "2025-05-20" },
    { id: "flip7",      brand: "jbl",    label: "JBL Flip 7",      tier: "entry",    msrp: 149.95, street0: 119.95, launched: "2025-03-11" },
    { id: "xtreme4",    brand: "jbl",    label: "JBL Xtreme 4",    tier: "premium",  msrp: 379.95, street0: 299.95, launched: "2024-04-16" },
    { id: "homepod2",   brand: "apple",  label: "HomePod (2nd gen)", tier: "premium", msrp: 299,   street0: 279,    launched: "2023-02-03" },
    { id: "homepodmini",brand: "apple",  label: "HomePod mini",    tier: "entry",    msrp: 99,     street0: 94.99,  launched: "2020-11-16" },
  ],

  ENGINES: [
    { id: "gpt",        label: "ChatGPT" },
    { id: "perplexity", label: "Perplexity" },
    { id: "gemini",     label: "Gemini" },
    { id: "copilot",    label: "Copilot" },
  ],

  STAGES: [
    { id: "awareness",     label: "Awareness",     q: "best smart speakers 2026" },
    { id: "consideration", label: "Consideration", q: "Sonos Era 100 vs Echo Studio" },
    { id: "evaluation",    label: "Evaluation",    q: "which speaker has the best multi-room" },
    { id: "decision",      label: "Decision",      q: "where to buy Sonos Era 100 cheapest" },
  ],

  TERMS: [
    { id: "wireless",  label: "wireless speaker",  vol: 1.00 },
    { id: "smart",     label: "smart speaker",     vol: 0.72 },
    { id: "bluetooth", label: "bluetooth speaker", vol: 1.34 },
    { id: "soundbar",  label: "soundbar",          vol: 0.88 },
    { id: "multiroom", label: "multiroom speaker", vol: 0.21 },
  ],

  CHANNELS: [
    { id: "direct",   label: "Direct",         color: "#0d9488" },
    { id: "organic",  label: "Organic search", color: "#2563eb" },
    { id: "paid",     label: "Paid search",    color: "#d97706" },
    { id: "aiRef",    label: "AI assistants",  color: "#7c3aed" },
    { id: "social",   label: "Social",         color: "#db2777" },
    { id: "referral", label: "Referral",       color: "#0891b2" },
    { id: "email",    label: "Email & CRM",    color: "#4d7c0f" },
    { id: "display",  label: "Display & video",color: "#64748b", residual: true },
  ],

  PROMO_TYPES: [
    { id: "discount",   label: "Price discount",     family: "price",   color: "#be123c", costToBrand: 1.00, attach: 1.00, kind: "price",   note: "Straight markdown off the shelf price. Modelled as fully brand-funded through price protection — the assumption on this page a commercial team is most likely to want to change, and the one that moves the funding split furthest." },
    { id: "card",       label: "Card offer",         family: "finance", color: "#2563eb", costToBrand: 0.25, attach: 0.14, kind: "finance", note: "Retailer store card, e.g. $50 instant off on approval." },
    { id: "bnpl",       label: "Buy now, pay later", family: "finance", color: "#2563eb", costToBrand: 0.35, attach: 0.19, kind: "finance", note: "Pay in 4 / Affirm. Cost is the platform fee." },
    { id: "financing",  label: "Financing",          family: "finance", color: "#2563eb", costToBrand: 0.30, attach: 0.11, kind: "finance", note: "Monthly instalment offer at $/mo." },
    { id: "tradein",    label: "Trade-in",           family: "price",   color: "#be123c", costToBrand: 0.60, attach: 0.08, kind: "price",   note: "Save % when an old device is returned." },
    { id: "bundle",     label: "Bundle",             family: "value",   color: "#0891b2", costToBrand: 0.70, attach: 0.16, kind: "value",   note: "Second product or service attached below list." },
    { id: "protection", label: "Protection plan",    family: "addon",   color: "#5b21b6", costToBrand: 0.00, attach: 0.21, kind: "addon",   note: "Retailer-sold warranty. Adds to what the shopper pays." },
    { id: "delivery",   label: "Delivery offer",     family: "value",   color: "#0891b2", costToBrand: 0.20, attach: 0.62, kind: "value",   note: "Free or accelerated shipping." },
    { id: "trial",      label: "Service trial",      family: "value",   color: "#0891b2", costToBrand: 0.15, attach: 0.27, kind: "value",   note: "Music or membership trial attached to the purchase." },
    { id: "cashback",   label: "Cash back",          family: "price",   color: "#be123c", costToBrand: 0.45, attach: 0.23, kind: "price",   note: "Loyalty rebate paid back after purchase." },
    { id: "clearance",  label: "Clearance",          family: "price",   color: "#881337", costToBrand: 0.85, attach: 1.00, kind: "price",   note: "End-of-life markdown to clear stock." },
  ],

  PROMO_FAMILIES: [
    { id: "price",   label: "Price give",     color: "#be123c", note: "Money off the shelf price." },
    { id: "finance", label: "Finance",        color: "#2563eb", note: "Spreads the payment; does not change the total." },
    { id: "value",   label: "Attached value", color: "#0891b2", note: "Something extra at no or low cost." },
    { id: "addon",   label: "Paid add-on",    color: "#5b21b6", note: "Raises what the shopper pays." },
  ],

  EVENTS: [
    { id: "memorial", label: "Memorial Day",        start: "2026-05-25", end: "2026-05-26", lift: 1.34, kind: "retail" },
    { id: "fathers",  label: "Father's Day",        start: "2026-06-14", end: "2026-06-21", lift: 1.22, kind: "retail" },
    { id: "july4",    label: "July 4th",            start: "2026-07-02", end: "2026-07-06", lift: 1.28, kind: "retail" },
    { id: "primeday", label: "Prime Day",           start: "2026-07-14", end: "2026-07-15", lift: 1.95, kind: "platform" },
    { id: "b2s",      label: "Back to school",      start: "2026-08-03", end: "2026-08-23", lift: 1.15, kind: "season" },
    { id: "sonoslaunch", label: "Sonos Play + Era 100 SL on shelf", start: "2026-06-09", end: "2026-06-16", lift: 1.41, kind: "brand", brand: "sonos" },
  ],

  BASE_CARRIAGE: {                      // p(carried) by brand x retailer
    sonos:  { amazon: 1, bestbuy: 1, target: 0.9, walmart: 0.5, newegg: 0.6 },
    amazon: { amazon: 1, bestbuy: 1, target: 1,   walmart: 0.2, newegg: 0.4 },
    apple:  { amazon: 1, bestbuy: 1, target: 1,   walmart: 1,   newegg: 0.5 },
    bose:   { amazon: 1, bestbuy: 1, target: 0.8, walmart: 1,   newegg: 0.8 },
    jbl:    { amazon: 1, bestbuy: 1, target: 1,   walmart: 1,   newegg: 0.9 },
  },

  RETAILER_MECHANICS: {
    amazon:  { card: 5, protection: 4, delivery: 4, discount: 4, tradein: 2, bundle: 1, clearance: 1 },
    target:  { protection: 4, financing: 3, bnpl: 3, delivery: 2, bundle: 2, discount: 2 },
    walmart: { delivery: 3, trial: 3, discount: 3, cashback: 2, protection: 2, financing: 2 },
    bestbuy: { discount: 4, financing: 3, bundle: 2, delivery: 2, tradein: 1, protection: 2 },
    newegg:  { discount: 4, bundle: 2, delivery: 2, bnpl: 2, cashback: 1 },
  },

  PROMO_APPETITE: { sonos: 0.16, bose: 0.44, amazon: 0.58, jbl: 0.93, apple: 0.88 },

  RETAILER_PRICE_BIAS: { amazon: -0.012, bestbuy: 0.004, target: 0.011, walmart: -0.004, newegg: 0.021 },

  RETAILER_LEADTIME: { amazon: 2.2, walmart: 3.1, target: 3.4, bestbuy: 3.9, newegg: 5.2 },

  CITY_LEADTIME: { nyc: -0.5, lax: -0.35, chi: -0.2, hou: 0.15, den: 0.55, mia: 0.7 },

  PROMPT_BANK: [
    ["awareness", "best smart speakers 2026"], ["awareness", "best wireless speaker for a house"],
    ["awareness", "top rated bluetooth speakers this year"], ["awareness", "best multiroom audio system"],
    ["awareness", "which speaker brand is most reliable"],
    ["consideration", "Sonos Era 100 vs Echo Studio"], ["consideration", "Sonos vs Bose for home audio"],
    ["consideration", "is Sonos worth the money"], ["consideration", "JBL Charge 6 vs Sonos Roam"],
    ["consideration", "Sonos Beam vs Arc Ultra which soundbar"],
    ["evaluation", "which speaker has the best multi-room support"], ["evaluation", "does Sonos work with Apple Music"],
    ["evaluation", "speaker with best app experience"], ["evaluation", "Sonos Era 100 sound quality review"],
    ["evaluation", "most durable portable speaker"],
    ["decision", "where to buy Sonos Era 100 cheapest"], ["decision", "Sonos discount code August 2026"],
    ["decision", "best Prime Day speaker deals"], ["decision", "Sonos Era 100 SL price"],
    ["decision", "cheapest place to buy Echo Studio"],
  ],

  TRAFFIC_BASE: { sonos: 148000, amazon: 316000, apple: 96000, bose: 208000, jbl: 176000 },

  CHANNEL_MIX: {
    sonos:  { direct: .31, organic: .27, paid: .11, aiRef: .05, social: .09, referral: .09, email: .06, display: .02 },
    amazon: { direct: .44, organic: .19, paid: .07, aiRef: .04, social: .07, referral: .13, email: .04, display: .02 },
    apple:  { direct: .49, organic: .24, paid: .04, aiRef: .04, social: .06, referral: .10, email: .02, display: .01 },
    bose:   { direct: .26, organic: .24, paid: .17, aiRef: .04, social: .11, referral: .08, email: .07, display: .03 },
    jbl:    { direct: .21, organic: .23, paid: .22, aiRef: .03, social: .16, referral: .07, email: .05, display: .03 },
  },

  mapFloorPct: { sonos: 0.86, apple: 0.84, bose: 0.74, amazon: 0.72, jbl: 0.58 },


  // ── how each brand behaves, where the builder needs a per-brand number ─────
  // Price ladder floor as a share of list, and how far a step is allowed to move.
  // Sonos holds price; JBL clears stock. Both come from the measured discount rate.
  PRICE_FLOOR_PCT: { sonos: 0.955, bose: 0.86, amazon: 0.80, apple: 0.62, jbl: 0.62 },
  PRICE_DRIFT:     { sonos: 0.008, bose: 0.028, amazon: 0.028, apple: 0.028, jbl: 0.028 },

  // Where a brand over-indexes on a search term relative to its overall shelf share.
  TERM_BIAS: {
    multiroom: { sonos: 4.2 },
    soundbar:  { sonos: 2.6 },
    bluetooth: { jbl: 1.9 },
    smart:     { amazon: 1.5 },
  },
  // Extra paid pressure on event weeks, beyond a retailer promoting its own brand.
  PAID_PUSH:       { jbl: 1.5 },
  // Share of a brand's grid presence that is a sponsored placement, before events.
  SPONSORED_BASE:  { jbl: 34, bose: 26, amazon: 41, sonos: 11, apple: 6 },
  // How complete a brand's product pages tend to be, before the retailer's own lift.
  PDP_BRAND_LIFT:  { sonos: 0.86, amazon: 0.95, apple: 0.79, bose: 0.88, jbl: 0.83 },

  // A launch lifts the subject's presence in the lower funnel first.
  LAUNCH_PULL: { brand: "sonos", from: "2026-06-09", stages: ["evaluation", "decision"], rampDays: 34, points: 7.5 },

  // Brands whose traffic rides every event on the calendar, including a retail
  // platform's own — a house brand on its own platform does.
  TRAFFIC_ALL_EVENTS: ["amazon"],
  TRAFFIC_TREND: { sonos: 0.09, amazon: 0.03, apple: -0.02, bose: 0.01, jbl: 0.06 },
  ENGAGE: {
    sonos:  { bounce: 41, pages: 4.1, duration: 214, addToCart: 5.8 },
    amazon: { bounce: 37, pages: 3.4, duration: 176, addToCart: 7.4 },
    apple:  { bounce: 44, pages: 3.1, duration: 158, addToCart: 4.2 },
    bose:   { bounce: 46, pages: 3.2, duration: 168, addToCart: 5.1 },
    jbl:    { bounce: 52, pages: 2.6, duration: 132, addToCart: 6.6 },
  },
  RATING_DRIFT:    { sonos: 0.04 },
  REVIEW_VELOCITY: { sonos: 34, amazon: 148, apple: 9, bose: 96, jbl: 285 },
  SERVICE:         {},   // no mandatory subscription in this category

  anchors,
  paletteNote: "Sonos\u2019s own black fails the chroma and lightness checks for a categorical slot and reads as \u201cno data\u201d, and Amazon teal against Apple blue fails colour-vision separation."
    .replace(/\s+/g, " "),
};
