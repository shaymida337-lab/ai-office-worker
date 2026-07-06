import {
  isQuarantinedGmailScanItem,
  isQuarantinedSupplierPayment,
} from "../p0/crossOrgGmailQuarantine.js";
import {
  hasDocumentFingerprint,
  isPositivePaymentAmount,
  NULL_FINGERPRINT_DATA_QUALITY_MARKER,
} from "../p0/supplierPaymentQuality.js";
import {
  runScannerIsolationChecks,
  type ScannerIsolationViolation,
  type ScannerIsolationViolationType,
} from "../scanner/scannerIsolationChecks.js";
import { computeFindingConfidence } from "./integrityConfidence.js";
import { buildIntegrityFinding } from "./integrityFinding.js";
import type { IntegrityOrgData } from "./integrityDb.js";
import type { IntegrityFinding } from "./integrityTypes.js";
import {
  classifyOrphanEmailMessage,
  orphanDispositionToSeverity,
} from "./integrityOrphanClassifier.js";
import { DEFAULT_INTEGRITY_SIGNAL_CONFIG } from "./integritySignalConfig.js";
import type { IntegrityIgnoredRecord } from "./integrityNoiseAnalytics.js";

const CORE_ISOLATION_VIOLATIONS = new Set<ScannerIsolationViolationType>([
  "blocked_outcome_persisted",
]);

const ISOLATION_CHECK_MAP: Partial<Record<ScannerIsolationViolationType, string>> = {
  blocked_outcome_persisted: "fin-payment-after-blocked",
};

export type IntegrityValidatorResult = {
  findings: IntegrityFinding[];
  ignored: IntegrityIgnoredRecord[];
};

export function runAllIntegrityValidators(data: IntegrityOrgData): IntegrityValidatorResult {
  const ignored: IntegrityIgnoredRecord[] = [];
  const scanner = runCoreScannerValidators(data, ignored);

  const findings = [
    ...runCoreFinancialValidators(data),
    ...runCoreOrganizationValidators(data),
    ...scanner,
    ...runCoreIntegrationValidators(data),
    ...mapCoreIsolationViolationsToFindings(
      data.organizationId,
      runScannerIsolationChecks(data),
      data,
    ),
  ];

  return { findings, ignored };
}

/** @phase 2.3B — not implemented */
export function runFinancialValidators(_data: IntegrityOrgData): IntegrityFinding[] {
  return [];
}

/** @phase 2.3B — not implemented */
export function runScannerValidators(_data: IntegrityOrgData): IntegrityFinding[] {
  return [];
}

/** @phase 2.3B — not implemented */
export function runOrganizationValidators(_data: IntegrityOrgData): IntegrityFinding[] {
  return [];
}

/** @phase 2.3B — not implemented */
export function runDashboardValidators(_data: IntegrityOrgData): IntegrityFinding[] {
  return [];
}

/** @phase 2.3B — not implemented */
export function runIntegrationValidators(_data: IntegrityOrgData): IntegrityFinding[] {
  return [];
}

