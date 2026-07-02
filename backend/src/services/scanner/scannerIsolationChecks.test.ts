import test from "node:test";
import assert from "node:assert/strict";

import { GMAIL_SCAN_STALE_MS } from "../gmailScanLifecycle.js";
import {
  detectAutoSavedWithoutAttachmentViolations,
  detectBlockedOutcomePersistedViolations,
  detectCrossOrgGmailMessageIdViolations,
  detectDriveLinkInvoiceConfusionViolations,
  detectDuplicateSupplierPaymentViolations,
  detectFdrWithoutGsiViolations,
  detectGmailMailboxMismatchViolations,
  detectStuckActiveScanViolations,
  fetchScannerIsolationViolations,
  runScannerIsolationChecks,
  type ScannerIsolationCheckData,
  type ScannerIsolationDb,
} from "./scannerIsolationChecks.js";

const ORG_ID = "org-isolation-test";
const NOW = new Date("2026-07-01T15:00:00.000Z");

function baseData(overrides: Partial<ScannerIsolationCheckData> = {}): ScannerIsolationCheckData {
  return {
    organizationId: ORG_ID,
    stuckActiveScans: [],
    supplierPayments: [],
    invoices: [],
    gmailScanItems: [],
    financialDocumentReviews: [],
    emailMessages: [],
    crossOrgEmailMessages: [],
    gmailIntegration: null,
    organizationUserEmail: null,
    ...overrides,
  };
}

test("empty org returns no violations", () => {
  const violations = runScannerIsolationChecks(baseData());
  assert.equal(violations.length, 0);
});

test("detectStuckActiveScanViolations flags active scan older than stale threshold", () => {
  const violations = detectStuckActiveScanViolations(
    ORG_ID,
    [
      {
        id: "scan-stuck",
        status: "running",
        startedAt: new Date(NOW.getTime() - GMAIL_SCAN_STALE_MS - 60_000),
      },
    ],
    NOW,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "stuck_active_scan");
  assert.equal(violations[0]?.severity, "critical");
});

