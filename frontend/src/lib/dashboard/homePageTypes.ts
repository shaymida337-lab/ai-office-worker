export type ClientSummary = {
  id: string;
  name: string;
  color: string | null;
  /** Present on GET /api/clients — used only for home “new this month” counts. */
  createdAt?: string;
  isActive?: boolean;
  stats?: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

export type ClientsResponse = {
  clients: ClientSummary[];
  totals: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

export type ScanStatus = {
  logs: Array<{
    id: string;
    type: string;
    status: string;
    found: number;
    saved: number;
    invoicesFound?: number;
    paymentsFound?: number;
    driveUploaded?: number;
    sheetsUpdated?: number;
    errors: string | null;
    windowTruncated?: boolean;
    totalMatched?: number | null;
    startedAt: string;
    endedAt: string | null;
  }>;
  last: {
    id: string;
    type: string;
    status: string;
    found: number;
    saved: number;
    invoicesFound?: number;
    paymentsFound?: number;
    driveUploaded?: number;
    sheetsUpdated?: number;
    errors: string | null;
    windowTruncated?: boolean;
    totalMatched?: number | null;
    startedAt: string;
    endedAt: string | null;
  } | null;
  nextScheduledScanAt: string;
};

export type WhatsAppAssistantStats = {
  sentToday: number;
  activeChats: number;
};

export type AccountantSummary = {
  profit: number;
  vatDue: number;
  vat?: { netVAT: number };
};

export type SystemComponentStatus = {
  name: "gmail" | "drive" | "sheets" | "whatsapp" | "database";
  label: string;
  connected: boolean;
  status: "PASS" | "FAIL";
  reason: string | null;
  details?: Record<string, unknown>;
};

export type SystemHealth = {
  checkedAt: string;
  allPassed: boolean;
  components: Record<SystemComponentStatus["name"], SystemComponentStatus>;
};

export type WhatsAppScanResult = {
  scanId: string | null;
  status: "disabled" | "started" | "running" | "completed" | "error";
  inProgress?: boolean;
  mode: string;
  progressUrl?: string;
  progressPercent?: number;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
  messagesFound: number;
  messagesScanned: number;
  mediaMessagesFound?: number;
  mediaItemsFound?: number;
  mediaItemsProcessed?: number;
  driveFilesCreated?: number;
  supplierPaymentsCreatedOrUpdated?: number;
  invoiceRecordsCreatedOrUpdated?: number;
  paymentMessagesFound: number;
  supplierPaymentsFound: number;
  errorsCount: number;
  errors: string[];
};

export type ScanToast = {
  type: "info" | "success" | "warning" | "error";
  text: string;
};

export type GmailScanSummary = {
  totalEmailsChecked?: number;
  emailsScanned: number;
  relevantEmailsFound?: number;
  invoiceOrPaymentEmailsFound: number;
  invoicesFound?: number;
  receiptsFound?: number;
  paymentRequestsFound?: number;
  recordsSaved: number;
  paymentsSaved: number;
  invoicesSaved: number;
  duplicatesSkipped: number;
  needsReviewCount?: number;
  classifiedCount?: number;
  rejectedCount?: number;
  documentsFound?: number;
  errorsCount?: number;
  emailsFetched?: number;
  emailsSaved?: number;
  clientsFound?: number;
  supplierPaymentsFound?: number;
  uploadedToDrive?: number;
  rejectedReasons?: Record<string, number>;
  windowTruncated?: boolean;
  totalMatched?: number | null;
};

export type GmailScanResult = {
  emailsProcessed?: number;
  emailsFound?: number;
  scanId?: string;
  status?: string;
  progressUrl?: string;
  paymentsCreated?: number;
  tasksCreated?: number;
  clientsCreated?: number;
  invoicesCreated?: number;
  potentialClients?: number;
  invoiceEmails?: number;
  duplicatesSkipped?: number;
  recordsSaved?: number;
  scanSteps?: string[];
  inProgress?: boolean;
  backgroundProcessing?: boolean;
  quick?: boolean;
  message?: string;
  summary?: GmailScanSummary;
};

export type ScanProgressResult = {
  scanId: string;
  status:
    | "running"
    | "queued"
    | "completed"
    | "partial"
    | "error"
    | "success"
    | "failed"
    | "cancelled"
    | "stale"
    | "timed_out"
    | "paused";
  authoritativeStatus?: "idle" | "queued" | "running" | "completed" | "failed" | "timed_out" | "cancelled";
  inProgress: boolean;
  startedAt: string;
  lastProgressAt?: string | null;
  finishedAt: string | null;
  failureReason?: string | null;
  canStartNewScan?: boolean;
  userMessageHe?: string | null;
  currentStage?: string | null;
  error: string | null;
  emailsFetched: number;
  emailsSaved: number;
  documentsFound?: number;
  invoicesFound: number;
  supplierPaymentsFound: number;
  clientsFound: number;
  uploadedToDrive: number;
  sheetsUpdated?: number;
  failedItems?: Array<{
    id: string;
    gmailMessageId: string;
    gmailMessageLink: string;
    sender: string;
    subject: string;
    documentType: string;
    decisionReason: string;
    reviewStatus: string;
    occurredAt: string;
  }>;
  finalSummary?: {
    emailsFetched: number;
    emailsSaved: number;
    invoicesFound: number;
    paymentsFound: number;
    uploadedToDrive: number;
    sheetsUpdated: number;
    failedItems: number;
    errorsCount: number;
    windowTruncated?: boolean;
    totalMatched?: number | null;
    completedAt: string;
  } | null;
  lastSuccessfulScanAt?: string | null;
  rejectedReasons: Record<string, number>;
  progressPercent?: number;
  estimatedRemainingSeconds?: number | null;
  summary?: GmailScanSummary;
  windowTruncated?: boolean;
  totalMatched?: number | null;
};

export type RecentInvoice = {
  id: string;
  amount: number | null;
  currency: string;
  date: string;
  dueDate?: string | null;
  status: string;
  reviewStatus?: string;
  source?: string;
  description: string | null;
  driveUrl: string | null;
  driveFileUrl?: string | null;
  supplierName?: string | null;
  completionReasons?: string[];
  client?: { id: string; name: string; color: string | null };
};

export type AlertItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
};

export type UpcomingAppointment = {
  id: string;
  startTime: string;
  status: string;
  client: { name: string };
  source?: "appointment" | "calendar_event";
  statusLabel?: string;
  pendingOwnerApproval?: boolean;
};

/** Slim fields from GET /api/document-reviews?view=summary (dashboard home only). */
export type DocumentReviewHomeItem = {
  id: string;
  supplierName: string | null;
  sender: string | null;
  totalAmount: number | null;
  currency: string | null;
  documentDate: string | null;
  createdAt: string;
  reviewStatus: string;
  uncertaintyReason: string | null;
  documentType: string;
};

export type DocumentReviewsHomeSummaryResponse = {
  count: number;
  items: DocumentReviewHomeItem[];
};

export type DocumentReview = {
  id: string;
  source: string;
  sender: string | null;
  subject: string | null;
  fileName: string | null;
  invoiceNumber?: string | null;
  documentDate?: string | null;
  documentType: string;
  supplierName: string | null;
  supplierTaxId?: string | null;
  totalAmount: number | null;
  currency?: string | null;
  confidenceScore: number;
  uncertaintyReason: string | null;
  parsedFieldsJson?: unknown;
  rawAnalysis?: unknown;
  driveFileUrl: string | null;
  reviewStatus: string;
  createdAt: string;
};
