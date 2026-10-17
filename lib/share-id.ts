import { createHmac } from "node:crypto";
import { listBrands } from "./bq";
import { magicLinkSecret } from "./magic-link";

const SHARE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CACHE_TTL_MS = 60_000;
const MISS_REFRESH_MS = 10_000;

export const isShareId = (s: string): boolean => SHARE_ID_RE.test(s);

/**
 * The fixed, unguessable public id of a brand's dashboard (a UUID keyed on MAGIC_LINK_SECRET).
 */
export function shareIdFor(slug: string): string {
  return idFor(`cc-share|${slug}`);
}

/**
 * The analyst view's id: a second unguessable UUID per brand that shows real vs simulated on every figure.
 */
export function analystIdFor(slug: string): string {
  return idFor(`cc-analyst|${slug}`);
}

function idFor(key: string): string {
  const h = createHmac("sha256", magicLinkSecret()).update(key).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export type ShareTarget = { slug: string; analyst: boolean };

type Index = { at: number; byId: Map<string, ShareTarget> };

let cache: Index | null = null;

async function refresh(): Promise<Index> {
  const slugs = (await listBrands()).map((b) => b.slug);
  cache = { at: Date.now(), byId: new Map(slugs.flatMap((s): Array<[string, ShareTarget]> => [[shareIdFor(s), { slug: s, analyst: false }], [analystIdFor(s), { slug: s, analyst: true }]])) };
  return cache;
}

/**
 * The brand and view behind a share or analyst id, or null when no brand has that id.
 */
export async function resolveShareId(id: string): Promise<ShareTarget | null> {
  if (!isShareId(id)) return null;
  const stale = !cache || Date.now() - cache.at > CACHE_TTL_MS;
  const index = stale || !cache ? await refresh() : cache;
  const hit = index.byId.get(id);
  if (hit || stale || Date.now() - index.at < MISS_REFRESH_MS) return hit ?? null;
  return (await refresh()).byId.get(id) ?? null;
}

export async function slugForShareId(id: string): Promise<string | null> {
  return (await resolveShareId(id))?.slug ?? null;
}

export function sharePath(slug: string): string {
  return `/${shareIdFor(slug)}`;
}

export function analystPath(slug: string): string {
  return `/${analystIdFor(slug)}`;
}
