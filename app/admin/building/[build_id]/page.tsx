"use client";

import { use, useEffect, useRef, useState } from "react";
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
  share_id?: string;
};

const ADMIN_TOKEN_KEY = "cct_admin_token";

const STEP_LABELS: Record<string, string> = {
  config: "Writing the config",
  builder: "Running the simulation",
  relabel: "Relabeling under your brand",
  upload: "Publishing to storage",
};

export default function BuildingPage({ params }: PageProps<"/admin/building/[build_id]">) {
  const { build_id } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const slugFromUrl = search.get("slug");
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const brandName = useBrandName(slugFromUrl ?? build?.brand_slug ?? "");
  const tStart = useRef<number>(Date.now());

  useEffect(() => {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/builds/${build_id}`, { headers: token ? { "x-admin-token": token } : {} });
        if (res.status === 401) { setError("not signed in — go back to /admin and enter the admin token"); return; }
        if (!res.ok) { setError(`backend returned ${res.status}`); return; }
        const b = (await res.json()) as Build;
        if (cancelled) return;
        setBuild(b);
        if (b.status === "ready" && (b.share_id || slugFromUrl)) {
          setExiting(true);
          setTimeout(() => router.push(`/${b.share_id ?? slugFromUrl}`), 1400);
          return;
        }
        if (b.status === "failed" || b.status === "cancelled") return;
        timer = setTimeout(tick, 1800);
      } catch (e) {
        setError((e as Error).message);
      }
    };

    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [build_id, router, slugFromUrl]);

  const steps: BuildStep[] = build?.steps ?? [
    { name: "config", status: "pending" },
    { name: "builder", status: "pending" },
    { name: "upload", status: "pending" },
  ];
  const activeStep = steps.findIndex((s) => s.status === "running");
  const activeStepName = activeStep >= 0 ? steps[activeStep].name : (build?.status === "ready" ? "done" : "queued");
  const elapsed = Math.max(0, (Date.now() - tStart.current) / 1000);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <Link href="/admin" className="g-btn-text -ml-3 mb-4">
          ← Admin
        </Link>
        <h1 className="font-display text-3xl text-on-surface">Something went wrong</h1>
        <p className="mt-3 text-sm text-[#c5221f]">{error}</p>
      </main>
    );
  }

  const failed = build?.status === "failed";

  return (
    <div className={`building-scene ${exiting ? "building-scene--exiting" : ""}`}>
      
      <main className="building-content">
        <div className="building-eyebrow">
          <span className="building-dot" />
          <span>
            {failed ? "Build failed" :
             build?.status === "ready" ? "Dashboard ready" :
             "Building the command center"}
          </span>
          <span className="building-count">·  {build_id}</span>
        </div>

        <h1 className="building-brand">
          {splitChars(brandName || "…").map((ch, i) => (
            <span key={i} className="building-char" style={{ animationDelay: `${i * 60}ms` }}>
              {ch === " " ? " " : ch}
            </span>
          ))}
        </h1>

        <div className="building-sub">
          {failed
            ? build?.error ?? "unknown error"
            : build?.status === "ready"
              ? "Pulling into view…"
              : activeStepName === "queued"
                ? "Queueing the simulation…"
                : STEP_LABELS[activeStepName] ?? activeStepName}
        </div>

        <div className={`building-progress ${failed || build?.status === "ready" ? "building-progress--still" : ""}`} role="progressbar" aria-label="Build progress">
          <span />
        </div>

        <ol className="building-steps">
          {steps.map((s, i) => (
            <li
              key={s.name}
              className={`building-step building-step--${stepState(s, i, steps, build?.status)}`}
            >
              <span className="building-step-num">{stepState(s, i, steps, build?.status) === "done" ? "✓" : i + 1}</span>
              <span className="building-step-name">{STEP_LABELS[s.name] ?? s.name}</span>
              <span className="building-step-time">
                {s.duration_ms != null
                  ? `${(s.duration_ms / 1000).toFixed(1)}s`
                  : s.status === "running"
                    ? "running"
                    : "waiting"}
              </span>
            </li>
          ))}
        </ol>

        <div className="building-foot">
          <span>{elapsed.toFixed(1)}s elapsed</span>
          <span>·</span>
          <span>payload stored in Google Cloud Storage</span>
          <span>·</span>
          <span>build row in BigQuery <code>cco_mgmt.builds</code></span>
        </div>
      </main>

      <style>{sceneStyles}</style>
    </div>
  );
}

function stepState(s: BuildStep, i: number, all: BuildStep[], status?: Build["status"]): string {
  if (s.status === "done") return "done";
  if (s.status === "running") return "running";
  if (status === "ready") return "done";
  // the first non-pending step is "next-up"
  const firstActive = all.findIndex((x) => x.status === "running" || x.status === "done");
  if (firstActive < 0 && i === 0) return "next";
  if (i === firstActive + 1) return "next";
  return "pending";
}

function splitChars(s: string): string[] {
  // keep emoji + grapheme-safe splits
  return Array.from(s);
}

function useBrandName(slug: string): string {
  // Pretty-print the slug: "sony-bravia" → "Sony Bravia"
  if (!slug) return "";
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const sceneStyles = `
  html, body { background: #f8fafd; color: #1f1f1f; }
  .building-scene {
    position: fixed; inset: 0;
    background: #f8fafd;
    overflow: auto;
    transition: opacity 0.6s cubic-bezier(.2,0,0,1), transform 0.6s cubic-bezier(.2,0,0,1);
  }
  .building-scene--exiting { opacity: 0; transform: scale(1.02); }
  .building-content {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; padding: 48px 24px; text-align: center;
    font-family: "Google Sans Text", "Google Sans", Roboto, system-ui, sans-serif;
  }
  .building-eyebrow {
    display: inline-flex; align-items: center; gap: 10px;
    height: 32px; padding: 0 14px; border-radius: 8px;
    background: #fff; border: 1px solid #e3e3e3;
    font-size: 13px; font-weight: 500; color: #444746;
  }
  .building-dot { width: 8px; height: 8px; border-radius: 50%; background: #1a73e8; animation: pulseDot 1.6s ease-in-out infinite; }
  .building-count { color: #5f6368; font-weight: 400; }
  .building-brand {
    font-family: "Google Sans Display", "Google Sans", Roboto, system-ui, sans-serif;
    font-weight: 400; font-size: clamp(56px, 10vw, 112px); line-height: 1.05;
    margin: 28px 0 10px; color: #1f1f1f;
    display: flex; flex-wrap: wrap; justify-content: center;
  }
  .building-char { display: inline-block; opacity: 0; transform: translateY(10px); animation: charIn 0.6s cubic-bezier(.2,0,0,1) forwards; }
  .building-sub { font-size: 16px; color: #444746; margin-bottom: 32px; min-height: 24px; }
  .building-progress {
    position: relative; width: min(560px, 90vw); height: 4px; border-radius: 2px;
    background: #d3e3fd; overflow: hidden; margin-bottom: 32px;
  }
  .building-progress span {
    position: absolute; top: 0; bottom: 0; width: 40%; border-radius: 2px; background: #0b57d0;
    animation: indeterminate 1.6s cubic-bezier(.4,0,.2,1) infinite;
  }
  .building-progress--still span { animation: none; left: 0; width: 100%; }
  .building-steps {
    list-style: none; padding: 8px; margin: 0;
    display: flex; flex-direction: column; gap: 2px;
    width: min(560px, 90vw);
    background: #fff; border: 1px solid #e3e3e3; border-radius: 16px;
  }
  .building-step {
    display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 16px;
    padding: 12px 14px; border-radius: 12px;
    font-size: 14px; color: #5f6368; text-align: left;
    transition: background-color 0.3s, color 0.3s;
  }
  .building-step-num {
    width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
    font-size: 13px; font-weight: 500; background: #f1f3f4; color: #5f6368;
  }
  .building-step-name { font-weight: 500; }
  .building-step-time { font-size: 13px; color: #5f6368; font-variant-numeric: tabular-nums; }
  .building-step--next { color: #1f1f1f; }
  .building-step--running { background: #e8f0fe; color: #041e49; }
  .building-step--running .building-step-num { background: #0b57d0; color: #fff; }
  .building-step--running .building-step-time { color: #0b57d0; }
  .building-step--done { color: #1f1f1f; }
  .building-step--done .building-step-num { background: #e6f4ea; color: #137333; }
  .building-step--done .building-step-time { color: #137333; }
  .building-foot {
    margin-top: 28px; font-size: 12px; color: #5f6368;
    display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
  }
  .building-foot code {
    font-family: "Roboto Mono", ui-monospace, monospace; font-size: 12px;
    background: #f1f3f4; padding: 1px 6px; border-radius: 4px;
  }
  @keyframes charIn { to { opacity: 1; transform: none; } }
  @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes indeterminate { 0% { left: -40%; } 100% { left: 100%; } }
`;