export function runCoreFinancialValidators(data: IntegrityOrgData): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const orgId = data.organizationId;

  for (const payment of data.payments) {
    const hasSource =
      Boolean(payment.emailMessageId?.trim()) ||
      Boolean(payment.documentLink?.trim()) ||
      Boolean(payment.driveFileId?.trim());
    if (!hasSource && payment.source === "gmail") {
      findings.push(
        buildIntegrityFinding({
          checkId: "fin-payment-without-source",
          category: "financial",
          severity: "critical",
          organizationId: orgId,
          entityType: "SupplierPayment",
          entityId: payment.id,
          explanation: `Payment ${payment.id} has no linked source document.`,
          probableRootCause: "persistence_without_ingestion_trail",
          suggestedAction: "Verify FDR/GSI linkage before keeping payment row.",
          findingConfidence: computeFindingConfidence({
            baseConfidence: 0.92,
            signalCount: 2,
            crossValidated: true,
          }),
        }),
      );
    }

    if (!isPositivePaymentAmount(payment.amount)) {
      findings.push(
        buildIntegrityFinding({
          checkId: "fin-zero-amount-forbidden",
          category: "financial",
          severity: "critical",
          organizationId: orgId,
          entityType: "SupplierPayment",
          entityId: payment.id,
          explanation: `Payment ${payment.id} has zero or missing amount.`,
          probableRootCause: "amount_extraction_failure",
          suggestedAction: "Review amount before approval.",
          findingConfidence: 0.95,
        }),
      );
    }

    if (!hasDocumentFingerprint(payment.documentFingerprint)) {
      findings.push(
        buildIntegrityFinding({
          checkId: "fin-null-document-fingerprint",
          category: "financial",
          severity: "warning",
          organizationId: orgId,
          entityType: "SupplierPayment",
          entityId: payment.id,
          explanation: `Payment ${payment.id} is missing documentFingerprint.`,
          probableRootCause: "legacy_persistence_gap",
          suggestedAction: "Backfill fingerprint or quarantine before dedup relies on it.",
          correlationId: NULL_FINGERPRINT_DATA_QUALITY_MARKER,
          findingConfidence: 0.9,
        }),
      );
    }
  }

  const activePaymentById = new Map(
    data.supplierPayments
      .filter((payment) => payment.approvalStatus !== "rejected")
      .map((payment) => [payment.id, payment]),
  );
  for (const review of data.financialDocumentReviews) {
    if (review.reviewStatus !== "needs_review" || !review.supplierPaymentId) continue;
    const linked = activePaymentById.get(review.supplierPaymentId);
    if (!linked || linked.approvalStatus !== "approved") continue;
    findings.push(
      buildIntegrityFinding({
        checkId: "fin-fdr-payment-status-mismatch",
        category: "financial",
        severity: "critical",
        organizationId: orgId,
        entityType: "FinancialDocumentReview",
        entityId: review.id,
        explanation: `Review ${review.id} is needs_review but links active payment ${linked.id}.`,
        probableRootCause: "approval_status_divergence",
        suggestedAction: "Align FDR status with payment or detach invalid payment link.",
        correlationId: linked.id,
        findingConfidence: 0.94,
      }),
    );
  }

  for (const invoice of data.invoiceDetails) {
    if (invoice.amount === 0) {
      findings.push(
        buildIntegrityFinding({
          checkId: "fin-zero-amount-forbidden",
          category: "financial",
          severity: "critical",
          organizationId: orgId,
          entityType: "Invoice",
          entityId: invoice.id,
          explanation: `Invoice ${invoice.id} has zero amount.`,
          probableRootCause: "amount_extraction_failure",
          suggestedAction: "Review amount before approval.",
          findingConfidence: 0.95,
        }),
      );
    }
  }

  const fingerprintGroups = groupByFingerprint(data.payments);
  for (const [fingerprint, ids] of fingerprintGroups.entries()) {
    if (ids.length < 2) continue;
    findings.push(
      buildIntegrityFinding({
        checkId: "fin-duplicate-fingerprint",
        category: "financial",
        severity: "critical",
        organizationId: orgId,
        entityType: "SupplierPayment",
        entityId: ids[0] ?? null,
        explanation: `${ids.length} payments share fingerprint ${fingerprint}.`,
        correlationId: fingerprint,
        suggestedAction: "Manual deduplication review required.",
        findingConfidence: computeFindingConfidence({
          baseConfidence: 0.9,
          signalCount: ids.length,
          crossValidated: true,
        }),
      }),
    );
  }

  return findings;
}

