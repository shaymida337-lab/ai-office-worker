import {
  parseFinanceGateSnapshot,
  upsertFinanceGateSnapshot,
} from "../trust/financeGateSnapshots.js";
import {
  computeCanonicalFingerprint,
  type CanonicalFingerprintResult,
  type CanonicalFingerprintTier,
} from "./sharedMatcher.js";

export const FINGERPRINT_GATE_VERSION = "fingerprint-gate-v1" as const;

const STRONG_TIERS = new Set<CanonicalFingerprintTier>([
  "file",
  "invoice-amount",
  "tax-invoice",
  "supplier-amount-date",
]);

export type FingerprintGateVerdict = "pass" | "review" | "block";

export type FingerprintGateReasonCode =
  | "fingerprint.null"
  | "fingerprint.empty"
  | "fingerprint.weak_tier"
  | "fingerprint.none_tier"
  | "fingerprint.legacy_only"
  | "fingerprint.missing_tier_fields"
  | "fingerprint.file_hash_missing"
  | "fingerprint.identity_changed"
  | "fingerprint.force_reprocess"
  | "fingerprint.confirmed_duplicate"
  | "fingerprint.resolved";

export type FingerprintIdentityStability = {
  amountChanged?: boolean;
  dateChanged?: boolean;
  supplierChanged?: boolean;
  fieldsChanged?: boolean;
};

export type FingerprintGateSnapshot = {
  gate: "fingerprint";
  verdict: FingerprintGateVerdict;
  reasonCode: FingerprintGateReasonCode;
  engineVersion: typeof FINGERPRINT_GATE_VERSION;
  documentFingerprint: string | null;
  tier: CanonicalFingerprintTier | null;
};

export type FingerprintGateInput = {
  scfc: CanonicalFingerprintResult;
  documentFingerprint?: string | null;
  forceReprocess?: boolean;
  identityStability?: FingerprintIdentityStability;
  confirmedDuplicate?: boolean;
  hasAttachment?: boolean;
  fileSha256?: string | null;
};

export type ScfcSummary = {
  fingerprint: string | null;
  tier: CanonicalFingerprintTier;
  version: string;
  isStrongEnoughForAutoSaveDedup: boolean;
  legacyFingerprint: string;
};

export function summarizeScfcResult(result: CanonicalFingerprintResult): ScfcSummary {
  return {
    fingerprint: result.fingerprint,
    tier: result.tier,
    version: result.version,
    isStrongEnoughForAutoSaveDedup: result.isStrongEnoughForAutoSaveDedup,
    legacyFingerprint: result.legacyFingerprint,
  };
}

