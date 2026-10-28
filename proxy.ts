import { NextResponse, type NextRequest } from "next/server";
import { isShareId, shareIdFor } from "@/lib/share-id";
import { isSingleBrandKey, singleBrand } from "@/lib/single-brand";

const CLOSED = /^\/(admin|share|api\/(admin|brands|builds|magic-links|ai-live))(\/|$)/;
const SCOPED = /^\/api\/(payloads|captures)\/([^/]+)/;

const notFound = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export function proxy(req: NextRequest) {
  const slug = singleBrand();
  if (!slug) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (path === "/") {
    const url = req.nextUrl.clone();
    url.pathname = `/${shareIdFor(slug)}`;
    return NextResponse.rewrite(url);
  }
  if (CLOSED.test(path)) return notFound();
  const scoped = SCOPED.exec(path);
  if (scoped && !isSingleBrandKey(scoped[2], slug)) return notFound();
  const top = /^\/([^/.]+)$/.exec(path);
  if (top && !path.startsWith("/api") && (!isShareId(top[1]) || !isSingleBrandKey(top[1], slug))) return notFound();
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon|apple-touch-icon).*)"],
};
