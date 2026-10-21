"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "../_lib/admin-fetch";

export default function RebuildButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "starting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reuseAi, setReuseAi] = useState(true);

  const start = async () => {
    setState("starting");
    setError(null);
    const res = await adminFetch(`/api/brands/${encodeURIComponent(slug)}/rebuild`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reuse_ai: reuseAi }),
    });
    const body = (await res.json().catch(() => ({}))) as { build_id?: string; error?: string };
    if (!res.ok || !body.build_id) {
      setError(body.error ?? `failed (${res.status})`);
      setState("idle");
      return;
    }
    router.push(`/admin/building/${body.build_id}?slug=${encodeURIComponent(slug)}`);
  };

  if (state === "confirm") {
    return (
      <span className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-muted" title="Use the AI answers and analysis saved from the last build instead of calling the AI engines again">
          <input type="checkbox" checked={reuseAi} onChange={(e) => setReuseAi(e.target.checked)} className="h-4 w-4 accent-current" />
          Reuse saved AI results
        </label>
        <button type="button" onClick={start} className="g-btn h-9 px-4 text-[13px]">
          Confirm · ~100 Keepa tokens
        </button>
        <button type="button" onClick={() => setState("idle")} className="g-btn-text">Cancel</button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      {error && <span className="max-w-56 truncate text-xs text-[#c5221f]" title={error}>{error}</span>}
      <button
        type="button"
        disabled={state === "starting"}
        onClick={() => setState("confirm")}
        className="g-btn-outline"
      >
        {state === "starting" ? "Starting…" : "Rebuild"}
      </button>
    </span>
  );
}
