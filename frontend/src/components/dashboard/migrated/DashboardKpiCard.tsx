"use client";

export function DashboardKpiCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-[#DBE5F4] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-[#64748B]">{label}</p>
      <p className="mt-2 text-xl font-black text-[#0F172A]">{value}</p>
    </article>
  );
}
