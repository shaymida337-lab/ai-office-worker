import type { Invoice } from "@/components/invoices";
import type { CompletionListRow } from "@/lib/invoiceCompletion/completionListStore";

const MISSING_REASON_BY_KEY: Record<string, string> = {
  supplier: "ספק לא זוהה",
  amount: "חסר סכום",
  date: "חסר תאריך",
  currency: "מטבע חסר",
  documentType: "סוג מסמך חסר",
};

/** Map slim completion list row → Invoice shape used by existing action UI. */
export function completionRowToInvoice(row: CompletionListRow): Invoice {
  const missingDataReasons = (row.missingFields ?? [])
    .map((key) => MISSING_REASON_BY_KEY[key])
    .filter((value): value is string => Boolean(value));

  return {
    id: row.id,
    clientId: row.clientId || "",
    invoiceNumber: row.invoiceNumber,
    amount: row.amount,
    currency: row.currency || "ILS",
    date: row.issueDate || row.createdAt || "",
    dueDate: null,
    status: (row.reviewStatus as Invoice["status"]) || "needs_review",
    reviewStatus: (row.reviewStatus as Invoice["reviewStatus"]) || "needs_review",
    source: row.source,
    reviewSourceId: row.reviewSourceId,
    description: null,
    driveUrl: row.driveUrl,
    driveFileUrl: row.driveUrl,
    supplierName: row.supplierDisplayName,
    documentType: row.documentType,
    dataComplete: row.dataComplete,
    approvalRequired: row.approvalRequired,
    isComplete: false,
    missingDataReasons,
    canApproveDirectly: row.canApproveDirectly,
    supplierNeedsConfirmation: row.supplierNeedsConfirmation,
    approvalBlockReason: row.approvalBlockReason ?? null,
    createdAt: row.createdAt,
  };
}

export function invoiceToCompletionRow(invoice: Invoice): CompletionListRow {
  const missingFields: string[] = [];
  for (const reason of invoice.missingDataReasons ?? []) {
    if (reason.includes("ספק")) missingFields.push("supplier");
    else if (reason.includes("סכום")) missingFields.push("amount");
    else if (reason.includes("תאריך")) missingFields.push("date");
    else if (reason.includes("מטבע")) missingFields.push("currency");
    else if (reason.includes("סוג מסמך")) missingFields.push("documentType");
  }
  return {
    id: invoice.id,
    supplierDisplayName: invoice.supplierName ?? null,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.date || null,
    amount: invoice.amount,
    currency: invoice.currency || "ILS",
    reviewStatus: invoice.reviewStatus || String(invoice.status),
    missingFields,
    source: invoice.source || "financial_document_review",
    hasAttachment: Boolean(invoice.driveUrl || invoice.driveFileUrl),
    createdAt: invoice.createdAt ?? null,
    clientId: invoice.clientId || "",
    documentType: invoice.documentType ?? null,
    driveUrl: invoice.driveUrl || invoice.driveFileUrl || null,
    dataComplete: invoice.dataComplete ?? false,
    approvalRequired: invoice.approvalRequired ?? true,
    canApproveDirectly: invoice.canApproveDirectly,
    supplierNeedsConfirmation: invoice.supplierNeedsConfirmation,
    approvalBlockReason: invoice.approvalBlockReason ?? null,
    reviewSourceId: invoice.reviewSourceId ?? null,
    status: String(invoice.status),
  };
}
