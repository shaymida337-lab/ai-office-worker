import type { PrismaClient } from "@prisma/client";
import { GMAIL_SCAN_ACTIVE_STATUSES, GMAIL_SCAN_STALE_MS } from "../gmailScanLifecycle.js";
import {
  hasMissingAmountSignal,
  isFinancialDocumentType,
  isStuckGmailScan,
  type ScannerHealthDateRange,
} from "./scannerHealthQueries.js";
import { normalizeDecisionBucket } from "./scannerStageTypes.js";
import { isBlockedDocumentOutcome } from "../trust/blockedOutcomeGuard.js";

export type ScannerIsolationSeverity = "critical" | "warning" | "info";

export const SCANNER_ISOLATION_VIOLATION_TYPES = [
  "stuck_active_scan",
  "duplicate_supplier_payment_fingerprint",
  "blocked_outcome_persisted",
  "auto_saved_without_attachment",
  "drive_link_invoice_confusion",
  "fdr_without_gsi",
  "cross_org_gmail_message_id",
  "gmail_mailbox_mismatch",
] as const;

export type ScannerIsolationViolationType = (typeof SCANNER_ISOLATION_VIOLATION_TYPES)[number];

export type ScannerIsolationViolation = {
  severity: ScannerIsolationSeverity;
  violationType: ScannerIsolationViolationType;
  organizationId: string;
  affectedIds: string[];
  explanation: string;
  recommendedAction: string;
};

export type ScannerIsolationCheckInput = {
  organizationId: string;
  range?: ScannerHealthDateRange;
  now?: Date;
};

export type ScannerIsolationSyncLogRow = {
  id: string;
  status: string;
  startedAt: Date;
  scanMode?: string | null;
};

export type ScannerIsolationSupplierPaymentRow = {
  id: string;
  documentFingerprint: string | null;
  emailMessageId: string | null;
  createdAt: Date;
};

export type ScannerIsolationInvoiceRow = {
  id: string;
  gmailMessageId: string | null;
  emailId: string | null;
  createdAt: Date;
};

export type ScannerIsolationGmailScanItemRow = {
  id: string;
  gmailMessageId: string;
  reviewStatus: string;
  documentType: string;
  attachmentFilename: string | null;
  driveFileLink: string | null;
  amount: number | null;
  decisionReason: string;
  parsedFieldsJson: unknown;
  rawAnalysis: unknown;
  createdAt: Date;
};

export type ScannerIsolationFinancialDocumentReviewRow = {
  id: string;
  source: string;
  gmailMessageId: string | null;
  reviewStatus: string;
  uncertaintyReason: string | null;
  documentFingerprint: string;
  supplierPaymentId: string | null;
  parsedFieldsJson: unknown;
  createdAt: Date;
};

export type ScannerIsolationEmailMessageRow = {
  id: string;
  gmailId: string;
  receivedAt: Date;
};

export type ScannerIsolationCrossOrgEmailRow = {
  id: string;
  organizationId: string;
  gmailId: string;
};

export type ScannerIsolationIntegrationRow = {
  id: string;
  metadata: string | null;
};

export type ScannerIsolationCheckData = {
  organizationId: string;
  now?: Date;
  stuckActiveScans: ScannerIsolationSyncLogRow[];
  supplierPayments: ScannerIsolationSupplierPaymentRow[];
  invoices: ScannerIsolationInvoiceRow[];
  gmailScanItems: ScannerIsolationGmailScanItemRow[];
  financialDocumentReviews: ScannerIsolationFinancialDocumentReviewRow[];
  emailMessages: ScannerIsolationEmailMessageRow[];
  crossOrgEmailMessages: ScannerIsolationCrossOrgEmailRow[];
  gmailIntegration: ScannerIsolationIntegrationRow | null;
  organizationUserEmail: string | null;
};

export type ScannerIsolationDb = Pick<
  PrismaClient,
  | "syncLog"
  | "supplierPayment"
  | "invoice"
  | "gmailScanItem"
  | "financialDocumentReview"
  | "emailMessage"
  | "integration"
  | "organization"
>;

function parseIntegrationMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function integrationGoogleAccountEmail(metadata: string | null | undefined): string | null {
  const value = parseIntegrationMetadata(metadata).googleAccountEmail;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function outcomeStatusFromParsed(parsedFieldsJson: unknown): string | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || Array.isArray(parsedFieldsJson)) {
    return null;
  }
  const status = (parsedFieldsJson as { outcome?: { status?: unknown } }).outcome?.status;
  return typeof status === "string" ? status.toUpperCase() : null;
}

