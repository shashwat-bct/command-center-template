import { type NextRequest } from "next/server";
import { listLatestReadyBuildPerBrand } from "@/lib/bq";
import { readPayloadBytes, readKindedPayloadBytes } from "@/lib/gcs";
import { readVendoredPayload, readVendoredExtras } from "@/lib/capture";

// GET /api/payloads/<slug>              → the latest ready base payload
// GET /api/payloads/<slug>?kind=ai      → AI Visibility payload
// GET /api/payloads/<slug>?kind=wb      → AEO Workbench payload
// GET /api/payloads/<slug>?kind=snapshots → Snapshots index
// GET /api/payloads/<slug>?build=<id>   → a specific build's base payload

export const dynamic = "force-dynamic";

type Kind = "base" | "ai" | "wb" | "snapshots";

function parseKind(s: string | null): Kind {
  if (s === "ai" || s === "wb" || s === "snapshots") return s;
  return "base";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const build = req.nextUrl.searchParams.get("build");
  const kind = parseKind(req.nextUrl.searchParams.get("kind"));

  // Specific build id (base payload only — extras aren't versioned per-build)
  if (build && kind === "base") {
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

  // Latest ready build. BQ/GCS errors fall through to vendored fallback.
  try {
    const latestByBrand = await listLatestReadyBuildPerBrand();
    const latest = latestByBrand[slug];
    if (latest) {
      try {
        const bytes = kind === "base"
          ? await readPayloadBytes(slug, latest.build_id)
          : await readKindedPayloadBytes(slug, latest.build_id, kind);
        if (bytes) {
          return new Response(new Uint8Array(bytes), {
            headers: { "content-type": "application/json; charset=utf-8", "x-build-id": latest.build_id, "cache-control": "public, max-age=60" },
          });
        }
      } catch (e) {
        console.error(`[GET /api/payloads/${slug}?kind=${kind}] GCS fetch failed, falling through:`, (e as Error).message);
      }
    }
  } catch (e) {
    console.error(`[GET /api/payloads/${slug}?kind=${kind}] BQ query failed, falling through:`, (e as Error).message);
  }

  // Vendored fallback — works for base and extras.
  try {
    if (kind === "base") {
      const vendored = readVendoredPayload(slug);
      if (vendored) {
        return new Response(vendored, {
          headers: { "content-type": "application/json; charset=utf-8", "x-source": "vendored", "cache-control": "public, max-age=60" },
        });
      }
    } else {
      const vendored = readVendoredExtras(slug, kind);
      if (vendored) {
        return new Response(vendored, {
          headers: { "content-type": "application/json; charset=utf-8", "x-source": "vendored", "cache-control": "public, max-age=60" },
        });
      }
    }
  } catch (e) {
    console.error(`[GET /api/payloads/${slug}?kind=${kind}] vendored fallback failed:`, (e as Error).message);
  }

  return new Response("not found", { status: 404 });
}
