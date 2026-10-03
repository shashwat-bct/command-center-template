import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isAdminSession } from "@/lib/admin-auth";
import { savedInputsFor } from "@/lib/build-inputs";
import AdminForm from "./_components/admin-form";
import RebuildList from "./_components/rebuild-list";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]+$/;

export default async function AdminPage(props: PageProps<"/admin">) {
  const { from } = await props.searchParams;
  const slug = typeof from === "string" && SLUG_RE.test(from) ? from : null;
  const admin = isAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
  const saved = slug && admin ? await savedInputsFor(slug).catch(() => null) : null;
  const editing = slug && saved ? saved.inputs : null;

  return (
    <main className="mx-auto max-w-3xl px-8 py-12">
      <Link href="/" className="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-900">
        ← all brands
      </Link>
      <h1 className="font-serif text-4xl font-medium tracking-tight">{editing ? `Edit and rebuild ${editing.name}` : "Add a brand"}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-500">
        {editing
          ? `Pre-filled with what /${editing.slug} was last built with${saved?.source === "reconstructed" ? " (read back from its last build)" : ""}. Change anything and rebuild; the dashboard keeps its URL.`
          : "Type a brand, category and competitors. The backend finds each brand's own Amazon listings and reads 13 weeks of daily price, stock, buy box, rating and reviews (Keepa), today's product pages and delivery promise (Apify), and AI share of answer (Claude). Nothing is simulated: measures without a source are left blank."}
      </p>
      {slug && !saved && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          {admin ? `No saved inputs were found for /${slug}; fill the form to rebuild it.` : "Sign in (submit the form once) to load saved inputs."}
        </p>
      )}
      {editing && (
        <Link href="/admin" className="mt-3 inline-block text-xs font-semibold text-neutral-500 hover:text-neutral-900">+ Add a new brand instead</Link>
      )}

      <AdminForm key={slug ?? "new"} initial={editing} />

      <section className="mt-14">
        <h2 className="mb-1 font-serif text-2xl font-medium">Your brands</h2>
        <p className="mb-4 text-sm text-neutral-500">Rebuild reuses the inputs each brand was last built with. Edit opens them in the form above.</p>
        {admin ? (
          <Suspense fallback={<p className="text-sm text-neutral-500">Loading brands…</p>}>
            <RebuildList />
          </Suspense>
        ) : (
          <p className="text-sm text-neutral-500">Sign in to see and rebuild your brands.</p>
        )}
      </section>
    </main>
  );
}
