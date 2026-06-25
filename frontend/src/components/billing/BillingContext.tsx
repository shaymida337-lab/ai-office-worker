"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BILLING_MOCK_HISTORY,
  BILLING_MOCK_PLANS,
  BILLING_MOCK_SUMMARY_BY_STATE,
  BILLING_MOCK_VALUE_METRICS,
  type BillingHistoryItem,
  type BillingPlan,
  type BillingSummary,
  type BillingSubscriptionState,
  type BillingValueMetric,
  isBillingSubscriptionState,
} from "@/lib/billing/model";

type BillingContextValue = {
  loading: boolean;
  error: string;
  empty: boolean;
  summary: BillingSummary;
  plans: BillingPlan[];
  valueMetrics: BillingValueMetric[];
  billingHistory: BillingHistoryItem[];
  selectedPlanId: BillingPlan["id"];
  setSelectedPlanId: (next: BillingPlan["id"]) => void;
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
  const queryLoading = searchParams.get("mockLoading");
  const queryError = searchParams.get("mockError");
  const queryEmpty = searchParams.get("mockEmpty");
  const [mockState, setMockStateValue] = useState<BillingSubscriptionState>(() => getInitialMockState(queryState));
  const [selectedPlanId, setSelectedPlanId] = useState<BillingPlan["id"]>("growth");

  const value = useMemo<BillingContextValue>(
    () => ({
      loading: queryLoading === "1",
      error: queryError === "1" ? "אירעה תקלה זמנית בטעינת נתוני החיוב." : "",
      empty: queryEmpty === "1",
      summary: BILLING_MOCK_SUMMARY_BY_STATE[mockState],
      plans: BILLING_MOCK_PLANS,
      valueMetrics: queryEmpty === "1" ? [] : BILLING_MOCK_VALUE_METRICS,
      billingHistory: queryEmpty === "1" ? [] : BILLING_MOCK_HISTORY,
      selectedPlanId,
      setSelectedPlanId,
      setMockState: (next) => {
        setMockStateValue(next);
        if (typeof window !== "undefined") window.localStorage.setItem(BILLING_STATE_STORAGE_KEY, next);
      },
    }),
    [mockState, queryLoading, queryError, queryEmpty, selectedPlanId]
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error("useBilling must be used within BillingProvider");
  return context;
}
