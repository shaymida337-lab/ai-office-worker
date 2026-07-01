import { defaultRecoveryCapabilities } from "./reliabilityRecoveryFramework.js";
import type { ReliabilityRegistryEntry, ReliabilitySubsystemId } from "./reliabilityTypes.js";
import { RELIABILITY_SUBSYSTEM_IDS } from "./reliabilityTypes.js";

const SCANNER_STAGES = [
  "ingestion",
  "classification",
  "extraction",
  "decision",
  "persistence",
] as const;

const GMAIL_STAGES = ["connect", "list", "fetch", "parse", "handoff"] as const;
const DRIVE_STAGES = ["auth", "folder", "upload", "link"] as const;
const CLAUDE_STAGES = ["request", "response", "parse", "validate"] as const;
const OUTCOME_STAGES = ["trust", "fse", "duplicate", "decide", "gate"] as const;
const PAYMENT_STAGES = ["eligibility", "persist", "sheet_sync", "approve"] as const;
const INVOICE_STAGES = ["classify", "extract", "review", "persist"] as const;
const DASHBOARD_STAGES = ["load", "aggregate", "render"] as const;
const TASK_STAGES = ["enqueue", "execute", "complete"] as const;
const CALENDAR_STAGES = ["sync", "mirror", "decision_queue", "notify"] as const;
const WHATSAPP_STAGES = ["webhook", "ingest", "extract"] as const;
const VOICE_STAGES = ["capture", "transcribe", "route"] as const;

export const RELIABILITY_REGISTRY: readonly ReliabilityRegistryEntry[] = [
  {
    id: "scanner",
    label: "Scanner",
    description: "Gmail ingestion through persistence observability (health, golden suite).",
    category: "platform",
    monitored: true,
    placeholder: false,
    stages: SCANNER_STAGES,
    recovery: defaultRecoveryCapabilities("scanner", {
      canRetry: true,
      canRequeue: true,
      recoveryNotes: "Scan retries via cron/incremental; no auto-recovery implemented yet.",
    }),
  },
  {
    id: "gmail",
    label: "Gmail",
    description: "Gmail API connectivity, mailbox sync, and message ingestion.",
    category: "ingestion",
    monitored: true,
    placeholder: false,
    stages: GMAIL_STAGES,
    recovery: defaultRecoveryCapabilities("gmail", {
      canRetry: true,
      canRestart: true,
      recoveryNotes: "Stuck scans detectable; manual resume only today.",
    }),
  },
  {
    id: "drive",
    label: "Drive",
    description: "Google Drive folder tree and document upload linkage.",
    category: "integration",
    monitored: true,
    placeholder: false,
    stages: DRIVE_STAGES,
    recovery: defaultRecoveryCapabilities("drive", {
      canRetry: true,
      recoveryNotes: "Upload retries pending_retry status; no auto-heal.",
    }),
  },
  {
    id: "claude_extraction",
    label: "Claude extraction",
    description: "LLM extraction and structured field parsing.",
    category: "ai",
    monitored: false,
    placeholder: false,
    stages: CLAUDE_STAGES,
    recovery: defaultRecoveryCapabilities("claude_extraction", {
      canRetry: true,
      recoveryNotes: "Transient API failures may be retried in future.",
    }),
  },
  {
    id: "outcome_engine",
    label: "Outcome Engine",
    description: "Trust/FSE/outcome gating and terminal decision routing.",
    category: "decision",
    monitored: false,
    placeholder: false,
    stages: OUTCOME_STAGES,
    recovery: defaultRecoveryCapabilities("outcome_engine", {
      needsHumanReview: true,
      recoveryNotes: "Blocked outcomes require human review; no auto override.",
    }),
  },
  {
    id: "payments",
    label: "Payments",
    description: "Supplier payment persistence, sheets sync, and approval.",
    category: "persistence",
    monitored: false,
    placeholder: false,
    stages: PAYMENT_STAGES,
    recovery: defaultRecoveryCapabilities("payments", {
      needsHumanReview: true,
      recoveryNotes: "Financial rows require accountant review before auto actions.",
    }),
  },
  {
    id: "invoice_creation",
    label: "Invoice creation",
    description: "Invoice and financial document review creation flows.",
    category: "persistence",
    monitored: false,
    placeholder: false,
    stages: INVOICE_STAGES,
    recovery: defaultRecoveryCapabilities("invoice_creation", {
      needsHumanReview: true,
    }),
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Operational dashboard data loading and aggregation.",
    category: "surface",
    monitored: false,
    placeholder: false,
    stages: DASHBOARD_STAGES,
    recovery: defaultRecoveryCapabilities("dashboard", {
      canRetry: true,
      safeAutomaticRecovery: false,
    }),
  },
  {
    id: "tasks",
    label: "Tasks",
    description: "Background tasks and work queues.",
    category: "platform",
    monitored: false,
    placeholder: false,
    stages: TASK_STAGES,
    recovery: defaultRecoveryCapabilities("tasks", {
      canRequeue: true,
      canRetry: true,
    }),
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Calendar engine, Google mirror, and decision queue.",
    category: "surface",
    monitored: false,
    placeholder: false,
    stages: CALENDAR_STAGES,
    recovery: defaultRecoveryCapabilities("calendar", {
      canRetry: true,
      canRestart: true,
    }),
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "WhatsApp webhook ingestion and invoice intake (placeholder monitoring).",
    category: "ingestion",
    monitored: false,
    placeholder: true,
    stages: WHATSAPP_STAGES,
    recovery: defaultRecoveryCapabilities("whatsapp", {
      recoveryNotes: "Placeholder — recovery design reserved for future WhatsApp work.",
    }),
  },
  {
    id: "voice",
    label: "Voice",
    description: "Voice capture and transcription routing (placeholder monitoring).",
    category: "ai",
    monitored: false,
    placeholder: true,
    stages: VOICE_STAGES,
    recovery: defaultRecoveryCapabilities("voice", {
      recoveryNotes: "Placeholder — recovery design reserved for future voice work.",
    }),
  },
] as const;

