import { bucket } from "./gcs";
import { callLLM } from "./llm";
import { parseJsonObject } from "./market-mechanics";
import { renderTiles } from "./retail-browser";
import type { SiteOffer } from "./retail-sites";

const SEARCH_CACHE_KEY = "retail-sites/v1/search-urls.json";

const KNOWN_SEARCH: Record<string, string> = {
  "costco.com": "https://www.costco.com/s?keyword={q}",
  "cvs.com": "https://www.cvs.com/search?searchTerm={q}",
  "bestbuy.com": "https://www.bestbuy.com/site/searchpage.jsp?st={q}",
  "homedepot.com": "https://www.homedepot.com/s/{q}",
  "lowes.com": "https://www.lowes.com/search?searchTerm={q}",
  "walgreens.com": "https://www.walgreens.com/search/results.jsp?Ntt={q}",
  "kroger.com": "https://www.kroger.com/search?query={q}",
  "samsclub.com": "https://www.samsclub.com/s/{q}",
  "bjs.com": "https://www.bjs.com/search/{q}",
  "sephora.com": "https://www.sephora.com/search?keyword={q}",
  "ulta.com": "https://www.ulta.com/search?search={q}",
  "newegg.com": "https://www.newegg.com/p/pl?d={q}",
  "kohls.com": "https://www.kohls.com/search.jsp?search={q}",
  "crutchfield.com": "https://www.crutchfield.com/s-/search.aspx?q={q}",
  "bhphotovideo.com": "https://www.bhphotovideo.com/c/search?q={q}",
  "chewy.com": "https://www.chewy.com/s?query={q}",
  "petco.com": "https://www.petco.com/shop/SearchDisplay?searchTerm={q}",
  "staples.com": "https://www.staples.com/{q}/directory_{q}",
  "officedepot.com": "https://www.officedepot.com/catalog/search.do?Ntt={q}",
  "wayfair.com": "https://www.wayfair.com/keyword.php?keyword={q}",
};

type Retailer = { id: string; label: string; domain: string };

let learned: Promise<Record<string, string>> | null = null;

const host = (domain: string): string => domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

function loadLearned(): Promise<Record<string, string>> {
  learned ??= bucket().file(SEARCH_CACHE_KEY).download()
    .then(([buf]) => JSON.parse(buf.toString("utf8")) as Record<string, string>)
    .catch(() => ({}));
  return learned;
}

async function searchTemplate(r: Retailer): Promise<string | null> {
  const d = host(r.domain);
  if (KNOWN_SEARCH[d]) return KNOWN_SEARCH[d];
  const cache = await loadLearned();
  if (cache[d]) return cache[d];
  const text = await callLLM({
    system: "You know how US retail websites build their product search URLs. Reply with JSON only.",
    user: `What URL does ${r.label} (${d}) open when a shopper searches its site for products? Give it with {q} where the search words go, for example https://www.example.com/search?q={q}. Reply with only {"url": "..."} or {"url": null} if you do not know.`,
    maxTokens: 300,
    temperature: 0,
  });
  const url = parseJsonObject(text)?.url;
  if (typeof url !== "string" || !url.includes("{q}") || host(new URL(url.replace("{q}", "x")).hostname) !== d) return null;
  cache[d] = url;
  await bucket().file(SEARCH_CACHE_KEY).save(JSON.stringify(cache), { contentType: "application/json", resumable: false }).catch(() => undefined);
  return url;
}

type Extracted = { n?: unknown; title?: unknown; price?: unknown; was?: unknown; thirdParty?: unknown; available?: unknown };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

async function extract(r: Retailer, tiles: string[]): Promise<SiteOffer[]> {
  if (!tiles.length) return [];
  const list = tiles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const text = await callLLM({
    system: "You read product listings off retail search pages. Reply with JSON only.",
    user: `These are product tiles from a search on ${r.label}'s website, each ending with its link in <>.\n\n${list}\n\nFor each tile that is a product for sale, give its full product name, the price a shopper pays now in dollars (not a per-unit price), the crossed-out or regular price if one is shown, whether it is sold by a third-party or marketplace seller rather than ${r.label} itself, and whether it is shown as unavailable or out of stock. Skip ads for services, gift cards and tiles with no price shown.\n\nReply with only this JSON: {"products": [{"n": tile number, "title": "...", "price": 0.0, "was": 0.0 or null, "thirdParty": false, "available": true}]}`,
    maxTokens: 3000,
    temperature: 0,
  });
  const at = [...text.matchAll(/\{\s*"products"/g)].pop()?.index;
  const products = at == null ? null : parseJsonObject(text.slice(at))?.products;
  if (!Array.isArray(products)) return [];
  return (products as Extracted[]).flatMap((x): SiteOffer[] => {
    const n = Number(x.n), price = num(x.price), was = num(x.was);
    const link = Number.isInteger(n) ? /<([^>]+)>\s*$/.exec(tiles[n - 1] ?? "")?.[1] : undefined;
    if (!link || price == null || typeof x.title !== "string" || x.thirdParty === true || x.available === false) return [];
    return [{ retailer: r.id, title: x.title, price, was: was != null && was > price ? was : null, url: link, inStock: x.available === true ? true : null }];
  });
}

/**
 * Reads any retailer's own search results by rendering its search page in a
 * real browser and having Claude read the product tiles. Offers from
 * marketplace sellers and items shown as unavailable are left out.
 */
export async function readGeneric(r: Retailer, query: string, key: string): Promise<SiteOffer[]> {
  const template = await searchTemplate(r);
  if (!template) throw new Error(`no search URL known for ${r.label}`);
  const tiles = await renderTiles(template.replaceAll("{q}", encodeURIComponent(query)), key);
  if (!tiles.length) throw new Error(`${r.label} search page showed no priced products`);
  return extract(r, tiles);
}
