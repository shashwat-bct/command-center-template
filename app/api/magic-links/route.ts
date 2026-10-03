import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdminSession } from "@/lib/admin-auth";
import { DEFAULT_TTL_HOURS, MAX_TTL_HOURS, MagicLinkConfigError, createMagicToken } from "@/lib/magic-link";
import { isMeasuredOnly, latestReadyBuildId, loadBuildPayload } from "@/lib/payload-source";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]+$/;
const BUILD_RE = /^b_[A-Za-z0-9_-]+$/;

type CreateBody = {
  slug?: unknown;
  build_id?: unknown;
  expires_in_hours?: unknown;
  label?: unknown;
};

// POST /api/magic-links
//   { slug, build_id?, expires_in_hours?, label? }
// → { url, token, slug, build_id, label, issued_at, expires_at }
//
// Without build_id the link is pinned to the brand's latest ready build at
// creation time, so a later rebuild doesn't change what the recipient sees.
export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: "slug must be lowercase letters, digits, hyphens" }, { status: 400 });

  const ttlHours = body.expires_in_hours == null ? DEFAULT_TTL_HOURS : Number(body.expires_in_hours);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > MAX_TTL_HOURS) {
    return NextResponse.json({ error: `expires_in_hours must be > 0 and <= ${MAX_TTL_HOURS}` }, { status: 400 });
  }

  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;

  let buildId: string | null = null;
  if (body.build_id != null) {
    if (typeof body.build_id !== "string" || !BUILD_RE.test(body.build_id)) {
      return NextResponse.json({ error: "build_id is malformed" }, { status: 400 });
    }
    const pinned = await loadBuildPayload(slug, body.build_id);
    if (!pinned) return NextResponse.json({ error: `no payload for ${slug} build ${body.build_id}` }, { status: 404 });
    if (!isMeasuredOnly(pinned)) return NextResponse.json({ error: `build ${body.build_id} used simulated data; rebuild ${slug} first` }, { status: 409 });
    buildId = body.build_id;
  } else {
    buildId = await latestReadyBuildId(slug);
    if (!buildId) {
      return NextResponse.json({ error: `brand "${slug}" has no ready build` }, { status: 404 });
    }
    const latest = await loadBuildPayload(slug, buildId);
    if (!latest || !isMeasuredOnly(latest)) return NextResponse.json({ error: `the latest build of ${slug} used simulated data; rebuild it first` }, { status: 409 });
  }

  try {
    const { token, claims } = createMagicToken({ slug, buildId, label, ttlHours });
    return withAdminSession(req, NextResponse.json(
      {
        url: new URL(`/share/${token}`, req.nextUrl.origin).toString(),
        token,
        slug,
        build_id: buildId,
        label,
        issued_at: new Date(claims.issuedAt * 1000).toISOString(),
        expires_at: new Date(claims.expiresAt * 1000).toISOString(),
      },
      { status: 201 },
    ));
  } catch (e) {
    if (e instanceof MagicLinkConfigError) {
      console.error("[POST /api/magic-links]", e.message);
      return NextResponse.json({ error: "magic links are not configured on this server" }, { status: 500 });
    }
    throw e;
  }
}
