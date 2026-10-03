import { type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { isMeasuredOnly, loadBuildPayload, loadLatestPayload, payloadResponse, retiredResponse } from "@/lib/payload-source";

// GET /api/payloads/<slug>              → the latest ready payload for a brand
// GET /api/payloads/<slug>?build=<id>   → a specific build's payload
//
// Only measured-only builds are served; older simulated builds answer 409.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const { slug } = await params;
  const build = req.nextUrl.searchParams.get("build");

  if (build) {
    const source = await loadBuildPayload(slug, build);
    if (!source) return new Response("not found", { status: 404 });
    return isMeasuredOnly(source) ? payloadResponse(source, "private, max-age=300") : retiredResponse();
  }

  const source = await loadLatestPayload(slug);
  if (!source) return new Response("not found", { status: 404 });
  return isMeasuredOnly(source) ? payloadResponse(source, "private, max-age=60") : retiredResponse();
}
