import type { GreenInvoiceCreateDocumentParams } from "./green-invoice.js";

export const DEFAULT_DOCUMENT_TYPE = 320; // חשבונית מס/קבלה
export const DEFAULT_VAT_TYPE = 0; // ⚠️ לאמת מול הגדרות חשבון Green Invoice לפני הנפקה אמיתית
export const DEFAULT_PAYMENT_TYPE = 4; // העברה בנקאית

export type GreenInvoiceDraftInput = {
  customerName: string;
  customerEmail?: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency?: string;
  issueDate?: string;
};

export type MapDraftToGreenInvoiceOptions = {
  documentType?: number;
  language?: "he" | "en";
  vatType?: number;
  paymentType?: number;
};

function formatIssueDate(issueDate: string): string {
  const trimmed = issueDate.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString().slice(0, 10);
}

export function mapDraftToGreenInvoiceDocument(
  draft: GreenInvoiceDraftInput,
  options?: MapDraftToGreenInvoiceOptions
): GreenInvoiceCreateDocumentParams {
  const customerName = typeof draft.customerName === "string" ? draft.customerName.trim() : "";
  if (!customerName) {
    throw new Error("customerName is required");
  }

  const client: GreenInvoiceCreateDocumentParams["client"] = { name: customerName };
  const customerEmail = draft.customerEmail?.trim();
  const customerTaxId = draft.customerTaxId?.trim();
  if (customerEmail) client.email = customerEmail;
  if (customerTaxId) client.taxId = customerTaxId;

  const params: GreenInvoiceCreateDocumentParams = {
    documentType: options?.documentType ?? DEFAULT_DOCUMENT_TYPE,
    client,
    income: [
      {
        description: draft.description,
        price: draft.amount,
        quantity: 1,
        vatType: options?.vatType ?? DEFAULT_VAT_TYPE,
      },
    ],
    currency: draft.currency || "ILS",
    language: options?.language ?? "he",
  };

  if (draft.issueDate?.trim()) {
    params.date = formatIssueDate(draft.issueDate);
  }

  params.payment = [
    {
      price: draft.amount,
      type: options?.paymentType ?? DEFAULT_PAYMENT_TYPE,
      currency: draft.currency || "ILS",
      ...(params.date ? { date: params.date } : {}),
    },
  ];

  return params;
}
