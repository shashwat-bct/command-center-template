import { readCaptureImage } from "@/lib/captures";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; file: string }> }) {
  const { slug, file } = await params;
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[A-Za-z0-9_-]+(\.top|\.read|\.focus)?\.jpg$/.test(file)) return Response.json({ error: "not found" }, { status: 404 });
  const jpg = await readCaptureImage(slug, file);
  if (!jpg) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(jpg), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}
