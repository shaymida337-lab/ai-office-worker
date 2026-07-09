export type InvoicePaymentStatus = "paid" | "pending" | "overdue";
export type InvoiceReviewStatus = "approved" | "needs_review" | "rejected";
export type InvoiceStatus = InvoicePaymentStatus | "needs_review" | "rejected";

export type Invoice = {
  id: string;
  clientId: string;
  invoiceNumber: string | null;
  amount: number | null;
  amountLabel?: string;
  amountResolved?: boolean;
  currency: string;
  date: string;
  normalizedDocumentDate?: string | null;
  invoiceDate?: string | null;
  documentDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  dueDate: string | null;
  status: InvoiceStatus;
  reviewStatus?: InvoiceReviewStatus;
  source?: "invoice" | "gmail_scan_item" | "financial_document_review";
  reviewSourceId?: string | null;
  description: string | null;
  driveUrl: string | null;
  driveFileUrl?: string | null;
  gmailMessageLink?: string | null;
  supplierName?: string | null;
  decisionReason?: string | null;
  client?: { id: string; name: string; color: string | null };
};

export type ClientItem = { id: string; name: string; gmailConnected: boolean };
