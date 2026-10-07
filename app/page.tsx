import Link from "next/link";
import { Suspense } from "react";
import BrandList from "./_components/brand-list";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-muted">Atlas</p>
          <h1 className="mt-1 font-display text-4xl text-on-surface">Commercial Command Center</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-on-surface-variant">
            One dashboard per brand, measured live: every number comes from Keepa, Apify, Bright Data or Claude on the latest build, and anything unmeasured is left blank.
          </p>
        </div>
        <Link href="/admin" className="g-btn">
          <span aria-hidden className="text-lg leading-none">+</span>
          Add a brand
        </Link>
      </div>

      <section className="mt-12">
        <h2 className="mb-4 font-display text-xl text-on-surface">Brands</h2>
        <Suspense fallback={<p className="text-sm text-muted">Loading brands…</p>}>
          <BrandList />
        </Suspense>
      </section>
    </main>
  );
}
