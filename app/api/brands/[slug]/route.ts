import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdminSession } from "@/lib/admin-auth";
import { savedInputsFor } from "@/lib/build-inputs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const { slug } = await params;
  try {
    const saved = await savedInputsFor(slug);
    if (!saved) return NextResponse.json({ error: `no saved inputs for "${slug}"` }, { status: 404 });
    return withAdminSession(req, NextResponse.json(saved));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