const registryById = new Map<ReliabilitySubsystemId, ReliabilityRegistryEntry>(
  RELIABILITY_REGISTRY.map((entry) => [entry.id, entry]),
);

export function getReliabilityRegistryEntry(
  id: ReliabilitySubsystemId,
): ReliabilityRegistryEntry | undefined {
  return registryById.get(id);
}

export function listReliabilityRegistryEntries(): ReliabilityRegistryEntry[] {
  return [...RELIABILITY_REGISTRY];
}

export function listMonitoredReliabilitySubsystems(): ReliabilityRegistryEntry[] {
  return RELIABILITY_REGISTRY.filter((entry) => entry.monitored);
}

export function listPlaceholderReliabilitySubsystems(): ReliabilityRegistryEntry[] {
  return RELIABILITY_REGISTRY.filter((entry) => entry.placeholder);
}

export function validateReliabilityRegistryIntegrity(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const expectedId of RELIABILITY_SUBSYSTEM_IDS) {
    if (!registryById.has(expectedId)) {
      errors.push(`missing registry entry for subsystem: ${expectedId}`);
    }
  }

  for (const entry of RELIABILITY_REGISTRY) {
    if (seen.has(entry.id)) {
      errors.push(`duplicate registry id: ${entry.id}`);
    }
    seen.add(entry.id);
    if (!entry.label.trim()) errors.push(`empty label for ${entry.id}`);
    if (entry.stages.length === 0) errors.push(`no stages declared for ${entry.id}`);
    if (entry.placeholder && entry.monitored) {
      errors.push(`placeholder subsystem cannot be monitored: ${entry.id}`);
    }
  }

  if (RELIABILITY_REGISTRY.length !== RELIABILITY_SUBSYSTEM_IDS.length) {
    errors.push(
      `registry size ${RELIABILITY_REGISTRY.length} does not match canonical id list ${RELIABILITY_SUBSYSTEM_IDS.length}`,
    );
  }

  return { valid: errors.length === 0, errors };
}
