import type { JourneyDefinition } from "./journeyTypes.js";
import { JOURNEY_RELIABILITY_VERSION } from "./journeyTypes.js";

/**
 * Canonical registry of Natalie customer journeys.
 * WhatsApp entries are design-only (implemented: false).
 */
export const JOURNEY_REGISTRY: readonly JourneyDefinition[] = [
  {
    journeyId: "cj-fin-001-gmail-invoice-to-payment",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "financial_documents",
    title: "Gmail tax invoice → scan → extraction → decision → drive → review → supplier payment",
    description:
      "Full financial document lifecycle from Gmail ingestion through supplier payment persistence.",
    criticality: "critical",
    steps: [
      { stepId: "s1", kind: "gmail_ingest", subsystem: "gmail", label: "Gmail message received" },
      { stepId: "s2", kind: "scan", subsystem: "scanner", label: "Scanner ingests attachment" },
      { stepId: "s3", kind: "ai_extraction", subsystem: "claude_extraction", label: "Claude extracts fields" },
      { stepId: "s4", kind: "decision", subsystem: "outcome_engine", label: "Outcome engine decides" },
      { stepId: "s5", kind: "drive_upload", subsystem: "drive", label: "Document archived to Drive" },
      { stepId: "s6", kind: "review", subsystem: "invoice_creation", label: "Review queue (if needed)" },
      { stepId: "s7", kind: "persistence", subsystem: "payments", label: "Supplier payment persisted" },
      { stepId: "s8", kind: "dashboard_visibility", subsystem: "dashboard", label: "Visible on dashboard" },
      { stepId: "s9", kind: "audit_log", subsystem: "scanner", label: "Audit trail recorded" },
    ],
    assertions: [
      "no_duplicate_records",
      "correct_fingerprint",
      "organization_isolation",
      "correct_supplier",
      "correct_amount",
      "correct_payment_direction",
      "correct_review_state",
      "confidence_threshold",
      "dashboard_state",
      "event_emission",
      "audit_log_present",
      "correct_persistence",
    ],
    expectedOutcome: {
      persistenceAction: "auto_save_payment",
      reviewStatus: "auto_saved",
      decisionOutcome: "SAVED",
      dashboardVisible: true,
      supplierName: "Acme",
      amount: 1180,
      currency: "ILS",
      paymentDirection: "incoming_expense",
      recordCount: 1,
      auditLogEntries: 1,
      reliabilityEventTypes: [],
      notificationSent: false,
    },
    failureScenarios: [
      {
        scenarioId: "fi-claude-timeout",
        injection: "claude_timeout",
        atStepId: "s3",
        description: "Claude API times out during extraction",
        expectedBehavior: {
          noIncorrectPersistence: true,
          noDataCorruption: true,
          properReviewRouting: true,
          reliabilityEventExpected: true,
          recoveryPathDeclared: true,
        },
      },
      {
        scenarioId: "fi-drive-unavailable",
        injection: "drive_unavailable",
        atStepId: "s5",
        description: "Drive upload fails but payment path continues",
        expectedBehavior: {
          noIncorrectPersistence: true,
          noDataCorruption: true,
          properReviewRouting: true,
          reliabilityEventExpected: true,
          recoveryPathDeclared: true,
        },
      },
    ],
    tags: ["gmail", "invoice", "auto-save", "financial"],
    goldenSuiteCaseId: "gs-001-perfect-tax-invoice",
    implemented: true,
  },
  {
    journeyId: "cj-fin-002-gmail-receipt-archive",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "financial_documents",
    title: "Gmail receipt → scan → archive",
    description: "Receipt ingested and archived without supplier payment.",
    criticality: "standard",
    steps: [
      { stepId: "s1", kind: "gmail_ingest", subsystem: "gmail", label: "Gmail message received" },
      { stepId: "s2", kind: "scan", subsystem: "scanner", label: "Scanner ingests receipt" },
      { stepId: "s3", kind: "ai_extraction", subsystem: "claude_extraction", label: "Extract receipt fields" },
      { stepId: "s4", kind: "decision", subsystem: "outcome_engine", label: "Classify as receipt" },
      { stepId: "s5", kind: "drive_upload", subsystem: "drive", label: "Archive to Drive" },
      { stepId: "s6", kind: "dashboard_visibility", subsystem: "dashboard", label: "Receipt visible" },
    ],
    assertions: [
      "correct_persistence",
      "dashboard_state",
      "audit_log_present",
      "no_duplicate_records",
      "organization_isolation",
    ],
    expectedOutcome: {
      persistenceAction: "auto_save_payment",
      reviewStatus: "auto_saved",
      decisionOutcome: "SAVED",
      dashboardVisible: true,
      documentType: "receipt",
      recordCount: 1,
      auditLogEntries: 1,
    },
    tags: ["gmail", "receipt", "archive"],
    scaffoldOnly: true,
    implemented: false,
  },
  {
    journeyId: "cj-fin-003-non-financial-ignore",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "financial_documents",
    title: "Gmail non-financial → scan → ignore",
    description: "Non-financial email correctly ignored with no persistence.",
    criticality: "critical",
    steps: [
      { stepId: "s1", kind: "gmail_ingest", subsystem: "gmail", label: "Gmail message received" },
      { stepId: "s2", kind: "scan", subsystem: "scanner", label: "Scanner classifies" },
      { stepId: "s3", kind: "decision", subsystem: "outcome_engine", label: "NOT_FINANCIAL decision" },
    ],
    assertions: [
      "no_incorrect_persistence",
      "correct_persistence",
      "event_emission",
      "organization_isolation",
    ],
    expectedOutcome: {
      persistenceAction: "not_persisted",
      reviewStatus: "rejected",
      decisionOutcome: "NOT_FINANCIAL",
      dashboardVisible: false,
      recordCount: 0,
      auditLogEntries: 1,
    },
    tags: ["gmail", "non-financial", "ignore"],
    scaffoldOnly: true,
    implemented: false,
  },
  {
    journeyId: "cj-fin-004-duplicate-no-persistence",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "financial_documents",
    title: "Duplicate invoice → detection → no new persistence",
    description: "Duplicate fingerprint detected; no duplicate payment created.",
    criticality: "critical",
    steps: [
      { stepId: "s1", kind: "gmail_ingest", subsystem: "gmail", label: "Duplicate email arrives" },
      { stepId: "s2", kind: "scan", subsystem: "scanner", label: "Scanner processes" },
      { stepId: "s3", kind: "decision", subsystem: "outcome_engine", label: "Duplicate detected" },
      { stepId: "s4", kind: "persistence", subsystem: "payments", label: "No new record" },
    ],
    assertions: [
      "no_duplicate_records",
      "correct_fingerprint",
      "no_incorrect_persistence",
      "event_emission",
      "recovery_declaration",
    ],
    expectedOutcome: {
      persistenceAction: "duplicate_update",
      reviewStatus: "rejected",
      decisionOutcome: "DUPLICATE",
      dashboardVisible: true,
      recordCount: 1,
      auditLogEntries: 1,
      reliabilityEventTypes: ["duplicate_regression_detected"],
    },
    failureScenarios: [
      {
        scenarioId: "fi-duplicate-document",
        injection: "duplicate_document",
        atStepId: "s3",
        expectedBehavior: {
          noIncorrectPersistence: true,
          noDataCorruption: true,
          properReviewRouting: true,
          reliabilityEventExpected: true,
          recoveryPathDeclared: false,
        },
      },
    ],
    tags: ["duplicate", "gmail", "financial"],
    scaffoldOnly: true,
    implemented: false,
  },
  {
    journeyId: "cj-wa-001-image-to-payment",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "whatsapp",
    title: "WhatsApp image → OCR → AI → review → payment",
    description: "Design only — WhatsApp image intake journey.",
    criticality: "critical",
    steps: [
      { stepId: "s1", kind: "whatsapp_ingest", subsystem: "whatsapp", label: "WhatsApp image received" },
      { stepId: "s2", kind: "ocr", subsystem: "scanner", label: "OCR extraction" },
      { stepId: "s3", kind: "ai_extraction", subsystem: "claude_extraction", label: "AI field extraction" },
      { stepId: "s4", kind: "review", subsystem: "invoice_creation", label: "Manual review" },
      { stepId: "s5", kind: "persistence", subsystem: "payments", label: "Payment created" },
    ],
    assertions: ["correct_persistence", "dashboard_state", "permissions_enforced"],
    expectedOutcome: {
      persistenceAction: "needs_review_fdr",
      reviewStatus: "needs_review",
      decisionOutcome: "NEEDS_REVIEW",
      dashboardVisible: true,
      recordCount: 1,
    },
    tags: ["whatsapp", "image", "design-only"],
    scaffoldOnly: true,
    implemented: false,
  },
  {
    journeyId: "cj-man-001-upload-to-dashboard",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "manual_upload",
    title: "Manual upload PDF → extraction → review → persistence → dashboard",
    description: "User uploads PDF through UI; full processing pipeline.",
    criticality: "critical",
    steps: [
      { stepId: "s1", kind: "manual_upload", subsystem: "scanner", label: "PDF uploaded" },
      { stepId: "s2", kind: "ai_extraction", subsystem: "claude_extraction", label: "AI extraction" },
      { stepId: "s3", kind: "review", subsystem: "invoice_creation", label: "Review queue" },
      { stepId: "s4", kind: "persistence", subsystem: "payments", label: "Persist payment" },
      { stepId: "s5", kind: "dashboard_visibility", subsystem: "dashboard", label: "Dashboard updated" },
    ],
    assertions: [
      "correct_persistence",
      "dashboard_state",
      "audit_log_present",
      "permissions_enforced",
      "organization_isolation",
    ],
    expectedOutcome: {
      persistenceAction: "needs_review_fdr",
      reviewStatus: "needs_review",
      decisionOutcome: "NEEDS_REVIEW",
      dashboardVisible: true,
      recordCount: 1,
      auditLogEntries: 1,
    },
    tags: ["manual-upload", "pdf"],
    scaffoldOnly: true,
    implemented: false,
  },
  {
    journeyId: "cj-cal-001-meeting-to-reminder",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "calendar",
    title: "Meeting request → AI → availability → event → reminder → dashboard",
    description: "Calendar meeting scheduling from chat request.",
    criticality: "standard",
    steps: [
      { stepId: "s1", kind: "gmail_ingest", subsystem: "voice", label: "Meeting request received" },
      { stepId: "s2", kind: "ai_extraction", subsystem: "claude_extraction", label: "AI understands request" },
      { stepId: "s3", kind: "availability_check", subsystem: "calendar", label: "Check availability" },
      { stepId: "s4", kind: "event_creation", subsystem: "calendar", label: "Create calendar event" },
      { stepId: "s5", kind: "reminder", subsystem: "calendar", label: "Schedule reminder" },
      { stepId: "s6", kind: "dashboard_visibility", subsystem: "dashboard", label: "Event on dashboard" },
    ],
    assertions: ["dashboard_state", "event_emission", "notification_sent", "audit_log_present"],
    expectedOutcome: {
      persistenceAction: "none",
      reviewStatus: "auto_saved",
      decisionOutcome: "SAVED",
      dashboardVisible: true,
      notificationSent: true,
      recordCount: 1,
      auditLogEntries: 1,
    },
    tags: ["calendar", "meeting"],
    scaffoldOnly: true,
    implemented: false,
  },
  {
    journeyId: "cj-task-001-chat-to-completion",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "tasks",
    title: "Chat → task creation → assignment → reminder → completion",
    description: "Task lifecycle from conversational creation to completion.",
    criticality: "standard",
    steps: [
      { stepId: "s1", kind: "gmail_ingest", subsystem: "voice", label: "Chat message" },
      { stepId: "s2", kind: "task_creation", subsystem: "tasks", label: "Task created" },
      { stepId: "s3", kind: "task_assignment", subsystem: "tasks", label: "Task assigned" },
      { stepId: "s4", kind: "reminder", subsystem: "tasks", label: "Reminder scheduled" },
      { stepId: "s5", kind: "task_completion", subsystem: "tasks", label: "Task completed" },
      { stepId: "s6", kind: "dashboard_visibility", subsystem: "dashboard", label: "Task on dashboard" },
    ],
    assertions: ["dashboard_state", "event_emission", "audit_log_present", "correct_status"],
    expectedOutcome: {
      persistenceAction: "none",
      reviewStatus: "auto_saved",
      decisionOutcome: "SAVED",
      dashboardVisible: true,
      recordCount: 1,
      auditLogEntries: 2,
    },
    tags: ["tasks", "chat"],
    scaffoldOnly: true,
    implemented: false,
  },
  {
    journeyId: "cj-pay-001-invoice-to-reports",
    version: JOURNEY_RELIABILITY_VERSION,
    category: "payments",
    title: "Invoice approved → supplier payment → approval → dashboard → reports",
    description: "Payment approval workflow through to reporting.",
    criticality: "critical",
    steps: [
      { stepId: "s1", kind: "review", subsystem: "invoice_creation", label: "Invoice approved" },
      { stepId: "s2", kind: "persistence", subsystem: "payments", label: "Supplier payment created" },
      { stepId: "s3", kind: "payment_approval", subsystem: "payments", label: "Payment approved" },
      { stepId: "s4", kind: "dashboard_visibility", subsystem: "dashboard", label: "Payment on dashboard" },
      { stepId: "s5", kind: "report_generation", subsystem: "dashboard", label: "Reports updated" },
      { stepId: "s6", kind: "audit_log", subsystem: "payments", label: "Audit trail" },
    ],
    assertions: [
      "correct_amount",
      "correct_supplier",
      "correct_persistence",
      "dashboard_state",
      "audit_log_present",
      "permissions_enforced",
      "organization_isolation",
    ],
    expectedOutcome: {
      persistenceAction: "auto_save_payment",
      reviewStatus: "auto_saved",
      decisionOutcome: "SAVED",
      dashboardVisible: true,
      recordCount: 1,
      auditLogEntries: 2,
    },
    tags: ["payments", "approval", "reports"],
    scaffoldOnly: true,
    implemented: false,
  },
] as const;

export function findJourneyInRegistry(journeyId: string): JourneyDefinition | undefined {
  return JOURNEY_REGISTRY.find((j) => j.journeyId === journeyId);
}

export function listJourneysByCategory(category: JourneyDefinition["category"]): JourneyDefinition[] {
  return JOURNEY_REGISTRY.filter((j) => j.category === category);
}

export function listImplementedJourneys(): JourneyDefinition[] {
  return JOURNEY_REGISTRY.filter((j) => j.implemented === true);
}

export function listCriticalJourneys(): JourneyDefinition[] {
  return JOURNEY_REGISTRY.filter((j) => j.criticality === "critical");
}

export function buildJourneyDatasetFromRegistry(): {
  version: typeof JOURNEY_RELIABILITY_VERSION;
  journeys: JourneyDefinition[];
} {
  return {
    version: JOURNEY_RELIABILITY_VERSION,
    journeys: [...JOURNEY_REGISTRY],
  };
}
