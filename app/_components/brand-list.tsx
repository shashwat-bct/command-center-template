import Link from "next/link";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isAdminSession } from "@/lib/admin-auth";
import { loadBrandRows, tsText } from "@/lib/brand-rows";

const fmtDate = (v: unknown): string => {
  const s = tsText(v);
  return s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
};

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-green-50 text-green-700",
  running: "bg-amber-50 text-amber-700",
  queued: "bg-amber-50 text-amber-700",
  failed: "bg-rose-50 text-rose-700",
};

export default async function BrandList() {
  const session = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!isAdminSession(session)) {
    return <p className="text-sm text-neutral-500">Sign in from <Link href="/admin" className="underline">Add a brand</Link> to see the brands you have built.</p>;
  }

  let rows: Awaited<ReturnType<typeof loadBrandRows>> = [];
  try {
    rows = await loadBrandRows();
  } catch (e) {
    return <p className="text-sm text-rose-700">Could not load brands: {(e as Error).message}</p>;
  }

  if (!rows.length) return <p className="text-sm text-neutral-500">No brands built yet.</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map(({ slug, name, latest, ready }) => {
        const href = ready ? `/${slug}#scorecard` : latest ? `/admin/building/${latest.build_id}?slug=${slug}` : "/admin";
        return (
          <Link
            key={slug}
            href={href}
            className="group flex items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-5 transition hover:-translate-y-px hover:border-neutral-900"
          >
            <div className="min-w-0">
              <div className="truncate font-semibold">{name}</div>
              <div className="truncate font-mono text-[11px] text-neutral-500">/{slug} · {fmtDate(latest?.finished_at ?? latest?.created_at)}</div>
            </div>
            {latest && (
              <span className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${STATUS_STYLE[latest.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                {latest.status === "ready" || !ready ? latest.status : `${latest.status} · last ready shown`}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
