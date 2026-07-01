import type { IntegrityOrgData } from "./integrityDb.js";

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
    clientId: "client-1",
    parsedFieldsJson: null,
    source: "gmail",
    createdAt: NOW,
    ...overrides,
  };
}