function missingTierFields(
  tier: CanonicalFingerprintTier,
  normalized: CanonicalFingerprintResult["normalizedInputs"]
): boolean {
  switch (tier) {
    case "file":
      return !normalized.fileSha256;
    case "invoice-amount":
      return !normalized.invoiceNumber || !normalized.amount;
    case "tax-invoice":
      return !normalized.taxId || !normalized.invoiceNumber;
    case "supplier-amount-date":
      return !normalized.supplier || !normalized.amount || !normalized.date;
    default:
      return true;
  }
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

export function detectScanIdentityInstability(input: {
  existingScanItem?: {
    amount?: unknown;
    supplierName?: string | null;
    normalizedDocumentDate?: Date | null;
    occurredAt?: Date | null;
  } | null;
  current: {
    amount?: number | null;
    supplierName?: string | null;
    documentDate?: Date | null;
  };
}): FingerprintIdentityStability {
  if (!input.existingScanItem) return {};

  const stability: FingerprintIdentityStability = {};
  const previousAmount = Number(input.existingScanItem.amount);
  const nextAmount = input.current.amount;
  if (
    Number.isFinite(previousAmount) &&
    previousAmount > 0 &&
    nextAmount != null &&
    Number.isFinite(nextAmount) &&
    Math.abs(previousAmount - nextAmount) > 0.009
  ) {
    stability.amountChanged = true;
  }

  const previousSupplier = (input.existingScanItem.supplierName ?? "").trim().toLowerCase();
  const nextSupplier = (input.current.supplierName ?? "").trim().toLowerCase();
  if (previousSupplier && nextSupplier && previousSupplier !== nextSupplier) {
    stability.supplierChanged = true;
  }

  const previousDate =
    input.existingScanItem.normalizedDocumentDate ?? input.existingScanItem.occurredAt ?? null;
  const nextDate = input.current.documentDate ?? null;
  if (previousDate && nextDate) {
    const previousKey = previousDate.toISOString().slice(0, 10);
    const nextKey = nextDate.toISOString().slice(0, 10);
    if (previousKey !== nextKey) {
      stability.dateChanged = true;
    }
  }

  stability.fieldsChanged = identityStabilityChanged(stability);
  return stability;
}

export function evaluateFingerprintGate(input: FingerprintGateInput): FingerprintGateSnapshot {
  const { scfc } = input;
  const documentFingerprint =
    input.documentFingerprint ?? scfc.fingerprint ?? scfc.legacyFingerprint ?? null;
  const tier = scfc.tier;

  if (input.confirmedDuplicate) {
    return buildSnapshot("block", "fingerprint.confirmed_duplicate", documentFingerprint, tier);
  }

  if (input.forceReprocess) {
    return buildSnapshot("review", "fingerprint.force_reprocess", documentFingerprint, tier);
  }

  if (identityStabilityChanged(input.identityStability)) {
    return buildSnapshot("review", "fingerprint.identity_changed", documentFingerprint, tier);
  }

  if (documentFingerprint == null) {
    return buildSnapshot("review", "fingerprint.null", null, tier);
  }

  if (!documentFingerprint.trim()) {
    return buildSnapshot("review", "fingerprint.empty", documentFingerprint, tier);
  }

  if (tier === "none") {
    return buildSnapshot("review", "fingerprint.none_tier", documentFingerprint, tier);
  }

  if (tier === "weak") {
    return buildSnapshot("review", "fingerprint.weak_tier", documentFingerprint, tier);
  }

  const legacyOnly =
    Boolean(documentFingerprint) &&
    documentFingerprint === scfc.legacyFingerprint &&
    scfc.fingerprint !== documentFingerprint;
  if (legacyOnly) {
    return buildSnapshot("review", "fingerprint.legacy_only", documentFingerprint, tier);
  }

  if (!STRONG_TIERS.has(tier)) {
    return buildSnapshot("review", "fingerprint.weak_tier", documentFingerprint, tier);
  }

  if (missingTierFields(tier, scfc.normalizedInputs)) {
    return buildSnapshot("review", "fingerprint.missing_tier_fields", documentFingerprint, tier);
  }

  if (!scfc.isStrongEnoughForAutoSaveDedup) {
    return buildSnapshot("review", "fingerprint.weak_tier", documentFingerprint, tier);
  }

  return buildSnapshot("pass", "fingerprint.resolved", scfc.fingerprint ?? documentFingerprint, tier);
}

function buildSnapshot(
  verdict: FingerprintGateVerdict,
  reasonCode: FingerprintGateReasonCode,
  documentFingerprint: string | null,
  tier: CanonicalFingerprintTier | null
): FingerprintGateSnapshot {
  return {
    gate: "fingerprint",
    verdict,
    reasonCode,
    engineVersion: FINGERPRINT_GATE_VERSION,
    documentFingerprint,
    tier,
  };
}

export function fingerprintGatePasses(snapshot: FingerprintGateSnapshot | null | undefined): boolean {
  return snapshot?.verdict === "pass";
}

export function parseFingerprintGateFromParsedFields(parsedFieldsJson: unknown): FingerprintGateSnapshot | null {
  const record = parseFinanceGateSnapshot<FingerprintGateSnapshot & Record<string, unknown>>(
    parsedFieldsJson,
    "fingerprint"
  );
  if (!record) return null;
  const verdict =
    record.verdict === "pass" || record.verdict === "review" || record.verdict === "block"
      ? record.verdict
      : null;
  if (!verdict) return null;
  const reasonCode =
    typeof record.reasonCode === "string" ? record.reasonCode : "fingerprint.null";
  const documentFingerprint =
    typeof record.documentFingerprint === "string" ? record.documentFingerprint : null;
  const tier =
    typeof record.tier === "string"
      ? (record.tier as CanonicalFingerprintTier)
      : null;
  return {
    gate: "fingerprint",
    verdict,
    reasonCode: reasonCode as FingerprintGateReasonCode,
    engineVersion: FINGERPRINT_GATE_VERSION,
    documentFingerprint,
    tier,
  };
}

export function attachFingerprintGateToParsedFields(
  parsedFieldsJson: Record<string, unknown>,
  input: FingerprintGateInput
): FingerprintGateSnapshot {
  const snapshot = evaluateFingerprintGate(input);
  upsertFinanceGateSnapshot(parsedFieldsJson, snapshot);
  return snapshot;
}

export function fingerprintGateAllowsManualApproval(input: FingerprintGateInput): {
  allowed: boolean;
  reasonCode: FingerprintGateReasonCode | null;
} {
  const gate = evaluateFingerprintGate(input);
  if (gate.verdict === "pass") {
    return { allowed: true, reasonCode: null };
  }
  return { allowed: false, reasonCode: gate.reasonCode };
}

export function scfcSummaryFromParsedFields(parsedFieldsJson: unknown): ScfcSummary | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || parsedFieldsJson === null) {
    return null;
  }
  const scfc = (parsedFieldsJson as { scfc?: unknown }).scfc;
  if (!scfc || typeof scfc !== "object") return null;
  const record = scfc as Record<string, unknown>;
  const tier = typeof record.tier === "string" ? (record.tier as CanonicalFingerprintTier) : null;
  if (!tier) return null;
  return {
    fingerprint: typeof record.fingerprint === "string" ? record.fingerprint : null,
    tier,
    version: typeof record.version === "string" ? record.version : "scfc-v1",
    isStrongEnoughForAutoSaveDedup: record.isStrongEnoughForAutoSaveDedup === true,
    legacyFingerprint:
      typeof record.legacyFingerprint === "string" ? record.legacyFingerprint : "",
  };
}

export function buildFingerprintGateInputFromReview(input: {
  organizationId: string;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  documentDate?: Date | null;
  documentType?: string | null;
  documentFingerprint?: string | null;
  parsedFieldsJson?: unknown;
  fileSha256?: string | null;
}): FingerprintGateInput {
  const scfc = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.totalAmount,
    documentDate: input.documentDate,
    documentType: input.documentType,
    fileSha256: input.fileSha256,
  });

  return {
    scfc,
    documentFingerprint: input.documentFingerprint ?? scfc.fingerprint ?? scfc.legacyFingerprint,
    fileSha256: input.fileSha256 ?? null,
    hasAttachment: Boolean(input.fileSha256),
  };
}
