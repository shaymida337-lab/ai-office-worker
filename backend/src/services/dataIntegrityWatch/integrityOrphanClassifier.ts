import type {
  IntegrityEmailAttachmentRow,
  IntegrityEmailMessageRow,
  IntegritySiblingArtifactSummary,
} from "./integrityDb.js";
import { analyzeOrphanAttachments } from "./integrityAttachmentSignals.js";
import {
  DEFAULT_INTEGRITY_SIGNAL_CONFIG,
  type IntegritySignalConfig,
} from "./integritySignalConfig.js";

export const ORPHAN_SIGNAL_DISPOSITIONS = ["CRITICAL", "WARNING", "INFO", "IGNORED"] as const;

export type OrphanSignalDisposition = (typeof ORPHAN_SIGNAL_DISPOSITIONS)[number];

export type OrphanClassificationContext = {
  attachments?: IntegrityEmailAttachmentRow[];
  siblingArtifacts?: IntegritySiblingArtifactSummary | null;
};

export type OrphanClassification = {
  disposition: OrphanSignalDisposition;
  reason: string;
  findingConfidence: number;
  signals: string[];
  probableRootCause: string;
};

export function classifyOrphanEmailMessage(
  email: IntegrityEmailMessageRow,
  now: Date,
  config: IntegritySignalConfig = DEFAULT_INTEGRITY_SIGNAL_CONFIG,
  context: OrphanClassificationContext = {},
): OrphanClassification {
  const signals: string[] = [];
  const subject = email.subject ?? "";
  const sender = email.fromAddress ?? "";
  const processedAt = email.processedAt;
  const referenceTime = processedAt ?? email.receivedAt;
  const ageMs = now.getTime() - referenceTime.getTime();
  const attachments = context.attachments ?? [];
  const attachmentAnalysis = analyzeOrphanAttachments(attachments, config);
  const sibling = context.siblingArtifacts ?? null;

  if (ageMs < config.orphanGracePeriodMs) {
    return pack({
      disposition: "IGNORED",
      reason: "Within grace period — may still be in-flight or awaiting artifact linkage.",
      findingConfidence: 0.2,
      signals: ["grace_period"],
      probableRootCause: "grace_period",
    });
  }

  if (matchesAny(config.systemMailPatterns, sender) || matchesAny(config.junkSubjectPatterns, subject)) {
    signals.push("system_or_junk_mail");
    return pack({
      disposition: "IGNORED",
      reason: "System or junk mail — expected processed email without financial scan artifact.",
      findingConfidence: 0.15,
      signals,
      probableRootCause: "system_or_junk_mail",
    });
  }

  const isTestSender = matchesAny(config.testSenderPatterns, sender);
  const isTestSubject = matchesAny(config.testSubjectPatterns, subject);
  const isInvoiceLike = matchesAny(config.invoiceSubjectPatterns, subject);

  if (isTestSender) {
    signals.push("test_sender");
    return pack({
      disposition: "INFO",
      reason: "Test sender email processed without GSI/FDR — likely internal QA, not customer risk.",
      findingConfidence: computeOrphanConfidence({
        disposition: "INFO",
        signals,
        isTestSender: true,
        isTestSubject,
        attachmentAnalysis,
        siblingPresent: Boolean(sibling?.hasArtifact),
      }),
      signals,
      probableRootCause: "test_sender",
    });
  }

  if (sibling?.hasArtifact) {
    signals.push("sibling_org_artifact", "shared_mailbox_history");
    return pack({
      disposition: "WARNING",
      reason: `Shared mailbox: sibling organization(s) already have scan artifacts for this gmailId (${sibling.artifactSummary}; ${sibling.siblingOrganizationCount} org(s)).`,
      findingConfidence: computeOrphanConfidence({
        disposition: "WARNING",
        signals,
        isTestSender,
        isTestSubject,
        attachmentAnalysis,
        siblingPresent: true,
      }),
      signals,
      probableRootCause: "sibling_org_artifact",
    });
  }

  if (isTestSubject) {
    signals.push("test_subject");
    if (!attachmentAnalysis.hasFinancialAttachment || attachmentAnalysis.unsupportedOnly) {
      signals.push("no_financial_attachment");
      return pack({
        disposition: "INFO",
        reason: "Test subject without supported financial attachment — not operator-critical.",
        findingConfidence: computeOrphanConfidence({
          disposition: "INFO",
          signals,
          isTestSender,
          isTestSubject: true,
          attachmentAnalysis,
          siblingPresent: false,
        }),
        signals,
        probableRootCause: "test_subject_no_financial_attachment",
      });
    }
    signals.push("financial_attachment_present");
    return pack({
      disposition: "WARNING",
      reason: "Test subject with financial attachment but no scan artifact — investigation candidate, not customer-critical.",
      findingConfidence: computeOrphanConfidence({
        disposition: "WARNING",
        signals,
        isTestSender,
        isTestSubject: true,
        attachmentAnalysis,
        siblingPresent: false,
      }),
      signals,
      probableRootCause: "test_subject_investigation_candidate",
    });
  }

  if (isInvoiceLike) {
    signals.push("invoice_subject", "past_grace_period", "no_gsi_or_fdr");

    if (attachmentAnalysis.unsupportedOnly) {
      signals.push("unsupported_attachment_only");
      return pack({
        disposition: "INFO",
        reason: "Invoice-like subject with unsupported attachment type only (e.g. HTML) — no financial document expected.",
        findingConfidence: computeOrphanConfidence({
          disposition: "INFO",
          signals,
          isTestSender,
          isTestSubject,
          attachmentAnalysis,
          siblingPresent: false,
        }),
        signals,
        probableRootCause: "unsupported_attachment_only",
      });
    }

    if (!attachmentAnalysis.hasFinancialAttachment) {
      signals.push("no_financial_attachment");
      return pack({
        disposition: "WARNING",
        reason: "Invoice-like subject without PDF/image attachment — possible scan gap, review recommended.",
        findingConfidence: computeOrphanConfidence({
          disposition: "WARNING",
          signals,
          isTestSender,
          isTestSubject,
          attachmentAnalysis,
          siblingPresent: false,
        }),
        signals,
        probableRootCause: "invoice_subject_no_financial_attachment",
      });
    }

    signals.push("financial_attachment_present");
    return pack({
      disposition: "CRITICAL",
      reason: "Invoice-like email with financial attachment past grace period and no GmailScanItem or FinancialDocumentReview.",
      findingConfidence: computeOrphanConfidence({
        disposition: "CRITICAL",
        signals,
        isTestSender,
        isTestSubject,
        attachmentAnalysis,
        siblingPresent: false,
      }),
      signals,
      probableRootCause: "invoice_orphan_past_grace",
    });
  }

  signals.push("processed_no_artifact", "non_invoice_subject");
  return pack({
    disposition: "INFO",
    reason: "Non-invoice email processed without scan artifact — expected for non-financial mail.",
    findingConfidence: computeOrphanConfidence({
      disposition: "INFO",
      signals,
      isTestSender,
      isTestSubject,
      attachmentAnalysis,
      siblingPresent: false,
    }),
    signals,
    probableRootCause: "non_invoice_processed",
  });
}

function computeOrphanConfidence(input: {
  disposition: OrphanSignalDisposition;
  signals: string[];
  isTestSender: boolean;
  isTestSubject: boolean;
  attachmentAnalysis: ReturnType<typeof analyzeOrphanAttachments>;
  siblingPresent: boolean;
}): number {
  let confidence =
    input.disposition === "CRITICAL"
      ? 0.88
      : input.disposition === "WARNING"
        ? 0.72
        : input.disposition === "INFO"
          ? 0.7
          : 0.2;

  if (input.attachmentAnalysis.hasFinancialAttachment) confidence += 0.06;
  if (input.isTestSender || input.isTestSubject) confidence -= 0.12;
  if (input.siblingPresent) confidence += 0.08;
  if (input.signals.length >= 3) confidence += 0.04;
  if (input.disposition === "CRITICAL" && (input.isTestSender || input.isTestSubject)) {
    confidence -= 0.2;
  }

  return Math.round(Math.max(0.1, Math.min(0.98, confidence)) * 100) / 100;
}

function pack(classification: OrphanClassification): OrphanClassification {
  return classification;
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