function isBlockedOutcome(parsedFieldsJson: unknown, uncertaintyReason?: string | null): boolean {
  return isBlockedDocumentOutcome(parsedFieldsJson, uncertaintyReason);
}

function isNotFinancialExclusion(parsedFieldsJson: unknown, uncertaintyReason?: string | null): boolean {
  const outcomeStatus = outcomeStatusFromParsed(parsedFieldsJson);
  if (outcomeStatus === "NOT_FINANCIAL") return true;
  const uncertainty = uncertaintyReason?.toLowerCase() ?? "";
  return uncertainty.includes("not_financial") || uncertainty.includes("irrelevant");
}

function isPersonalSenderReject(uncertaintyReason?: string | null): boolean {
  const uncertainty = uncertaintyReason?.toLowerCase() ?? "";
  return uncertainty.includes("personal") && uncertainty.includes("reject");
}

function hasAttachmentEvidence(item: ScannerIsolationGmailScanItemRow): boolean {
  if (item.attachmentFilename?.trim()) return true;
  if (!item.rawAnalysis || typeof item.rawAnalysis !== "object" || Array.isArray(item.rawAnalysis)) {
    return false;
  }
  const raw = item.rawAnalysis as {
    hasAttachment?: boolean;
    audit?: { attachmentFound?: boolean };
  };
  return raw.hasAttachment === true || raw.audit?.attachmentFound === true;
}

function gsiDecisionSignals(item: ScannerIsolationGmailScanItemRow) {
  const parsed = item.parsedFieldsJson;
  const outcomeStatus = outcomeStatusFromParsed(parsed);
  const reasonCode =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof (parsed as { outcome?: { reasonCode?: unknown } }).outcome?.reasonCode === "string"
      ? ((parsed as { outcome: { reasonCode: string } }).outcome.reasonCode as string)
      : null;
  return {
    reviewStatus: item.reviewStatus,
    outcomeStatus,
    uncertaintyReason: item.decisionReason,
    reasonCode,
  };
}

function createdAtInRange(createdAt: Date, range?: ScannerHealthDateRange): boolean {
  if (!range) return true;
  return createdAt >= range.from && createdAt <= range.to;
}

function filterByRange<T extends { createdAt: Date }>(rows: T[], range?: ScannerHealthDateRange): T[] {
  if (!range) return rows;
  return rows.filter((row) => createdAtInRange(row.createdAt, range));
}

export function detectStuckActiveScanViolations(
  organizationId: string,
  scans: ScannerIsolationSyncLogRow[],
  now: Date = new Date(),
): ScannerIsolationViolation[] {
  return scans
    .filter((scan) => isStuckGmailScan(scan, now))
    .map((scan) => ({
      severity: "critical" as const,
      violationType: "stuck_active_scan" as const,
      organizationId,
      affectedIds: [scan.id],
      explanation: `Gmail scan ${scan.id} has been ${scan.status} since ${scan.startedAt.toISOString()} (>${GMAIL_SCAN_STALE_MS / 60_000} minutes).`,
      recommendedAction:
        "Inspect SyncLog row, confirm worker health, and close or resume the scan without reprocessing blindly.",
    }));
}

export function detectDuplicateSupplierPaymentViolations(
  organizationId: string,
  payments: ScannerIsolationSupplierPaymentRow[],
): ScannerIsolationViolation[] {
  const grouped = new Map<string, string[]>();
  for (const payment of payments) {
    const fingerprint = payment.documentFingerprint?.trim();
    if (!fingerprint) continue;
    const bucket = grouped.get(fingerprint) ?? [];
    bucket.push(payment.id);
    grouped.set(fingerprint, bucket);
  }

  const violations: ScannerIsolationViolation[] = [];
  for (const [fingerprint, ids] of grouped.entries()) {
    if (ids.length < 2) continue;
    violations.push({
      severity: "critical",
      violationType: "duplicate_supplier_payment_fingerprint",
      organizationId,
      affectedIds: ids,
      explanation: `Found ${ids.length} SupplierPayment rows sharing documentFingerprint ${fingerprint}.`,
      recommendedAction:
        "Quarantine duplicate payments after manual review; do not auto-delete until accountant confirms.",
    });
  }
  return violations;
}

