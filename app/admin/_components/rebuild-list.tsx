import Link from "next/link";
import { loadBrandRows, tsText } from "@/lib/brand-rows";
import { sharePath } from "@/lib/share-id";
import CopyLinkButton from "./copy-link-button";
import RebuildButton from "./rebuild-button";

const fmtDate = (v: unknown): string => {
  const s = tsText(v);
  return s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
};

export default async function RebuildList() {
  let rows: Awaited<ReturnType<typeof loadBrandRows>> = [];
  try {
    rows = await loadBrandRows();
  } catch (e) {
    return <p className="text-sm text-[#c5221f]">Could not load brands: {(e as Error).message}</p>;
  }
  if (!rows.length) return <p className="text-sm text-muted">No brands built yet.</p>;
  return (
    <ul className="g-card divide-y divide-outline-soft overflow-hidden">
      {rows.map((r) => (
        <li key={r.slug} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-surface-low">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-[15px] font-medium text-on-surface">{r.name}</span>
              {r.latest && (
                <span className="g-status" data-status={r.latest.status}>{r.latest.status}</span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[13px] text-muted">/{r.slug} · last built {fmtDate(r.latest?.finished_at ?? r.latest?.created_at)}</div>
          </div>
          <div className="flex items-center gap-1">
            {r.ready && <Link href={`${sharePath(r.slug)}#scorecard`} className="g-btn-text">View</Link>}
            {r.ready && <CopyLinkButton path={sharePath(r.slug)} />}
            <Link href={`/admin?from=${encodeURIComponent(r.slug)}#form`} className="g-btn-text">Edit</Link>
            <RebuildButton slug={r.slug} />
          </div>
        </li>
      ))}
    </ul>
  );
}
