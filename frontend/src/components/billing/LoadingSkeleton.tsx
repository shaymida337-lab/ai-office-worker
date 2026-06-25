export function LoadingSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200/80 bg-white/80 p-8">
      <div className="mb-4 h-8 w-56 max-w-full rounded-xl bg-slate-200" />
      <div className="mb-6 h-5 w-full max-w-md rounded-lg bg-slate-100" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-32 rounded-2xl bg-slate-100" />
        <div className="h-32 rounded-2xl bg-slate-100" />
        <div className="h-32 rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}
