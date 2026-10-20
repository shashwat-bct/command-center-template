import { request } from "node:https";

const UNLOCKER = "https://api.brightdata.com/request";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ATTEMPTS = 3;
const RETRY_MS = 12_000;
const PER_RETAILER = 12;
const TARGET_STORE = "3991";
const TARGET_ZIP = "55401";

export type SiteOffer = { retailer: string; title: string; price: number; was: number | null; url: string; inStock: boolean | null };

type Reply = { status: number; error: string | null; text: string };

type WalmartItem = {
  name?: string;
  price?: number;
  priceInfo?: { wasPrice?: string; linePrice?: string };
  sellerName?: string;
  canonicalUrl?: string;
  availabilityStatusV2?: { value?: string };
};

type TargetProduct = {
  tcin?: string;
  item?: { product_description?: { title?: string } };
  price?: { current_retail?: number; reg_retail?: number };
};

function send(url: string, opts: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: opts.method, headers: opts.headers, timeout: 90_000 }, (res) => {
      const chunks: Buffer[] = [];
      const error = [res.headers["x-brd-error"], res.headers["x-brd-err-msg"]].filter((v): v is string => typeof v === "string").join(": ") || null;
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, error, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`request to ${new URL(url).hostname} timed out`)));
    req.on("error", reject);
    req.end(opts.body);
  });
}

async function viaUnlocker(url: string, key: string): Promise<string> {
  const body = JSON.stringify({ zone: process.env.BRIGHTDATA_UNLOCKER_ZONE || "web_unlocker1", url, format: "raw" });
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await send(UNLOCKER, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body })
      .catch((e: unknown): Reply => ({ status: 0, error: (e as Error).message, text: "" }));
    if (res.status === 200 && !res.error && res.text) return res.text;
    last = `Bright Data unlocker ${res.status}: ${(res.error ?? res.text).slice(0, 200)}`;
    if (/ip_blacklisted|Auth Failed/.test(last) || attempt === ATTEMPTS) break;
    await new Promise((r) => setTimeout(r, /minimum of 60 seconds/.test(last) ? 65_000 : RETRY_MS * attempt));
  }
  throw new Error(last);
}

async function direct(url: string): Promise<string | null> {
  const res = await send(url, { method: "GET", headers: { "user-agent": UA, accept: "*/*", "accept-language": "en-US" } }).catch(() => null);
  return res && res.status === 200 ? res.text : null;
}

const decode = (s: string): string => s
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const dollars = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const m = typeof v === "string" ? /\d[\d,]*(\.\d+)?/.exec(v) : null;
  return m ? parseFloat(m[0].replace(/,/g, "")) : null;
};

/**
 * Walmart search results sold by Walmart itself and in stock; marketplace
 * sellers and out-of-stock items are dropped.
 */
export function parseWalmartSearch(html: string): SiteOffer[] {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return [];
  let stacks: Array<{ items?: WalmartItem[] }> = [];
  try {
    const data = JSON.parse(m[1]) as { props?: { pageProps?: { initialData?: { searchResult?: { itemStacks?: Array<{ items?: WalmartItem[] }> } } } } };
    stacks = data.props?.pageProps?.initialData?.searchResult?.itemStacks ?? [];
  } catch {
    return [];
  }
  return stacks.flatMap((s) => s.items ?? []).flatMap((i): SiteOffer[] => {
    const price = dollars(i.price);
    if (!i.name || price == null || i.sellerName !== "Walmart.com" || i.availabilityStatusV2?.value === "OUT_OF_STOCK") return [];
    const was = dollars(i.priceInfo?.wasPrice);
    const status = i.availabilityStatusV2?.value;
    return [{ retailer: "walmart", title: decode(i.name), price, was: was != null && was > price ? was : null, url: `https://www.walmart.com${(i.canonicalUrl ?? "").split("?")[0]}`, inStock: status ? status === "IN_STOCK" : null }];
  }).slice(0, PER_RETAILER);
}

/**
 * Target search results with their own price; each pack size of a product
 * comes back as its own result.
 */
export function parseTargetSearch(json: string): SiteOffer[] {
  let products: TargetProduct[] = [];
  try {
    products = (JSON.parse(json) as { data?: { search?: { products?: TargetProduct[] } } }).data?.search?.products ?? [];
  } catch {
    return [];
  }
  return products.flatMap((p): SiteOffer[] => {
    const title = p.item?.product_description?.title;
    const price = dollars(p.price?.current_retail);
    if (!title || !p.tcin || price == null) return [];
    const reg = dollars(p.price?.reg_retail);
    return [{ retailer: "target", title: decode(title), price, was: reg != null && reg > price ? reg : null, url: `https://www.target.com/p/-/A-${p.tcin}`, inStock: null }];
  }).slice(0, PER_RETAILER);
}

let targetKey: Promise<string> | null = null;

function targetApiKey(key: string): Promise<string> {
  targetKey ??= (async () => {
    const home = (await direct("https://www.target.com/")) ?? (await viaUnlocker("https://www.target.com/", key));
    const k = /apiKey\\?"\s*:\s*\\?"([0-9a-f]{40})/.exec(home)?.[1];
    if (!k) throw new Error("Target API key not found on target.com");
    return k;
  })().catch((e: unknown) => {
    targetKey = null;
    throw e;
  });
  return targetKey;
}

async function readWalmart(query: string, key: string): Promise<SiteOffer[]> {
  return parseWalmartSearch(await viaUnlocker(`https://www.walmart.com/search?q=${encodeURIComponent(query)}`, key));
}

async function readTarget(query: string, key: string): Promise<SiteOffer[]> {
  const q = encodeURIComponent(query);
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=${await targetApiKey(key)}&channel=WEB&count=24&default_purchasability_filter=true&include_sponsored=false&keyword=${q}&offset=0&page=%2Fs%2F${q}&platform=desktop&pricing_store_id=${TARGET_STORE}&visitor_id=0&zip=${TARGET_ZIP}`;
  return parseTargetSearch((await direct(url)) ?? (await viaUnlocker(url, key)));
}

/**
 * An Amazon listing's full title from its product page, or null when the page
 * can't be read.
 */
export async function amazonTitle(asin: string, key: string): Promise<string | null> {
  const url = `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;
  const pick = (html: string | null): string | null => {
    const m = html ? /<span id="productTitle"[^>]*>([\s\S]*?)<\/span>/.exec(html) : null;
    return m ? decode(m[1]) || null : null;
  };
  return pick(await direct(url)) ?? pick(await viaUnlocker(url, key).catch(() => null));
}

export const SITE_READERS: Record<string, (query: string, key: string) => Promise<SiteOffer[]>> = {
  walmart: readWalmart,
  target: readTarget,
};
