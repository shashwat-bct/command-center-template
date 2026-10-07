export default function AdminLoading() {
  return (
    <main className="mx-auto max-w-3xl px-8 py-12" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="h-5 w-5 animate-spin rounded-full border-[3px] border-primary-container border-t-primary" aria-hidden="true" />
        Loading saved inputs…
      </div>
    </main>
  );
}
