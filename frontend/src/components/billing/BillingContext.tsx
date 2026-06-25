"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BILLING_MOCK_SUMMARY_BY_STATE,
  type BillingSummary,
  type BillingSubscriptionState,
  isBillingSubscriptionState,
} from "@/lib/billing/model";

type BillingContextValue = {
  loading: boolean;
  error: string;
  summary: BillingSummary;
  setMockState: (next: BillingSubscriptionState) => void;
};

const BillingContext = createContext<BillingContextValue | null>(null);
const BILLING_STATE_STORAGE_KEY = "billing.mock.state";

function getInitialMockState(searchValue: string | null): BillingSubscriptionState {
  if (isBillingSubscriptionState(searchValue)) return searchValue;
  if (typeof window === "undefined") return "trial";
  const stored = window.localStorage.getItem(BILLING_STATE_STORAGE_KEY);
  return isBillingSubscriptionState(stored) ? stored : "trial";
}

export function BillingProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const queryState = searchParams.get("mockState");
  const [mockState, setMockStateValue] = useState<BillingSubscriptionState>(() => getInitialMockState(queryState));

  const value = useMemo<BillingContextValue>(
    () => ({
      loading: false,
      error: "",
      summary: BILLING_MOCK_SUMMARY_BY_STATE[mockState],
      setMockState: (next) => {
        setMockStateValue(next);
        if (typeof window !== "undefined") window.localStorage.setItem(BILLING_STATE_STORAGE_KEY, next);
      },
    }),
    [mockState]
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error("useBilling must be used within BillingProvider");
  return context;
}
