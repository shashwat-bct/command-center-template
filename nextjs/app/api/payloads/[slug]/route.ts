import { type NextRequest } from "next/server";
import { listLatestReadyBuildPerBrand } from "@/lib/bq";
import { readPayloadBytes } from "@/lib/gcs";
import { readVendoredPayload } from "@/lib/capture";

// GET /api/payloads/<slug>              → the latest ready payload for a brand
// GET /api/payloads/<slug>?build=<id>   → a specific build's payload
//
// If no ready build exists AND a vendored payload is baked into the image, we
// serve that so first-visit dashboards work before anything has been captured.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const build = req.nextUrl.searchParams.get("build");

  // Try the GCS + BQ path for a specific build id if requested.
  if (build) {
    try {
      const bytes = await readPayloadBytes(slug, build);
      if (bytes) {
        return new Response(new Uint8Array(bytes), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
        });
      }
    } catch (e) {
      console.error("[GET /api/payloads] specific-build fetch failed:", (e as Error).message);
    }
    return new Response("not found", { status: 404 });
  }

  // Try the latest ready build. BQ or GCS errors here should NOT 500 the
  // request — they should fall through to the vendored fallback so a
  // local-dev or cold-start container can still serve a dashboard.
  try {
    const latestByBrand = await listLatestReadyBuildPerBrand();
    const latest = latestByBrand[slug];
    if (latest) {
      try {
        const bytes = await readPayloadBytes(slug, latest.build_id);
        if (bytes) {
          return new Response(new Uint8Array(bytes), {
            headers: { "content-type": "application/json; charset=utf-8", "x-build-id": latest.build_id, "cache-control": "public, max-age=60" },
          });
        }
      } catch (e) {
        console.error("[GET /api/payloads/" + slug + "] GCS fetch failed, falling through:", (e as Error).message);
      }
    }
  } catch (e) {
    console.error("[GET /api/payloads/" + slug + "] BQ query failed, falling through:", (e as Error).message);
  }

  // Vendored fallback — used when no BQ/GCS is reachable (local dev) or no
  // ready build has run.
  try {
    const vendored = readVendoredPayload(slug);
    if (vendored) {
      return new Response(vendored, {
        headers: { "content-type": "application/json; charset=utf-8", "x-source": "vendored", "cache-control": "public, max-age=60" },
      });
    }
  } catch (e) {
    console.error("[GET /api/payloads/" + slug + "] vendored fallback failed:", (e as Error).message);
  }

  return new Response("not found", { status: 404 });
}
