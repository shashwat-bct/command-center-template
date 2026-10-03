import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdminSession } from "@/lib/admin-auth";
import { expireIfStale, getLatestBuild } from "@/lib/bq";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ build_id: string }> }) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const { build_id } = await params;
  try {
    const build = await getLatestBuild(build_id);
    if (!build) return NextResponse.json({ error: "not found", build_id }, { status: 404 });
    return withAdminSession(req, NextResponse.json(await expireIfStale(build)));
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: "bq query failed", detail: err.message }, { status: 500 });
  }
}