test("detectDuplicateSupplierPaymentViolations flags duplicate documentFingerprint", () => {
  const violations = detectDuplicateSupplierPaymentViolations(ORG_ID, [
    { id: "pay-1", documentFingerprint: "fp-abc", emailMessageId: null, createdAt: NOW },
    { id: "pay-2", documentFingerprint: "fp-abc", emailMessageId: null, createdAt: NOW },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "duplicate_supplier_payment_fingerprint");
  assert.deepEqual(violations[0]?.affectedIds.sort(), ["pay-1", "pay-2"]);
});

test("detectBlockedOutcomePersistedViolations flags blocked FDR with linked payment", () => {
  const violations = detectBlockedOutcomePersistedViolations(
    ORG_ID,
    [
      {
        id: "fdr-1",
        source: "gmail",
        gmailMessageId: "gmail-1",
        reviewStatus: "needs_review",
        uncertaintyReason: "outcome_BLOCKED:OE_TRUST_BLOCKED",
        documentFingerprint: "fp-blocked",
        supplierPaymentId: "pay-1",
        parsedFieldsJson: { outcome: { status: "BLOCKED" } },
        createdAt: NOW,
      },
    ],
    [],
    [
      {
        id: "pay-1",
        documentFingerprint: "fp-blocked",
        emailMessageId: "em-1",
        approvalStatus: "approved",
        createdAt: NOW,
      },
    ],
    [],
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "blocked_outcome_persisted");
});

test("detectBlockedOutcomePersistedViolations ignores rejected payments linked by fingerprint", () => {
  const violations = detectBlockedOutcomePersistedViolations(
    ORG_ID,
    [
      {
        id: "fdr-1",
        source: "gmail",
        gmailMessageId: "gmail-1",
        reviewStatus: "needs_review",
        uncertaintyReason: "outcome_BLOCKED:OE_TRUST_BLOCKED",
        documentFingerprint: "fp-blocked",
        supplierPaymentId: null,
        parsedFieldsJson: { outcome: { status: "BLOCKED" } },
        createdAt: NOW,
      },
    ],
    [],
    [
      {
        id: "pay-rejected",
        documentFingerprint: "fp-blocked",
        emailMessageId: "em-1",
        approvalStatus: "rejected",
        createdAt: NOW,
      },
    ],
    [],
  );
  assert.equal(violations.length, 0);
});

test("detectAutoSavedWithoutAttachmentViolations flags auto_saved without attachment evidence", () => {
  const violations = detectAutoSavedWithoutAttachmentViolations(ORG_ID, [
    {
      id: "gsi-1",
      gmailMessageId: "gmail-1",
      reviewStatus: "auto_saved",
      documentType: "invoice",
      attachmentFilename: null,
      driveFileLink: null,
      amount: 100,
      decisionReason: "Auto-saved",
      parsedFieldsJson: null,
      rawAnalysis: { hasAttachment: false },
      createdAt: NOW,
    },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "auto_saved_without_attachment");
});

test("detectDriveLinkInvoiceConfusionViolations flags drive-link-only missing amount confusion", () => {
  const violations = detectDriveLinkInvoiceConfusionViolations(ORG_ID, [
    {
      id: "gsi-drive",
      gmailMessageId: "gmail-drive",
      reviewStatus: "needs_review",
      documentType: "invoice",
      attachmentFilename: null,
      driveFileLink: "https://drive.google.com/open?id=abc",
      amount: null,
      decisionReason: "Held for review",
      parsedFieldsJson: { reasons: ["amount_not_found"] },
      rawAnalysis: null,
      createdAt: NOW,
    },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "drive_link_invoice_confusion");
});

test("detectFdrWithoutGsiViolations flags unexpected missing GSI mirror", () => {
  const violations = detectFdrWithoutGsiViolations(
    ORG_ID,
    [
      {
        id: "fdr-missing-gsi",
        source: "gmail",
        gmailMessageId: "gmail-orphan",
        reviewStatus: "needs_review",
        uncertaintyReason: "duplicate.key_mismatch",
        documentFingerprint: "fp-orphan",
        supplierPaymentId: null,
        parsedFieldsJson: { outcome: { status: "NEEDS_REVIEW" } },
        createdAt: NOW,
      },
    ],
    new Set(),
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "fdr_without_gsi");
});

test("detectCrossOrgGmailMessageIdViolations flags shared gmail ids across orgs", () => {
  const violations = detectCrossOrgGmailMessageIdViolations(
    ORG_ID,
    [{ id: "em-1", gmailId: "gmail-shared", receivedAt: NOW }],
    [{ id: "em-other", organizationId: "org-other", gmailId: "gmail-shared" }],
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "cross_org_gmail_message_id");
});

test("detectGmailMailboxMismatchViolations flags integration mailbox mismatch", () => {
  const violations = detectGmailMailboxMismatchViolations(
    ORG_ID,
    { id: "int-1", metadata: JSON.stringify({ googleAccountEmail: "clinic@gmail.com" }) },
    "owner@gmail.com",
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "gmail_mailbox_mismatch");
  assert.equal(violations[0]?.severity, "info");
});

test("legitimate safe cases are not flagged", () => {
  const violations = runScannerIsolationChecks(
    baseData({
      now: NOW,
      stuckActiveScans: [
        {
          id: "scan-fresh",
          status: "running",
          startedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
        },
      ],
      supplierPayments: [
        { id: "pay-safe", documentFingerprint: "fp-safe", emailMessageId: null, createdAt: NOW },
      ],
      gmailScanItems: [
        {
          id: "gsi-safe",
          gmailMessageId: "gmail-safe",
          reviewStatus: "auto_saved",
          documentType: "invoice",
          attachmentFilename: "invoice.pdf",
          driveFileLink: null,
          amount: 1180,
          decisionReason: "Auto-saved",
          parsedFieldsJson: { outcome: { status: "SAVED" } },
          rawAnalysis: { hasAttachment: true, audit: { attachmentFound: true } },
          createdAt: NOW,
        },
      ],
      financialDocumentReviews: [
        {
          id: "fdr-personal-reject",
          source: "gmail",
          gmailMessageId: "gmail-personal",
          reviewStatus: "rejected",
          uncertaintyReason: "personal sender reject",
          documentFingerprint: "fp-personal",
          supplierPaymentId: null,
          parsedFieldsJson: { outcome: { status: "NOT_FINANCIAL" } },
          createdAt: NOW,
        },
        {
          id: "fdr-not-financial",
          source: "gmail",
          gmailMessageId: "gmail-marketing",
          reviewStatus: "needs_review",
          uncertaintyReason: "not_financial",
          documentFingerprint: "fp-marketing",
          supplierPaymentId: null,
          parsedFieldsJson: { outcome: { status: "NOT_FINANCIAL" } },
          createdAt: NOW,
        },
        {
          id: "fdr-with-gsi",
          source: "gmail",
          gmailMessageId: "gmail-safe",
          reviewStatus: "needs_review",
          uncertaintyReason: "Held for review",
          documentFingerprint: "fp-safe",
          supplierPaymentId: null,
          parsedFieldsJson: { outcome: { status: "NEEDS_REVIEW" } },
          createdAt: NOW,
        },
      ],
      gmailIntegration: {
        id: "int-safe",
        metadata: JSON.stringify({ googleAccountEmail: "owner@gmail.com" }),
      },
      organizationUserEmail: "owner@gmail.com",
    }),
  );

  assert.equal(violations.length, 0);
});

test("fetchScannerIsolationViolations uses mocked Prisma read-only queries", async () => {
  const queries: string[] = [];
  const staleStartedAt = new Date(NOW.getTime() - GMAIL_SCAN_STALE_MS - 60_000);

  const db: ScannerIsolationDb = {
    emailMessage: {
      findMany: async ({ where }) => {
        if (
          where &&
          typeof where === "object" &&
          "organizationId" in where &&
          typeof where.organizationId === "string"
        ) {
          queries.push("org-emails");
          return [{ id: "em-1", gmailId: "gmail-shared", receivedAt: NOW }];
        }
        if (
          where &&
          typeof where === "object" &&
          "organizationId" in where &&
          typeof where.organizationId === "object" &&
          where.organizationId !== null &&
          "not" in where.organizationId
        ) {
          queries.push("cross-org-emails");
          return [{ id: "em-other", organizationId: "org-other", gmailId: "gmail-shared" }];
        }
        return [];
      },
    },
    syncLog: {
      findMany: async () => {
        queries.push("stuck-scans");
        return [{ id: "scan-1", status: "queued", startedAt: staleStartedAt, scanMode: "fast_recurring" }];
      },
    },
    supplierPayment: {
      findMany: async () => {
        queries.push("payments");
        return [];
      },
    },
    invoice: {
      findMany: async () => {
        queries.push("invoices");
        return [];
      },
    },
    gmailScanItem: {
      findMany: async () => {
        queries.push("gsi");
        return [];
      },
    },
    financialDocumentReview: {
      findMany: async () => {
        queries.push("fdr");
        return [];
      },
    },
    integration: {
      findUnique: async () => {
        queries.push("integration");
        return null;
      },
    },
    organization: {
      findUnique: async () => {
        queries.push("organization");
        return { user: { email: "owner@gmail.com" } };
      },
    },
  };

  const violations = await fetchScannerIsolationViolations(db, {
    organizationId: ORG_ID,
    now: NOW,
  });

  assert.ok(queries.includes("org-emails"));
  assert.ok(queries.includes("cross-org-emails"));
  assert.ok(queries.includes("stuck-scans"));
  assert.equal(violations.some((v) => v.violationType === "stuck_active_scan"), true);
  assert.equal(violations.some((v) => v.violationType === "cross_org_gmail_message_id"), true);
});
