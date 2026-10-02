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
        if (b.status === "ready" && slugFromUrl) {
          setExiting(true);
          setTimeout(() => router.push(`/${slugFromUrl}`), 1400);
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
      <main className="mx-auto max-w-2xl px-8 py-12">
        <Link href="/admin" className="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-900">
          ← admin
        </Link>
        <h1 className="font-serif text-3xl font-medium tracking-tight">Something went wrong</h1>
        <p className="mt-3 text-sm text-red-800">{error}</p>
      </main>
    );
  }

  const failed = build?.status === "failed";

  return (
    <div className={`building-scene ${exiting ? "building-scene--exiting" : ""}`}>
      <div className="building-grid" aria-hidden />
      <div className="building-vignette" aria-hidden />

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

        {/* One SVG with a smooth gradient animation — one GPU layer total,
            instead of 48 CSS-animated divs that overwhelm the compositor and
            crashed the tab on first-pass. */}
        <svg
          className="building-wave"
          viewBox="0 0 480 56"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient id="wave-grad" x1="0" x2="1">
              <stop offset="0%" stopColor="rgba(140,180,255,0)" />
              <stop offset="50%" stopColor="rgba(140,180,255,0.95)" />
              <stop offset="100%" stopColor="rgba(140,180,255,0)" />
            </linearGradient>
          </defs>
          <path
            d="M 0 28 Q 60 4, 120 28 T 240 28 T 360 28 T 480 28"
            fill="none"
            stroke="url(#wave-grad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ animation: "wavePath 2.4s ease-in-out infinite" }}
          />
          <path
            d="M 0 28 Q 60 52, 120 28 T 240 28 T 360 28 T 480 28"
            fill="none"
            stroke="url(#wave-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.4"
            style={{ animation: "wavePath2 2.4s ease-in-out infinite reverse" }}
          />
        </svg>

        <ol className="building-steps">
          {steps.map((s, i) => (
            <li
              key={s.name}
              className={`building-step building-step--${stepState(s, i, steps, build?.status)}`}
            >
              <span className="building-step-num">{String(i + 1).padStart(2, "0")}</span>
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
  html, body { background: #0b0d12; color: #e8e6df; }
  .building-scene {
    position: fixed; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, #1a1f2b 0%, #0b0d12 60%, #06070a 100%);
    overflow: hidden;
    transition: filter 0.9s cubic-bezier(.6,.0,.2,1), transform 0.9s cubic-bezier(.6,.0,.2,1), opacity 0.9s;
  }
  .building-scene--exiting {
    opacity: 0; transform: scale(1.06); filter: blur(14px);
  }
  .building-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(ellipse at 50% 50%, black 20%, transparent 80%);
    -webkit-mask-image: radial-gradient(ellipse at 50% 50%, black 20%, transparent 80%);
    animation: gridDrift 20s linear infinite;
    will-change: transform;
  }
  .building-vignette {
    position: absolute; inset: 0;
    background:
      radial-gradient(circle at 20% 0%, rgba(120,160,255,0.08), transparent 40%),
      radial-gradient(circle at 80% 100%, rgba(255,200,120,0.06), transparent 40%);
    pointer-events: none;
  }
  .building-content {
    position: relative; z-index: 1;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 48px 24px;
    text-align: center;
  }
  .building-eyebrow {
    display: inline-flex; align-items: center; gap: 10px;
    font-family: 'Spline Sans Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(232,230,223,0.6);
    padding: 7px 16px;
    border: 1px solid rgba(232,230,223,0.14);
    border-radius: 999px;
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(6px);
  }
  .building-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #f5b94e;
    box-shadow: 0 0 10px #f5b94e, 0 0 20px rgba(245,185,78,0.5);
    animation: pulseDot 1.6s ease-in-out infinite;
  }
  .building-count { opacity: 0.5; }

  .building-brand {
    font-family: 'Newsreader', Georgia, serif;
    font-style: italic;
    font-weight: 400;
    font-size: clamp(72px, 14vw, 180px);
    line-height: 1;
    letter-spacing: -0.02em;
    margin: 28px 0 12px;
    display: flex; flex-wrap: wrap; justify-content: center;
    background: linear-gradient(180deg, #ffffff 0%, #b8bac0 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .building-char {
    display: inline-block;
    opacity: 0;
    transform: translateY(14px) rotate(-1.5deg);
    animation: charIn 0.75s cubic-bezier(.2,.65,.3,1) forwards;
  }

  .building-sub {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 20px;
    color: rgba(232,230,223,0.75);
    margin-bottom: 48px;
    min-height: 28px;
    transition: opacity 0.4s;
  }

  .building-wave {
    width: min(640px, 80vw);
    height: 56px;
    margin-bottom: 48px;
    overflow: visible;
  }
  @keyframes wavePath {
    0%, 100% { d: path("M 0 28 Q 60 8, 120 28 T 240 28 T 360 28 T 480 28"); }
    50%      { d: path("M 0 28 Q 60 48, 120 28 T 240 28 T 360 28 T 480 28"); }
  }
  @keyframes wavePath2 {
    0%, 100% { d: path("M 0 28 Q 60 44, 120 28 T 240 28 T 360 28 T 480 28"); }
    50%      { d: path("M 0 28 Q 60 12, 120 28 T 240 28 T 360 28 T 480 28"); }
  }

  .building-steps {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 10px;
    width: min(560px, 90vw);
  }
  .building-step {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
    border: 1px solid rgba(232,230,223,0.08);
    border-radius: 14px;
    background: rgba(255,255,255,0.015);
    font-family: 'Urbanist', system-ui, sans-serif;
    font-size: 14px;
    color: rgba(232,230,223,0.5);
    text-align: left;
    transition: all 0.5s cubic-bezier(.4,0,.2,1);
  }
  .building-step-num {
    font-family: 'Spline Sans Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    opacity: 0.5;
  }
  .building-step-name { font-weight: 500; }
  .building-step-time {
    font-family: 'Spline Sans Mono', monospace;
    font-size: 11px;
    opacity: 0.5;
  }
  .building-step--pending { }
  .building-step--next {
    border-color: rgba(232,230,223,0.2);
    color: rgba(232,230,223,0.75);
  }
  .building-step--running {
    border-color: rgba(140,180,255,0.6);
    background: linear-gradient(90deg, rgba(140,180,255,0.08), rgba(140,180,255,0.02));
    color: #fff;
    box-shadow: 0 0 24px rgba(140,180,255,0.15);
  }
  .building-step--running .building-step-num,
  .building-step--running .building-step-time {
    opacity: 1;
    color: rgba(140,180,255,0.9);
  }
  .building-step--done {
    border-color: rgba(144,220,160,0.3);
    color: rgba(232,230,223,0.85);
  }
  .building-step--done .building-step-num,
  .building-step--done .building-step-time {
    color: rgba(144,220,160,0.9);
    opacity: 1;
  }

  .building-foot {
    margin-top: 36px;
    font-family: 'Spline Sans Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: rgba(232,230,223,0.3);
    display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
  }
  .building-foot code {
    background: rgba(255,255,255,0.05);
    padding: 1px 6px;
    border-radius: 4px;
  }

  @keyframes charIn {
    from { opacity: 0; transform: translateY(14px) rotate(-1.5deg); }
    to   { opacity: 1; transform: translateY(0) rotate(0); }
  }
  @keyframes pulseDot {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1.4); opacity: 0.5; }
  }
  @keyframes gridDrift {
    0%   { transform: translate(0,0); }
    100% { transform: translate(44px, 44px); }
  }
`;
