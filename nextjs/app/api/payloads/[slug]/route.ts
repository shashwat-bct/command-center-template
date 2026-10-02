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

  try {
    if (build) {
      const bytes = await readPayloadBytes(slug, build);
      if (!bytes) return new Response("not found", { status: 404 });
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    const latestByBrand = await listLatestReadyBuildPerBrand();
    const latest = latestByBrand[slug];
    if (latest) {
      const bytes = await readPayloadBytes(slug, latest.build_id);
      if (bytes) {
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-build-id": latest.build_id,
            "cache-control": "public, max-age=60",
          },
        });
      }
    }

    // No ready build on record — fall back to the vendored committed payload
    // (what the dashboard rendered on day one). This keeps /<slug> useful
    // before the backend has ever run.
    const vendored = readVendoredPayload(slug);
    if (vendored) {
      return new Response(vendored, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-source": "vendored",
          "cache-control": "public, max-age=60",
        },
      });
    }

    return new Response("not found", { status: 404 });
  } catch (e) {
    const err = e as Error;
    console.error("[GET /api/payloads/" + slug + "] failed", err);
    return new Response("payload fetch failed: " + err.message, { status: 500 });
  }
}
