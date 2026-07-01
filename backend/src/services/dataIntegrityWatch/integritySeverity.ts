/**
 * Phase 2.3B severity framework (read-only classification rules).
 *
 * CRITICAL    — customer money at risk, cross-tenant financial leak, wrong persistence
 * IMPORTANT   — potential production issue requiring investigation
 * WARNING     — unexpected but explainable; historical anomaly
 * INFO        — operational observation; no customer risk
 */

export const INTEGRITY_SEVERITY_FRAMEWORK = {
  critical: [
    "customer_money_at_risk",
    "cross_tenant_financial_leak",
    "wrong_persistence_after_blocked",
    "payment_without_source",
    "duplicate_fingerprint",
    "zero_amount_financial",
    "stuck_scan",
    "gmail_invalid",
    "invoice_orphan_past_grace",
  ],
  important: ["potential_production_issue"],
  warning: [
    "historical_duplicate_rescan",
    "shared_mailbox_history",
    "sibling_org_artifact",
    "invoice_subject_no_financial_attachment",
    "test_subject_investigation_candidate",
    "unexpected_but_explainable",
  ],
  info: [
    "test_traffic",
    "test_sender",
    "test_subject_no_financial_attachment",
    "unsupported_attachment_only",
    "non_financial_processed",
    "operational_observation",
  ],
} as const;