export function runCoreOrganizationValidators(data: IntegrityOrgData): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const orgId = data.organizationId;

  for (const payment of data.payments) {
    if (payment.emailMessageId && !data.emailIds.has(payment.emailMessageId)) {
      findings.push(
        buildIntegrityFinding({
          checkId: "org-cross-org-reference",
          category: "organization",
          severity: "critical",
          organizationId: orgId,
          entityType: "SupplierPayment",
          entityId: payment.id,
          explanation: `Payment ${payment.id} references emailMessageId outside this organization.`,
          probableRootCause: "cross_tenant_financial_reference",
          suggestedAction: "Audit payment source linkage and quarantine if foreign org data.",
          findingConfidence: computeFindingConfidence({
            baseConfidence: 0.93,
            signalCount: 2,
            crossValidated: true,
          }),
        }),
      );
    }
  }

  if (data.crossOrgEmailMessages.length === 0) {
    return findings;
  }

  const sharedGmailIds = new Set(
    data.crossOrgEmailMessages
      .filter((row) => data.gmailMessageIds.has(row.gmailId))
      .map((row) => row.gmailId),
  );
  const affectedOrganizations = [
    ...new Set(data.crossOrgEmailMessages.map((row) => row.organizationId)),
  ];

  for (const scanItem of data.gmailScanItems) {
    const gmailId = scanItem.gmailMessageId;
    if (!gmailId || isQuarantinedGmailScanItem(scanItem)) continue;
    const sibling = data.siblingArtifactsByGmailId.get(gmailId);
    if (!sibling || sibling.siblingOrganizationCount === 0) continue;
    findings.push(
      buildIntegrityFinding({
        checkId: "org-cross-org-gmail-id",
        category: "organization",
        severity: "critical",
        organizationId: orgId,
        entityType: "GmailScanItem",
        entityId: scanItem.id,
        explanation: `Gmail scan item ${scanItem.id} uses gmailMessageId shared across ${sibling.siblingOrganizationCount + 1} organization(s).`,
        probableRootCause: "cross_org_gmail_ingestion",
        suggestedAction: "Quarantine artifact and exclude from payment flows.",
        correlationId: gmailId,
        findingConfidence: 0.96,
      }),
    );
  }

  for (const payment of data.payments) {
    if (!isQuarantinedSupplierPayment(payment)) continue;
    if (payment.duplicateReason?.includes("Quarantined: cross-org gmail ingestion")) {
      findings.push(
        buildIntegrityFinding({
          checkId: "org-cross-org-gmail-id",
          category: "organization",
          severity: "warning",
          organizationId: orgId,
          entityType: "SupplierPayment",
          entityId: payment.id,
          explanation: `Payment ${payment.id} is quarantined for cross-org gmail contamination.`,
          probableRootCause: "cross_org_gmail_ingestion",
          suggestedAction: "Keep excluded from payable KPIs until ownership verified.",
          findingConfidence: 0.95,
        }),
      );
    }
  }

  if (sharedGmailIds.size === 0) {
    return findings;
  }

  const hasFinancialLeak = findings.some((f) => f.probableRootCause === "cross_tenant_financial_reference");
  findings.push(
    buildIntegrityFinding({
      checkId: "org-cross-org-reference",
      category: "organization",
      severity: hasFinancialLeak ? "warning" : "info",
      organizationId: orgId,
      entityType: "EmailMessage",
      entityId: data.crossOrgEmailMessages[0]?.id ?? null,
      explanation: `Shared mailbox history: ${sharedGmailIds.size} gmailId(s) appear across ${affectedOrganizations.length + 1} organization(s) (${data.crossOrgEmailMessages.length} foreign EmailMessage rows).`,
      probableRootCause: "shared_mailbox_history",
      suggestedAction: "Review Gmail integration isolation; confirm no financial rows cross tenants.",
      correlationId: `shared-mailbox:${sharedGmailIds.size}:${affectedOrganizations.length}`,
      findingConfidence: computeFindingConfidence({
        baseConfidence: 0.82,
        signalCount: 3,
        historicalEvidence: true,
      }),
    }),
  );

  return findings;
}

