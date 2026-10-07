import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const MIN_SECRET_LENGTH = 32;

export const MAX_TTL_HOURS = 24 * 30;

export type MagicLinkClaims = {
  v: typeof TOKEN_VERSION;
  slug: string;
  buildId: string | null;
  label: string | null;
  partnerId: string | null;
  issuedAt: number;
  expiresAt: number | null;
  nonce: string;
};

export type VerifyResult =
  | { ok: true; claims: MagicLinkClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "unsupported_version" };

export class MagicLinkConfigError extends Error {}

export function magicLinkSecret(): string {
  const s = process.env.MAGIC_LINK_SECRET;
  if (!s || s.length < MIN_SECRET_LENGTH) {
    throw new MagicLinkConfigError(`MAGIC_LINK_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`);
  }
  return s;
}

const sign = (body: string): Buffer => createHmac("sha256", magicLinkSecret()).update(body).digest();

/**
 * Mints a signed, self-contained share token. The brand/build scope and optional
 * expiry live inside the token, so verification needs no storage; rotating
 * MAGIC_LINK_SECRET revokes every outstanding link at once.
 */
export function createMagicToken(input: {
  slug: string;
  buildId: string | null;
  label: string | null;
  partnerId?: string | null;
  ttlHours: number | null;
  now?: number;
}): { token: string; claims: MagicLinkClaims } {
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const claims: MagicLinkClaims = {
    v: TOKEN_VERSION,
    slug: input.slug,
    buildId: input.buildId,
    label: input.label,
    partnerId: input.partnerId ?? null,
    issuedAt,
    expiresAt: input.ttlHours == null ? null : issuedAt + Math.round(input.ttlHours * 3600),
    nonce: randomBytes(9).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${body}.${sign(body).toString("base64url")}`, claims };
}

export function verifyMagicToken(token: string, now: number = Date.now()): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;

  const expected = sign(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: MagicLinkClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MagicLinkClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims.v !== TOKEN_VERSION) return { ok: false, reason: "unsupported_version" };
  if (typeof claims.slug !== "string" || (claims.expiresAt !== null && typeof claims.expiresAt !== "number")) return { ok: false, reason: "malformed" };
  if (claims.expiresAt !== null && Math.floor(now / 1000) >= claims.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
