export default function AdminLoading() {
  return (
    <main className="mx-auto max-w-3xl px-8 py-12" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-neutral-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-900" aria-hidden="true" />
        Loading saved inputs…
      </div>
    </main>
  );
}