export function runCoreScannerValidators(
  data: IntegrityOrgData,
  ignored: IntegrityIgnoredRecord[] = [],
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const orgId = data.organizationId;
  const now = data.now ?? new Date();
  const config = DEFAULT_INTEGRITY_SIGNAL_CONFIG;

  for (const scan of data.stuckActiveScans) {
    findings.push(
      buildIntegrityFinding({
        checkId: "scan-stuck",
        category: "scanner",
        severity: "critical",
        organizationId: orgId,
        entityType: "SyncLog",
        entityId: scan.id,
        explanation: `Gmail scan ${scan.id} stuck in ${scan.status} since ${scan.startedAt.toISOString()}.`,
        probableRootCause: "stuck_active_scan",
        suggestedAction: "Inspect SyncLog row and worker health.",
        correlationId: `stuck:${scan.id}`,
        findingConfidence: 0.94,
      }),
    );
  }

  for (const email of data.emailMessages) {
    const hasGsi = data.gsiGmailIds.has(email.gmailId);
    const hasFdr = data.fdrGmailIds.has(email.gmailId);
    if (hasGsi || hasFdr) continue;

    const classification = classifyOrphanEmailMessage(email, now, config, {
      attachments: data.emailAttachmentsByEmailId.get(email.id) ?? [],
      siblingArtifacts: data.siblingArtifactsByGmailId.get(email.gmailId) ?? null,
    });
    if (classification.disposition === "IGNORED") {
      ignored.push({
        checkId: "scan-orphan-gmail-message",
        reason: classification.reason,
        entityId: email.id,
      });
      continue;
    }

    const severity = orphanDispositionToSeverity(classification.disposition);
    if (!severity) continue;

    findings.push(
      buildIntegrityFinding({
        checkId: "scan-orphan-gmail-message",
        category: "scanner",
        severity,
        organizationId: orgId,
        entityType: "EmailMessage",
        entityId: email.id,
        explanation: `${classification.reason} (${classification.signals.join(", ")})`,
        probableRootCause: classification.probableRootCause,
        suggestedAction:
          severity === "critical"
            ? "Investigate why invoice-like email with financial attachment has no scan or review artifact."
            : severity === "warning"
              ? "Review shared-mailbox or partial-scan condition; likely not active customer-money risk."
              : "Monitor; likely non-financial, test traffic, or expected shared-mailbox behavior.",
        signalDisposition: classification.disposition,
        findingConfidence: computeFindingConfidence({
          baseConfidence: classification.findingConfidence,
          signalCount: classification.signals.length,
          crossValidated: classification.signals.includes("financial_attachment_present"),
          historicalEvidence: classification.signals.includes("sibling_org_artifact"),
        }),
      }),
    );
  }

  return findings;
}

export function runCoreIntegrationValidators(data: IntegrityOrgData): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const orgId = data.organizationId;
  const now = data.now ?? new Date();

  const gmail = data.integrations.find((i) => i.provider === "gmail");
  if (!gmail) {
    findings.push(
      buildIntegrityFinding({
        checkId: "int-gmail-invalid",
        category: "integration",
        severity: "critical",
        organizationId: orgId,
        entityType: "Integration",
        entityId: null,
        explanation: "Gmail integration not connected.",
        probableRootCause: "gmail_disconnected",
        suggestedAction: "Connect Gmail for scanning.",
        findingConfidence: 0.98,
      }),
    );
    return findings;
  }

  if (gmail.expiresAt && gmail.expiresAt.getTime() < now.getTime()) {
    findings.push(
      buildIntegrityFinding({
        checkId: "int-gmail-invalid",
        category: "integration",
        severity: "critical",
        organizationId: orgId,
        entityType: "Integration",
        entityId: gmail.id,
        explanation: "Gmail OAuth token expired.",
        probableRootCause: "oauth_expired",
        suggestedAction: "Refresh Gmail integration token.",
        findingConfidence: 0.97,
      }),
    );
  }

  if (gmail.metadata?.includes("invalid") || gmail.metadata?.includes("revoked")) {
    findings.push(
      buildIntegrityFinding({
        checkId: "int-gmail-invalid",
        category: "integration",
        severity: "critical",
        organizationId: orgId,
        entityType: "Integration",
        entityId: gmail.id,
        explanation: "Gmail integration metadata indicates invalid or revoked state.",
        probableRootCause: "oauth_invalid",
        suggestedAction: "Reconnect Gmail integration.",
        findingConfidence: 0.9,
      }),
    );
  }

  return findings;
}

