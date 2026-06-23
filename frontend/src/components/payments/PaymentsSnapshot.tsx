"use client";

import { CheckCircle2 } from "lucide-react";
import { colors, radius, type as typography } from "@/lib/design-tokens";
import type { PaymentsSnapshotMetrics } from "@/lib/payments/types";

export function PaymentsSnapshot({ metrics, loading = false }: { metrics: PaymentsSnapshotMetrics; loading?: boolean }) {
  if (loading) {
    return (
      <div className={`${radius.lg} h-16 animate-pulse border`} style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }} />
    );
  }

  const chips = [
    { label: `${metrics.totalCount} תשלומים` },
    { label: metrics.totalAmountLabel },
    { label: `${metrics.pendingCount} ממתינים` },
  ];

  return (
    <section aria-label="תמונת מצב שקטה">
      <div
        className={`flex flex-wrap gap-3 ${radius.lg} border px-5 py-4`}
        style={{ backgroundColor: colors.bgSoft, borderColor: colors.borderSubtle }}
      >
        {chips.map((chip) => (
          <span key={chip.label} className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: colors.textSecondary }}>
            <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} />
            {chip.label}
          </span>
        ))}
      </div>
    </section>
  );
}
