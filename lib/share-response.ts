import { MagicLinkConfigError, verifyMagicToken, type MagicLinkClaims } from "@/lib/magic-link";

export const SHARE_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
} as const;

export type ShareCheck = { ok: true; claims: MagicLinkClaims } | { ok: false; kind: "expired" | "invalid" | "config" };

export function checkShareToken(token: string): ShareCheck {
  try {
    const r = verifyMagicToken(token);
    if (r.ok) return { ok: true, claims: r.claims };
    return { ok: false, kind: r.reason === "expired" ? "expired" : "invalid" };
  } catch (e) {
    if (e instanceof MagicLinkConfigError) {
      console.error("[share]", e.message);
      return { ok: false, kind: "config" };
    }
    throw e;
  }
}
