import {
  parseFinanceGateSnapshot,
  upsertFinanceGateSnapshot,
} from "../trust/financeGateSnapshots.js";
import type { FingerprintIdentityStability } from "./fingerprintGate.js";
import type { DedupMatchResult } from "./sharedMatcher.js";

export const DUPLICATE_GATE_VERSION = "duplicate-gate-v1" as const;

export type DuplicateGateVerdict = "pass" | "review" | "block";

export type DuplicateMatchStrength = "confirmed" | "unsure" | "none";

export type DuplicateGateReasonCode =
  | "duplicate.confirmed_match"
  | "duplicate.file_hash_match"
  | "duplicate.invoice_amount_match"
  | "duplicate.semantic_unsure"
  | "duplicate.email_attachment_match"
  | "duplicate.key_mismatch"
  | "duplicate.rescan_identity_changed"
  | "duplicate.rescan_amount_recovered"
  | "duplicate.force_reprocess"
  | "duplicate.cross_channel_unsure"
  | "duplicate.none";

export type DuplicateGateSnapshot = {
  gate: "duplicate";
  verdict: DuplicateGateVerdict;
  reasonCode: DuplicateGateReasonCode;
  engineVersion: typeof DUPLICATE_GATE_VERSION;
  matchedPaymentId: string | null;
  matchedReviewId: string | null;
  matchStrength: DuplicateMatchStrength;
};

export type DuplicateGateCandidate = {
  id: string;
  source?: string | null;
  lastSource?: string | null;
  sourcesJson?: unknown;
  documentFingerprint?: string | null;
  emailMessageId?: string | null;
};

export type DuplicateGateInput = {
  matchResult: DedupMatchResult;
  matchReasons?: string[];
  matchedCandidate?: DuplicateGateCandidate | null;
  documentFingerprint?: string | null;
  legacyDuplicateKey?: string | null;
  scfcFingerprint?: string | null;
  forceReprocess?: boolean;
  identityStability?: FingerprintIdentityStability;
  amountRecoveredOnRescan?: boolean;
  duplicateSuspicionFailed?: boolean;
  duplicateSuspicionWarning?: boolean;
  sameEmailAttachmentMatch?: boolean;
  crossChannelUnsure?: boolean;
  invoiceNumber?: string | null;
  currentSource?: string | null;
};

function blockReasonFromMatchReasons(reasons: string[]): DuplicateGateReasonCode {
  if (reasons.includes("same_file_sha256")) return "duplicate.file_hash_match";
  if (reasons.includes("same_invoice_number_and_amount")) return "duplicate.invoice_amount_match";
  if (
    reasons.includes("fingerprint_match") ||
    reasons.includes("same_supplier_tax_id_and_invoice_number")
  ) {
    return "duplicate.confirmed_match";
  }
  return "duplicate.confirmed_match";
}

function identityStabilityChanged(stability: FingerprintIdentityStability | undefined): boolean {
  if (!stability) return false;
  return Boolean(
    stability.amountChanged ||
      stability.dateChanged ||
      stability.supplierChanged ||
      stability.fieldsChanged
  );
}

function isCrossChannelCandidate(
  candidate: DuplicateGateCandidate | null | undefined,
  currentSource: string | null | undefined
): boolean {
  if (!candidate || !currentSource) return false;
  const candidateSource = candidate.lastSource ?? candidate.source ?? null;
  if (!candidateSource) return false;
  if (candidateSource === "both") return true;
  return candidateSource !== currentSource;
}

export function evaluateDuplicateGate(input: DuplicateGateInput): DuplicateGateSnapshot {
  const reasons = input.matchReasons ?? [];
  const matchedPaymentId = input.matchedCandidate?.id ?? null;

  if (input.matchResult === "MATCH") {
    return buildSnapshot(
      "block",
      blockReasonFromMatchReasons(reasons),
      "confirmed",
      matchedPaymentId,
      null
    );
  }

  if (input.forceReprocess) {
    return buildSnapshot("review", "duplicate.force_reprocess", "none", matchedPaymentId, null);
  }

  if (identityStabilityChanged(input.identityStability)) {
    return buildSnapshot("review", "duplicate.rescan_identity_changed", "none", matchedPaymentId, null);
  }

  if (input.amountRecoveredOnRescan) {
    return buildSnapshot("review", "duplicate.rescan_amount_recovered", "none", matchedPaymentId, null);
  }

  const legacyKey = input.legacyDuplicateKey?.trim() ?? "";
  const scfcKey = input.scfcFingerprint?.trim() ?? "";
  if (legacyKey && scfcKey && legacyKey !== scfcKey) {
    return buildSnapshot("review", "duplicate.key_mismatch", "none", matchedPaymentId, null);
  }

  if (input.duplicateSuspicionFailed || input.duplicateSuspicionWarning) {
    return buildSnapshot("review", "duplicate.semantic_unsure", "unsure", matchedPaymentId, null);
  }

  if (input.sameEmailAttachmentMatch) {
    return buildSnapshot("review", "duplicate.email_attachment_match", "unsure", matchedPaymentId, null);
  }

  if (input.crossChannelUnsure || isCrossChannelCandidate(input.matchedCandidate, input.currentSource)) {
    if (input.matchResult === "UNSURE" || input.crossChannelUnsure) {
      return buildSnapshot("review", "duplicate.cross_channel_unsure", "unsure", matchedPaymentId, null);
    }
  }

  if (input.matchResult === "UNSURE") {
    const supplierAmountDate =
      reasons.includes("same_supplier") &&
      reasons.includes("same_amount") &&
      reasons.includes("same_date") &&
      !input.invoiceNumber?.trim();
    return buildSnapshot(
      "review",
      supplierAmountDate ? "duplicate.semantic_unsure" : "duplicate.semantic_unsure",
      "unsure",
      matchedPaymentId,
      null
    );
  }

  return buildSnapshot("pass", "duplicate.none", "none", null, null);
}

