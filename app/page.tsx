import Link from "next/link";
import { Suspense } from "react";
import BrandList from "./_components/brand-list";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-8 py-12">
      <div className="w-full max-w-3xl">
        <h1 className="font-serif text-5xl font-medium tracking-tight">Commercial Command Center</h1>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-neutral-500">
          One dashboard per brand, measured live: every number comes from Keepa, Apify or Claude on the latest build, and anything unmeasured is left blank.
        </p>

        <Link
          href="/admin"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-700"
        >
          + Add a brand
        </Link>

        <section className="mt-9">
          <h2 className="mb-3 font-serif text-xl font-medium">Brands</h2>
          <Suspense fallback={<p className="text-sm text-neutral-500">Loading brands…</p>}>
            <BrandList />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
