import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdminSession } from "@/lib/admin-auth";
import { savedInputsFor } from "@/lib/build-inputs";
import { createBuild } from "@/lib/capture";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const { slug } = await params;
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
    });
    return withAdminSession(req, NextResponse.json({ ...result, inputs, source: saved.source }, { status: 202 }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
