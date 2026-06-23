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
  documentReviews?: NatalieDocumentReviewInput[];
  unpaidPayments?: NataliePaymentInput[];
  missingInvoices?: NataliePaymentInput[];
  openTasksCount?: number;
  upcomingAppointments?: NatalieAppointmentInput[];
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
  openTaskCount?: number;
  scanRunning?: boolean;
  gmailConnected?: boolean;
};
