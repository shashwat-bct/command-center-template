import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ build_id: string }> }) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const { build_id } = await params;
  return NextResponse.json(
    { error: "not implemented until stage 2.3", build_id },
    { status: 501 },
  );
}