export function detectBlockedOutcomePersistedViolations(
  organizationId: string,
  reviews: ScannerIsolationFinancialDocumentReviewRow[],
  scanItems: ScannerIsolationGmailScanItemRow[],
  payments: ScannerIsolationSupplierPaymentRow[],
  invoices: ScannerIsolationInvoiceRow[],
): ScannerIsolationViolation[] {
  const violations: ScannerIsolationViolation[] = [];
  const paymentsByFingerprint = new Map<string, string[]>();
  for (const payment of payments) {
    const fingerprint = payment.documentFingerprint?.trim();
    if (!fingerprint) continue;
    const ids = paymentsByFingerprint.get(fingerprint) ?? [];
    ids.push(payment.id);
    paymentsByFingerprint.set(fingerprint, ids);
  }
  const invoicesByGmailId = new Map<string, string[]>();
  for (const invoice of invoices) {
    const gmailMessageId = invoice.gmailMessageId?.trim();
    if (!gmailMessageId) continue;
    const ids = invoicesByGmailId.get(gmailMessageId) ?? [];
    ids.push(invoice.id);
    invoicesByGmailId.set(gmailMessageId, ids);
  }

  for (const review of reviews) {
    if (!isBlockedOutcome(review.parsedFieldsJson, review.uncertaintyReason)) continue;
    const affected = new Set<string>([review.id]);
    if (review.supplierPaymentId) affected.add(review.supplierPaymentId);
    for (const paymentId of paymentsByFingerprint.get(review.documentFingerprint) ?? []) {
      affected.add(paymentId);
    }
    if (review.gmailMessageId) {
      for (const invoiceId of invoicesByGmailId.get(review.gmailMessageId) ?? []) {
        affected.add(invoiceId);
      }
    }
    if (affected.size <= 1) continue;
    violations.push({
      severity: "critical",
      violationType: "blocked_outcome_persisted",
      organizationId,
      affectedIds: [...affected],
      explanation: `FinancialDocumentReview ${review.id} is BLOCKED but linked SupplierPayment or Invoice rows exist.`,
      recommendedAction:
        "Treat as isolation breach: verify trust/OE gate order and remove or quarantine persisted financial rows.",
    });
  }

  for (const item of scanItems) {
    if (!isBlockedOutcome(item.parsedFieldsJson, item.decisionReason)) continue;
    const invoiceIds = invoicesByGmailId.get(item.gmailMessageId) ?? [];
    if (invoiceIds.length === 0) continue;
    violations.push({
      severity: "critical",
      violationType: "blocked_outcome_persisted",
      organizationId,
      affectedIds: [item.id, ...invoiceIds],
      explanation: `GmailScanItem ${item.id} is BLOCKED but Invoice rows exist for gmailMessageId ${item.gmailMessageId}.`,
      recommendedAction:
        "Investigate blocked terminal path vs invoice persistence; hold auto-save until resolved.",
    });
  }

  return violations;
}

export function detectAutoSavedWithoutAttachmentViolations(
  organizationId: string,
  scanItems: ScannerIsolationGmailScanItemRow[],
): ScannerIsolationViolation[] {
  return scanItems
    .filter(
      (item) =>
        item.reviewStatus === "auto_saved" &&
        isFinancialDocumentType(item.documentType) &&
        !hasAttachmentEvidence(item),
    )
    .map((item) => ({
      severity: "warning" as const,
      violationType: "auto_saved_without_attachment" as const,
      organizationId,
      affectedIds: [item.id],
      explanation: `GmailScanItem ${item.id} is auto_saved without attachmentFilename or attachment audit evidence.`,
      recommendedAction:
        "Reclassify to needs_review until a real PDF/image attachment or approved manual upload exists.",
    }));
}

export function detectDriveLinkInvoiceConfusionViolations(
  organizationId: string,
  scanItems: ScannerIsolationGmailScanItemRow[],
): ScannerIsolationViolation[] {
  return scanItems
    .filter((item) => {
      if (!item.driveFileLink?.includes("drive.google.com")) return false;
      if (item.attachmentFilename?.trim()) return false;
      if (!isFinancialDocumentType(item.documentType)) return false;
      if (normalizeDecisionBucket(gsiDecisionSignals(item)) === "unsupported") return false;
      return hasMissingAmountSignal(item);
    })
    .map((item) => ({
      severity: "warning" as const,
      violationType: "drive_link_invoice_confusion" as const,
      organizationId,
      affectedIds: [item.id],
      explanation: `Drive-link-only GmailScanItem ${item.id} is treated like a normal invoice with missing amount signals.`,
      recommendedAction:
        "Route Drive-link-only messages to unsupported review copy; do not surface amount-missing invoice failures.",
    }));
}

