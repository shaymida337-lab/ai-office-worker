/** Project Phoenix — Natalie presentation models (customer-facing only). */

export type NatalieScreen =
  | "today"
  | "documents"
  | "payments"
  | "calendar"
  | "tasks"
  | "clients"
  | "invoices";

export type NatalieBriefingItem = {
  id: string;
  text: string;
};

export type NataliePrimaryActionModel = {
  label: string;
  intent: string;
  href?: string;
  disabled?: boolean;
  reason?: string;
};

export type NatalieBriefing = {
  greeting: string;
  summary: string;
  completedItems: NatalieBriefingItem[];
  pendingItems: NatalieBriefingItem[];
  primaryAction: NataliePrimaryActionModel;
  suggestedQuestions: string[];
};

export type NatalieTimelineItem = {
  id: string;
  text: string;
  occurredAt?: string;
  kind?: NatalieActivityInput["kind"];
};

export type NatalieQuietSummaryChip = {
  id: string;
  label: string;
  value: string;
};

export type NatalieCopyContext = {
  supplierName?: string | null;
  amount?: number | null;
  currency?: string | null;
  documentType?: string | null;
  clientName?: string | null;
  meetingTime?: string | null;
  count?: number;
  uncertaintyReason?: string | null;
};

export type NatalieDocumentReviewInput = {
  id: string;
  supplierName?: string | null;
  reviewStatus?: string | null;
  uncertaintyReason?: string | null;
  documentType?: string | null;
  totalAmount?: number | null;
  currency?: string | null;
};

export type NataliePaymentInput = {
  id: string;
  supplier?: string | null;
  paid?: boolean;
  missingInvoice?: boolean;
  amount?: number;
  currency?: string;
};

export type NatalieAppointmentInput = {
  id: string;
  clientName?: string | null;
  startTime: string;
  status?: string | null;
  source?: "appointment" | "calendar_event";
  statusLabel?: string;
  pendingOwnerApproval?: boolean;
};

export type NatalieSchedulingDecisionInput = {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  reason?: string | null;
  calendarEventId?: string | null;
  createdAt: string;
  href: string;
};

export type NatalieActivityInput = {
  id: string;
  kind: "invoice_saved" | "payment_prepared" | "payment_paid" | "task_created" | "appointment_scheduled" | "email_checked" | "document_review" | "scan_completed";
  supplierName?: string | null;
  clientName?: string | null;
  amount?: number | null;
  currency?: string | null;
  occurredAt?: string | null;
  title?: string | null;
};

export type NatalieBriefingInput = {
  screen: NatalieScreen;
  ownerFirstName?: string | null;
  now?: Date;
  gmailConnected?: boolean;
  scanRunning?: boolean;
  scanStale?: boolean;
  scanBacklog?: boolean;
  documentReviews?: NatalieDocumentReviewInput[];
  unpaidPayments?: NataliePaymentInput[];
  missingInvoices?: NataliePaymentInput[];
  openTasksCount?: number;
  upcomingAppointments?: NatalieAppointmentInput[];
  pendingSchedulingDecisions?: NatalieSchedulingDecisionInput[];
  schedulingTodaySummary?: {
    todayCompletedCount?: number;
    todayNoShowCount?: number;
    todayCancelledCount?: number;
  };
  recentActivity?: NatalieActivityInput[];
  emailsChecked?: number;
  invoicesSaved?: number;
  paymentsPrepared?: number;
};

export type NataliePrimaryActionInput = {
  screen: NatalieScreen;
  documentReviewCount?: number;
  unpaidPaymentCount?: number;
  missingInvoiceCount?: number;
  pendingAppointmentCount?: number;
  pendingSchedulingDecisionCount?: number;
  primarySchedulingDecisionHref?: string;
  openTaskCount?: number;
  scanRunning?: boolean;
  gmailConnected?: boolean;
};

export type NatalieRecommendationKind =
  | "blocked_review"
  | "urgent_payment"
  | "document_review"
  | "missing_invoice"
  | "appointment"
  | "open_tasks"
  | "connect_gmail"
  | "all_clear";

export type NatalieRecommendation = {
  kind: NatalieRecommendationKind;
  title: string;
  reason: string;
  ctaLabel: string;
  href?: string;
  scrollToDecisions?: boolean;
  emotionalNote?: string;
};

export type NatalieRecommendationInput = {
  now?: Date;
  gmailConnected?: boolean;
  documentReviews?: NatalieDocumentReviewInput[];
  unpaidPayments?: Array<NataliePaymentInput & { date?: string | null }>;
  missingInvoices?: Array<NataliePaymentInput & { date?: string | null }>;
  upcomingAppointments?: NatalieAppointmentInput[];
  pendingSchedulingDecisions?: NatalieSchedulingDecisionInput[];
  openTasksCount?: number;
  alerts?: Array<{ id: string; type: string; title: string }>;
  invoicesSaved?: number;
  paymentsPrepared?: number;
  pendingDecisionCount?: number;
  scanRunning?: boolean;
  scanStale?: boolean;
  scanBacklog?: boolean;
};
