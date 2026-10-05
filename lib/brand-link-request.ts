import { expireIfStale, getLatestBuildForBrand } from "./bq";
import { fetchCompetitorBrands } from "./ai-visibility";
import { createBuild } from "./capture";
import { isMeasuredOnly, latestReadyBuildId, loadBuildPayload } from "./payload-source";

export type BrandLinkRequest = {
  slug: string;
  name: string;
  category: string;
  products: string[];
  link: string | null;
  region: string;
  competitors: string[] | null;
  partnerId: string | null;
  rebuild: boolean;
};

export type ResolvedBuild = {
  buildId: string;
  status: "ready" | "queued" | "running";
  reused: boolean;
  competitors: string[] | null;
  competitorsSource: "request" | "claude" | "existing build";
};

const PARTNER_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const slugify = (s: string): string => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]+/) : []).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);

/**
 * Validates a brand-link request body: brand_name, brand_category,
 * brand_product (string or list), brand_link, partner_id, and optional
 * competitors, region, slug and rebuild.
 */
export function parseBrandLinkRequest(body: Record<string, unknown>): { ok: true; req: BrandLinkRequest } | { ok: false; error: string } {
  const name = text(body.brand_name);
  const category = text(body.brand_category);
  if (!name) return { ok: false, error: "brand_name is required" };
  if (!category) return { ok: false, error: "brand_category is required" };
  const slug = text(body.slug) ?? slugify(name);
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, error: "slug must be lowercase letters, digits, hyphens" };
  const partnerId = text(body.partner_id);
  if (partnerId && !PARTNER_RE.test(partnerId)) return { ok: false, error: "partner_id must be 1–64 characters: letters, digits, . _ : -" };
  const link = text(body.brand_link);
  if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: "brand_link must start with http:// or https://" };
  const competitors = body.competitors == null ? null : list(body.competitors).slice(0, 4);
  return {
    ok: true,
    req: {
      slug,
      name,
      category,
      products: list(body.brand_product ?? body.brand_products).slice(0, 7),
      link,
      region: (text(body.region) ?? "US").toUpperCase(),
      competitors: competitors && competitors.length ? competitors : null,
      partnerId,
      rebuild: body.rebuild === true,
    },
  };
}

/**
 * Finds the build a brand link should point at: the latest measured build if
 * there is one (unless a rebuild is asked for), a build already in progress,
 * or a new build started with the request's inputs.
 */
export async function resolveBuildForLink(req: BrandLinkRequest): Promise<ResolvedBuild> {
  if (!req.rebuild) {
    const readyId = await latestReadyBuildId(req.slug);
    const ready = readyId ? await loadBuildPayload(req.slug, readyId) : null;
    if (readyId && ready && isMeasuredOnly(ready)) return { buildId: readyId, status: "ready", reused: true, competitors: null, competitorsSource: "existing build" };
    const latest = await getLatestBuildForBrand(req.slug);
    const current = latest ? await expireIfStale(latest) : null;
    if (current && (current.status === "queued" || current.status === "running")) {
      return { buildId: current.build_id, status: current.status, reused: true, competitors: null, competitorsSource: "existing build" };
    }
  }

  let competitors = req.competitors;
  let competitorsSource: ResolvedBuild["competitorsSource"] = "request";
  if (!competitors) {
    competitors = await fetchCompetitorBrands(req.name, req.category).catch(() => []);
    competitorsSource = "claude";
  }
  const started = await createBuild({
    slug: req.slug,
    name: req.name,
    brandLink: req.link,
    region: req.region,
    aiCategory: req.category,
    aiCompetitors: competitors,
    products: req.products,
  });
  return { buildId: started.build_id, status: "queued", reused: false, competitors, competitorsSource };
}
