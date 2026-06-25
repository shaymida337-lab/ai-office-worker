"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BillingPageShell, BillingPrimaryButton, BillingSecondaryLink } from "@/components/billing/ui";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingFailedPage() {
  const { loading, error, beginCheckout } = useBilling();

  return (
    <BillingRouteGuard allowedStates={["past_due", "trial", "trial_ending", "restricted", "cancelled", "paused"]}>
      <BillingPageShell tone="warm">
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && (
          <div className="grid gap-8 text-right">
            <div className="grid gap-3">
              <h2 className="text-2xl font-extrabold text-slate-900 md:text-3xl">לא הצלחתי להשלים את התשלום</h2>
              <p className="text-base leading-8 text-slate-600 md:text-lg">
                זה קורה לפעמים. המידע שלך שמור, ואפשר לנסות שוב או לעדכן אמצעי תשלום.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <BillingPrimaryButton onClick={() => void beginCheckout()}>לנסות שוב</BillingPrimaryButton>
              <BillingSecondaryLink href={BILLING_ROUTES["payment-method"]}>עדכון אמצעי תשלום</BillingSecondaryLink>
              <Link
                href={BILLING_ROUTES.plans}
                className="inline-flex min-h-[3.25rem] items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3.5 text-center text-base font-bold text-slate-800"
              >
                חזרה
              </Link>
            </div>
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
