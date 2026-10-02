// The admin-token guard. Any mutating or sensitive route calls `requireAdmin`
// at its entry; health is public (Cloud Run readiness probe hits it).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SECRET = process.env.ADMIN_SHARED_SECRET;

export function requireAdmin(req: NextRequest): NextResponse | null {
  if (!SECRET) return null; // local dev — no guard
  const got = req.headers.get("x-admin-token");
  if (got !== SECRET) {
    return NextResponse.json({ error: "missing or invalid X-Admin-Token" }, { status: 401 });
  }
  return null;
}
