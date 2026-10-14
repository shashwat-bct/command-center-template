export type PriceQuote = { lo: number; hi: number };
export type ShelfRef = { label: string; price: number; source: "tracked" | "search" };
export type ShelfMatch =
  | { kind: "match"; price: number; refs: ShelfRef[] }
  | { kind: "ambiguous"; refs: ShelfRef[] }
  | { kind: "noSize" }
  | { kind: "sizeNotOnShelf"; size: number }
  | { kind: "notOnShelf" };

const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?|(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(?:USD|dollars)\b/gi;
const RANGE_TAIL = /^\s*(?:-|–|—|to)\s*\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?!\s*(?:count|ct|wipes|pack|pcs|%|¢))/i;
const FOREIGN_CURRENCY = /(?:₹|£|€|¥|₩|\bRs\.?|\bINR|\bGBP|\bEUR|\bCAD|\bAUD)\s*$|(?:^|[^A-Za-z])[CA]$/;
const PACK = /\b(\d{1,5})\s*-?\s*(?:count|ct)\b/i;
const PACK_UNITS = /\b(\d{1,5})\s*-?\s*(?:wipes|sheets|pieces|pcs|pods|tablets|capsules)\b/i;
const SYNONYMS: Array<[RegExp, string]> = [
  [/\bfragrance[\s-]?free\b|\bscent[\s-]?free\b|\bno fragrance\b/gi, "unscented"],
  [/\bextra[\s-]large\b/gi, "xl"],
  [/\bon[\s-]the[\s-]go\b/gi, "onthego"],
  [/\bindividually wrapped\b/gi, "singles"],
];
const STOP = new Set(["the", "and", "for", "with", "of", "a", "an", "in", "by", "per", "pack", "count", "ct", "x", "new", "plus", "size", "version", "edition"]);

const num = (whole: string, frac?: string): number => parseFloat(whole.replace(/,/g, "") + (frac ?? ""));

/**
 * A dollar price an engine quoted: only figures written as money ("$12.29",
 * "12.29 USD"), so pack counts and cents per wipe are never read as prices.
 * A range ("$144–240") keeps both ends.
 */
export function parsePriceQuote(text: string): PriceQuote | null {
  const t = String(text);
  for (const m of t.matchAll(DOLLARS)) {
    const at = m.index ?? 0;
    if (FOREIGN_CURRENCY.test(t.slice(Math.max(0, at - 4), at))) continue;
    const lo = m[1] ? num(m[1], m[2]) : num(m[3], m[4]);
    if (!(lo >= 0.5 && lo < 100000)) continue;
    const tail = RANGE_TAIL.exec(t.slice(at + m[0].length));
    const hi = tail ? num(tail[1], tail[2]) : lo;
    return { lo, hi: hi > lo && hi < lo * 4 ? hi : lo };
  }
  return null;
}

/** The unit count a product name states ("288 Count", "48ct", "180 wipes"). */
export function packCount(text: string): number | null {
  const m = PACK.exec(text) ?? PACK_UNITS.exec(text);
  return m ? Number(m[1]) : null;
}

function words(text: string, drop: Set<string>): string[] {
  let t = text.toLowerCase();
  for (const [rx, to] of SYNONYMS) t = t.replace(rx, to);
  return [...new Set(t.replace(/\b\d+\s*-?\s*(?:count|ct|wipes|sheets|pieces|pcs|pods|tablets|capsules)\b/g, " ").split(/[^a-z0-9]+/))]
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w) && !drop.has(w) && !drop.has(w.replace(/s$/, "")));
}

/**
 * The Amazon shelf price an engine's quote should be checked against: the
 * listings that share its pack size and every variant word it names. A quote
 * is only judged when that points to one price; several prices, an unknown
 * variant or a missing pack size are reported as such rather than guessed.
 */
export function matchShelf(text: string, refs: ShelfRef[], brand: string, categoryWords: string[]): ShelfMatch {
  const drop = new Set([...brand, ...categoryWords].flatMap((w) => w.toLowerCase().split(/[^a-z0-9]+/)).flatMap((w) => [w, w.replace(/s$/, "")]).filter(Boolean));
  const refWords = refs.map((r) => new Set(words(r.label, drop)));
  const vocab = new Set(refWords.flatMap((s) => [...s]));
  const claim = words(text, drop);
  if (claim.some((w) => !vocab.has(w))) return { kind: "notOnShelf" };
  let fits = refs.filter((_, i) => claim.every((w) => refWords[i].has(w)));
  if (!fits.length) return { kind: "notOnShelf" };
  const size = packCount(text);
  if (refs.some((r) => packCount(r.label) != null)) {
    if (size == null) return { kind: "noSize" };
    fits = fits.filter((r) => packCount(r.label) === size);
    if (!fits.length) return { kind: "sizeNotOnShelf", size };
  }
  const prices = fits.map((r) => r.price).sort((a, b) => a - b);
  if (prices[prices.length - 1] > prices[0] * 1.05) return { kind: "ambiguous", refs: fits };
  return { kind: "match", price: prices[Math.floor(prices.length / 2)], refs: fits };
}