export function mapCoreIsolationViolationsToFindings(
  organizationId: string,
  violations: ScannerIsolationViolation[],
  data: IntegrityOrgData,
): IntegrityFinding[] {
  const paymentCreatedAt = new Map(data.payments.map((p) => [p.id, p.createdAt]));
  const fdrCreatedAt = new Map(data.financialDocumentReviews.map((f) => [f.id, f.createdAt]));
  const fdrIds = new Set(data.financialDocumentReviews.map((f) => f.id));
  const paymentIds = new Set(data.payments.map((p) => p.id));

  return violations
    .filter((v) => CORE_ISOLATION_VIOLATIONS.has(v.violationType))
    .flatMap((v) => {
      const checkId = ISOLATION_CHECK_MAP[v.violationType] ?? `scan-${v.violationType}`;
      const blockedFdrId = v.affectedIds.find((id) => fdrIds.has(id));
      const blockedAt = blockedFdrId ? fdrCreatedAt.get(blockedFdrId) : null;

      return v.affectedIds.map((entityId) => {
        const isPayment = paymentIds.has(entityId);
        const paymentAt = isPayment ? paymentCreatedAt.get(entityId) : null;
        const activePersistence =
          isPayment &&
          blockedAt != null &&
          paymentAt != null &&
          paymentAt.getTime() > blockedAt.getTime();

        const severity = isPayment
          ? activePersistence
            ? "critical"
            : "warning"
          : fdrIds.has(entityId)
            ? "warning"
            : "warning";

        const probableRootCause = isPayment
          ? activePersistence
            ? "blocked_outcome_persisted"
            : "duplicate_rescan"
          : "blocked_outcome_persisted";

        return buildIntegrityFinding({
          checkId,
          category: "financial",
          severity,
          organizationId,
          entityType: isPayment ? "SupplierPayment" : fdrIds.has(entityId) ? "FinancialDocumentReview" : v.violationType,
          entityId,
          explanation: activePersistence
            ? `${v.explanation} Payment persisted after BLOCKED decision.`
            : `${v.explanation} Historical ordering — payment predates blocked review (duplicate-rescan pattern).`,
          probableRootCause,
          suggestedAction: activePersistence
            ? v.recommendedAction
            : "Review duplicate-rescan history; no active write-through detected.",
          correlationId: `isolation:${v.violationType}:${entityId}`,
          findingConfidence: computeFindingConfidence({
            baseConfidence: activePersistence ? 0.95 : 0.85,
            signalCount: activePersistence ? 3 : 2,
            crossValidated: true,
            historicalEvidence: !activePersistence,
          }),
        });
      });
    });
}

/** @deprecated Use mapCoreIsolationViolationsToFindings — full mapping reserved for future phases */
export function mapIsolationViolationsToFindings(
  organizationId: string,
  violations: ScannerIsolationViolation[],
  data?: IntegrityOrgData,
): IntegrityFinding[] {
  if (!data) return [];
  return mapCoreIsolationViolationsToFindings(organizationId, violations, data);
}

function groupByFingerprint(payments: IntegrityOrgData["payments"]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const payment of payments) {
    const fp = payment.documentFingerprint?.trim();
    if (!fp) continue;
    const ids = grouped.get(fp) ?? [];
    ids.push(payment.id);
    grouped.set(fp, ids);
  }
  return grouped;
}
