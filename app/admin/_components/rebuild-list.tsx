import Link from "next/link";
import { loadBrandRows, tsText } from "@/lib/brand-rows";
import RebuildButton from "./rebuild-button";

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

export default async function RebuildList() {
  let rows: Awaited<ReturnType<typeof loadBrandRows>> = [];
  try {
    rows = await loadBrandRows();
  } catch (e) {
    return <p className="text-sm text-rose-700">Could not load brands: {(e as Error).message}</p>;
  }
  if (!rows.length) return <p className="text-sm text-neutral-500">No brands built yet.</p>;
  return (
    <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white">
      {rows.map((r) => (
        <li key={r.slug} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{r.name}</span>
              {r.latest && (
                <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${STATUS_STYLE[r.latest.status] ?? "bg-neutral-100 text-neutral-600"}`}>{r.latest.status}</span>
              )}
            </div>
            <div className="truncate font-mono text-[11px] text-neutral-500">/{r.slug} · last built {fmtDate(r.latest?.finished_at ?? r.latest?.created_at)}</div>
          </div>
          <div className="flex items-center gap-3">
            {r.ready && <Link href={`/${r.slug}#scorecard`} className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">View</Link>}
            <Link href={`/admin?from=${encodeURIComponent(r.slug)}#form`} className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">Edit</Link>
            <RebuildButton slug={r.slug} />
          </div>
        </li>
      ))}
    </ul>
  );
}
