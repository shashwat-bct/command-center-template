import { MagicLinkConfigError, verifyMagicToken, type MagicLinkClaims } from "@/lib/magic-link";
import { escapeHtml } from "@/lib/dashboard-html";

export const SHARE_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
} as const;

const MESSAGES: Record<string, { status: number; title: string; body: string }> = {
  expired: { status: 410, title: "This link has expired", body: "Ask whoever shared it for a new one." },
  invalid: { status: 404, title: "This link isn't valid", body: "Check that you copied the whole link." },
  config: { status: 500, title: "Sharing is unavailable", body: "This server isn't configured for share links." },
};

export function shareErrorPage(kind: keyof typeof MESSAGES): Response {
  const m = MESSAGES[kind];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(m.title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;font-family:system-ui,sans-serif;color:#1a1a1a}main{max-width:420px;padding:32px;background:#fff;border:1px solid #e5e3dd;border-radius:16px}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#6a6a6a;line-height:1.5}</style>
</head><body><main><h1>${escapeHtml(m.title)}</h1><p>${escapeHtml(m.body)}</p></main></body></html>`;
  return new Response(html, { status: m.status, headers: { ...SHARE_HEADERS, "content-type": "text/html; charset=utf-8" } });
}

export type ShareCheck = { ok: true; claims: MagicLinkClaims } | { ok: false; kind: "expired" | "invalid" | "config" };

export function checkShareToken(token: string): ShareCheck {
  try {
    const r = verifyMagicToken(decodeURIComponent(token));
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
