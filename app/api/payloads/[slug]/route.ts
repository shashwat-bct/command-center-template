import { type NextRequest } from "next/server";
import { bearerToken, isAdmin, tokenIsValid } from "@/lib/admin-auth";
import { expireIfStale, getLatestBuild, getLatestBuildForBrand } from "@/lib/bq";
import { isServable, loadBuildPayload, loadLatestPayload, payloadResponse, retiredResponse } from "@/lib/payload-source";
import { SHARE_HEADERS, checkShareToken } from "@/lib/share-response";
import { withReviewAspects } from "@/lib/aspect-backfill";
import { withCurrentWorkbench } from "@/lib/workbench-repair";
import type { PayloadSource } from "@/lib/payload-source";
import { isShareId, slugForShareId } from "@/lib/share-id";

// GET /api/payloads/<share id>          → the latest ready payload of that brand (no credentials)
// GET /api/payloads/<slug>              → the latest ready payload (admin session or token)
// GET /api/payloads/<slug>?build=<id>   → a specific build's payload (admin)
// Authorization: Bearer <magic token>   → the build that token is pinned to
//

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const enrich = async (slug: string, source: PayloadSource): Promise<PayloadSource> => ({ ...source, bytes: withCurrentWorkbench(slug, source.buildId, await withReviewAspects(slug, source.buildId, source.bytes)) });

const SHARE_STATUS = { expired: 410, invalid: 401, config: 500 } as const;

async function sharedPayload(slug: string, token: string): Promise<Response> {
  const check = checkShareToken(token);
  if (!check.ok) return Response.json({ error: check.kind }, { status: SHARE_STATUS[check.kind], headers: SHARE_HEADERS });
  const { claims } = check;
  if (claims.slug !== slug || !claims.buildId) return Response.json({ error: "invalid" }, { status: 401, headers: SHARE_HEADERS });

  const source = await loadBuildPayload(slug, claims.buildId);
  if (!source) {
    const build = await getLatestBuild(claims.buildId).then((b) => (b ? expireIfStale(b) : null)).catch(() => null);
    if (build && (build.status === "queued" || build.status === "running")) {
      return Response.json({ status: "building", started_at: build.started_at }, { status: 202, headers: { ...SHARE_HEADERS, "retry-after": "10" } });
    }
    if (build?.status === "failed") return Response.json({ error: "build failed", detail: build.error }, { status: 424, headers: SHARE_HEADERS });
    return Response.json({ error: "payload not found" }, { status: 404, headers: SHARE_HEADERS });
  }
  if (!isServable(source)) return retiredResponse({ ...SHARE_HEADERS });
  const res = payloadResponse(await enrich(slug, source), SHARE_HEADERS["cache-control"]);
  for (const [k, v] of Object.entries(SHARE_HEADERS)) res.headers.set(k, v);
  return res;
}

async function payloadById(id: string): Promise<Response> {
  const slug = await slugForShareId(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404, headers: SHARE_HEADERS });
  const source = await loadLatestPayload(slug);
  if (source) {
    if (!isServable(source)) return retiredResponse({ ...SHARE_HEADERS });
    const res = payloadResponse(await enrich(slug, source), SHARE_HEADERS["cache-control"]);
    for (const [k, v] of Object.entries(SHARE_HEADERS)) res.headers.set(k, v);
    return res;
  }
  const build = await getLatestBuildForBrand(slug).then((b) => (b ? expireIfStale(b) : null)).catch(() => null);
  if (build && (build.status === "queued" || build.status === "running")) {
    return Response.json({ status: "building", started_at: build.started_at }, { status: 202, headers: { ...SHARE_HEADERS, "retry-after": "10" } });
  }
  if (build?.status === "failed") return Response.json({ error: "build failed", detail: build.error }, { status: 424, headers: SHARE_HEADERS });
  return Response.json({ error: "payload not found" }, { status: 404, headers: SHARE_HEADERS });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (isShareId(slug)) return payloadById(slug);
  const bearer = bearerToken(req);
  if (bearer && !tokenIsValid(bearer)) return sharedPayload(slug, bearer);
  if (!isAdmin(req)) return Response.json({ error: "missing or invalid credentials" }, { status: 401 });

  const build = req.nextUrl.searchParams.get("build");
  if (build) {
    const source = await loadBuildPayload(slug, build);
    if (!source) return new Response("not found", { status: 404 });
    return isServable(source) ? payloadResponse(await enrich(slug, source), "private, max-age=300") : retiredResponse();
  }

  const source = await loadLatestPayload(slug);
  if (!source) return new Response("not found", { status: 404 });
  return isServable(source) ? payloadResponse(await enrich(slug, source), "private, max-age=60") : retiredResponse();
}
