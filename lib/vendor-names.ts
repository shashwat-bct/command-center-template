const VENDOR = "(?:Keepa|Kompy|Histomart|RetailerAPI|Retailer API|ShopSavvy|Endless|Wayback Machine|Wayback|Apify|Bright Data|BrightData)";
const LIST = `${VENDOR}(?:\\s*(?:,|and|&|\\+)\\s*(?:the )?(?:${VENDOR}|retail audit))*`;

const RULES: Array<[RegExp, string]> = [
  [/written by Claude from market knowledge and checked by a second Claude pass/g, "drafted from market knowledge and checked by a second review pass"],
  [/Claude · market knowledge/g, "Market knowledge"],
  [/\bKeepa (?=[a-z])/g, ""],
  [/Apify Amazon crawler/g, "Amazon product pages"],
  [/Keepa search/g, "Amazon search"],
  [new RegExp(`\\s*\\((?:the )?${LIST}\\)`, "g"), ""],
  [new RegExp(`\\((?:the )?${LIST},\\s*`, "g"), "("],
  [new RegExp(`\\b${LIST}(?: Amazon)?\\s*·\\s*`, "g"), ""],
  [new RegExp(`,? (?:as )?(?:read |recorded )?(?:from|via|through|by|in|on) (?:the )?${LIST}(?:'s? [a-z-]+(?: [a-z-]+)?)?(?=[\\s.,;:)]|$)`, "g"), ""],
  [new RegExp(`\\b${VENDOR}'s?\\s+`, "g"), ""],
  [/\bKeepa\b/g, "Amazon history"],
  [/\bApify\b/g, "product-page reader"],
  [/\bBright ?Data\b/g, "web reader"],
  [new RegExp(`\\b${VENDOR}\\b`, "g"), "retailer data"],
  [/ · (?:web reader|product-page reader|Amazon history|retailer data)\b/g, ""],
  [/\b([A-Z][a-z]+ data) · \1\b/g, "$1"],
  [/\(\s*\)/g, ""],
  [/ {2,}/g, " "],
  [/ ([.,;:])/g, "$1"],
];

const VENDOR_TEST = new RegExp(`${VENDOR}|Claude · market|by Claude from`);
const QUOTED = new Set(["text", "answer"]);
const QUOTE_SCOPES = new Set(["aiConsole", "perQuestion", "reviews", "quotes"]);

/**
 * A display string with the names of the data tools behind it taken out.
 */
export function withoutVendorNames(s: string): string {
  if (!VENDOR_TEST.test(s)) return s;
  return RULES.reduce((out, [re, to]) => out.replace(re, to), s).trim();
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function scrub(node: Json, key: string, quoted: boolean): Json {
  if (typeof node === "string") return quoted && QUOTED.has(key) ? node : withoutVendorNames(node);
  if (Array.isArray(node)) return node.map((v) => scrub(v, key, quoted));
  if (node && typeof node === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(node)) out[k] = scrub(v, k, quoted || QUOTE_SCOPES.has(k));
    return out;
  }
  return node;
}

const cleaned = new Map<string, Buffer>();
const MAX_CACHED = 24;

/**
 * A payload whose display text names no data vendor. Quoted engine answers and reviews
 * are left exactly as they were read.
 */
export function withoutVendors(slug: string, buildId: string, bytes: Buffer): Buffer {
  const key = `${slug}/${buildId}/${bytes.length}`;
  const hit = cleaned.get(key);
  if (hit) return hit;
  try {
    const out = Buffer.from(JSON.stringify(scrub(JSON.parse(bytes.toString("utf8")) as Json, "", false)));
    if (cleaned.size >= MAX_CACHED) cleaned.delete(cleaned.keys().next().value as string);
    cleaned.set(key, out);
    return out;
  } catch (e) {
    console.error(`[vendor-names] ${slug}/${buildId}`, e);
    return bytes;
  }
}
