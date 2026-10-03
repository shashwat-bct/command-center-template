// File-backed brand dashboards served as a Route Handler returning raw HTML.
// Why not a React page? The bravo-platform shell JS mutates the DOM at parse
// time (populating #bmName with the brand label, filling #nav with page links,
// drawing into #pages). React 19's hydration can't reconcile those mutations
// and either errors or wipes them. Serving raw HTML sidesteps React entirely
// for this one route — the shell is a legacy classic-script app embedded as-is.

import { isAdmin } from "@/lib/admin-auth";
import { dashboardTitle, renderDashboardHtml, renderSignInHtml } from "@/lib/dashboard-html";

const SLUG_RE = /^[a-z0-9-]+$/;

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (!SLUG_RE.test(brand)) return new Response("invalid slug", { status: 400 });
  if (!isAdmin(req)) {
    return new Response(renderSignInHtml(dashboardTitle(brand)), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
    });
  }

  const html = renderDashboardHtml({
    title: dashboardTitle(brand),
    payloadUrl: `/api/payloads/${brand}`,
  });

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
