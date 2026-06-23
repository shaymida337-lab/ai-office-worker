import type { Payment } from "@/lib/api";

export type { Payment };

export type PaymentFilterChip = "all" | "urgent" | "missing_invoice" | "duplicates" | "paid";

export type PaymentPresentation = {
  supplier: string;
  amountLabel: string;
  dueLabel: string;
  reason: string;
  typeLabel: string;
  urgent: boolean;
  primaryLabel: string;
  secondaryLabel?: string;
  showAttach: boolean;
};

export type PaymentRecommendationKind =
  | "overdue"
  | "today"
  | "tomorrow"
  | "missing_invoice"
  | "large"
  | "unpaid"
  | "all_clear";

export type PaymentRecommendation = {
  kind: PaymentRecommendationKind;
  title: string;
  reason: string;
  ctaLabel: string;
  paymentId?: string;
};

export type PaymentsSnapshotMetrics = {
  totalCount: number;
  totalAmountLabel: string;
  pendingCount: number;
};

export type PaymentsSessionStats = {
  markedPaid: number;
  attachedInvoices: number;
};
