import type { IntegrityOrgData } from "./integrityDb.js";
import type { IntegrityEmailAttachmentRow } from "./integrityDb.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");

export function emptyIntegrityOrgData(overrides: Partial<IntegrityOrgData> = {}): IntegrityOrgData {
  return {
    organizationId: "org-test",
    now: NOW,
    stuckActiveScans: [],
    supplierPayments: [],
    invoices: [],
    gmailScanItems: [],
    financialDocumentReviews: [],
    emailMessages: [],
    emailAttachmentsByEmailId: new Map(),
    siblingArtifactsByGmailId: new Map(),
    crossOrgEmailMessages: [],
    gmailIntegration: null,
    organizationUserEmail: "user@example.com",
    payments: [],
    invoiceDetails: [],
    integrations: [],
    emailIds: new Set(),
    gmailMessageIds: new Set(),
    gsiGmailIds: new Set(),
    fdrGmailIds: new Set(),
    ...overrides,
  };
}

export function emailRow(
  overrides: Partial<IntegrityOrgData["emailMessages"][number]> = {},
): IntegrityOrgData["emailMessages"][number] {
  return {
    id: "em-1",
    gmailId: "g-1",
    receivedAt: new Date("2026-05-01T10:00:00.000Z"),
    subject: "חשבונית",
    fromAddress: "vendor@example.com",
    processedAt: new Date("2026-05-01T11:00:00.000Z"),
    ...overrides,
  };
}

export function attachmentRow(
  overrides: Partial<IntegrityEmailAttachmentRow> = {},
): IntegrityEmailAttachmentRow {
  return {
    emailMessageId: "em-1",
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    ...overrides,
  };
}

export function paymentRow(
  overrides: Partial<IntegrityOrgData["payments"][number]> = {},
): IntegrityOrgData["payments"][number] {
  return {
    id: "pay-1",
    supplier: "Acme",
    supplierName: "Acme Ltd",
    amount: 100,
    totalAmount: 100,
    currency: "ILS",
    documentFingerprint: null,
    emailMessageId: "email-1",
    documentLink: null,
    driveFileId: null,
    duplicateDetected: false,
    duplicateHash: null,
    duplicateReason: null,
    approvalStatus: "approved",
    clientId: "client-1",
    parsedFieldsJson: null,
    source: "gmail",
    createdAt: NOW,
    ...overrides,
  };
}
