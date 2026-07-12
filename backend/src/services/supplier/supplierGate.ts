import {
  isGenericSingleEnglishWordName,
  isLikelyJunkSupplierName,
} from "../supplierNameValidation.js";
import {
  parseFinanceGateSnapshot,
  upsertFinanceGateSnapshot,
} from "../trust/financeGateSnapshots.js";
import type {
  SupplierCandidateKind,
  SupplierDecision,
  SupplierResolutionStatus,
} from "./supplierTypes.js";
import {
  isStrongEvidenceKind,
  isTaxIdLikeSupplierName,
  isUnknownPlaceholder,
  isUsableSupplierNameShared,
  isValidSupplierNameShared,
  isWeakEvidenceKind,
  looksLikeAddress,
  looksLikeDomain,
  looksLikeEmailAddress,
  looksLikePhoneNumber,
} from "./supplierValidation.js";

export const SUPPLIER_GATE_VERSION = "supplier-gate-v1" as const;

export type SupplierGateVerdict = "pass" | "review" | "block";

export type SupplierGateReasonCode =
  | "supplier.placeholder_hebrew"
  | "supplier.placeholder_en"
  | "supplier.email_or_domain"
  | "supplier.phone_or_address"
  | "supplier.ocr_artifact"
  | "supplier.sir_missing"
  | "supplier.sir_ambiguous"
  | "supplier.sir_rejected"
  | "supplier.sir_weak_evidence"
  | "supplier.generic_single_word"
  | "supplier.not_supplier"
  | "supplier.resolved";

export type SupplierGateSnapshot = {
  gate: "supplier";
  verdict: SupplierGateVerdict;
  reasonCode: SupplierGateReasonCode;
  engineVersion: typeof SUPPLIER_GATE_VERSION;
  canonicalSupplierName: string | null;
};

export type SirSummaryForSupplierGate = {
  supplierName?: string | null;
  canonicalSupplier?: string | null;
  status?: string | null;
  reasonCode?: string | null;
  isStrongEnoughForAutoSave?: boolean;
  winnerKind?: string | null;
};

export type SupplierGateInput = {
  supplierDecision?: SupplierDecision | null;
  sirSummary?: SirSummaryForSupplierGate | null;
  supplierName?: string | null;
  ownerEmails?: Set<string>;
};

const HEBREW_PLACEHOLDER = /^(לא\s*זוהה|לא\s*ידוע|לא\s*מזוהה)$/i;
const ENGLISH_PLACEHOLDER =
  /^(unknown|unknown supplier|current|address|name|details|document|documents|number|supplier|vendor|issuer)$/i;

function placeholderReasonCode(name: string): SupplierGateReasonCode {
  const cleaned = name.trim();
  if (HEBREW_PLACEHOLDER.test(cleaned)) return "supplier.placeholder_hebrew";
  if (ENGLISH_PLACEHOLDER.test(cleaned)) return "supplier.placeholder_en";
  return "supplier.placeholder_hebrew";
}

function resolveSirFields(input: SupplierGateInput): {
  status: SupplierResolutionStatus | "unknown";
  reasonCode: string;
  supplierName: string | null;
  canonicalSupplier: string | null;
  isStrongEnoughForAutoSave: boolean;
  winnerKind: SupplierCandidateKind | null;
} {
  if (input.supplierDecision) {
    const winner = input.supplierDecision.candidates[0] ?? null;
    return {
      status: input.supplierDecision.status,
      reasonCode: input.supplierDecision.reasonCode,
      supplierName: input.supplierDecision.supplierName,
      canonicalSupplier: input.supplierDecision.canonicalSupplier,
      isStrongEnoughForAutoSave: input.supplierDecision.isStrongEnoughForAutoSave,
      winnerKind: winner?.kind ?? null,
    };
  }

  const sir = input.sirSummary;
  return {
    status: (sir?.status as SupplierResolutionStatus | undefined) ?? "unknown",
    reasonCode: sir?.reasonCode ?? "MISSING",
    supplierName: sir?.supplierName ?? input.supplierName ?? null,
    canonicalSupplier: sir?.canonicalSupplier ?? null,
    isStrongEnoughForAutoSave: sir?.isStrongEnoughForAutoSave ?? false,
    winnerKind: (sir?.winnerKind as SupplierCandidateKind | undefined) ?? null,
  };
}

function reviewReasonFromSupplierName(
  name: string,
  ownerEmails: Set<string>
): SupplierGateReasonCode | null {
  const cleaned = name.trim();
  if (!cleaned) return "supplier.sir_missing";
  if (isUnknownPlaceholder(cleaned)) return placeholderReasonCode(cleaned);
  if (looksLikeEmailAddress(cleaned) || looksLikeDomain(cleaned)) return "supplier.email_or_domain";
  if (looksLikePhoneNumber(cleaned) || looksLikeAddress(cleaned)) return "supplier.phone_or_address";
  if (isLikelyJunkSupplierName(cleaned)) return "supplier.ocr_artifact";
  if (isTaxIdLikeSupplierName(cleaned)) return "supplier.sir_weak_evidence";
  if (!isValidSupplierNameShared(cleaned)) return "supplier.sir_missing";
  if (!isUsableSupplierNameShared(cleaned, ownerEmails)) return "supplier.sir_weak_evidence";
  return null;
}

