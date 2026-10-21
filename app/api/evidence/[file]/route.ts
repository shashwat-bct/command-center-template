import { readAnswerShot } from "@/lib/answer-shot";

// GET /api/evidence/<sha256>.jpg → the screenshot of the consumer-app page an answer was read from

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const sha = /^([0-9a-f]{64})\.jpg$/.exec(file)?.[1];
  if (!sha) return Response.json({ error: "not found" }, { status: 404 });
  const jpg = await readAnswerShot(sha);
  if (!jpg) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(jpg), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}
