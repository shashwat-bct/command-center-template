import Link from "next/link";
import Image from "next/image";
import UserBrands from "./_components/user-brands";

// File-backed brands — one dashboard per entry here, with a committed
// JSON payload in /public and a /<slug> dashboard route. Add a brand by
// adding its row + payload + brand mark.
const BUILTINS = [
  { slug: "sonos", name: "Sonos", mark: "/brand-marks/sonos.png", note: "base · file-backed" },
] as const;

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-8 py-12">
      <div className="w-full max-w-3xl">
        <h1 className="font-serif text-5xl font-medium tracking-tight">Commercial Command Center</h1>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-neutral-500">
          Standalone template of the Atlas command-centre dashboard. Each brand is one page plus one JSON data payload — the shell is shared.
        </p>

        <Link
          href="/admin"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-700"
        >
          + Add a brand
        </Link>

        <section className="mt-9">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-serif text-xl font-medium">Built-in</h2>
            <span className="font-mono text-xs text-neutral-400">{BUILTINS.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {BUILTINS.map((b) => (
              <Link
                key={b.slug}
                href={`/${b.slug}`}
                className="group flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 transition hover:-translate-y-px hover:border-neutral-900"
              >
                <Image src={b.mark} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
                <div>
                  <div className="font-semibold">{b.name}</div>
                  <div className="font-mono text-[11px] text-neutral-500">{b.note}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <UserBrands />

        <p className="mt-10 text-xs leading-relaxed text-neutral-500">
          File-backed brands live on disk. localStorage brands live in your browser and only this computer sees them.
        </p>
      </div>
    </main>
  );
}
