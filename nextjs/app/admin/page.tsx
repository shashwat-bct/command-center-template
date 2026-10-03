"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const ADMIN_TOKEN_KEY = "cct_admin_token";

const REGIONS: Array<{ code: string; label: string; keepa: number }> = [
  { code: "US", label: "United States · amazon.com", keepa: 1 },
  { code: "UK", label: "United Kingdom · amazon.co.uk", keepa: 2 },
  { code: "DE", label: "Germany · amazon.de", keepa: 3 },
  { code: "FR", label: "France · amazon.fr", keepa: 4 },
  { code: "JP", label: "Japan · amazon.co.jp", keepa: 5 },
  { code: "CA", label: "Canada · amazon.ca", keepa: 6 },
  { code: "IT", label: "Italy · amazon.it", keepa: 8 },
  { code: "ES", label: "Spain · amazon.es", keepa: 9 },
  { code: "IN", label: "India · amazon.in", keepa: 10 },
  { code: "MX", label: "Mexico · amazon.com.mx", keepa: 11 },
];

export default function AdminPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [brandLink, setBrandLink] = useState("");
  const [region, setRegion] = useState("US");
  const [brandMarkDataURL, setBrandMarkDataURL] = useState<string | null>(null);
  const [brandMarkName, setBrandMarkName] = useState<string | null>(null);
  const [aiCategory, setAiCategory] = useState("");
  const [aiCompetitorsRaw, setAiCompetitorsRaw] = useState("");
  const [productsRaw, setProductsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brandMarkInput = useRef<HTMLInputElement>(null);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name || !slug) return setError("Brand name and slug are required.");
    if (!aiCategory.trim()) return setError("Category is required so we know what to fetch.");

    setSubmitting(true);
    try {
      const products = productsRaw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
      const aiCompetitors = aiCompetitorsRaw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
      await runBackendBuild(
        {
          slug,
          name,
          brandLink: brandLink.trim() || null,
          region,
          brandMark: brandMarkDataURL,
          aiCategory: aiCategory.trim(),
          aiCompetitors,
          products,
        },
        router,
        setError,
        setSubmitting,
      );
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
        Type a brand + category and the backend auto-discovers top products on Amazon, fetches real pricing from Keepa, live listings from Apify, and AI share-of-mind from Claude. ~90s end-to-end.
      </p>

      <form onSubmit={submit} className="mt-9" autoComplete="off" data-form-type="other">
        <Section title="Brand">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand name">
              <input
                type="text" required autoComplete="off"
                placeholder="e.g. Dyson"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] focus:border-neutral-900 focus:outline-none"
              />
            </Field>
            <Field label="Slug" hint="URL-safe id. Auto-filled.">
              <input
                type="text" required autoComplete="off" pattern="[-a-z0-9]+"
                placeholder="dyson"
                value={slug}
                onChange={(e) => onSlugChange(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] focus:border-neutral-900 focus:outline-none"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand link" hint="Where the brand lives online.">
              <input
                type="url" autoComplete="off" name="brand-link-opaque" data-lpignore="true" data-1p-ignore="true"
                placeholder="https://dyson.com"
                value={brandLink}
                onChange={(e) => setBrandLink(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] focus:border-neutral-900 focus:outline-none"
              />
            </Field>
            <Field label="Region" hint="Which Amazon marketplace Keepa + Apify should hit.">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] focus:border-neutral-900 focus:outline-none"
              >
                {REGIONS.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
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
                type="file" accept="image/*"
                className="hidden"
                onChange={(e) => onMarkChange(e.target.files?.[0] || null)}
              />
              <span className="text-sm text-neutral-500">
                {brandMarkName ?? "no file — the text name will show instead"}
              </span>
            </div>
          </Field>
        </Section>

        <Section title="What to fetch">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={
                <>
                  Category <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">required</span>
                </>
              }
              hint="What this brand sells. Drives Keepa product discovery + Claude's shopper questions."
            >
              <input
                type="text" required autoComplete="off" name="ai-category-opaque" data-lpignore="true" data-1p-ignore="true"
                placeholder="cordless vacuum"
                value={aiCategory}
                onChange={(e) => setAiCategory(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
              />
            </Field>
            <Field label="Competitor brands" hint="Comma-separated. Counted in Claude's AI share-of-mind.">
              <input
                type="text" autoComplete="off" name="ai-competitors-opaque" data-lpignore="true" data-1p-ignore="true"
                placeholder="Shark, Miele, Bissell"
                value={aiCompetitorsRaw}
                onChange={(e) => setAiCompetitorsRaw(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
              />
            </Field>
          </div>

          <Field
            label={
              <>
                Specific product names{" "}
                <span className="text-xs normal-case tracking-normal font-normal text-neutral-400">· optional</span>
              </>
            }
            hint="One per line. Backend searches Keepa for '{brand} {product}' and takes the top result. Leave blank to auto-discover top-sellers from the Category above."
          >
            <textarea
              rows={3}
              placeholder={`V15 Detect\nV12 Detect Slim\nV8 Absolute`}
              value={productsRaw}
              onChange={(e) => setProductsRaw(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </Field>

          <div className="rounded-lg bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
            <b>How this becomes real data:</b>{" "}
            Keepa searches Amazon ({REGIONS.find((r) => r.code === region)?.label.split(" · ")[1] ?? "amazon.com"}) for &quot;{(name || "Brand").trim()} {(aiCategory || "category").trim()}&quot;, picks the top ASINs by sales rank. Those feed real Keepa pricing/reviews + Apify live-Amazon fetches. Claude is asked 8 shopper questions in that category to compute real AI share-of-mind.
          </div>
        </Section>

        <div className="mt-6 flex items-center justify-end gap-3">
          {error && <span className="text-sm text-red-700">{error}</span>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-neutral-900 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-neutral-700 disabled:bg-neutral-300"
          >
            {submitting ? "Starting build…" : "Create dashboard"}
          </button>
        </div>
      </form>
    </main>
  );
}

type BackendBuildArgs = {
  slug: string;
  name: string;
  brandLink: string | null;
  region: string;
  brandMark: string | null;
  aiCategory: string;
  aiCompetitors: string[];
  products: string[];
};

async function runBackendBuild(
  args: BackendBuildArgs,
  router: ReturnType<typeof useRouter>,
  setError: (msg: string) => void,
  setSubmitting: (b: boolean) => void,
) {
  let token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) {
    token = prompt("Admin token (from Secret Manager → ADMIN_SHARED_SECRET):");
    if (!token) {
      setError("admin token required");
      setSubmitting(false);
      return;
    }
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  const res = await fetch("/api/brands", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify({
      slug: args.slug,
      name: args.name,
      brandLink: args.brandLink,
      region: args.region,
      aiCategory: args.aiCategory,
      aiCompetitors: args.aiCompetitors,
      products: args.products,
    }),
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
  router.push(`/admin/building/${build_id}?slug=${encodeURIComponent(args.slug)}`);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-7">
      <h2 className="font-serif text-xl font-medium">{title}</h2>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
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
