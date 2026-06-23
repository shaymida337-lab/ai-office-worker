"use client";

import { CreditCard, ExternalLink } from "lucide-react";
import type { Payment } from "@/lib/api";
import { presentPayment } from "@/lib/payments/presentation";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";

export function PaymentDecisionCard({
  payment,
  exiting = false,
  updating = false,
  onMarkPaid,
  onAttach,
  onPreview,
}: {
  payment: Payment;
  exiting?: boolean;
  updating?: boolean;
  onMarkPaid: (id: string) => void;
  onAttach: (id: string) => void;
  onPreview: (url: string) => void;
}) {
  const view = presentPayment(payment);
  const docUrl = payment.invoiceLink ?? payment.documentLink;

  function handlePrimary() {
    if (view.showAttach || view.primaryLabel === "צרפי חשבונית") {
      onAttach(payment.id);
      return;
    }
    if (view.primaryLabel === "פתחי מסמך" && docUrl) {
      onPreview(docUrl);
      return;
    }
    onMarkPaid(payment.id);
  }

  function handleSecondary() {
    if (docUrl) onPreview(docUrl);
  }

  return (
    <article
      className={`${radius.lg} border transition-all duration-300 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 ${
        exiting ? "pointer-events-none translate-x-4 opacity-0 scale-[0.98]" : ""
      }`}
      style={{
        backgroundColor: colors.surface,
        borderColor: view.urgent ? colors.warnBorder : colors.borderSubtle,
        boxShadow: "0 6px 24px rgba(15,23,42,0.05)",
      }}
    >
      <div className="flex flex-col gap-4 p-5 md:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
            style={{
              backgroundColor: view.urgent ? colors.warnBg : colors.accentSoft,
              color: view.urgent ? colors.warnText : colors.accent,
            }}
          >
            <CreditCard className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`${radius.pill} px-2.5 py-1 text-xs font-bold`}
                style={{
                  backgroundColor: view.urgent ? colors.warnBg : colors.bgSoft,
                  color: view.urgent ? colors.warnText : colors.textMuted,
                }}
              >
                {view.typeLabel}
              </span>
            </div>
            <h3 className={`${typography.cardTitle} mt-2 break-words`} style={{ color: colors.textPrimary }}>
              {view.supplier}
            </h3>
            <p className={`${typography.kpiValue} mt-2 text-[28px] md:text-[32px]`} style={{ color: colors.accent }}>
              {view.amountLabel}
            </p>
            <p className={`${typography.caption} mt-1 font-semibold`} style={{ color: colors.textMuted }}>
              לתשלום עד {view.dueLabel}
            </p>
            <p className={`${typography.body} mt-3 leading-7`} style={{ color: colors.textSecondary }}>
              {view.reason}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={updating || exiting || payment.paid}
            onClick={handlePrimary}
            className={`${radius.control} ${button.primary} w-full sm:w-auto`}
            style={{
              backgroundColor: colors.accent,
              border: `1px solid ${colors.accent}`,
              color: colors.surface,
            }}
          >
            {updating ? "מעדכנת..." : view.primaryLabel}
          </button>
          {docUrl && view.secondaryLabel && (
            <button
              type="button"
              disabled={updating || exiting}
              onClick={handleSecondary}
              className={`${radius.control} ${button.secondary} inline-flex w-full items-center justify-center gap-2 sm:w-auto`}
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.textSecondary,
              }}
            >
              <ExternalLink className="h-4 w-4" />
              {view.secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
