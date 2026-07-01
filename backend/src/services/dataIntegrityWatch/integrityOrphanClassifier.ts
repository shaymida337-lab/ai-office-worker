import type { IntegrityEmailMessageRow } from "./integrityDb.js";
import {
  DEFAULT_INTEGRITY_SIGNAL_CONFIG,
  type IntegritySignalConfig,
} from "./integritySignalConfig.js";

export const ORPHAN_SIGNAL_DISPOSITIONS = ["CRITICAL", "WARNING", "INFO", "IGNORED"] as const;

export type OrphanSignalDisposition = (typeof ORPHAN_SIGNAL_DISPOSITIONS)[number];

export type OrphanClassification = {
  disposition: OrphanSignalDisposition;
  reason: string;
  findingConfidence: number;
  signals: string[];
};

export function classifyOrphanEmailMessage(
  email: IntegrityEmailMessageRow,
  now: Date,
  config: IntegritySignalConfig = DEFAULT_INTEGRITY_SIGNAL_CONFIG,
): OrphanClassification {
  const signals: string[] = [];
  const subject = email.subject ?? "";
  const sender = email.fromAddress ?? "";
  const processedAt = email.processedAt;
  const referenceTime = processedAt ?? email.receivedAt;
  const ageMs = now.getTime() - referenceTime.getTime();

  if (ageMs < config.orphanGracePeriodMs) {
    return {
      disposition: "IGNORED",
      reason: "Within grace period — may still be in-flight or awaiting artifact linkage.",
      findingConfidence: 0.2,
      signals: ["grace_period"],
    };
  }

  if (matchesAny(config.systemMailPatterns, sender) || matchesAny(config.junkSubjectPatterns, subject)) {
    signals.push("system_or_junk_mail");
    return {
      disposition: "IGNORED",
      reason: "System or junk mail — expected processed email without financial scan artifact.",
      findingConfidence: 0.15,
      signals,
    };
  }

  const isTestSender = matchesAny(config.testSenderPatterns, sender);
  const isInvoiceLike = matchesAny(config.invoiceSubjectPatterns, subject);

  if (isTestSender) {
    signals.push("test_sender");
    return {
      disposition: "INFO",
      reason: "Test sender email processed without GSI/FDR — likely test traffic, not customer risk.",
      findingConfidence: 0.75,
      signals,
    };
  }

  if (isInvoiceLike) {
    signals.push("invoice_subject", "past_grace_period", "no_gsi_or_fdr");
    return {
      disposition: "CRITICAL",
      reason: "Invoice-like email past grace period with no GmailScanItem or FinancialDocumentReview.",
      findingConfidence: 0.88,
      signals,
    };
  }

  signals.push("processed_no_artifact", "non_invoice_subject");
  return {
    disposition: "INFO",
    reason: "Non-invoice email processed without scan artifact — expected for non-financial mail.",
    findingConfidence: 0.7,
    signals,
  };
}

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function orphanDispositionToSeverity(
  disposition: OrphanSignalDisposition,
): "critical" | "important" | "warning" | "info" | null {
  switch (disposition) {
    case "CRITICAL":
      return "critical";
    case "WARNING":
      return "warning";
    case "INFO":
      return "info";
    case "IGNORED":
      return null;
    default:
      return null;
  }
}
