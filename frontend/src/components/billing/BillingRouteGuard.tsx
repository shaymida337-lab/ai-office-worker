"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { preferredRouteForState, type BillingSubscriptionState } from "@/lib/billing/model";
import { useBilling } from "./BillingContext";

export function BillingRouteGuard({
  allowedStates,
  children,
}: {
  allowedStates: BillingSubscriptionState[];
  children: React.ReactNode;
}) {
  const { summary } = useBilling();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (allowedStates.includes(summary.status)) return;
    const fallback = preferredRouteForState(summary.status);
    if (fallback !== pathname) router.replace(fallback);
  }, [allowedStates, pathname, router, summary.status]);

  if (!allowedStates.includes(summary.status)) return null;
  return <>{children}</>;
}
