import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  // Stage 2.2 will wire this to BigQuery. For now, empty list + a documentation
  // note so a caller can tell the service is up but the data layer isn't yet.
  return NextResponse.json({
    brands: [],
    _note: "stage 2.1 — BigQuery not wired yet; this endpoint will list captured brands once stage 2.2 lands",
  });
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // ignore — echoed as nulls below
  }
  return NextResponse.json(
    {
      error: "capture orchestration not implemented until stage 2.3",
      received: {
        name: (body.name as string) ?? null,
        slug: (body.slug as string) ?? null,
        category: (body.category as string) ?? null,
        retailers: (body.retailers as unknown[]) ?? [],
        models: (body.models as unknown[]) ?? [],
      },
    },
    { status: 501 },
  );
}
