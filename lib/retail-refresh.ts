import { loadLatestPayload } from "./payload-source";
import { captureRetailOffers, loadRetailHistory, type RetailProduct, type ShopRetailer } from "./retail-offers";
import { amazonTitle } from "./retail-sites";

type LatestPayload = {
  meta: { marketProfile?: { retailers?: ShopRetailer[] } };
  dims: { brands: Array<{ id: string; label: string }>; retailers: ShopRetailer[]; models: Array<{ id: string; brand: string; label: string; asin?: string }> };
  pricing?: { price?: Record<string, Array<number | null>> };
};

export type RefreshResult = { slug: string; listings: number; found: number; error?: string };

/**
 * Takes one more retailer-site reading for every product on a brand's latest
 * dashboard and adds it to the stored history the next build reads.
 */
export async function refreshRetailOffers(slug: string, key: string): Promise<RefreshResult> {
  const source = await loadLatestPayload(slug);
  if (!source) return { slug, listings: 0, found: 0, error: "no ready build" };
  const p = JSON.parse(source.bytes.toString("utf8")) as LatestPayload;
  const label = new Map(p.dims.brands.map((b) => [b.id, b.label]));
  const lastPrice = (id: string): number | null => [...(p.pricing?.price?.[`${id}|amazon`] ?? [])].reverse().find((v): v is number => v != null) ?? null;
  const log = (s: string) => console.log(`[retail-offers] ${slug} ${s}`);
  const stored = (await loadRetailHistory(slug)).products ?? {};
  const fetched = new Set<string>();
  const products = (await Promise.all(p.dims.models.map(async (m): Promise<RetailProduct | null> => {
    if (!m.asin) return null;
    const known = stored[m.asin];
    const title = known?.title ?? (await amazonTitle(m.asin, key).catch(() => null));
    if (!title) {
      log(`  ${m.asin}: skipped, its Amazon title could not be read`);
      return null;
    }
    if (!known) fetched.add(m.asin);
    return { asin: m.asin, brand: known?.brand ?? label.get(m.brand) ?? m.brand, title, model: known?.model ?? null, price: lastPrice(m.id) };
  }))).filter((x): x is RetailProduct => !!x);
  const retailers = (p.meta.marketProfile?.retailers ?? p.dims.retailers).filter((r) => r.id !== "amazon");
  if (!products.length || !retailers.length) return { slug, listings: products.length, found: 0, error: "no products or retailers to read" };
  const r = await captureRetailOffers({ slug, products, retailers, key, log, remember: fetched });
  return { slug, listings: products.length, found: Object.keys(r.readings).length };
}