export function detectFdrWithoutGsiViolations(
  organizationId: string,
  reviews: ScannerIsolationFinancialDocumentReviewRow[],
  gsiGmailMessageIds: Set<string>,
): ScannerIsolationViolation[] {
  return reviews
    .filter((review) => {
      if (review.source !== "gmail") return false;
      if (!review.gmailMessageId) return false;
      if (gsiGmailMessageIds.has(review.gmailMessageId)) return false;
      if (review.reviewStatus === "rejected") return false;
      if (isNotFinancialExclusion(review.parsedFieldsJson, review.uncertaintyReason)) return false;
      if (isPersonalSenderReject(review.uncertaintyReason)) return false;
      return true;
    })
    .map((review) => ({
      severity: "warning" as const,
      violationType: "fdr_without_gsi" as const,
      organizationId,
      affectedIds: [review.id],
      explanation: `FinancialDocumentReview ${review.id} exists for gmailMessageId ${review.gmailMessageId} without a GmailScanItem mirror.`,
      recommendedAction:
        "Verify terminal outcome path and ops visibility; create review-only GSI mirror only when product policy requires it.",
    }));
}

export function detectCrossOrgGmailMessageIdViolations(
  organizationId: string,
  orgEmails: ScannerIsolationEmailMessageRow[],
  crossOrgEmails: ScannerIsolationCrossOrgEmailRow[],
): ScannerIsolationViolation[] {
  if (crossOrgEmails.length === 0) return [];

  const orgGmailIds = new Set(orgEmails.map((email) => email.gmailId));
  const conflicts = crossOrgEmails.filter((row) => orgGmailIds.has(row.gmailId));
  if (conflicts.length === 0) return [];

  const affectedIds = [
    ...new Set([
      ...orgEmails.filter((email) => conflicts.some((row) => row.gmailId === email.gmailId)).map((e) => e.id),
      ...conflicts.map((row) => row.id),
    ]),
  ];

  const gmailIds = [...new Set(conflicts.map((row) => row.gmailId))];
  return [
    {
      severity: "warning",
      violationType: "cross_org_gmail_message_id",
      organizationId,
      affectedIds,
      explanation: `Gmail message id(s) ${gmailIds.join(", ")} appear in multiple organizations.`,
      recommendedAction:
        "Confirm Gmail integration isolation; shared mailbox or token reuse can cause cross-org ingestion.",
    },
  ];
}

export function detectGmailMailboxMismatchViolations(
  organizationId: string,
  integration: ScannerIsolationIntegrationRow | null,
  organizationUserEmail: string | null,
): ScannerIsolationViolation[] {
  if (!integration) return [];
  const connectedEmail = integrationGoogleAccountEmail(integration.metadata);
  if (!connectedEmail || !organizationUserEmail) return [];

  const expectedEmail = organizationUserEmail.trim().toLowerCase();
  if (!expectedEmail || connectedEmail === expectedEmail) return [];

  return [
    {
      severity: "info",
      violationType: "gmail_mailbox_mismatch",
      organizationId,
      affectedIds: [integration.id],
      explanation: `Gmail integration mailbox ${connectedEmail} differs from organization user email ${expectedEmail}.`,
      recommendedAction:
        "Confirm the connected Gmail account is intentional for this organization before changing scan settings.",
    },
  ];
}

export function runScannerIsolationChecks(data: ScannerIsolationCheckData): ScannerIsolationViolation[] {
  const now = data.now ?? new Date();
  const gsiGmailMessageIds = new Set(data.gmailScanItems.map((item) => item.gmailMessageId));

  return [
    ...detectStuckActiveScanViolations(data.organizationId, data.stuckActiveScans, now),
    ...detectDuplicateSupplierPaymentViolations(data.organizationId, data.supplierPayments),
    ...detectBlockedOutcomePersistedViolations(
      data.organizationId,
      data.financialDocumentReviews,
      data.gmailScanItems,
      data.supplierPayments,
      data.invoices,
    ),
    ...detectAutoSavedWithoutAttachmentViolations(data.organizationId, data.gmailScanItems),
    ...detectDriveLinkInvoiceConfusionViolations(data.organizationId, data.gmailScanItems),
    ...detectFdrWithoutGsiViolations(
      data.organizationId,
      data.financialDocumentReviews,
      gsiGmailMessageIds,
    ),
    ...detectCrossOrgGmailMessageIdViolations(
      data.organizationId,
      data.emailMessages,
      data.crossOrgEmailMessages,
    ),
    ...detectGmailMailboxMismatchViolations(
      data.organizationId,
      data.gmailIntegration,
      data.organizationUserEmail,
    ),
  ];
}

