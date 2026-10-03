import { dashboardTitle, renderDashboardHtml } from "@/lib/dashboard-html";
import { SHARE_HEADERS, checkShareToken, shareErrorPage } from "@/lib/share-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = checkShareToken(token);
  if (!check.ok) return shareErrorPage(check.kind);

  const { slug } = check.claims;
  const html = renderDashboardHtml({
    title: dashboardTitle(slug),
    payloadUrl: `/api/share/${encodeURIComponent(token)}/payload`,
  });
  return new Response(html, { status: 200, headers: { ...SHARE_HEADERS, "content-type": "text/html; charset=utf-8" } });
}
