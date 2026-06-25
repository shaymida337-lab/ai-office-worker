export const BILLING_SUBSCRIPTION_STATES = [
  "trial",
  "trial_ending",
  "active",
  "past_due",
  "restricted",
  "paused",
  "cancelled",
  "reactivated",
] as const;

export type BillingSubscriptionState = (typeof BILLING_SUBSCRIPTION_STATES)[number];

export type BillingSummary = {
  organizationName: string;
  planName: string | null;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
  readOnly: boolean;
  status: BillingSubscriptionState;
};

export type BillingRouteKey =
  | "trial"
  | "trial-ending"
  | "value-report"
  | "plans"
  | "checkout"
  | "success"
  | "failed"
  | "payment-method"
  | "subscription"
  | "manage"
  | "restricted"
  | "reactivate";

export const BILLING_ROUTES: Record<BillingRouteKey, string> = {
  trial: "/billing/trial",
  "trial-ending": "/billing/trial-ending",
  "value-report": "/billing/value-report",
  plans: "/billing/plans",
  checkout: "/billing/checkout",
  success: "/billing/success",
  failed: "/billing/failed",
  "payment-method": "/billing/payment-method",
  subscription: "/billing/subscription",
  manage: "/billing/manage",
  restricted: "/billing/restricted",
  reactivate: "/billing/reactivate",
};

const today = new Date();
const plusDays = (days: number) => {
  const value = new Date(today);
  value.setDate(today.getDate() + days);
  return value.toISOString();
};

export const BILLING_MOCK_SUMMARY_BY_STATE: Record<BillingSubscriptionState, BillingSummary> = {
  trial: {
    organizationName: "העסק שלי",
    planName: null,
    trialEndsAt: plusDays(14),
    nextBillingAt: null,
    readOnly: false,
    status: "trial",
  },
  trial_ending: {
    organizationName: "העסק שלי",
    planName: null,
    trialEndsAt: plusDays(2),
    nextBillingAt: null,
    readOnly: false,
    status: "trial_ending",
  },
  active: {
    organizationName: "העסק שלי",
    planName: "Growth",
    trialEndsAt: null,
    nextBillingAt: plusDays(21),
    readOnly: false,
    status: "active",
  },
  past_due: {
    organizationName: "העסק שלי",
    planName: "Growth",
    trialEndsAt: null,
    nextBillingAt: plusDays(1),
    readOnly: false,
    status: "past_due",
  },
  restricted: {
    organizationName: "העסק שלי",
    planName: "Starter",
    trialEndsAt: null,
    nextBillingAt: null,
    readOnly: true,
    status: "restricted",
  },
  paused: {
    organizationName: "העסק שלי",
    planName: "Starter",
    trialEndsAt: null,
    nextBillingAt: null,
    readOnly: true,
    status: "paused",
  },
  cancelled: {
    organizationName: "העסק שלי",
    planName: "Starter",
    trialEndsAt: null,
    nextBillingAt: null,
    readOnly: true,
    status: "cancelled",
  },
  reactivated: {
    organizationName: "העסק שלי",
    planName: "Growth",
    trialEndsAt: null,
    nextBillingAt: plusDays(30),
    readOnly: false,
    status: "reactivated",
  },
};

export function isBillingSubscriptionState(value: string | null): value is BillingSubscriptionState {
  return !!value && (BILLING_SUBSCRIPTION_STATES as readonly string[]).includes(value);
}

export function preferredRouteForState(state: BillingSubscriptionState): string {
  switch (state) {
    case "trial":
      return BILLING_ROUTES.trial;
    case "trial_ending":
      return BILLING_ROUTES["trial-ending"];
    case "active":
    case "reactivated":
      return BILLING_ROUTES.subscription;
    case "past_due":
      return BILLING_ROUTES.failed;
    case "restricted":
    case "paused":
    case "cancelled":
      return BILLING_ROUTES.restricted;
    default:
      return BILLING_ROUTES.trial;
  }
}