function buildSnapshot(
  verdict: DuplicateGateVerdict,
  reasonCode: DuplicateGateReasonCode,
  matchStrength: DuplicateMatchStrength,
  matchedPaymentId: string | null,
  matchedReviewId: string | null
): DuplicateGateSnapshot {
  return {
    gate: "duplicate",
    verdict,
    reasonCode,
    engineVersion: DUPLICATE_GATE_VERSION,
    matchedPaymentId,
    matchedReviewId,
    matchStrength,
  };
}

export function duplicateGatePasses(snapshot: DuplicateGateSnapshot | null | undefined): boolean {
  return snapshot?.verdict === "pass";
}

export function parseDuplicateGateFromParsedFields(parsedFieldsJson: unknown): DuplicateGateSnapshot | null {
  const record = parseFinanceGateSnapshot<DuplicateGateSnapshot & Record<string, unknown>>(
    parsedFieldsJson,
    "duplicate"
  );
  if (!record) return null;
  const verdict =
    record.verdict === "pass" || record.verdict === "review" || record.verdict === "block"
      ? record.verdict
      : null;
  if (!verdict) return null;
  const reasonCode =
    typeof record.reasonCode === "string" ? (record.reasonCode as DuplicateGateReasonCode) : "duplicate.none";
  const matchStrength =
    record.matchStrength === "confirmed" ||
    record.matchStrength === "unsure" ||
    record.matchStrength === "none"
      ? record.matchStrength
      : "none";
  return {
    gate: "duplicate",
    verdict,
    reasonCode,
    engineVersion: DUPLICATE_GATE_VERSION,
    matchedPaymentId: typeof record.matchedPaymentId === "string" ? record.matchedPaymentId : null,
    matchedReviewId: typeof record.matchedReviewId === "string" ? record.matchedReviewId : null,
    matchStrength,
  };
}

export function attachDuplicateGateToParsedFields(
  parsedFieldsJson: Record<string, unknown>,
  input: DuplicateGateInput
): DuplicateGateSnapshot {
  const snapshot = evaluateDuplicateGate(input);
  upsertFinanceGateSnapshot(parsedFieldsJson, snapshot);
  return snapshot;
}

export function duplicateGateAllowsManualApproval(input: DuplicateGateInput): {
  allowed: boolean;
  reasonCode: DuplicateGateReasonCode | null;
} {
  const gate = evaluateDuplicateGate(input);
  if (gate.verdict === "pass") {
    return { allowed: true, reasonCode: null };
  }
  return { allowed: false, reasonCode: gate.reasonCode };
}

export function detectAmountRecoveredOnRescan(input: {
  existingScanItem?: { amount?: unknown } | null;
  currentAmount?: number | null;
}): boolean {
  if (!input.existingScanItem) return false;
  const previousAmount = Number(input.existingScanItem.amount);
  const hadMissingAmount = !Number.isFinite(previousAmount) || previousAmount <= 0;
  const nextAmount = input.currentAmount;
  return (
    hadMissingAmount &&
    nextAmount != null &&
    Number.isFinite(nextAmount) &&
    nextAmount > 0
  );
}

export function fseDuplicateSuspicionFlags(fseSummary: unknown): {
  failed: boolean;
  warning: boolean;
} {
  if (!fseSummary || typeof fseSummary !== "object") {
    return { failed: false, warning: false };
  }
  const record = fseSummary as { failedRules?: unknown; errors?: unknown; warnings?: unknown };
  const failedRules = Array.isArray(record.failedRules)
    ? record.failedRules.filter((entry): entry is string => typeof entry === "string")
    : [];
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const warnings = Array.isArray(record.warnings) ? record.warnings : [];
  return {
    failed:
      failedRules.includes("duplicate_suspicion") ||
      errors.some(
        (entry) =>
          Boolean(entry) &&
          typeof entry === "object" &&
          (entry as { ruleId?: string }).ruleId === "duplicate_suspicion"
      ),
    warning: warnings.some(
      (entry) =>
        Boolean(entry) &&
        typeof entry === "object" &&
        (entry as { ruleId?: string }).ruleId === "duplicate_suspicion"
    ),
  };
}
