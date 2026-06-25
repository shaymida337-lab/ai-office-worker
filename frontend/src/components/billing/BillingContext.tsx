"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
import {
  createBillingCheckoutSession,
  createBillingPaymentMethodSession,
  getBillingHistory,
  getBillingPlans,
  getBillingSummary,
  getBillingValueReport,
  runBillingSubscriptionAction,
} from "@/lib/api";

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
  refresh: () => Promise<void>;
  beginCheckout: () => Promise<void>;
  beginPaymentMethodUpdate: () => Promise<void>;
  runSubscriptionAction: (action: "pause" | "cancel" | "reactivate") => Promise<void>;
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
  const useMockData = searchParams.get("mock") === "1";
  const [mockState, setMockStateValue] = useState<BillingSubscriptionState>(() => getInitialMockState(queryState));
  const [loading, setLoading] = useState(!useMockData);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<BillingSummary>(BILLING_MOCK_SUMMARY_BY_STATE[mockState]);
  const [plans, setPlans] = useState<BillingPlan[]>(BILLING_MOCK_PLANS);
  const [valueMetrics, setValueMetrics] = useState<BillingValueMetric[]>(BILLING_MOCK_VALUE_METRICS);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryItem[]>(BILLING_MOCK_HISTORY);
  const [selectedPlanId, setSelectedPlanId] = useState<BillingPlan["id"]>("growth");
  const [busyAction, setBusyAction] = useState<"" | "checkout" | "payment_method" | "subscription_action">("");

  const applyMockState = useCallback(
    (state: BillingSubscriptionState) => {
      setSummary(BILLING_MOCK_SUMMARY_BY_STATE[state]);
      setPlans(BILLING_MOCK_PLANS);
      setValueMetrics(BILLING_MOCK_VALUE_METRICS);
      setBillingHistory(BILLING_MOCK_HISTORY);
      setError("");
      setLoading(false);
    },
    []
  );

  const refresh = useCallback(async () => {
    if (useMockData) {
      applyMockState(mockState);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [summaryRes, plansRes, historyRes, valueRes] = await Promise.all([
        getBillingSummary(),
        getBillingPlans(),
        getBillingHistory(),
        getBillingValueReport(),
      ]);
      setSummary(summaryRes);
      setPlans(plansRes as BillingPlan[]);
      setBillingHistory(historyRes as BillingHistoryItem[]);
      setValueMetrics(valueRes as BillingValueMetric[]);
      if (plansRes.length > 0 && !plansRes.some((plan) => plan.id === selectedPlanId)) {
        setSelectedPlanId(plansRes[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "אירעה תקלה זמנית בטעינת נתוני החיוב.");
    } finally {
      setLoading(false);
    }
  }, [applyMockState, mockState, selectedPlanId, useMockData]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const beginCheckout = useCallback(async () => {
    if (busyAction) return;
    setBusyAction("checkout");
    setError("");
    try {
      const result = await createBillingCheckoutSession(selectedPlanId);
      if (!result.url) throw new Error("חסרה כתובת מעבר לעמוד התשלום.");
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "לא הצלחתי להתחיל תשלום.");
    } finally {
      setBusyAction("");
    }
  }, [busyAction, selectedPlanId]);

  const beginPaymentMethodUpdate = useCallback(async () => {
    if (busyAction) return;
    setBusyAction("payment_method");
    setError("");
    try {
      const result = await createBillingPaymentMethodSession();
      if (!result.url) throw new Error("חסרה כתובת לעדכון אמצעי תשלום.");
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "לא הצלחתי לפתוח עדכון אמצעי תשלום.");
    } finally {
      setBusyAction("");
    }
  }, [busyAction]);

  const runSubscriptionAction = useCallback(
    async (action: "pause" | "cancel" | "reactivate") => {
      if (busyAction) return;
      setBusyAction("subscription_action");
      setError("");
      try {
        await runBillingSubscriptionAction(action);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "פעולת המנוי נכשלה.");
      } finally {
        setBusyAction("");
      }
    },
    [busyAction, refresh]
  );

  const value = useMemo<BillingContextValue>(
    () => ({
      loading: loading || busyAction !== "",
      error,
      empty: !loading && !error && valueMetrics.length === 0 && billingHistory.length === 0,
      summary,
      plans,
      valueMetrics,
      billingHistory,
      selectedPlanId,
      setSelectedPlanId,
      refresh,
      beginCheckout,
      beginPaymentMethodUpdate,
      runSubscriptionAction,
      setMockState: (next) => {
        setMockStateValue(next);
        if (typeof window !== "undefined") window.localStorage.setItem(BILLING_STATE_STORAGE_KEY, next);
        if (useMockData) applyMockState(next);
      },
    }),
    [
      applyMockState,
      beginCheckout,
      beginPaymentMethodUpdate,
      billingHistory,
      busyAction,
      error,
      loading,
      plans,
      refresh,
      runSubscriptionAction,
      selectedPlanId,
      summary,
      useMockData,
      valueMetrics,
    ]
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error("useBilling must be used within BillingProvider");
  return context;
}
