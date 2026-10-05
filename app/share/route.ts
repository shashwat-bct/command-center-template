import { renderDashboardHtml } from "@/lib/dashboard-html";
import { SHARE_HEADERS } from "@/lib/share-response";

export const dynamic = "force-dynamic";

export async function GET() {
  const html = renderDashboardHtml({ title: "Shared dashboard · Commercial Command Center", payloadUrl: "", share: true });
  return new Response(html, { status: 200, headers: { ...SHARE_HEADERS, "content-type": "text/html; charset=utf-8" } });
}
