import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listBrands, listLatestBuildsPerBrand } from "@/lib/bq";
import { createBuild } from "@/lib/capture";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  try {
    const [brands, builds] = await Promise.all([listBrands(), listLatestBuildsPerBrand(200)]);
    const buildsByBrand = builds.reduce<Record<string, typeof builds>>((acc, b) => {
      (acc[b.brand_slug] ??= []).push(b);
      return acc;
    }, {});
    return NextResponse.json({
      brands: brands.map((b) => ({
        slug: b.slug,
        name: b.name,
        category: b.category,
        retailers: b.retailers,
        latest_build_id: b.latest_build_id,
        updated_at: b.updated_at,
        builds: (buildsByBrand[b.slug] ?? []).slice(0, 5).map((bl) => ({
          build_id: bl.build_id,
          status: bl.status,
          finished_at: bl.finished_at,
          payload_url: bl.payload_url,
        })),
      })),
    });
  } catch (e) {
    const err = e as Error;
    console.error("[GET /api/brands] bq error", err);
    return NextResponse.json({ error: "bq query failed", detail: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  try {
    const result = await createBuild({
      slug,
      name,
      category: (body.category as string) ?? null,
      retailers: (body.retailers as string[]) ?? undefined,
      models: (body.models as unknown[]) ?? undefined,
      cities: (body.cities as string[]) ?? undefined,
      asins: Array.isArray(body.asins) ? (body.asins as string[]) : undefined,
      aiCategory: (body.aiCategory as string | null | undefined) ?? null,
      aiCompetitors: Array.isArray(body.aiCompetitors) ? (body.aiCompetitors as string[]) : undefined,
      options: (body.options as never) ?? undefined,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    const err = e as { message?: string; errors?: unknown; response?: unknown; stack?: string };
    console.error("[POST /api/brands] createBuild failed", JSON.stringify({
      message: err.message, errors: err.errors, response: err.response, stack: err.stack,
    }));
    return NextResponse.json(
      { error: err.message || "unknown error", errors: err.errors ?? null },
      { status: 400 },
    );
  }
}
