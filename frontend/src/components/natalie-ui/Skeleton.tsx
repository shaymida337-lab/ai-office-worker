"use client";

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl bg-[#E8EDF8] dark:bg-[var(--natalie-surface-elevated,#1E293B)] ${className}`}
      aria-hidden
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-[#DBE5F4] bg-white p-4 shadow-sm" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-6 w-1/3" />
      <SkeletonText lines={3} />
    </div>
  );
}
