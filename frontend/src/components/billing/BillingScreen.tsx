"use client";

import type { BillingSubscriptionState } from "@/lib/billing/model";
import { useBilling } from "./BillingContext";
import { BillingRouteGuard } from "./BillingRouteGuard";
import { InlineErrorCard } from "./InlineErrorCard";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { PlanCard } from "./PlanCard";

export function BillingScreen({
  title,
  description,
  allowedStates,
  showPlanCards = false,
}: {
  title: string;
  description: string;
  allowedStates: BillingSubscriptionState[];
  showPlanCards?: boolean;
}) {
  const { loading, error } = useBilling();
  return (
    <BillingRouteGuard allowedStates={allowedStates}>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-700">{description}</p>
        {loading && <div className="mt-4"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-4"><InlineErrorCard message={error} /></div>}
        {showPlanCards && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <PlanCard
              plan={{
                id: "starter",
                name: "Starter",
                priceMonthly: 149,
                description: "מסך Placeholder",
                highlights: ["ללא אינטגרציה בספרינט זה"],
              }}
            />
            <PlanCard
              plan={{
                id: "growth",
                name: "Growth",
                priceMonthly: 199,
                description: "מסך Placeholder",
                highlights: ["ללא אינטגרציה בספרינט זה"],
                recommended: true,
              }}
            />
          </div>
        )}
      </section>
    </BillingRouteGuard>
  );
}
