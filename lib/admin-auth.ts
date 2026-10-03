import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SECRET = process.env.ADMIN_SHARED_SECRET;

export const ADMIN_COOKIE = "cc_admin";
const COOKIE_MAX_AGE_S = 7 * 24 * 3600;

const sessionValue = (secret: string): string => createHash("sha256").update(`cc-admin-session|${secret}`).digest("hex");

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const readCookie = (req: Request, name: string): string | null => {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
};

export const adminAuthEnabled = (): boolean => !!SECRET;

export function tokenIsValid(token: string | null | undefined): boolean {
  return !!SECRET && !!token && safeEqual(token, SECRET);
}

/**
 * True when the request carries the admin token header or a session cookie
 * minted from it. Always true when ADMIN_SHARED_SECRET is unset (local dev).
 */
export function isAdmin(req: Request): boolean {
  if (!SECRET) return true;
  if (tokenIsValid(req.headers.get("x-admin-token"))) return true;
  const cookie = readCookie(req, ADMIN_COOKIE);
  return !!cookie && safeEqual(cookie, sessionValue(SECRET));
}

export function requireAdmin(req: NextRequest): NextResponse | null {
  if (isAdmin(req)) return null;
  return NextResponse.json({ error: "missing or invalid X-Admin-Token" }, { status: 401 });
}

/**
 * Sets the admin session cookie on a response when the request proved the
 * token, so dashboard links opened from the admin flow are authorised.
 */
export function withAdminSession<T extends Response>(req: Request, res: T): T {
  if (!SECRET || !tokenIsValid(req.headers.get("x-admin-token"))) return res;
  res.headers.append("set-cookie", adminCookieHeader(sessionValue(SECRET), COOKIE_MAX_AGE_S));
  return res;
}

export function adminCookieHeader(value: string, maxAgeS: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`;
}

export function sessionCookieFor(token: string): string | null {
  return SECRET && tokenIsValid(token) ? adminCookieHeader(sessionValue(SECRET), COOKIE_MAX_AGE_S) : null;
}

/**
 * Session check for server components, which see cookies rather than a Request.
 */
export function isAdminSession(cookieValue: string | undefined): boolean {
  if (!SECRET) return true;
  return !!cookieValue && safeEqual(cookieValue, sessionValue(SECRET));
}
