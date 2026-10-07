import Link from "next/link";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isAdminSession } from "@/lib/admin-auth";
import { loadBrandRows, tsText } from "@/lib/brand-rows";
import { sharePath } from "@/lib/share-id";

const fmtDate = (v: unknown): string => {
  const s = tsText(v);
  return s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
};

export default async function BrandList() {
  const session = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!isAdminSession(session)) {
    return <p className="text-sm text-muted">Sign in from <Link href="/admin" className="font-medium text-primary hover:underline">Add a brand</Link> to see the brands you have built.</p>;
  }

  let rows: Awaited<ReturnType<typeof loadBrandRows>> = [];
  try {
    rows = await loadBrandRows();
  } catch (e) {
    return <p className="text-sm text-[#c5221f]">Could not load brands: {(e as Error).message}</p>;
  }

  if (!rows.length) return <p className="text-sm text-muted">No brands built yet.</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map(({ slug, name, latest, ready }) => {
        const href = ready ? `${sharePath(slug)}#scorecard` : latest ? `/admin/building/${latest.build_id}?slug=${slug}` : "/admin";
        return (
          <Link
            key={slug}
            href={href}
            className="g-card flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-[0_1px_3px_rgba(60,64,67,.15),0_4px_8px_3px_rgba(60,64,67,.08)]"
          >
            <div className="min-w-0">
              <div className="truncate font-display text-base font-medium text-on-surface">{name}</div>
              <div className="mt-0.5 truncate text-[13px] text-muted">/{slug} · {fmtDate(latest?.finished_at ?? latest?.created_at)}</div>
            </div>
            {latest && (
              <span className="g-status shrink-0" data-status={latest.status}>
                {latest.status === "ready" || !ready ? latest.status : `${latest.status} · last ready shown`}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
