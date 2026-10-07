import { isAdmin } from "@/lib/admin-auth";
import { dashboardTitle, renderDashboardHtml, renderSignInHtml } from "@/lib/dashboard-html";
import { SHARE_HEADERS } from "@/lib/share-response";
import { isShareId, sharePath } from "@/lib/share-id";

const SLUG_RE = /^[a-z0-9-]+$/;
const HTML = "text/html; charset=utf-8";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (isShareId(brand)) {
    const html = renderDashboardHtml({ title: "Commercial Command Center", payloadUrl: `/api/payloads/${brand}`, shareId: brand });
    return new Response(html, { status: 200, headers: { ...SHARE_HEADERS, "content-type": HTML } });
  }
  if (!SLUG_RE.test(brand)) return new Response("invalid slug", { status: 400 });
  if (!isAdmin(req)) {
    return new Response(renderSignInHtml(dashboardTitle(brand)), {
      status: 401,
      headers: { "content-type": HTML, "cache-control": "private, no-store" },
    });
  }
  return new Response(null, { status: 308, headers: { location: sharePath(brand), "cache-control": "private, no-store" } });
}
