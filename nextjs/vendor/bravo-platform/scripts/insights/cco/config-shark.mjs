import anchors from "./anchors.mjs";

// =============================================================================
// SHARK · commercial command centre configuration
// =============================================================================
// This dashboard is a SIMULATED FORWARD VIEW — it says so in its own top bar —
// and the simulation IS the deliverable, not a fallback from one. The Shark
// study measured Amazon: eleven tracked listings, six months of audited price
// and availability history, the Amazon shelf, the listing lead time and the
// review base. All of that is the anchor. The rest of the retail estate and the
// metro spread are extrapolated from it, on exactly the machinery every other
// instance uses for a cell its own capture could not read.
//
// That is what the anchor ledger on the method screen is for: it names, lane by
// lane, which figures are pinned to a capture and which are modelled around
// them. An executive should see a complete commercial picture and be able to
// find out in one click how much of it is measured — not meet a blank panel.
//
// data/amazon-only/shark.json is the launch report and the PDP capture reshaped
// into the capture format, adding nothing: it asserts the Amazon cells and stays
// silent everywhere else, so the builder extrapolates the rest.
// =============================================================================
export default {
  id: "shark",
  subject: "shark",
  subjectLabel: "Shark",
  title: "Shark · Commercial Command Center",
  category: "cordless stick vacuums",
  out: "public/shark-command-center-data.json",
  brandMark: "/brand-marks/shark.svg",
  sources: {
    launch: "public/shark-vacuums-data.json",
    multi:  "data/amazon-only/shark.json",
    promo:  "data/pdp-promo/shark-vacuums.json",
    deliv:  "data/amazon-only/shark.json",
  },
  sourceReports: [
    { label: "Shark 2026 cordless vacuums report", url: "https://atlas.brandcontext.ai/presentation/shark-2026-2fa819?autotour=1" },
  ],
  anchors,
  paletteNote: "Shark’s own navy sits too close to Dyson’s for a categorical slot, and the pair a reader most needs to separate here is the subject against Dyson.",

  // Four slots from the same validated palette the other instances use. Samsung
  // appears in the report's media and social lanes but has no tracked listing,
  // no rating and no lead time, so it is not carried here: a brand column that
  // is empty across every commercial lane is worse than an absent one.
  BRANDS: [
    { id: "shark",  label: "Shark",  color: "#5b21b6", soft: "#ede9fe", subject: true },
    { id: "dyson",  label: "Dyson",  color: "#0891b2", soft: "#cffafe" },
    { id: "tineco", label: "Tineco", color: "#be123c", soft: "#ffe4e6" },
    { id: "lg",     label: "LG",     color: "#d97706", soft: "#fef3c7" },
  ],

  // Amazon is measured. The other four are the estate a cordless vacuum is
  // actually sold across, modelled from the Amazon anchor — weights are US
  // channel shares for small domestic appliances.
  RETAILERS: [
    { id: "amazon",  label: "Amazon",   color: "#d97706", soft: "#fef3c7", weight: 0.41, kind: "marketplace" },
    { id: "bestbuy", label: "Best Buy", color: "#2563eb", soft: "#dbeafe", weight: 0.17, kind: "specialist" },
    { id: "target",  label: "Target",   color: "#be123c", soft: "#ffe4e6", weight: 0.16, kind: "mass" },
    { id: "walmart", label: "Walmart",  color: "#0891b2", soft: "#cffafe", weight: 0.21, kind: "mass" },
    { id: "kohls",   label: "Kohl's",   color: "#5b21b6", soft: "#ede9fe", weight: 0.05, kind: "department" },
  ],

  CITIES: [
    { id: "nyc", label: "New York, NY",    zip: "10001", region: "Northeast", lat: 40.71, lon: -74.01 },
    { id: "lax", label: "Los Angeles, CA", zip: "90012", region: "West",      lat: 34.05, lon: -118.24 },
    { id: "chi", label: "Chicago, IL",     zip: "60601", region: "Midwest",   lat: 41.88, lon: -87.63 },
    { id: "hou", label: "Houston, TX",     zip: "77002", region: "South",     lat: 29.76, lon: -95.37 },
    { id: "den", label: "Denver, CO",      zip: "80202", region: "Mountain",  lat: 39.74, lon: -104.99 },
    { id: "mia", label: "Miami, FL",       zip: "33130", region: "South",     lat: 25.77, lon: -80.19 },
  ],

  // The eleven tracked ASINs, every one pinned to a captured product page.
  // msrp is the listed price from the audited history; street0 the price the
  // page actually showed at capture.
  MODELS: [
    { id: "B0F2GS1SN6", brand: "shark",  label: "PowerPro Flex Reveal Plus", tier: "core",     msrp: 379.99,  street0: 379.95,  anchored: true },
    { id: "B0DDZVKVNJ", brand: "shark",  label: "PowerDetect Stick",        tier: "premium",  msrp: 449.99,  street0: 349.95,  anchored: true },
    { id: "B0D15LVBJB", brand: "shark",  label: "Clean & Empty Stick",      tier: "premium",  msrp: 449.99,  street0: 417.98,  anchored: true },
    { id: "B0GTC14BFW", brand: "dyson",  label: "V15 Detect Origin",        tier: "premium",  msrp: 839.99,  street0: 839.99,  anchored: true },
    { id: "B0GYPLWHKJ", brand: "dyson",  label: "V16 Piston Animal",        tier: "flagship", msrp: 979.99,  street0: 849.99,  anchored: true },
    { id: "B0GY5Z5BT4", brand: "dyson",  label: "V16 Piston Submarine",     tier: "flagship", msrp: 1099.99, street0: 1099.95, anchored: true },
    { id: "B0F43B9K65", brand: "tineco", label: "Pure ONE S70",             tier: "premium",  msrp: 569.00,  street0: 569.00,  anchored: true },
    { id: "B0FKM65DLZ", brand: "tineco", label: "Pure ONE A90S",            tier: "premium",  msrp: 749.00,  street0: 749.00,  anchored: true },
    { id: "B0GXTVBT2B", brand: "tineco", label: "Pure ONE Station 5 Pro",   tier: "premium",  msrp: 599.00,  street0: 599.00,  anchored: true },
    { id: "B0F146NL5W", brand: "lg",     label: "CordZero Q3",              tier: "core",     msrp: 329.00,  street0: 319.00,  anchored: true },
    { id: "B0CS45SYW7", brand: "lg",     label: "CordZero A949",            tier: "entry",    msrp: 999.99,  street0: 249.99,  anchored: true },
    // Beyond the eleven tracked listings, the rest of each brand's 2026 cordless
    // range, so the assortment, ladder and mechanic lanes have the shelf a
    // shopper actually meets rather than only the ASINs this study followed.
    // Same treatment as the unanchored half of the Sonos and Sony model sets.
    { id: "sh-detectpro", brand: "shark",  label: "Detect Pro Auto-Empty",  tier: "premium",  msrp: 499.99, street0: 399.99 },
    { id: "sh-stratos",   brand: "shark",  label: "Stratos Cordless",       tier: "core",     msrp: 429.99, street0: 349.99 },
    { id: "sh-cordpro",   brand: "shark",  label: "Cordless Pro",           tier: "core",     msrp: 349.99, street0: 279.99 },
    { id: "sh-rocket",    brand: "shark",  label: "Rocket Pet Pro",         tier: "entry",    msrp: 259.99, street0: 199.99 },
    { id: "dy-v12slim",   brand: "dyson",  label: "V12 Detect Slim",        tier: "premium",  msrp: 649.99, street0: 549.99 },
    { id: "dy-gen5",      brand: "dyson",  label: "Gen5detect",             tier: "flagship", msrp: 949.99, street0: 849.99 },
    { id: "dy-v8",        brand: "dyson",  label: "V8 Origin",              tier: "entry",    msrp: 369.99, street0: 279.99 },
    { id: "ti-s50",       brand: "tineco", label: "Pure ONE S50",           tier: "core",     msrp: 399.00, street0: 349.00 },
    { id: "ti-floors7",   brand: "tineco", label: "Floor One S7 Pro",       tier: "premium",  msrp: 699.00, street0: 599.00 },
    { id: "lg-a9k",       brand: "lg",     label: "CordZero A9 Kompressor", tier: "premium",  msrp: 599.99, street0: 449.99 },
    { id: "lg-tower",     brand: "lg",     label: "CordZero All-in-One",    tier: "flagship", msrp: 999.99, street0: 799.99 },
  ],

  // The three engines the study actually queried. No fourth is shown: a
  // modelled engine column beside three measured ones is illustration, and the
  // ledger would have to say so on every screen it appears.
  ENGINES: [
    { id: "gpt",        label: "ChatGPT" },
    { id: "perplexity", label: "Perplexity" },
    { id: "gemini",     label: "Gemini" },
  ],
  STAGES: [
    { id: "awareness",     label: "Awareness",     q: "best cordless vacuum 2026" },
    { id: "consideration", label: "Consideration", q: "Shark PowerDetect vs Dyson V16" },
    { id: "evaluation",    label: "Evaluation",    q: "which cordless vacuum has the best suction" },
    { id: "decision",      label: "Decision",      q: "where to buy a Shark PowerDetect cheapest" },
  ],
  // The measured grid was read on "cordless vacuum"; the rest are the terms the
  // category is also shopped on, extrapolated from it.
  TERMS: [
    { id: "cordless", label: "cordless vacuum",   vol: 1.00 },
    { id: "stick",    label: "stick vacuum",      vol: 0.72 },
    { id: "pet",      label: "vacuum for pet hair", vol: 0.58 },
    { id: "hardwood", label: "hardwood floor vacuum", vol: 0.34 },
    { id: "selfempty",label: "self emptying vacuum", vol: 0.21 },
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

  // The three mechanics the capture actually found running on these pages, and
  // no others: an Amazon Visa instant offer, a Complete Protect plan, and a
  // straight markdown off list. `costToBrand` is the share of face value the
  // brand carries and `attach` the share of buyers who take it when offered —
  // both modelling assumptions, both printed on the cost-of-ownership page.
  // Three of these were read on the Amazon pages — the markdown, the Visa
  // instant offer and the Complete Protect plan. The rest are the mechanics this
  // category runs elsewhere, extrapolated onto the modelled retailers.
  PROMO_TYPES: [
    { id: "discount",   label: "Price discount",     family: "price",   color: "#be123c", costToBrand: 1.00, attach: 1.00, kind: "price",   note: "Straight markdown off the list price. Modelled as fully brand-funded through price protection — the assumption a commercial team is most likely to want to change." },
    { id: "card",       label: "Card offer",         family: "finance", color: "#2563eb", costToBrand: 0.25, attach: 0.12, kind: "finance", note: "Retailer card instant offer — $50 off on approval, seen on every Amazon listing in the capture." },
    { id: "protection", label: "Protection plan",    family: "addon",   color: "#5b21b6", costToBrand: 0.00, attach: 0.24, kind: "addon",   note: "Retailer-sold cover. Adds to what the shopper pays rather than reducing it." },
    { id: "bnpl",       label: "Buy now, pay later", family: "finance", color: "#2563eb", costToBrand: 0.35, attach: 0.16, kind: "finance", note: "Pay in 4 / Affirm. Cost is the platform fee." },
    { id: "bundle",     label: "Accessory bundle",   family: "value",   color: "#0891b2", costToBrand: 0.70, attach: 0.21, kind: "value",   note: "Extra tools, filters or a spare battery attached below the sum of the parts." },
    { id: "giftcard",   label: "Gift card back",     family: "value",   color: "#0891b2", costToBrand: 0.85, attach: 0.34, kind: "value",   note: "Store credit returned on purchase — a mass-retail mechanic that keeps the spend in the retailer." },
    { id: "tradein",    label: "Trade-in",           family: "price",   color: "#be123c", costToBrand: 0.55, attach: 0.05, kind: "price",   note: "Credit for an old machine returned at purchase." },
    { id: "clearance",  label: "Clearance",          family: "price",   color: "#881337", costToBrand: 0.85, attach: 1.00, kind: "price",   note: "End-of-line markdown to clear a superseded model." },
    { id: "delivery",   label: "Free delivery",      family: "value",   color: "#0891b2", costToBrand: 0.20, attach: 0.62, kind: "value",   note: "Shipping absorbed by the retailer or the brand." },
  ],
  PROMO_FAMILIES: [
    { id: "price",   label: "Price give",     color: "#be123c", note: "Money off the shelf price." },
    { id: "finance", label: "Finance",        color: "#2563eb", note: "Spreads or offsets the payment on approval." },
    { id: "value",   label: "Attached value", color: "#0891b2", note: "Something extra at no or low cost." },
    { id: "addon",   label: "Paid add-on",    color: "#5b21b6", note: "Raises what the shopper pays." },
  ],

  // The calendar a floorcare product is sold against. Spring cleaning is behind
  // us by the window's start; the summer events and the back-to-school run are
  // what this quarter turns on.
  EVENTS: [
    { id: "memorial", label: "Memorial Day",  start: "2026-05-25", end: "2026-05-26", lift: 1.44, kind: "retail" },
    { id: "shark",    label: "PowerDetect Speed on shelf", start: "2026-06-03", end: "2026-06-14", lift: 1.38, kind: "brand", brand: "shark" },
    { id: "fathers",  label: "Father's Day",  start: "2026-06-14", end: "2026-06-21", lift: 1.22, kind: "retail" },
    { id: "july4",    label: "July 4th",      start: "2026-07-02", end: "2026-07-06", lift: 1.41, kind: "retail" },
    { id: "primeday", label: "Prime Day",     start: "2026-07-14", end: "2026-07-15", lift: 1.96, kind: "platform" },
    { id: "b2s",      label: "Back to school",start: "2026-08-03" , end: "2026-08-23", lift: 1.18, kind: "season" },
  ],

  // Amazon is read from the capture, so its probability never applies. The rest
  // is where each brand's distribution actually sits: Shark is the mass-retail
  // incumbent in this category, Dyson is selective and premium, Tineco is
  // marketplace-led with thin bricks-and-mortar, LG barely present.
  BASE_CARRIAGE: {
    shark:  { amazon: 1, bestbuy: 0.95, target: 0.90, walmart: 0.95, kohls: 0.70 },
    dyson:  { amazon: 1, bestbuy: 0.95, target: 0.55, walmart: 0.45, kohls: 0.35 },
    tineco: { amazon: 1, bestbuy: 0.45, target: 0.25, walmart: 0.35, kohls: 0.08 },
    lg:     { amazon: 1, bestbuy: 0.60, target: 0.20, walmart: 0.30, kohls: 0.10 },
  },
  RETAILER_MECHANICS: {
    amazon:  { card: 5, protection: 4, discount: 3, bnpl: 2, delivery: 3 },
    bestbuy: { discount: 4, protection: 4, bundle: 3, bnpl: 3, delivery: 3, tradein: 2, clearance: 2 },
    target:  { giftcard: 5, discount: 3, delivery: 3, bnpl: 2, bundle: 2 },
    walmart: { discount: 4, delivery: 4, bnpl: 3, protection: 2, clearance: 2 },
    kohls:   { giftcard: 5, discount: 4, clearance: 3, card: 3 },
  },
  // Discount appetite from the measured rate: Shark 15.6%, Dyson 0.05%,
  // Tineco 4.1%, LG 18.2%.
  PROMO_APPETITE: { dyson: 0.05, tineco: 0.30, shark: 0.82, lg: 0.95 },

  PRICE_FLOOR_PCT: { dyson: 0.95, tineco: 0.90, shark: 0.78, lg: 0.70 },
  PRICE_DRIFT:     { dyson: 0.004, tineco: 0.012, shark: 0.022, lg: 0.030 },
  RETAILER_PRICE_BIAS: { amazon: -0.011, bestbuy: 0.008, target: 0.016, walmart: -0.004, kohls: 0.022 },
  RETAILER_LEADTIME: { amazon: 5.7, bestbuy: 4.4, target: 5.1, walmart: 4.8, kohls: 6.6 },
  CITY_LEADTIME:  { nyc: -0.6, lax: -0.4, chi: -0.25, hou: 0.2, den: 0.6, mia: 0.75 },

  // Where each brand over-indexes on a term, relative to its own mean. Shark
  // owns the pet-hair query, Dyson the hardwood and self-emptying ones.
  TERM_BIAS: {
    pet:       { shark: 1.6, tineco: 1.2 },
    hardwood:  { dyson: 1.5, lg: 1.3 },
    selfempty: { shark: 1.4, dyson: 1.4, tineco: 1.3 },
    stick:     { shark: 1.2 },
  },
  // Shelf presence is not uniform across the estate: Shark's mass-retail
  // strength and Dyson's specialist concentration both show up here.
  SHELF_RETAILER_BIAS: {
    amazon:  { shark: 1.0,  dyson: 1.0,  tineco: 1.0,  lg: 1.0 },
    bestbuy: { shark: 0.85, dyson: 1.85, tineco: 0.55, lg: 1.30 },
    target:  { shark: 1.45, dyson: 0.70, tineco: 0.30, lg: 0.35 },
    walmart: { shark: 1.55, dyson: 0.55, tineco: 0.45, lg: 0.40 },
    kohls:   { shark: 1.30, dyson: 0.45, tineco: 0.10, lg: 0.15 },
  },
  PAID_PUSH:      { tineco: 1.5, lg: 1.2 },
  SPONSORED_BASE: { tineco: 38, lg: 26, shark: 18, dyson: 8 },
  PDP_BRAND_LIFT: { shark: 0.92, dyson: 0.95, tineco: 0.78, lg: 0.80 },

  LAUNCH_PULL: { brand: "shark", from: "2026-06-03", stages: ["evaluation", "decision"], rampDays: 40, points: 5 },

  // lg.com is measured, and it is not a vacuum number. 36.2M monthly visits
  // against sharkclean.com's 0.46M is an appliance, television and phone site
  // being compared with a floorcare brand's own — on the first build it took 76%
  // of "category traffic" and would have read to an executive as LG owning
  // demand in a category where it barely competes. Same judgement as samsung.com
  // in the television set, for the same reason.
  TRAFFIC_WITHHOLD: {
    lg: "lg.com spans appliances, televisions and phones. LG's cordless line is a small part of it, so its site traffic cannot stand for this category.",
  },

  TRAFFIC_ALL_EVENTS: [],
  TRAFFIC_BASE:  { shark: 96000, dyson: 174000, tineco: 41000, lg: 318000 },
  TRAFFIC_TREND: { shark: 0.09, dyson: 0.03, tineco: 0.14, lg: 0.01 },
  CHANNEL_MIX: {
    shark:  { direct: .27, organic: .30, paid: .14, aiRef: .04, social: .09, referral: .10, email: .04, display: .02 },
    dyson:  { direct: .33, organic: .28, paid: .11, aiRef: .05, social: .08, referral: .09, email: .04, display: .02 },
    tineco: { direct: .18, organic: .26, paid: .22, aiRef: .03, social: .16, referral: .09, email: .04, display: .02 },
    lg:     { direct: .30, organic: .25, paid: .14, aiRef: .04, social: .09, referral: .10, email: .05, display: .03 },
  },
  // Bounce, pages and duration come from the captured profile; add-to-cart is
  // published nowhere and is the modelled one. A floorcare DTC site converts
  // far less of its own traffic than a speaker brand's: most of the basket
  // closes at a retailer.
  ENGAGE: {
    shark:  { bounce: 77, pages: 1.6, duration: 69,  addToCart: 1.4 },
    dyson:  { bounce: 49, pages: 4.1, duration: 163, addToCart: 2.2 },
    tineco: { bounce: 46, pages: 3.1, duration: 187, addToCart: 2.6 },
    lg:     { bounce: 53, pages: 2.8, duration: 125, addToCart: 1.8 },
  },
  RATING_DRIFT:    { shark: 0.02 },
  REVIEW_VELOCITY: { shark: 84, dyson: 9, tineco: 6, lg: 12 },
  SERVICE:         {},
  mapFloorPct:     { dyson: 0.95, tineco: 0.88, shark: 0.80, lg: 0.66 },

  PROMPT_BANK: [
    ["awareness", "best cordless vacuum 2026"], ["awareness", "best cordless vacuum for pet hair"],
    ["awareness", "best stick vacuum for hardwood floors"], ["awareness", "which vacuum brand lasts longest"],
    ["awareness", "best self-emptying cordless vacuum"],
    ["consideration", "Shark PowerDetect vs Dyson V16"], ["consideration", "Shark vs Dyson cordless which is better"],
    ["consideration", "is a Dyson worth the extra money"], ["consideration", "Tineco Pure ONE vs Shark"],
    ["consideration", "wet dry vacuum vs regular cordless"],
    ["evaluation", "which cordless vacuum has the best suction"], ["evaluation", "cordless vacuum with the longest battery life"],
    ["evaluation", "Shark PowerDetect review"], ["evaluation", "best cordless vacuum for allergies"],
    ["evaluation", "which cordless vacuum is easiest to empty"],
    ["decision", "where to buy a Shark PowerDetect cheapest"], ["decision", "Shark vacuum deals August 2026"],
    ["decision", "best Prime Day vacuum deals"], ["decision", "Dyson V16 price"],
    ["decision", "cheapest place to buy a Tineco Pure ONE"],
  ],
};
