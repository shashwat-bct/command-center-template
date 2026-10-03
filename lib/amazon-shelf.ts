import { listingMatchesBrand } from "./keepa";
import type { SearchResult } from "./apify";

export type ShelfSnapshot = {
  term: string;
  capturedAt: string;
  depth: number;
  results: Array<{ position: number; asin: string; title: string; price: number | null; brand: string | null }>;
  share: Record<string, number>;
  firstPosition: Record<string, number | null>;
};

/**
 * Attributes each organic Amazon search result to a brand slot by title and
 * returns each brand's share of the result positions read.
 */
export function shelfSnapshot(term: string, results: SearchResult[], brands: Array<{ slot: string; name: string }>, capturedAt: string): ShelfSnapshot {
  const organic = results.filter((r) => !r.sponsored);
  const attributed = organic.map((r) => ({
    position: r.position,
    asin: r.asin,
    title: r.title,
    price: r.price,
    brand: brands.find((b) => listingMatchesBrand({ brand: null, title: r.title }, b.name))?.slot ?? null,
  }));
  const depth = attributed.length;
  const share = Object.fromEntries(brands.map((b) => [b.slot, depth ? Math.round((attributed.filter((r) => r.brand === b.slot).length / depth) * 1000) / 10 : 0]));
  const firstPosition = Object.fromEntries(brands.map((b) => [b.slot, attributed.find((r) => r.brand === b.slot)?.position ?? null]));
  return { term, capturedAt, depth, results: attributed, share, firstPosition };
}
