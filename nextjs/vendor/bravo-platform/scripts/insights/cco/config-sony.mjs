import anchors from "./anchors.mjs";

// =============================================================================
// SONY BRAVIA · commercial command centre configuration
// =============================================================================
// Same builder, same fifteen screens, a different world. Televisions are not
// speakers: the basket is five to ten times larger, the promotional mechanics
// are different (open-box, included content credits, delivery-and-install), the
// competitive set is four brands not five, and the subject's premium range is
// concentrated in one retailer. Every level below is anchored to the two Sony
// captures named in `sources`.
// =============================================================================
export default {
  id: "sony",
  subject: "sony",
  subjectLabel: "Sony Bravia",
  title: "Sony Bravia · Commercial Command Center",
  category: "premium televisions",
  out: "public/sony-command-center-data.json",
  // The wordmark that heads the rail. Black on transparent — the stylesheet
  // drives it to white for the dark rail.
  brandMark: "/brand-marks/sony.png",
  sources: {
    launch: "public/sony-launch-data.json",
    multi:  "public/sonyrgb-retailers-data.json",
    promo:  "data/pdp-promo/sonyrgb-multiretailer.json",
    deliv:  "data/delivery-cities/sonyrgb.json",
  },
  sourceReports: [
    { label: "Sony Bravia 2026 launch report", url: "https://atlas.brandcontext.ai/presentation/sony-bravia-launch?autotour=1" },
    { label: "Sony multi-retailer capture", url: "https://atlas.brandcontext.ai/presentation/sony-retail-2026-4o50yg" },
  ],
  anchors,
  paletteNote: "Sony\u2019s own black fails the chroma and lightness checks for a categorical slot and reads as \u201cno data\u201d, and Samsung blue against LG red is the pair a reader most needs to be able to separate."
    .replace(/\s+/g, " "),

  // Four slots from the same validated palette the Sonos instance uses. The
  // brands do not wear their marketing colours: Sony black fails the chroma and
  // lightness checks for a categorical slot and reads as "no data", and Samsung
  // blue against LG red is the pair a reader most needs to separate.
  BRANDS: [
    { id: "sony",    label: "Sony Bravia", color: "#5b21b6", soft: "#ede9fe", subject: true },
    { id: "samsung", label: "Samsung",     color: "#0891b2", soft: "#cffafe" },
    { id: "lg",      label: "LG",          color: "#be123c", soft: "#ffe4e6" },
    { id: "tcl",     label: "TCL",         color: "#d97706", soft: "#fef3c7" },
  ],

  RETAILERS: [
    { id: "amazon",  label: "Amazon",   color: "#d97706", soft: "#fef3c7", weight: 0.34, kind: "marketplace" },
    { id: "bestbuy", label: "Best Buy", color: "#2563eb", soft: "#dbeafe", weight: 0.31, kind: "specialist" },
    { id: "target",  label: "Target",   color: "#be123c", soft: "#ffe4e6", weight: 0.11, kind: "mass" },
    { id: "walmart", label: "Walmart",  color: "#0891b2", soft: "#cffafe", weight: 0.18, kind: "mass" },
    { id: "newegg",  label: "Newegg",   color: "#5b21b6", soft: "#ede9fe", weight: 0.06, kind: "specialist" },
  ],

  CITIES: [
    { id: "nyc", label: "New York, NY",    zip: "10001", region: "Northeast", lat: 40.71, lon: -74.01, measured: true },
    { id: "lax", label: "Los Angeles, CA", zip: "90012", region: "West",      lat: 34.05, lon: -118.24, measured: true },
    { id: "chi", label: "Chicago, IL",     zip: "60601", region: "Midwest",   lat: 41.88, lon: -87.63, measured: true },
    { id: "hou", label: "Houston, TX",     zip: "77002", region: "South",     lat: 29.76, lon: -95.37, measured: true },
    { id: "den", label: "Denver, CO",      zip: "80202", region: "Mountain",  lat: 39.74, lon: -104.99, measured: true },
    { id: "mia", label: "Miami, FL",       zip: "33130", region: "South",     lat: 25.77, lon: -80.19, measured: true },
  ],

  // The nine models in the measured matrix, plus the rest of each brand's 2026
  // shelf so the assortment lanes have something to say. `anchored:true` marks a
  // model whose price and carriage are pinned to a captured product page.
  MODELS: [
    { id: "b9ii-65",   brand: "sony",    label: "BRAVIA 9 II 65\"",   tier: "flagship", msrp: 3299.99, street0: 2974.99, anchored: true, launched: "2026-05-27", isNew: true },
    { id: "b7ii-65",   brand: "sony",    label: "BRAVIA 7 II 65\"",   tier: "premium",  msrp: 2799.99, street0: 2599.99, anchored: true, launched: "2026-05-27", isNew: true },
    { id: "b7ii-55",   brand: "sony",    label: "BRAVIA 7 II 55\"",   tier: "premium",  msrp: 2199.99, street0: 1999.99, anchored: true, launched: "2026-05-27", isNew: true },
    { id: "b9-65",     brand: "sony",    label: "BRAVIA 9 65\"",      tier: "flagship", msrp: 2999.99, street0: 2798.00, anchored: true, launched: "2024-04-17" },
    { id: "b8ii-65",   brand: "sony",    label: "BRAVIA 8 II 65\"",   tier: "flagship", msrp: 3499.99, street0: 3298.00, anchored: true, launched: "2025-05-14" },
    { id: "b5-65",     brand: "sony",    label: "BRAVIA 5 65\"",      tier: "core",     msrp: 1299.99, street0: 1198.00, launched: "2025-06-11" },
    { id: "b3-55",     brand: "sony",    label: "BRAVIA 3 55\"",      tier: "entry",    msrp:  699.99, street0:  598.00, launched: "2024-09-04" },
    { id: "qn80h-65",  brand: "samsung", label: "Samsung QN80H 65\"", tier: "core",     msrp: 1597.99, street0: 1497.99, anchored: true, launched: "2026-03-05" },
    { id: "s90h-65",   brand: "samsung", label: "Samsung S90H 65\"",  tier: "premium",  msrp: 1899.99, street0: 1797.99, anchored: true, launched: "2026-03-05" },
    { id: "qn90f-65",  brand: "samsung", label: "Samsung QN90F 65\"", tier: "premium",  msrp: 2199.99, street0: 1997.99, launched: "2025-03-20" },
    { id: "frame-55",  brand: "samsung", label: "The Frame 55\"",     tier: "core",     msrp: 1499.99, street0: 1297.99, launched: "2025-04-10" },
    { id: "du8000-55", brand: "samsung", label: "Samsung DU8000 55\"",tier: "entry",    msrp:  599.99, street0:  497.99, launched: "2024-04-02" },
    { id: "g5-65",     brand: "lg",      label: "LG G5 OLED 65\"",    tier: "flagship", msrp: 2499.99, street0: 2299.99, anchored: true, launched: "2025-04-01" },
    { id: "c5rgb-65",  brand: "lg",      label: "LG C5 OLED 65\"",    tier: "premium",  msrp: 1699.99, street0: 1499.99, anchored: true, launched: "2025-04-01" },
    { id: "b5-55",     brand: "lg",      label: "LG B5 OLED 55\"",    tier: "core",     msrp: 1299.99, street0: 1099.99, launched: "2025-05-20" },
    { id: "qned85-65", brand: "lg",      label: "LG QNED85 65\"",     tier: "core",     msrp: 1199.99, street0:  999.99, launched: "2025-04-22" },
    { id: "qm8k-65",   brand: "tcl",     label: "TCL QM8K 65\"",      tier: "premium",  msrp: 1499.99, street0: 1199.99, launched: "2025-04-08" },
    { id: "qm7k-65",   brand: "tcl",     label: "TCL QM7K 65\"",      tier: "core",     msrp: 1099.99, street0:  849.99, launched: "2025-04-08" },
    { id: "qm6k-75",   brand: "tcl",     label: "TCL QM6K 75\"",      tier: "core",     msrp: 1299.99, street0:  899.99, launched: "2025-03-11" },
    { id: "s5-55",     brand: "tcl",     label: "TCL S5 55\"",        tier: "entry",    msrp:  429.99, street0:  329.99, launched: "2025-02-25" },
  ],

  ENGINES: [
    { id: "gpt",        label: "ChatGPT" },
    { id: "perplexity", label: "Perplexity" },
    { id: "gemini",     label: "Gemini" },
    { id: "copilot",    label: "Copilot" },
  ],
  STAGES: [
    { id: "awareness",     label: "Awareness",     q: "best TVs to buy in 2026" },
    { id: "consideration", label: "Consideration", q: "Sony BRAVIA 9 II vs Samsung S90H" },
    { id: "evaluation",    label: "Evaluation",    q: "which TV has the best picture quality" },
    { id: "decision",      label: "Decision",      q: "where to buy a BRAVIA 9 II cheapest" },
  ],
  // The three measured terms, plus two the category is also shopped on.
  TERMS: [
    { id: "4k",      label: "4k tv",        vol: 1.00 },
    { id: "oled",    label: "oled tv",      vol: 0.54 },
    { id: "miniled", label: "mini led tv",  vol: 0.28 },
    { id: "smart",   label: "smart tv",     vol: 0.91 },
    { id: "big",     label: "75 inch tv",   vol: 0.42 },
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

  // Eleven mechanics drawn from what the Sony and competitor product pages were
  // actually seen running. Two are specific to this category and absent from the
  // speaker set: an open-box price, and an included content credit — Sony ships
  // movie credits and an IMAX Enhanced entitlement with the premium BRAVIAs.
  // `costToBrand` is the share of face value the brand carries; `attach` the
  // share of buyers who take it when offered. Both are modelling assumptions and
  // are printed on the cost-of-ownership page so the arithmetic can be argued with.
  PROMO_TYPES: [
    { id: "discount",   label: "Price discount",    family: "price",   color: "#be123c", costToBrand: 1.00, attach: 1.00, kind: "price",   note: "Straight markdown off the shelf price. Modelled as fully brand-funded through price protection — the assumption on this page a commercial team is most likely to want to change, and the one that moves the funding split furthest." },
    { id: "card",       label: "Card offer",        family: "finance", color: "#2563eb", costToBrand: 0.25, attach: 0.12, kind: "finance", note: "Retailer store card, e.g. $50 instant off on approval." },
    { id: "bnpl",       label: "Buy now, pay later",family: "finance", color: "#2563eb", costToBrand: 0.35, attach: 0.14, kind: "finance", note: "Pay in 4 / Affirm. Cost is the platform fee." },
    { id: "financing",  label: "Financing",         family: "finance", color: "#2563eb", costToBrand: 0.30, attach: 0.22, kind: "finance", note: "Monthly instalment offer — heavily used at this basket size." },
    { id: "tradein",    label: "Trade-in",          family: "price",   color: "#be123c", costToBrand: 0.60, attach: 0.06, kind: "price",   note: "Credit for an old set returned at purchase." },
    { id: "bundle",     label: "Soundbar bundle",   family: "value",   color: "#0891b2", costToBrand: 0.70, attach: 0.18, kind: "value",   note: "Audio attached below the sum of its parts." },
    { id: "protection", label: "Protection plan",   family: "addon",   color: "#5b21b6", costToBrand: 0.00, attach: 0.28, kind: "addon",   note: "Retailer-sold warranty. Adds to what the shopper pays." },
    { id: "delivery",   label: "Delivery & install",family: "value",   color: "#0891b2", costToBrand: 0.25, attach: 0.55, kind: "value",   note: "Free or white-glove delivery, mounting and haul-away." },
    { id: "content",    label: "Included content",  family: "value",   color: "#0891b2", costToBrand: 0.55, attach: 0.41, kind: "value",   note: "Movie credits and streaming entitlements shipped with the set." },
    { id: "openbox",    label: "Open-box",          family: "price",   color: "#881337", costToBrand: 0.30, attach: 0.04, kind: "price",   note: "Returned or display stock at a cut price." },
    { id: "clearance",  label: "Clearance",         family: "price",   color: "#881337", costToBrand: 0.85, attach: 1.00, kind: "price",   note: "End-of-line markdown to clear the previous model year." },
  ],
  PROMO_FAMILIES: [
    { id: "price",   label: "Price give",     color: "#be123c", note: "Money off the shelf price." },
    { id: "finance", label: "Finance",        color: "#2563eb", note: "Spreads the payment; does not change the total." },
    { id: "value",   label: "Attached value", color: "#0891b2", note: "Something extra at no or low cost." },
    { id: "addon",   label: "Paid add-on",    color: "#5b21b6", note: "Raises what the shopper pays." },
  ],

  // The retail calendar a television is actually sold against. July 4th is the
  // second-largest TV week of the year after Black Friday, and the sport-driven
  // spring window is what the BRAVIA line launches into.
  EVENTS: [
    { id: "memorial",  label: "Memorial Day",   start: "2026-05-25", end: "2026-05-26", lift: 1.52, kind: "retail" },
    { id: "bravia",    label: "BRAVIA 9 II / 7 II on shelf", start: "2026-05-27", end: "2026-06-07", lift: 1.44, kind: "brand", brand: "sony" },
    { id: "fathers",   label: "Father's Day",   start: "2026-06-14", end: "2026-06-21", lift: 1.31, kind: "retail" },
    { id: "july4",     label: "July 4th",       start: "2026-07-02", end: "2026-07-06", lift: 1.61, kind: "retail" },
    { id: "primeday",  label: "Prime Day",      start: "2026-07-14", end: "2026-07-15", lift: 1.88, kind: "platform" },
    { id: "footy",     label: "Football season pre-buy", start: "2026-08-10", end: "2026-08-23", lift: 1.24, kind: "season" },
  ],

  // p(carried) by brand x retailer, for the cells the capture could not read.
  // Sony's premium range is concentrated at Best Buy and thin at Target, which
  // the measured matrix already pins for the nine models it covers.
  BASE_CARRIAGE: {
    sony:    { amazon: 0.55, bestbuy: 1,    target: 0.06, walmart: 0.45, newegg: 0.55 },
    samsung: { amazon: 1,    bestbuy: 1,    target: 0.55, walmart: 0.85, newegg: 0.85 },
    lg:      { amazon: 1,    bestbuy: 1,    target: 0.35, walmart: 0.70, newegg: 0.70 },
    tcl:     { amazon: 1,    bestbuy: 0.95, target: 1,    walmart: 1,    newegg: 0.75 },
  },
  RETAILER_MECHANICS: {
    amazon:  { protection: 5, delivery: 4, discount: 3, card: 3, content: 2, clearance: 1 },
    bestbuy: { discount: 4, financing: 4, delivery: 3, protection: 3, tradein: 2, bundle: 2, openbox: 2 },
    target:  { protection: 3, financing: 3, bnpl: 3, delivery: 2, bundle: 2, discount: 2 },
    walmart: { discount: 4, delivery: 3, protection: 3, financing: 2, bundle: 1 },
    newegg:  { discount: 4, openbox: 3, protection: 2, delivery: 2, bnpl: 2 },
  },
  // How willing each brand is to be discounted, from the measured Keepa rate:
  // Samsung 1.2%, Sony 5.1%, LG 11.9%, TCL 19.7%.
  PROMO_APPETITE: { samsung: 0.14, sony: 0.34, lg: 0.66, tcl: 0.95 },

  PRICE_FLOOR_PCT: { samsung: 0.93, sony: 0.88, lg: 0.80, tcl: 0.70 },
  PRICE_DRIFT:     { samsung: 0.010, sony: 0.014, lg: 0.026, tcl: 0.032 },
  RETAILER_PRICE_BIAS: { amazon: -0.009, bestbuy: 0.006, target: 0.014, walmart: -0.003, newegg: 0.018 },
  RETAILER_LEADTIME: { amazon: 3.4, walmart: 4.2, target: 4.6, bestbuy: 3.0, newegg: 5.8 },
  CITY_LEADTIME:  { nyc: -0.5, lax: -0.35, chi: -0.2, hou: 0.15, den: 0.55, mia: 0.7 },

  TERM_BIAS: {
    oled:    { lg: 2.4, sony: 1.6 },
    miniled: { sony: 1.8, tcl: 1.6, samsung: 1.5 },
    big:     { tcl: 1.5, samsung: 1.3 },
    smart:   { samsung: 1.2 },
  },
  PAID_PUSH:      { tcl: 1.6, samsung: 1.3 },
  SPONSORED_BASE: { tcl: 42, samsung: 38, lg: 24, sony: 9 },
  PDP_BRAND_LIFT: { sony: 0.90, samsung: 0.94, lg: 0.88, tcl: 0.80 },

  LAUNCH_PULL: { brand: "sony", from: "2026-05-27", stages: ["evaluation", "decision"], rampDays: 40, points: 6 },

  // No retailer in this set sells its own house brand of television.
  TRAFFIC_ALL_EVENTS: [],
  TRAFFIC_BASE: { sony: 212000, samsung: 486000, lg: 318000, tcl: 147000 },
  TRAFFIC_TREND: { sony: 0.11, samsung: 0.02, lg: 0.01, tcl: 0.07 },
  CHANNEL_MIX: {
    sony:    { direct: .34, organic: .26, paid: .09, aiRef: .05, social: .08, referral: .11, email: .05, display: .02 },
    samsung: { direct: .38, organic: .23, paid: .12, aiRef: .04, social: .08, referral: .09, email: .04, display: .02 },
    lg:      { direct: .30, organic: .25, paid: .14, aiRef: .04, social: .09, referral: .10, email: .05, display: .03 },
    tcl:     { direct: .19, organic: .24, paid: .24, aiRef: .03, social: .15, referral: .08, email: .04, display: .03 },
  },
  // A television is a considered purchase: more pages, longer sessions and a far
  // lower add-to-cart than a speaker, because most of the basket closes in store.
  ENGAGE: {
    sony:    { bounce: 39, pages: 4.6, duration: 245, addToCart: 2.1 },
    samsung: { bounce: 36, pages: 4.1, duration: 218, addToCart: 2.8 },
    lg:      { bounce: 41, pages: 3.9, duration: 205, addToCart: 2.4 },
    tcl:     { bounce: 48, pages: 3.1, duration: 158, addToCart: 3.6 },
  },
  RATING_DRIFT:    { sony: 0.03 },
  REVIEW_VELOCITY: { sony: 22, samsung: 78, lg: 41, tcl: 62 },
  SERVICE:         {},
  mapFloorPct:     { samsung: 0.88, sony: 0.85, lg: 0.75, tcl: 0.62 },

  PROMPT_BANK: [
    ["awareness", "best TVs to buy in 2026"], ["awareness", "best 65 inch TV for a living room"],
    ["awareness", "best OLED TV this year"], ["awareness", "best TV for bright rooms"],
    ["awareness", "which TV brand is most reliable"],
    ["consideration", "Sony BRAVIA 9 II vs Samsung S90H"], ["consideration", "Sony vs LG OLED which is better"],
    ["consideration", "is a Sony BRAVIA worth the premium"], ["consideration", "TCL QM8K vs Samsung QN90F"],
    ["consideration", "mini LED vs OLED for a living room"],
    ["evaluation", "which TV has the best picture quality"], ["evaluation", "best TV for PS5 120hz gaming"],
    ["evaluation", "which TV has the best built-in sound"], ["evaluation", "Sony BRAVIA 9 II review"],
    ["evaluation", "best TV for watching sport"],
    ["decision", "where to buy a BRAVIA 9 II cheapest"], ["decision", "Sony TV deals August 2026"],
    ["decision", "best Prime Day TV deals"], ["decision", "BRAVIA 7 II 65 inch price"],
    ["decision", "cheapest place to buy an LG G5"],
  ],
};
