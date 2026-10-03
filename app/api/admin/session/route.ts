import { NextResponse, type NextRequest } from "next/server";
import { adminAuthEnabled, adminCookieHeader, sessionCookieFor } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!adminAuthEnabled()) return NextResponse.json({ ok: true, auth: "disabled" });
  let token = "";
  try {
    token = String(((await req.json()) as { token?: unknown }).token ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const cookie = sessionCookieFor(token);
  if (!cookie) return NextResponse.json({ error: "invalid admin token" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", cookie);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", adminCookieHeader("", 0));
  return res;
}
