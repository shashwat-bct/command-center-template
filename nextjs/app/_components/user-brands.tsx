"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORE = "cct_brands_v1";

type UserBrand = { name: string; slug: string; brandMark: string | null };

function loadBrands(): Record<string, UserBrand> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, UserBrand>;
  } catch {
    return {};
  }
}

function deleteBrand(slug: string) {
  const brands = loadBrands();
  delete brands[slug];
  localStorage.setItem(STORE, JSON.stringify(brands));
}

export default function UserBrands() {
  const [brands, setBrands] = useState<Record<string, UserBrand>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setBrands(loadBrands());
  }, []);

  const slugs = Object.keys(brands);

  // Don't render anything on the server — localStorage isn't available there and
  // we'd flash the empty state before hydration if we did.
  if (!mounted) return null;

  return (
    <section className="mt-9">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-serif text-xl font-medium">Your brands</h2>
        <span className="font-mono text-xs text-neutral-400">{slugs.length}</span>
      </div>
      {slugs.length === 0 ? (
        <p className="text-sm text-neutral-400">
          None yet. Click <b>+ Add a brand</b>.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {slugs.map((slug) => {
            const b = brands[slug];
            return (
              <Link
                key={slug}
                href={`/view/${encodeURIComponent(slug)}`}
                className="group relative flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 transition hover:-translate-y-px hover:border-neutral-900"
              >
                <button
                  type="button"
                  title="Delete"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteBrand(slug);
                    setBrands(loadBrands());
                  }}
                  className="absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-red-700 group-hover:flex"
                >
                  ×
                </button>
                {b.brandMark ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.brandMark} alt="" className="h-9 w-9 object-contain" />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-neutral-900" />
                )}
                <div>
                  <div className="font-semibold">{b.name}</div>
                  <div className="font-mono text-[11px] text-neutral-500">{slug}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
