import { analystIdFor, shareIdFor } from "./share-id";

/** The one brand this deployment serves at its root, from ATLAS_BRAND, or null for the full command center. */
export function singleBrand(): string | null {
  const slug = process.env.ATLAS_BRAND?.trim().toLowerCase();
  return slug && /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

/** True when a share id or slug in a path belongs to the single brand this deployment serves. */
export function isSingleBrandKey(key: string, slug: string): boolean {
  return key === slug || key === shareIdFor(slug) || key === analystIdFor(slug);
}
