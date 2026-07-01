import {
  runScannerIsolationChecks,
  type ScannerIsolationViolation,
  type ScannerIsolationViolationType,
} from "../scanner/scannerIsolationChecks.js";
import { buildIntegrityFinding } from "./integrityFinding.js";
import type { IntegrityOrgData } from "./integrityDb.js";
import type { IntegrityFinding } from "./integrityTypes.js";

const CORE_ISOLATION_VIOLATIONS = new Set<ScannerIsolationViolationType>([
  "blocked_outcome_persisted",
]);

const ISOLATION_CHECK_MAP: Partial<Record<ScannerIsolationViolationType, string>> = {
  blocked_outcome_persisted: "fin-payment-after-blocked",
};

/** Phase 2.3A — runs only the 8 core validators. */
export function runAllIntegrityValidators(data: IntegrityOrgData): IntegrityFinding[] {
  return [
    ...runCoreFinancialValidators(data),
    ...runCoreOrganizationValidators(data),
    ...runCoreScannerValidators(data),
    ...runCoreIntegrationValidators(data),
    ...mapCoreIsolationViolationsToFindings(data.organizationId, runScannerIsolationChecks(data)),
  ];
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
        }),
      );
    }

    if (payment.amount === 0) {
      findings.push(
        buildIntegrityFinding({
          checkId: "fin-zero-amount-forbidden",
          category: "financial",
          severity: "critical",
          organizationId: orgId,
          entityType: "SupplierPayment",
          entityId: payment.id,
          explanation: `Payment ${payment.id} has zero amount.`,
          probableRootCause: "amount_extraction_failure",
          suggestedAction: "Review amount before approval.",
        }),
      );
    }
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
      }),
    );
  }

  return findings;
}

export function runCoreOrganizationValidators(data: IntegrityOrgData): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  if (data.crossOrgEmailMessages.length > 0) {
    findings.push(
      buildIntegrityFinding({
        checkId: "org-cross-org-reference",
        category: "organization",
        severity: "critical",
        organizationId: data.organizationId,
        entityType: "EmailMessage",
        entityId: data.crossOrgEmailMessages[0]?.id ?? null,
        explanation: `${data.crossOrgEmailMessages.length} cross-org email references detected.`,
        probableRootCause: "shared_mailbox_or_token_reuse",
        suggestedAction: "Audit Gmail integration isolation immediately.",
      }),
    );
  }
  return findings;
}

export function runCoreScannerValidators(data: IntegrityOrgData): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const orgId = data.organizationId;

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
      }),
    );
  }

  for (const email of data.emailMessages) {
    const hasGsi = data.gsiGmailIds.has(email.gmailId);
    const hasFdr = data.fdrGmailIds.has(email.gmailId);
    if (!hasGsi && !hasFdr) {
      findings.push(
        buildIntegrityFinding({
          checkId: "scan-orphan-gmail-message",
          category: "scanner",
          severity: "critical",
          organizationId: orgId,
          entityType: "EmailMessage",
          entityId: email.id,
          explanation: `Email ${email.id} has no GSI or FDR.`,
          suggestedAction: "Verify scan pipeline or mark as non-financial.",
        }),
      );
    }
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
      }),
    );
  }

  return findings;
}

export function mapCoreIsolationViolationsToFindings(
  organizationId: string,
  violations: ScannerIsolationViolation[],
): IntegrityFinding[] {
  return violations
    .filter((v) => CORE_ISOLATION_VIOLATIONS.has(v.violationType))
    .flatMap((v) => {
      const checkId = ISOLATION_CHECK_MAP[v.violationType] ?? `scan-${v.violationType}`;
      return v.affectedIds.map((entityId) =>
        buildIntegrityFinding({
          checkId,
          category: "financial",
          severity: "critical",
          organizationId,
          entityType: v.violationType,
          entityId,
          explanation: v.explanation,
          probableRootCause: v.violationType,
          suggestedAction: v.recommendedAction,
          correlationId: `isolation:${v.violationType}:${entityId}`,
        }),
      );
    });
}

/** @deprecated Use mapCoreIsolationViolationsToFindings — full mapping reserved for Phase 2.3B */
export function mapIsolationViolationsToFindings(
  organizationId: string,
  violations: ScannerIsolationViolation[],
): IntegrityFinding[] {
  return mapCoreIsolationViolationsToFindings(organizationId, violations);
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