export async function fetchScannerIsolationViolations(
  db: ScannerIsolationDb,
  input: ScannerIsolationCheckInput,
): Promise<ScannerIsolationViolation[]> {
  const now = input.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - GMAIL_SCAN_STALE_MS);
  const createdAtFilter = input.range
    ? { gte: input.range.from, lte: input.range.to }
    : undefined;
  const receivedAtFilter = input.range
    ? { gte: input.range.from, lte: input.range.to }
    : undefined;

  const emailWhere = {
    organizationId: input.organizationId,
    ...(receivedAtFilter ? { receivedAt: receivedAtFilter } : {}),
  };

  const emailMessages = await db.emailMessage.findMany({
    where: emailWhere,
    select: { id: true, gmailId: true, receivedAt: true },
  });

  const gmailIds = [...new Set(emailMessages.map((email) => email.gmailId))];
  const crossOrgEmailMessages =
    gmailIds.length > 0
      ? await db.emailMessage.findMany({
          where: {
            gmailId: { in: gmailIds },
            organizationId: { not: input.organizationId },
          },
          select: { id: true, organizationId: true, gmailId: true },
        })
      : [];

  const [
    stuckActiveScans,
    supplierPayments,
    invoices,
    gmailScanItems,
    financialDocumentReviews,
    gmailIntegration,
    organization,
  ] = await Promise.all([
    db.syncLog.findMany({
      where: {
        organizationId: input.organizationId,
        type: "gmail_scan",
        status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
        startedAt: { lte: staleCutoff },
      },
      select: { id: true, status: true, startedAt: true, scanMode: true },
    }),
    db.supplierPayment.findMany({
      where: {
        organizationId: input.organizationId,
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      select: {
        id: true,
        documentFingerprint: true,
        emailMessageId: true,
        createdAt: true,
      },
    }),
    db.invoice.findMany({
      where: {
        organizationId: input.organizationId,
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      select: { id: true, gmailMessageId: true, emailId: true, createdAt: true },
    }),
    db.gmailScanItem.findMany({
      where: {
        organizationId: input.organizationId,
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      select: {
        id: true,
        gmailMessageId: true,
        reviewStatus: true,
        documentType: true,
        attachmentFilename: true,
        driveFileLink: true,
        amount: true,
        decisionReason: true,
        parsedFieldsJson: true,
        rawAnalysis: true,
        createdAt: true,
      },
    }),
    db.financialDocumentReview.findMany({
      where: {
        organizationId: input.organizationId,
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      select: {
        id: true,
        source: true,
        gmailMessageId: true,
        reviewStatus: true,
        uncertaintyReason: true,
        documentFingerprint: true,
        supplierPaymentId: true,
        parsedFieldsJson: true,
        createdAt: true,
      },
    }),
    db.integration.findUnique({
      where: {
        organizationId_provider: { organizationId: input.organizationId, provider: "gmail" },
      },
      select: { id: true, metadata: true },
    }),
    db.organization.findUnique({
      where: { id: input.organizationId },
      select: { user: { select: { email: true } } },
    }),
  ]);

  return runScannerIsolationChecks({
    organizationId: input.organizationId,
    now,
    stuckActiveScans,
    supplierPayments: filterByRange(supplierPayments, input.range),
    invoices: filterByRange(invoices, input.range),
    gmailScanItems: filterByRange(gmailScanItems, input.range),
    financialDocumentReviews: filterByRange(financialDocumentReviews, input.range),
    emailMessages: receivedAtFilter
      ? emailMessages.filter((email) => createdAtInRange(email.receivedAt, input.range))
      : emailMessages,
    crossOrgEmailMessages,
    gmailIntegration,
    organizationUserEmail: organization?.user.email ?? null,
  });
}
