"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { preferredRouteForState } from "@/lib/billing/model";
import { useBilling } from "@/components/billing";

export default function BillingIndexPage() {
  const { summary } = useBilling();
  const router = useRouter();

  useEffect(() => {
    router.replace(preferredRouteForState(summary.status));
  }, [router, summary.status]);

  return null;
}
