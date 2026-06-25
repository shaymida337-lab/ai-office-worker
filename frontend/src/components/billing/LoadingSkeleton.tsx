export function LoadingSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 h-5 w-40 rounded bg-slate-200" />
      <div className="h-4 w-72 max-w-full rounded bg-slate-100" />
    </div>
  );
}
