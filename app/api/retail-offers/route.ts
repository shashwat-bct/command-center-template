import { NextResponse, after, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listBrands } from "@/lib/bq";
import { brightDataKey } from "@/lib/brightdata";
import { refreshRetailOffers } from "@/lib/retail-refresh";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const key = brightDataKey();
  if (!key) return NextResponse.json({ error: "BRIGHTDATA_API_KEY or BRIGHTDATA_SERP_KEY is not configured" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { slugs?: unknown };
  const asked = Array.isArray(body.slugs) ? body.slugs.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]+$/.test(s)) : [];
  const slugs = asked.length ? asked : (await listBrands()).map((b) => b.slug);
  after(async () => {
    for (const slug of slugs) {
      const r = await refreshRetailOffers(slug, key).catch((e: unknown) => ({ slug, listings: 0, found: 0, error: (e as Error).message }));
      console.log(`[retail-offers] ${JSON.stringify(r)}`);
    }
  });
  return NextResponse.json({ slugs }, { status: 202 });
}
