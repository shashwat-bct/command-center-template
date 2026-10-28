import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdminSession } from "@/lib/admin-auth";
import { savedInputsFor } from "@/lib/build-inputs";
import { createBuild } from "@/lib/capture";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const { slug } = await params;
  const body = (await req.json().catch(() => ({}))) as { reuse_ai?: unknown; ai_broad?: unknown };
  try {
    const saved = await savedInputsFor(slug);
    if (!saved) return NextResponse.json({ error: `"${slug}" has no saved inputs — create it from the form instead` }, { status: 404 });
    const { inputs } = saved;
    const result = await createBuild({
      slug,
      name: inputs.name,
      brandLink: inputs.brandLink,
      region: inputs.region,
      aiCategory: inputs.aiCategory,
      aiCompetitors: inputs.aiCompetitors,
      products: inputs.products,
      asins: inputs.asins,
      competitorAsins: inputs.competitorAsins,
      options: { reuse_ai: body.reuse_ai === true, ...(typeof body.ai_broad === "string" && body.ai_broad.trim() ? { ai_broad: body.ai_broad.trim() } : {}) },
    });
    return withAdminSession(req, NextResponse.json({ ...result, inputs, source: saved.source }, { status: 202 }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
