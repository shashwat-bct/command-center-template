"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STORE = "cct_brands_v1";

type DataSource = "clone" | "upload" | "paste" | "backend";

type CCOPayload = {
  meta?: {
    subject?: string;
    subjectLabel?: string;
    title?: string;
    subtitle?: string;
    brandMark?: string;
  };
  [key: string]: unknown;
};

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function cloneSonosPayload(
  name: string,
  markDataURL: string | null,
): Promise<CCOPayload> {
  const r = await fetch("/sonos-command-center-data.json");
  if (!r.ok) throw new Error("Could not load the Sonos sample payload (HTTP " + r.status + ")");
  const d = (await r.json()) as CCOPayload;
  d.meta = d.meta || {};
  // Only the display label and the brand mark are swapped. The underlying
  // `subject` id stays "sonos" because every number in the payload is keyed off
  // it. Renaming the id without rewriting the keyed data makes the KPI panels
  // look up a brand that isn't in the data and fall back to "average". The
  // cloned view is clearly labelled as Sonos's data under the new brand's name.
  d.meta.subjectLabel = name;
  d.meta.title = name + " · Commercial Command Center";
  if (!d.meta.subtitle)
    d.meta.subtitle = "A quarter of continuous collection, extrapolated from the measured snapshot";
  if (markDataURL) d.meta.brandMark = markDataURL;
  else delete d.meta.brandMark;
  return d;
}