export function evaluateSupplierGate(input: SupplierGateInput): SupplierGateSnapshot {
  const ownerEmails = input.ownerEmails ?? new Set<string>();
  const sir = resolveSirFields(input);
  const displayName = (sir.canonicalSupplier ?? sir.supplierName ?? input.supplierName ?? "").trim();

  if (sir.status === "rejected") {
    const reasonCode =
      sir.reasonCode === "BLOCKLISTED" ? "supplier.not_supplier" : "supplier.sir_rejected";
    return buildSnapshot("block", reasonCode, displayName || null);
  }

  if (sir.status === "missing" || sir.status === "unknown") {
    return buildSnapshot("review", "supplier.sir_missing", displayName || null);
  }

  if (sir.status === "ambiguous") {
    return buildSnapshot("review", "supplier.sir_ambiguous", displayName || null);
  }

  if (!displayName) {
    return buildSnapshot("review", "supplier.sir_missing", null);
  }

  const nameReview = reviewReasonFromSupplierName(displayName, ownerEmails);
  if (nameReview) {
    return buildSnapshot("review", nameReview, displayName);
  }

  if (sir.winnerKind && isWeakEvidenceKind(sir.winnerKind)) {
    return buildSnapshot("review", "supplier.sir_weak_evidence", displayName);
  }

  // כלל חיובי: מילה אנגלית בודדת גנרית שמקורה בחילוץ AI בלבד — ללא עוגן
  // עסקי (ח.פ / תיוג במסמך / היסטוריית הארגון / תיקון משתמש) — חשודה
  // כברירת מחדל → NEEDS_REVIEW, לא VALIDATED. blocklist לבדו תמיד יפספס
  // את המילה הגנרית הבאה שלא חשבנו עליה.
  if (sir.winnerKind === "ai_extracted" && isGenericSingleEnglishWordName(displayName)) {
    return buildSnapshot("review", "supplier.generic_single_word", displayName);
  }

  if (!sir.isStrongEnoughForAutoSave) {
    return buildSnapshot("review", "supplier.sir_weak_evidence", displayName);
  }

  if (sir.status !== "resolved") {
    return buildSnapshot("review", "supplier.sir_ambiguous", displayName);
  }

  const canonicalSupplierName = sir.canonicalSupplier ?? sir.supplierName ?? displayName;
  if (!canonicalSupplierName || !isUsableSupplierNameShared(canonicalSupplierName, ownerEmails)) {
    return buildSnapshot("review", "supplier.sir_weak_evidence", canonicalSupplierName || null);
  }

  return buildSnapshot("pass", "supplier.resolved", canonicalSupplierName);
}

function buildSnapshot(
  verdict: SupplierGateVerdict,
  reasonCode: SupplierGateReasonCode,
  canonicalSupplierName: string | null
): SupplierGateSnapshot {
  return {
    gate: "supplier",
    verdict,
    reasonCode,
    engineVersion: SUPPLIER_GATE_VERSION,
    canonicalSupplierName,
  };
}

export function supplierGatePasses(snapshot: SupplierGateSnapshot | null | undefined): boolean {
  return snapshot?.verdict === "pass";
}

export function supplierGateBlocksPayment(snapshot: SupplierGateSnapshot | null | undefined): boolean {
  return snapshot?.verdict !== "pass";
}

export function parseSupplierGateFromParsedFields(parsedFieldsJson: unknown): SupplierGateSnapshot | null {
  const record = parseFinanceGateSnapshot<SupplierGateSnapshot & Record<string, unknown>>(
    parsedFieldsJson,
    "supplier"
  );
  if (!record) return null;
  const verdict =
    record.verdict === "pass" || record.verdict === "review" || record.verdict === "block"
      ? record.verdict
      : null;
  if (!verdict) return null;
  const reasonCode =
    typeof record.reasonCode === "string" ? record.reasonCode : "supplier.sir_missing";
  const canonicalSupplierName =
    typeof record.canonicalSupplierName === "string" ? record.canonicalSupplierName : null;
  return {
    gate: "supplier",
    verdict,
    reasonCode: reasonCode as SupplierGateReasonCode,
    engineVersion: SUPPLIER_GATE_VERSION,
    canonicalSupplierName,
  };
}

export function attachSupplierGateToParsedFields(
  parsedFieldsJson: Record<string, unknown>,
  input: SupplierGateInput
): SupplierGateSnapshot {
  const snapshot = evaluateSupplierGate(input);
  upsertFinanceGateSnapshot(parsedFieldsJson, snapshot);
  return snapshot;
}

export function supplierGateAllowsManualApproval(input: SupplierGateInput): {
  allowed: boolean;
  reasonCode: SupplierGateReasonCode | null;
} {
  const gate = evaluateSupplierGate(input);
  if (gate.verdict === "pass") {
    return { allowed: true, reasonCode: null };
  }
  return { allowed: false, reasonCode: gate.reasonCode };
}

export function sirSummaryFromParsedFields(parsedFieldsJson: unknown): SirSummaryForSupplierGate | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || parsedFieldsJson === null) {
    return null;
  }
  const sir = (parsedFieldsJson as { sir?: unknown }).sir;
  if (!sir || typeof sir !== "object") return null;
  const record = sir as Record<string, unknown>;
  return {
    supplierName: typeof record.supplierName === "string" ? record.supplierName : null,
    canonicalSupplier: typeof record.canonicalSupplier === "string" ? record.canonicalSupplier : null,
    status: typeof record.status === "string" ? record.status : null,
    reasonCode: typeof record.reasonCode === "string" ? record.reasonCode : null,
    isStrongEnoughForAutoSave: record.isStrongEnoughForAutoSave === true,
    winnerKind: typeof record.winnerKind === "string" ? record.winnerKind : null,
  };
}
