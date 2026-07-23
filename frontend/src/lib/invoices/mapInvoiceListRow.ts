import type { Invoice, InvoiceReviewStatus, InvoiceStatus } from "@/components/invoices/types";
import type { InvoiceListRow } from "@/lib/invoices/invoicesListStore";

/** Maps slim list rows into the existing Invoice table shape (no design change). */
export function mapInvoiceListRowToInvoice(row: InvoiceListRow): Invoice {
  const reviewStatus = (row.reviewStatus || row.status) as InvoiceReviewStatus;
  const status = (row.status || reviewStatus) as InvoiceStatus;
  return {
    id: row.id,
    clientId: row.clientId,
    invoiceNumber: row.invoiceNumber,
    amount: row.amount,
    currency: row.currency,
    date: row.issueDate || "",
    dueDate: null,
    status,
    reviewStatus,
    source: row.source,
    reviewSourceId: row.reviewSourceId,
    description: null,
    driveUrl: row.driveUrl,
    driveFileUrl: row.driveUrl,
    supplierName: row.supplierDisplayName,
    documentType: row.documentType,
    dataComplete: row.dataComplete,
    approvalRequired: row.approvalRequired,
    isComplete: row.isComplete,
    client: row.clientId
      ? { id: row.clientId, name: row.supplierDisplayName || "", color: null }
      : undefined,
  };
}
