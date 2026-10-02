"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type BuildStep = { name: string; status: string; duration_ms?: number; error?: string };

type Build = {
  build_id: string;
  brand_slug: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  steps: BuildStep[] | null;
  started_at: string | null;
  finished_at: string | null;
  payload_url: string | null;
  logs_url: string | null;
  error: string | null;
};

const ADMIN_TOKEN_KEY = "cct_admin_token";

export default function BuildingPage({ params }: PageProps<"/admin/building/[build_id]">) {
  const { build_id } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const slug = search.get("slug");
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (!token) { setError("no admin token in sessionStorage; go back to /admin"); return; }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/builds/${build_id}`, { headers: { "x-admin-token": token } });
        if (res.status === 401) { setError("admin token rejected"); return; }
        if (!res.ok) { setError(`backend returned ${res.status}`); return; }
        const b = (await res.json()) as Build;
        if (cancelled) return;
        setBuild(b);
        if (b.status === "ready" && slug) {
          // Give the UI a moment to show "ready" before redirecting
          setTimeout(() => router.push(`/${slug}`), 1200);
          return;
        }
        if (b.status === "failed" || b.status === "cancelled") return;
        timer = setTimeout(tick, 2000);
      } catch (e) {
        setError((e as Error).message);
      }
    };

    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [build_id, router, slug]);

  return (
    <main className="mx-auto max-w-2xl px-8 py-12">
      <Link href="/admin" className="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-900">
        ← admin
      </Link>
      <h1 className="font-serif text-3xl font-medium tracking-tight">Building…</h1>
      <p className="mt-1 font-mono text-xs text-neutral-500">{build_id}</p>

      {error && (
        <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {build && (
        <div className="mt-7 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">brand</div>
              <div className="font-mono text-sm">{build.brand_slug}</div>
            </div>
            <StatusChip status={build.status} />
          </div>

          <ol className="mt-6 space-y-3">
            {(build.steps ?? []).map((s) => (
              <li key={s.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <StepIcon status={s.status} />
                  <span className="font-mono text-xs">{s.name}</span>
                </div>
                <div className="text-xs text-neutral-500">
                  {s.duration_ms != null ? `${(s.duration_ms / 1000).toFixed(1)}s` : s.status}
                </div>
              </li>
            ))}
          </ol>

          {build.error && (
            <div className="mt-5 rounded-lg bg-red-50 p-3 text-xs text-red-800">
              <div className="font-semibold mb-1">build failed</div>
              <div className="font-mono">{build.error}</div>
            </div>
          )}

          {build.status === "ready" && (
            <p className="mt-5 text-sm text-neutral-500">
              Redirecting to <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px]">/{build.brand_slug}</code>…
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function StatusChip({ status }: { status: Build["status"] }) {
  const cls =
    status === "ready" ? "bg-green-100 text-green-800" :
    status === "running" ? "bg-blue-100 text-blue-800" :
    status === "queued" ? "bg-neutral-100 text-neutral-700" :
    "bg-red-100 text-red-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-mono ${cls}`}>{status}</span>;
}

function StepIcon({ status }: { status: string }) {
  if (status === "done") return <span className="inline-block h-4 w-4 rounded-full bg-green-600 text-center text-white text-[10px] leading-4">✓</span>;
  if (status === "running") return <span className="inline-block h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />;
  return <span className="inline-block h-4 w-4 rounded-full border border-neutral-300" />;
}
