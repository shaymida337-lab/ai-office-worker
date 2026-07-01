import type { DataIntegrityCheckKind, DataIntegrityFinding, DataIntegritySeverity } from "./hardeningTypes.js";
import { DATA_INTEGRITY_CHECK_KINDS } from "./hardeningTypes.js";

export type DataIntegrityWatchReport = {
  generatedAt: string;
  organizationId: string | null;
  checksRun: number;
  findings: DataIntegrityFinding[];
  criticalCount: number;
  warningCount: number;
  passed: boolean;
  autoFixEnabled: false;
};

export type DataIntegrityCheckDefinition = {
  checkKind: DataIntegrityCheckKind;
  description: string;
  defaultSeverity: DataIntegritySeverity;
  readOnly: true;
  queryDescription: string;
};

export const DATA_INTEGRITY_CHECK_CATALOG: readonly DataIntegrityCheckDefinition[] = [
  check("payment_without_source_document", "Payment exists without linked source document", "critical", "JOIN payments WHERE source document ref IS NULL"),
  check("document_without_file", "Financial document record without file attachment", "warning", "Documents with missing Drive/file reference"),
  check("invoice_without_organization", "Invoice missing organizationId", "critical", "Invoices WHERE organizationId IS NULL"),
  check("duplicate_fingerprint", "Same fingerprint persisted multiple times in org", "critical", "GROUP BY fingerprint HAVING COUNT > 1"),
  check("zero_amount_financial_document", "Financial document with zero amount", "warning", "Payments/invoices with amount = 0 AND type financial"),
  check("missing_supplier_on_payment", "Supplier payment without supplier name", "critical", "Payments WHERE supplier IS NULL OR empty"),
  check("cross_org_data_anomaly", "Entity references data from another organization", "critical", "Cross-org gmailId / fingerprint leakage"),
  check("review_stuck_too_long", "FDR in review state beyond threshold", "warning", "FDR WHERE status=needs_review AND age > 7d"),
  check("drive_link_mismatch", "Drive link does not match document metadata", "warning", "Drive URL vs stored fileId mismatch"),
  check("dashboard_count_mismatch", "Dashboard aggregate differs from DB count", "warning", "Compare dashboard KPI vs SELECT COUNT"),
];

function check(
  checkKind: DataIntegrityCheckKind,
  description: string,
  defaultSeverity: DataIntegritySeverity,
  queryDescription: string,
): DataIntegrityCheckDefinition {
  return { checkKind, description, defaultSeverity, readOnly: true, queryDescription };
}

export function buildDataIntegrityFinding(
  input: Omit<DataIntegrityFinding, "autoFixAllowed" | "detectedAt"> & { detectedAt?: string },
): DataIntegrityFinding {
  return {
    ...input,
    autoFixAllowed: false,
    detectedAt: input.detectedAt ?? new Date().toISOString(),
  };
}

export function buildDataIntegrityWatchReport(
  findings: DataIntegrityFinding[],
  organizationId: string | null = null,
): DataIntegrityWatchReport {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  return {
    generatedAt: new Date().toISOString(),
    organizationId,
    checksRun: DATA_INTEGRITY_CHECK_KINDS.length,
    findings,
    criticalCount,
    warningCount,
    passed: criticalCount === 0,
    autoFixEnabled: false,
  };
}

export function classifyDataIntegrityResult(report: DataIntegrityWatchReport): "pass" | "warn" | "fail" {
  if (report.criticalCount > 0) return "fail";
  if (report.warningCount > 0) return "warn";
  return "pass";
}

export function listAllIntegrityCheckKinds(): DataIntegrityCheckKind[] {
  return [...DATA_INTEGRITY_CHECK_KINDS];
}

/** Phase 2.3 production implementation lives in `services/dataIntegrityWatch/`. */
export { INTEGRITY_WATCH_VERSION as PRODUCTION_INTEGRITY_WATCH_VERSION } from "../dataIntegrityWatch/integrityTypes.js";
export { listAllIntegrityCheckIds as listProductionIntegrityCheckIds } from "../dataIntegrityWatch/integrityRegistry.js";
