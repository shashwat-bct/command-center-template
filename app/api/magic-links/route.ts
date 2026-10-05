import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdminSession } from "@/lib/admin-auth";
import { DEFAULT_TTL_HOURS, MAX_TTL_HOURS, MagicLinkConfigError, createMagicToken } from "@/lib/magic-link";
import { isMeasuredOnly, latestReadyBuildId, loadBuildPayload } from "@/lib/payload-source";
import { parseBrandLinkRequest, resolveBuildForLink } from "@/lib/brand-link-request";
import { savedInputsFor } from "@/lib/build-inputs";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]+$/;
const BUILD_RE = /^b_[A-Za-z0-9_-]+$/;
const PARTNER_RE = /^[A-Za-z0-9._:-]{1,64}$/;

type Pinned = { slug: string; buildId: string; status: "ready" | "queued" | "running"; extra: Record<string, unknown> };

async function pinBySlug(body: Record<string, unknown>): Promise<Pinned | NextResponse> {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: "send brand_name + brand_category, or the slug of an existing brand" }, { status: 400 });
  if (body.build_id != null) {
    if (typeof body.build_id !== "string" || !BUILD_RE.test(body.build_id)) return NextResponse.json({ error: "build_id is malformed" }, { status: 400 });
    const pinned = await loadBuildPayload(slug, body.build_id);
    if (!pinned) return NextResponse.json({ error: `no payload for ${slug} build ${body.build_id}` }, { status: 404 });
    if (!isMeasuredOnly(pinned)) return NextResponse.json({ error: `build ${body.build_id} used simulated data; rebuild ${slug} first` }, { status: 409 });
    return { slug, buildId: body.build_id, status: "ready", extra: {} };
  }
  const buildId = await latestReadyBuildId(slug);
  if (!buildId) return NextResponse.json({ error: `brand "${slug}" has no ready build` }, { status: 404 });
  const latest = await loadBuildPayload(slug, buildId);
  if (!latest || !isMeasuredOnly(latest)) return NextResponse.json({ error: `the latest build of ${slug} used simulated data; rebuild it first` }, { status: 409 });
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
 * POST /api/magic-links — returns a share link for a brand dashboard.
 *
 * Either { brand_name, brand_category, brand_product?, brand_link?, competitors?, region?, rebuild? }
 * (reuses the brand's latest measured build, or starts one and links to it), or { slug, build_id? }
 * for an existing brand. Both accept partner_id (a per-partner link variant), expires_in_hours and label.
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

  const ttlHours = body.expires_in_hours == null ? DEFAULT_TTL_HOURS : Number(body.expires_in_hours);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > MAX_TTL_HOURS) {
    return NextResponse.json({ error: `expires_in_hours must be > 0 and <= ${MAX_TTL_HOURS}` }, { status: 400 });
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;
  const partnerId = typeof body.partner_id === "string" && body.partner_id.trim() ? body.partner_id.trim() : null;
  if (partnerId && !PARTNER_RE.test(partnerId)) return NextResponse.json({ error: "partner_id must be 1–64 characters: letters, digits, . _ : -" }, { status: 400 });

  try {
    const pinned = body.brand_name != null ? await pinByBrand(body) : await pinBySlug(body);
    if (pinned instanceof NextResponse) return pinned;
    const { token, claims } = createMagicToken({ slug: pinned.slug, buildId: pinned.buildId, label, partnerId, ttlHours });
    return withAdminSession(req, NextResponse.json(
      {
        url: `${new URL("/share", req.nextUrl.origin).toString()}#${token}`,
        token,
        slug: pinned.slug,
        partner_id: partnerId,
        label,
        issued_at: new Date(claims.issuedAt * 1000).toISOString(),
        expires_at: new Date(claims.expiresAt * 1000).toISOString(),
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
