import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdminSession } from "@/lib/admin-auth";
import { MagicLinkConfigError } from "@/lib/magic-link";
import { shareIdFor } from "@/lib/share-id";
import { isServable, latestReadyBuildId, loadBuildPayload } from "@/lib/payload-source";
import { parseBrandLinkRequest, resolveBuildForLink } from "@/lib/brand-link-request";
import { savedInputsFor } from "@/lib/build-inputs";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]+$/;

function publicOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return req.nextUrl.origin;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host.split(",")[0].trim()}`;
}

type Pinned = { slug: string; buildId: string; status: "ready" | "queued" | "running"; extra: Record<string, unknown> };

async function pinBySlug(body: Record<string, unknown>): Promise<Pinned | NextResponse> {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: "send brand_name + brand_category, or the slug of an existing brand" }, { status: 400 });
  const buildId = await latestReadyBuildId(slug);
  if (!buildId) return NextResponse.json({ error: `brand "${slug}" has no ready build` }, { status: 404 });
  const latest = await loadBuildPayload(slug, buildId);
  if (!latest || !isServable(latest)) return NextResponse.json({ error: `the latest build of ${slug} predates per-lane provenance; rebuild it first` }, { status: 409 });
  return { slug, buildId, status: "ready", extra: {} };
}

async function pinByBrand(body: Record<string, unknown>): Promise<Pinned | NextResponse> {
  const parsed = parseBrandLinkRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { req } = parsed;
  const build = await resolveBuildForLink(req);
  const builtWith = build.reused ? (await savedInputsFor(req.slug).catch(() => null))?.inputs ?? null : null;
  return {
    slug: req.slug,
    buildId: build.buildId,
    status: build.status,
    extra: {
      brand: { name: req.name, category: req.category, products: req.products, link: req.link, region: req.region },
      competitors: build.competitors,
      competitors_source: build.competitorsSource,
      reused_existing_build: build.reused,
      built_with: builtWith && {
        category: builtWith.aiCategory,
        competitors: builtWith.aiCompetitors,
        products: builtWith.products,
        link: builtWith.brandLink,
        region: builtWith.region,
      },
    },
  };
}

/**
 * POST /api/magic-links — returns the fixed share link of a brand dashboard, `/<id>`.
 *
 * Either { brand_name, brand_category, brand_product?, brand_link?, competitors?, region?, rebuild? }
 * (reuses the brand's latest measured build, or starts one), or { slug } for an existing brand.
 * The link always shows the brand's latest ready build.
 */
export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const pinned = body.brand_name != null ? await pinByBrand(body) : await pinBySlug(body);
    if (pinned instanceof NextResponse) return pinned;
    const id = shareIdFor(pinned.slug);
    return withAdminSession(req, NextResponse.json(
      {
        url: new URL(`/${id}`, publicOrigin(req)).toString(),
        id,
        slug: pinned.slug,
        build: { id: pinned.buildId, status: pinned.status, poll_url: `/api/builds/${pinned.buildId}` },
        ...pinned.extra,
      },
      { status: pinned.status === "ready" ? 201 : 202 },
    ));
  } catch (e) {
    if (e instanceof MagicLinkConfigError) {
      console.error("[POST /api/magic-links]", e.message);
      return NextResponse.json({ error: "magic links are not configured on this server" }, { status: 500 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
