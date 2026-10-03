import { listBrands, listLatestBuildsPerBrand, type BuildRow } from "./bq";

export type BrandRowView = { slug: string; name: string; latest: BuildRow | null; ready: BuildRow | null; updatedAt: string };

export const tsText = (v: unknown): string | null => {
  const raw = v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v;
  return typeof raw === "string" ? raw : null;
};

/**
 * Every brand with its newest build and newest ready build, newest first.
 */
export async function loadBrandRows(): Promise<BrandRowView[]> {
  const [brands, builds] = await Promise.all([listBrands(), listLatestBuildsPerBrand(300)]);
  const byBrand = new Map<string, BuildRow[]>();
  for (const b of builds) byBrand.set(b.brand_slug, [...(byBrand.get(b.brand_slug) ?? []), b]);
  return brands
    .map((b) => {
      const list = byBrand.get(b.slug) ?? [];
      return { slug: b.slug, name: b.name, latest: list[0] ?? null, ready: list.find((x) => x.status === "ready") ?? null, updatedAt: tsText(b.updated_at) ?? "" };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
