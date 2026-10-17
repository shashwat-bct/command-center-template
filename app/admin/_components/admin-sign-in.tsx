"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AdminSignIn() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(res?.status === 401 ? "That token is not valid." : "Could not sign in. Try again.");
      setBusy(false);
      return;
    }
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="font-display text-3xl text-on-surface">Admin sign in</h1>
      <p className="mt-2 text-[14px] text-on-surface-variant">Enter the admin token to create, edit and rebuild brands.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <input
          type="password"
          autoFocus
          required
          autoComplete="current-password"
          placeholder="Admin token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="g-input"
        />
        {error && <span className="text-sm text-[#c5221f]">{error}</span>}
        <button type="submit" disabled={busy || !token.trim()} className="g-btn h-10 px-5 text-[14px]">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
