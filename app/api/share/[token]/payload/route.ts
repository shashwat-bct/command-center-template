import { isMeasuredOnly, loadBuildPayload, payloadResponse, retiredResponse } from "@/lib/payload-source";
import { SHARE_HEADERS, checkShareToken } from "@/lib/share-response";

export const dynamic = "force-dynamic";

const ERROR_STATUS = { expired: 410, invalid: 404, config: 500 } as const;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = checkShareToken(token);
  if (!check.ok) {
    return Response.json({ error: check.kind }, { status: ERROR_STATUS[check.kind], headers: SHARE_HEADERS });
  }

  const { slug, buildId } = check.claims;
  const source = buildId ? await loadBuildPayload(slug, buildId) : null;
  if (!source) return Response.json({ error: "payload not found" }, { status: 404, headers: SHARE_HEADERS });
  if (!isMeasuredOnly(source)) return retiredResponse({ ...SHARE_HEADERS });

  const res = payloadResponse(source, SHARE_HEADERS["cache-control"]);
  for (const [k, v] of Object.entries(SHARE_HEADERS)) res.headers.set(k, v);
  return res;
}
