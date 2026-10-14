import { callLLM } from "./llm";
import { parseJsonObject } from "./market-mechanics";

export type ListingCheck = (listings: Array<{ asin: string; title: string | null }>) => Promise<Set<string> | null>;

/**
 * A check that keeps only the listings Claude reads as products in the
 * category, so a brand that also makes something else (toilet paper next to
 * wipes, a supplement sharing the name) is measured on the right products.
 * Answers null when Claude cannot be reached, which keeps every listing.
 */
export function categoryCheck(category: string, log: (line: string) => void = () => {}): ListingCheck {
  return async (listings) => {
    const titled = listings.filter((l) => l.title);
    if (!titled.length) return null;
    const lines = titled.map((l) => `${l.asin}: ${l.title}`).join("\n");
    try {
      const text = await callLLM({
        system: "You classify Amazon listings. You answer only with valid JSON.",
        user: `Category: ${category}\n\nListings:\n${lines}\n\nWhich listings are products a shopper searching for "${category}" would be comparing? Count pack sizes, variants and scents of the product as in the category. Exclude a different product type even from the same brand (toilet paper is not wipes, a supplement is not a cleaning product, a case is not a phone).\n\nReturn {"in": ["<asin>", ...], "out": [{"asin": "<asin>", "why": "<a few words>"}]}.`,
        maxTokens: 800,
        temperature: 0,
      });
      const parsed = parseJsonObject(text);
      if (!parsed || !Array.isArray(parsed.in)) return null;
      const keep = new Set(parsed.in.filter((a): a is string => typeof a === "string"));
      for (const l of listings) if (!l.title) keep.add(l.asin);
      return keep;
    } catch (e) {
      log(`category check failed (${(e as Error).message.slice(0, 100)}); keeping every listing`);
      return null;
    }
  };
}
