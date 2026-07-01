import type { IntegrityCheckDefinition } from "./integrityTypes.js";

/** Phase 2.3A — production MVP validators (implemented). */
export const CORE_INTEGRITY_CHECKS: readonly IntegrityCheckDefinition[] = [
  def("fin-payment-without-source", "financial", "Payment without source document", "SupplierPayment has no email, document link, or drive file", "critical", true),
  def("fin-payment-after-blocked", "financial", "Payment after BLOCKED decision", "Financial row persisted after BLOCKED outcome", "critical", true),
  def("fin-duplicate-fingerprint", "financial", "Duplicate fingerprint", "Multiple payments share documentFingerprint", "critical", true),
  def("fin-zero-amount-forbidden", "financial", "Zero amount on financial document", "Payment or invoice with amount=0", "critical", true),
  def("org-cross-org-reference", "organization", "Cross-org reference", "Entity references foreign organization data", "critical", true),
  def("scan-stuck", "scanner", "Stuck scan", "Active gmail scan exceeded stale threshold", "critical", true),
  def("scan-orphan-gmail-message", "scanner", "Orphan Gmail message", "Email without scan or review", "critical", true),
  def("int-gmail-invalid", "integration", "Gmail disconnected or invalid", "Gmail missing, expired, or invalid OAuth", "critical", true),
];

/** Phase 2.3B — planned validators (not implemented). */
export const PLACEHOLDER_INTEGRITY_CHECKS: readonly IntegrityCheckDefinition[] = [
  placeholder("fin-invoice-without-source", "financial", "Invoice without source document"),
  placeholder("fin-payment-without-supplier", "financial", "Supplier payment without supplier"),
  placeholder("fin-missing-currency", "financial", "Missing currency"),
  placeholder("fin-duplicate-payment", "financial", "Duplicate payment flag"),
  placeholder("fin-conflicting-amounts", "financial", "Conflicting amounts"),
  placeholder("fin-missing-review-before-persist", "financial", "Missing review before persistence"),
  placeholder("scan-without-review", "scanner", "Scan without review"),
  placeholder("scan-review-without-scan", "scanner", "Review without scan"),
  placeholder("scan-repeated-failures", "scanner", "Repeated scan failures"),
  placeholder("scan-missing-drive-link", "scanner", "Missing Drive link"),
  placeholder("scan-attachment-mismatch", "scanner", "Attachment mismatch"),
  placeholder("org-cross-org-gmail-id", "organization", "Cross-org Gmail IDs"),
  placeholder("org-organization-mismatch", "organization", "Organization mismatch"),
  placeholder("org-foreign-entity-reference", "organization", "Foreign entity reference"),
  placeholder("org-ownership-anomaly", "organization", "Ownership anomaly"),
  placeholder("dash-db-totals", "dashboard", "Dashboard totals equal DB totals"),
  placeholder("dash-review-count", "dashboard", "Review count consistency"),
  placeholder("dash-pending-count", "dashboard", "Pending count consistency"),
  placeholder("dash-overdue-count", "dashboard", "Overdue count consistency"),
  placeholder("dash-activity-timeline", "dashboard", "Activity timeline consistency"),
  placeholder("int-drive-connected", "integration", "Drive connected"),
  placeholder("int-token-expiring", "integration", "Token expiration approaching"),
  placeholder("int-dependency-health", "integration", "Dependency health"),
  placeholder("int-claude-available", "integration", "Claude available"),
];

export const INTEGRITY_CHECK_REGISTRY: readonly IntegrityCheckDefinition[] = [
  ...CORE_INTEGRITY_CHECKS,
  ...PLACEHOLDER_INTEGRITY_CHECKS,
];

function def(
  checkId: string,
  category: IntegrityCheckDefinition["category"],
  title: string,
  description: string,
  defaultSeverity: IntegrityCheckDefinition["defaultSeverity"],
  implemented: boolean,
): IntegrityCheckDefinition {
  return { checkId, category, title, description, defaultSeverity, readOnly: true, implemented };
}

function placeholder(
  checkId: string,
  category: IntegrityCheckDefinition["category"],
  title: string,
): IntegrityCheckDefinition {
  return {
    checkId,
    category,
    title,
    description: `Planned for Phase 2.3B — ${title}`,
    defaultSeverity: "warning",
    readOnly: true,
    implemented: false,
  };
}

export function getIntegrityCheckDefinition(checkId: string): IntegrityCheckDefinition | undefined {
  return INTEGRITY_CHECK_REGISTRY.find((c) => c.checkId === checkId);
}

export function listImplementedIntegrityCheckIds(): string[] {
  return CORE_INTEGRITY_CHECKS.map((c) => c.checkId);
}

export function listPlaceholderIntegrityCheckIds(): string[] {
  return PLACEHOLDER_INTEGRITY_CHECKS.map((c) => c.checkId);
}

export function listIntegrityChecksByCategory(
  category: IntegrityCheckDefinition["category"],
): IntegrityCheckDefinition[] {
  return INTEGRITY_CHECK_REGISTRY.filter((c) => c.category === category);
}

export function listAllIntegrityCheckIds(): string[] {
  return INTEGRITY_CHECK_REGISTRY.map((c) => c.checkId);
}
