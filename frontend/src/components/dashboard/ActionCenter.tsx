"use client";

import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  CreditCard,
  FileSearch,
  FileText,
} from "lucide-react";
import { DecisionCard } from "./DecisionCard";
import { colors, type as typography } from "@/lib/design-tokens";
import type { DecisionCardData, DecisionKind } from "@/lib/dashboard/decisions";
import type { LucideIcon } from "lucide-react";

const kindIcons: Record<DecisionKind, LucideIcon> = {
  urgent_payment: CreditCard,
  payment: CreditCard,
  blocked_review: FileSearch,
  document_review: FileText,
  missing_invoice: FileText,
  appointment: Calendar,
  alert: AlertTriangle,
};

export function ActionCenter({
  items,
  totalCount,
  loading = false,
  onMarkPaid,
  onAttachInvoice,
  onRetry,
}: {
  items: DecisionCardData[];
  totalCount: number;
  loading?: boolean;
  onMarkPaid: (paymentId: string) => void;
  onAttachInvoice: (paymentId: string) => void;
  onRetry: () => void;
}) {
  const router = useRouter();
  const remaining = totalCount - items.length;

  if (loading) {
    return (
      <section id="natalie-decisions" className="grid gap-2" aria-label="מרכז ההחלטות">
        <SectionHeader />
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border"
            style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
          />
        ))}
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section id="natalie-decisions" className="grid gap-2" aria-label="מרכז ההחלטות">
        <SectionHeader count={0} />
        <div className="rounded-xl border px-4 py-3 text-center" style={{ backgroundColor: colors.bgSoft, borderColor: colors.borderSubtle }}>
          <p className={`${typography.body} text-sm font-semibold`} style={{ color: colors.textSecondary }}>
            כרגע אין משהו שדורש החלטה — הכול מסודר.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="natalie-decisions" className="grid gap-2 md:gap-3" aria-label="מרכז ההחלטות">
      <SectionHeader count={totalCount} />

      <div className="grid gap-2">
        {items.map((item, index) => {
          const Icon = kindIcons[item.kind];
          return (
            <DecisionCard
              key={item.id}
              kind={item.kind}
              icon={Icon}
              typeLabel={item.typeLabel}
              title={item.title}
              description={item.description}
              meta={item.meta}
              urgent={item.urgent}
              primaryLabel={item.primaryLabel}
              briefingMode
              emphasized={index === 0 && item.urgent}
              onPrimary={() => handlePrimary(item, router, onMarkPaid, onAttachInvoice, onRetry)}
            />
          );
        })}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => router.push("/dashboard/document-reviews")}
          className="py-2 text-sm font-bold underline-offset-2 hover:underline"
          style={{ color: colors.accent }}
        >
          ועוד {remaining} {remaining === 1 ? "החלטה" : "החלטות"}
        </button>
      )}
    </section>
  );
}

function SectionHeader({ count }: { count?: number }) {
  return (
    <div>
      <h2 className="text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        מרכז ההחלטות
      </h2>
      {count != null && count > 0 && (
        <p className="mt-0.5 hidden text-sm md:block" style={{ color: colors.textSecondary }}>
          {count === 1 ? "דבר אחד שצריך את ההחלטה שלך" : `${count} דברים שצריכים את ההחלטה שלך`}
        </p>
      )}
    </div>
  );
}

function handlePrimary(
  item: DecisionCardData,
  router: ReturnType<typeof useRouter>,
  onMarkPaid: (id: string) => void,
  onAttachInvoice: (id: string) => void,
  onRetry: () => void
) {
  if (item.kind === "missing_invoice" && item.paymentId) {
    onAttachInvoice(item.paymentId);
    return;
  }
  if ((item.kind === "urgent_payment" || item.kind === "payment") && item.paymentId) {
    onMarkPaid(item.paymentId);
    return;
  }
  if (item.kind === "alert") {
    onRetry();
    return;
  }
  if (item.href) {
    router.push(item.href);
  }
}

function handleSecondary(
  item: DecisionCardData,
  router: ReturnType<typeof useRouter>,
  onAttachInvoice: (id: string) => void
) {
  if (item.kind === "missing_invoice" && item.paymentId) {
    router.push("/payments");
    return;
  }
  if (item.href) {
    router.push(item.href);
  }
}