export default function AdminPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [source, setSource] = useState<DataSource>("clone");
  const [brandMarkDataURL, setBrandMarkDataURL] = useState<string | null>(null);
  const [brandMarkName, setBrandMarkName] = useState<string | null>(null);
  const [uploadedPayload, setUploadedPayload] = useState<CCOPayload | null>(null);
  const [payloadFileName, setPayloadFileName] = useState<string | null>(null);
  const [pastedJson, setPastedJson] = useState("");
  const [asinsRaw, setAsinsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brandMarkInput = useRef<HTMLInputElement>(null);
  const payloadInput = useRef<HTMLInputElement>(null);

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const onSlugChange = (v: string) => {
    setSlug(slugify(v));
    setSlugTouched(true);
  };

  const onMarkChange = async (file: File | null) => {
    if (!file) {
      setBrandMarkDataURL(null);
      setBrandMarkName(null);
      return;
    }
    setBrandMarkName(file.name);
    const url = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(file);
    });
    setBrandMarkDataURL(url);
  };

  const onPayloadFileChange = async (file: File | null) => {
    if (!file) return;
    setPayloadFileName(file.name);
    try {
      const text = await file.text();
      setUploadedPayload(JSON.parse(text) as CCOPayload);
      setError(null);
    } catch (e) {
      setError("Could not parse JSON: " + (e as Error).message);
      setUploadedPayload(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name || !slug) return setError("Brand name and slug are required.");

    setSubmitting(true);
    try {
      if (source === "backend") {
        const asins = asinsRaw
          .split(/[,\s\n]+/)
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z0-9]{10}$/.test(s));
        await runBackendBuild(slug, name, asins, router, setError, setSubmitting);
        return;
      }

      let payload: CCOPayload;
      if (source === "clone") {
        payload = await cloneSonosPayload(name, brandMarkDataURL);
      } else if (source === "upload") {
        if (!uploadedPayload) throw new Error("Choose a JSON file first.");
        payload = uploadedPayload;
      } else {
        if (!pastedJson.trim()) throw new Error("Paste a JSON payload first.");
        payload = JSON.parse(pastedJson) as CCOPayload;
      }

      if (source !== "clone") {
        payload.meta = payload.meta || {};
        payload.meta.subject = payload.meta.subject || slug;
        payload.meta.subjectLabel = payload.meta.subjectLabel || name;
        payload.meta.title = payload.meta.title || name + " · Commercial Command Center";
        if (brandMarkDataURL) payload.meta.brandMark = brandMarkDataURL;
      }

      const brands = JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, unknown>;
      brands[slug] = {
        name,
        slug,
        createdAt: new Date().toISOString(),
        brandMark: brandMarkDataURL || payload.meta?.brandMark || null,
        payload,
      };
      localStorage.setItem(STORE, JSON.stringify(brands));
      router.push(`/view/${encodeURIComponent(slug)}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-8 py-12">
      <Link href="/" className="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-900">
        ← all brands
      </Link>
      <h1 className="font-serif text-4xl font-medium tracking-tight">Add a brand</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-500">
        Spin up a command-centre dashboard for a new brand. Everything lives in your browser&apos;s localStorage — no server, no file writes. You can promote any created brand to a real file-backed page later.
      </p>

      <form onSubmit={submit} className="mt-9">
        <Section title="Brand" subtitle="What appears in the top-left of the dashboard.">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand name">
              <input
                type="text"
                required
                autoComplete="off"
                placeholder="e.g. Meta"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] focus:border-neutral-900 focus:outline-none"
              />
            </Field>
            <Field label="Slug" hint="URL-safe id. Auto-filled from the name.">
              <input
                type="text"
                required
                autoComplete="off"
                pattern="[a-z0-9-]+"
                placeholder="meta"
                value={slug}
                onChange={(e) => onSlugChange(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] focus:border-neutral-900 focus:outline-none"
              />
            </Field>
          </div>

          <Field
            label={
              <>
                Brand mark{" "}
                <span className="text-xs normal-case tracking-normal font-normal text-neutral-400">· optional</span>
              </>
            }
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => brandMarkInput.current?.click()}
                className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
              >
                Choose image
              </button>
              <input
                ref={brandMarkInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onMarkChange(e.target.files?.[0] || null)}
              />
              <span className="text-sm text-neutral-500">
                {brandMarkName ?? "no file — the text name will show instead"}
              </span>
            </div>
          </Field>
        </Section>

        <Section title="Data" subtitle="The dashboard reads a single JSON payload. Pick where it comes from.">
          <div className="inline-flex flex-wrap gap-1 rounded-xl bg-neutral-200/70 p-0.5">
            {(["clone", "upload", "paste", "backend"] as DataSource[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSource(k)}
                className={`rounded-lg px-3.5 py-2 text-sm transition ${
                  source === k ? "bg-white font-medium shadow-sm" : "text-neutral-500"
                }`}
              >
                {k === "clone" ? "Clone Sonos sample" :
                 k === "upload" ? "Upload JSON file" :
                 k === "paste" ? "Paste JSON" :
                 "Run real build (backend)"}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {source === "clone" && (
              <p className="text-xs leading-relaxed text-neutral-500">
                The dashboard will render with Sonos&apos;s real captured numbers under the new brand name. Great for a shell preview;{" "}
                <b>the numbers are Sonos&apos;s, not the new brand&apos;s</b> — swap for a real payload before showing it to anyone.
              </p>
            )}
            {source === "upload" && (
              <Field label="Payload JSON file">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => payloadInput.current?.click()}
                    className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
                  >
                    Choose JSON
                  </button>
                  <input
                    ref={payloadInput}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => onPayloadFileChange(e.target.files?.[0] || null)}
                  />
                  <span className="text-sm text-neutral-500">{payloadFileName ?? "no file"}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                  Must match the shape of <code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px]">sonos-command-center-data.json</code>.
                </p>
              </Field>
            )}
            {source === "paste" && (
              <Field label="Payload JSON">
                <textarea
                  rows={6}
                  placeholder='{ "meta": { ... }, "dims": { ... }, "scorecard": { ... }, ... }'
                  value={pastedJson}
                  onChange={(e) => setPastedJson(e.target.value)}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 font-mono text-xs focus:border-neutral-900 focus:outline-none"
                />
              </Field>
            )}
            {source === "backend" && (
              <div className="space-y-4">
                <Field
                  label={
                    <>
                      Amazon ASINs <span className="text-xs font-normal normal-case tracking-normal text-neutral-400">· optional, for real pricing + review data</span>
                    </>
                  }
                  hint="Comma- or newline-separated 10-char ASINs. We hit Keepa for each and merge the real list price, street price, discount, rating, and review volume into the subject-brand slot. Leave blank to get a pure Sonos-reference preview."
                >
                  <textarea
                    rows={3}
                    placeholder="B08SW8MBQX, B01GCGE4DW, B07PGL2N7J"
                    value={asinsRaw}
                    onChange={(e) => setAsinsRaw(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 font-mono text-[11px] focus:border-neutral-900 focus:outline-none"
                  />
                </Field>

                <div className="space-y-2 text-xs leading-relaxed text-neutral-500">
                  <p>
                    <b>Vendored brands</b> (<code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px]">sonos</code>, <code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px]">sony</code>, <code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px]">shark</code>) always run their own real builder — ASINs are ignored.
                  </p>
                  <p>
                    <b>New brands</b> get real pricing + review data from Keepa if ASINs are supplied. The dashboard&apos;s pricing + review panels become real; other panels (shelf, delivery, in-stock, AI visibility) stay as Sonos reference data with an honest disclosure.
                  </p>
                  <p>
                    Build row + log stream to <code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px]">cco_mgmt.builds</code> in BigQuery. Takes ~5–15s end-to-end (Keepa adds ~0.5s per ASIN).
                  </p>
                </div>
              </div>
            )}
          </div>
        </Section>

        <div className="mt-6 flex items-center justify-end gap-3">
          {error && <span className="text-sm text-red-700">{error}</span>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-neutral-900 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-neutral-700 disabled:bg-neutral-300"
          >
            {submitting ? "Creating…" : "Create dashboard"}
          </button>
        </div>
      </form>
    </main>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-7">
      <h2 className="font-serif text-xl font-medium">{title}</h2>
      <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

const ADMIN_TOKEN_KEY = "cct_admin_token";

async function runBackendBuild(
  slug: string,
  name: string,
  asins: string[],
  router: ReturnType<typeof useRouter>,
  setError: (msg: string) => void,
  setSubmitting: (b: boolean) => void,
) {
  // The /api endpoints require an admin token (set once in Secret Manager at
  // deploy time). Prompt once per browser session, cache in sessionStorage.
  let token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) {
    token = prompt("Admin token (set in Secret Manager as ADMIN_SHARED_SECRET):");
    if (!token) {
      setError("admin token required for backend builds");
      setSubmitting(false);
      return;
    }
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  const res = await fetch("/api/brands", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify({ slug, name, asins }),
  });
  if (res.status === 401) {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setError("admin token rejected — try again");
    setSubmitting(false);
    return;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? `backend returned ${res.status}`);
    setSubmitting(false);
    return;
  }
  const { build_id } = (await res.json()) as { build_id: string };

  // Redirect to a page that polls the build and redirects to /<slug> on done.
  router.push(`/admin/building/${build_id}?slug=${encodeURIComponent(slug)}`);
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
