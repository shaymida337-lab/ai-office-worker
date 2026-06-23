"use client";

import type { Payment } from "@/lib/api";
import { colors, type as typography } from "@/lib/design-tokens";
import { PaymentDecisionCard } from "./PaymentDecisionCard";

const MAX_VISIBLE = 5;

export function PaymentDecisionQueue({
  payments,
  totalCount,
  exitingIds,
  updatingId,
  onMarkPaid,
  onAttach,
  onPreview,
}: {
  payments: Payment[];
  totalCount: number;
  exitingIds: Set<string>;
  updatingId: string | null;
  onMarkPaid: (id: string) => void;
  onAttach: (id: string) => void;
  onPreview: (url: string) => void;
}) {
  const visible = payments.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, totalCount - visible.length);

  if (payments.length === 0) return null;

  return (
    <section id="payments-decisions" className="grid gap-4" aria-label="תור תשלומים">
      <div>
        <h2 className={`${typography.sectionTitle} leading-snug`} style={{ color: colors.textPrimary }}>
          מה כדאי לסגור עכשיו
        </h2>
        <p className={`${typography.body} mt-1`} style={{ color: colors.textSecondary }}>
          {totalCount === 1 ? "תשלום אחד מחכה לך" : `${totalCount} תשלומים מחכים לך`}
        </p>
      </div>

      <div className="grid gap-3">
        {visible.map((payment) => (
          <PaymentDecisionCard
            key={payment.id}
            payment={payment}
            exiting={exitingIds.has(payment.id)}
            updating={updatingId === payment.id}
            onMarkPaid={onMarkPaid}
            onAttach={onAttach}
            onPreview={onPreview}
          />
        ))}
      </div>

      {hidden > 0 && (
        <p className={`${typography.body} text-center font-semibold`} style={{ color: colors.textSecondary }}>
          ועוד {hidden} {hidden === 1 ? "תשלום" : "תשלומים"} בתור
        </p>
      )}
    </section>
  );
}
