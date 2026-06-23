import { MAX_REASONABLE_FINANCIAL_AMOUNT } from "../financialAmountLimits.js";

export const ARC_VERSION = "arc-v1" as const;

export type AmountCandidateKind =
  | "invoice_total"
  | "amount_due"
  | "total_including_vat"
  | "subtotal_before_vat"
  | "vat_only"
  | "line_item"
  | "partial_payment"
  | "credit_amount"
  | "ai_inferred"
  | "ai_total"
  | "regex_labeled"
  | "regex_currency"
  | "user_provided"
  | "computed"
  | "unknown";

export type AmountCandidateSource =
  | "claude_file"
  | "claude_email"
  | "regex_gmail"
  | "regex_legacy"
  | "parsed_fields_json"
  | "user_input"
  | "reprocess";

export type AmountReasonCode =
  | "INVOICE_TOTAL"
  | "AMOUNT_DUE"
  | "TOTAL_INCLUDING_VAT"
  | "COMPUTED_FROM_VAT"
  | "AI_TOTAL"
  | "AI_INFERRED"
  | "REGEX_LABELED"
  | "REGEX_CURRENCY"
  | "USER_PROVIDED"
  | "AMBIGUOUS"
  | "MISSING"
  | "REJECTED_INVALID";

export type AmountResolutionStatus = "resolved" | "ambiguous" | "missing" | "rejected";

export type AmountCandidate = {
  value: number;
  kind: AmountCandidateKind;
  source: AmountCandidateSource;
  label?: string | null;
  confidence?: number | null;
  pageIndex?: number | null;
  currency?: string | null;
  raw?: string | null;
};

export type RankedAmountCandidate = AmountCandidate & {
  tier: number;
  score: number;
};

export type RejectedAmountCandidate = AmountCandidate & {
  reason: string;
};

export type CanonicalAmountDocumentType =
  | "tax_invoice"
  | "receipt"
  | "tax_invoice_receipt"
  | "payment_request"
  | "credit_note"
  | "quote"
  | "unknown";

export type CanonicalAmountInput = {
  organizationId: string;
  documentType: CanonicalAmountDocumentType;
  currency?: string | null;
  source: string;
  candidates: AmountCandidate[];
};

export type MoneyDecision = {
  selectedAmount: number | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  currency: string;
  confidence: number;
  evidenceScore: number;
  reason: string;
  reasonCode: AmountReasonCode;
  candidates: RankedAmountCandidate[];
  rejected: RejectedAmountCandidate[];
  status: AmountResolutionStatus;
  ambiguityFlags: string[];
  version: typeof ARC_VERSION;
  isStrongEnoughForAutoSave: boolean;
};

const KIND_TIER: Record<AmountCandidateKind, number> = {
  invoice_total: 100,
  credit_amount: 100,
  amount_due: 90,
  total_including_vat: 85,
  computed: 80,
  ai_total: 70,
  ai_inferred: 60,
  regex_labeled: 50,
  user_provided: 45,
  regex_currency: 40,
  unknown: 20,
  partial_payment: 35,
  line_item: 8,
  subtotal_before_vat: 10,
  vat_only: 5,
};

const SOURCE_PRIORITY: Record<AmountCandidateSource, number> = {
  claude_file: 5,
  regex_gmail: 4,
  claude_email: 3,
  parsed_fields_json: 3,
  reprocess: 3,
  regex_legacy: 2,
  user_input: 1,
};

const AMOUNT_TOLERANCE = 0.05;
const AMBIGUOUS_RELATIVE_GAP = 0.05;

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizePositiveAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value === 0) return null;
  return roundMoney(value);
}

function rejectReason(value: number, context?: { hasDateContext?: boolean }) {
  if (!Number.isFinite(value) || value === 0) return "parsed amount looks invalid";
  if (context?.hasDateContext && Number.isInteger(value) && value >= 2020 && value <= 2030) {
    return "parsed amount looks like a year";
  }
  if (Math.abs(value) >= MAX_REASONABLE_FINANCIAL_AMOUNT) return "parsed amount looks invalid/too large";
  return null;
}

function reasonCodeForKind(kind: AmountCandidateKind): AmountReasonCode {
  switch (kind) {
    case "invoice_total":
      return "INVOICE_TOTAL";
    case "amount_due":
    case "partial_payment":
      return "AMOUNT_DUE";
    case "total_including_vat":
      return "TOTAL_INCLUDING_VAT";
    case "computed":
      return "COMPUTED_FROM_VAT";
    case "ai_total":
      return "AI_TOTAL";
    case "ai_inferred":
      return "AI_INFERRED";
    case "regex_labeled":
      return "REGEX_LABELED";
    case "regex_currency":
      return "REGEX_CURRENCY";
    case "user_provided":
      return "USER_PROVIDED";
    case "credit_amount":
      return "INVOICE_TOTAL";
    default:
      return "AI_INFERRED";
  }
}

function reasonLabelForKind(kind: AmountCandidateKind) {
  switch (kind) {
    case "invoice_total":
      return "Invoice Total";
    case "amount_due":
      return "Amount Due";
    case "total_including_vat":
      return "Total Including VAT";
    case "computed":
      return "Computed Subtotal + VAT";
    case "ai_total":
      return "AI Total Amount";
    case "ai_inferred":
      return "AI Inferred Amount";
    case "regex_labeled":
      return "Regex Labeled Total";
    case "regex_currency":
      return "Regex Currency Amount";
    case "user_provided":
      return "User Provided Amount";
    case "credit_amount":
      return "Credit Note Total";
    case "partial_payment":
      return "Partial Payment";
    default:
      return "Resolved Amount";
  }
}

function dedupeCandidates(candidates: AmountCandidate[]) {
  const seen = new Set<string>();
  const unique: AmountCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.kind,
      candidate.source,
      roundMoney(candidate.value),
      candidate.label ?? "",
      candidate.pageIndex ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function rankCandidate(candidate: AmountCandidate, documentType: CanonicalAmountDocumentType) {
  let tier = KIND_TIER[candidate.kind] ?? 20;
  if (documentType === "payment_request" && candidate.kind === "amount_due") tier += 5;
  if (documentType === "receipt" && candidate.kind === "amount_due") tier += 3;
  if (documentType === "credit_note" && candidate.value < 0) tier += 10;
  const sourceBoost = SOURCE_PRIORITY[candidate.source] ?? 0;
  const confidenceBoost = (candidate.confidence ?? 0.5) * 10;
  return {
    ...candidate,
    tier,
    score: tier * 100 + sourceBoost * 10 + confidenceBoost,
  };
}

function pickBestSubtotalAndVat(ranked: RankedAmountCandidate[]) {
  const subtotal = ranked.find((candidate) => candidate.kind === "subtotal_before_vat") ?? null;
  const vat = ranked.find((candidate) => candidate.kind === "vat_only") ?? null;
  return { subtotal, vat };
}

function amountsClose(left: number, right: number) {
  const delta = Math.abs(left - right);
  return delta <= AMOUNT_TOLERANCE || delta / Math.max(Math.abs(right), 1) <= 0.01;
}

function maybeComputedTotal(subtotal: RankedAmountCandidate | null, vat: RankedAmountCandidate | null) {
  if (!subtotal || !vat) return null;
  const total = roundMoney(subtotal.value + vat.value);
  if (total <= 0) return null;
  return {
    value: total,
    kind: "computed" as const,
    source: subtotal.source,
    label: "subtotal + vat",
    confidence: Math.min(subtotal.confidence ?? 0.7, vat.confidence ?? 0.7),
  };
}

export function computeCanonicalAmount(input: CanonicalAmountInput): MoneyDecision {
  const currency = (input.currency ?? "ILS").trim() || "ILS";
  const rejected: RejectedAmountCandidate[] = [];
  const accepted: AmountCandidate[] = [];
  const allowNegative = input.documentType === "credit_note";

  for (const candidate of dedupeCandidates(input.candidates)) {
    if (!Number.isFinite(candidate.value)) {
      rejected.push({ ...candidate, reason: "not_finite" });
      continue;
    }
    if (candidate.value === 0) {
      rejected.push({ ...candidate, reason: "zero_amount" });
      continue;
    }
    if (!allowNegative && candidate.value < 0) {
      rejected.push({ ...candidate, reason: "negative_not_allowed" });
      continue;
    }
    const invalidReason = rejectReason(allowNegative ? Math.abs(candidate.value) : candidate.value);
    if (invalidReason) {
      rejected.push({ ...candidate, reason: invalidReason });
      continue;
    }
    if (candidate.kind === "vat_only" || candidate.kind === "subtotal_before_vat") {
      accepted.push(candidate);
      continue;
    }
    accepted.push(candidate);
  }

  const ranked = accepted
    .map((candidate) => rankCandidate(candidate, input.documentType))
    .sort((left, right) => right.score - left.score || right.value - left.value);

  const { subtotal, vat } = pickBestSubtotalAndVat(ranked);
  const computed = maybeComputedTotal(subtotal, vat);
  if (computed) {
    ranked.push(rankCandidate(computed, input.documentType));
    ranked.sort((left, right) => right.score - left.score || right.value - left.value);
  }

  const payableRanked = ranked.filter(
    (candidate) => candidate.kind !== "subtotal_before_vat" && candidate.kind !== "vat_only"
  );

  if (!payableRanked.length) {
    return {
      selectedAmount: null,
      amountBeforeVat: subtotal?.value ?? null,
      vatAmount: vat?.value ?? null,
      currency,
      confidence: 0,
      evidenceScore: 0,
      reason: "No valid amount candidates",
      reasonCode: "MISSING",
      candidates: ranked,
      rejected,
      status: "missing",
      ambiguityFlags: [],
      version: ARC_VERSION,
      isStrongEnoughForAutoSave: false,
    };
  }

  const topTier = payableRanked[0].tier;
  const topTierCandidates = payableRanked.filter((candidate) => candidate.tier === topTier);
  const ambiguityFlags: string[] = [];

  if (topTierCandidates.length > 1) {
    const values = topTierCandidates.map((candidate) => candidate.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max > 0 && (max - min) / max > AMBIGUOUS_RELATIVE_GAP) {
      ambiguityFlags.push("multiple_totals_conflict");
      return {
        selectedAmount: null,
        amountBeforeVat: subtotal?.value ?? null,
        vatAmount: vat?.value ?? null,
        currency,
        confidence: 0.45,
        evidenceScore: topTierCandidates.length,
        reason: "Multiple conflicting totals",
        reasonCode: "AMBIGUOUS",
        candidates: ranked,
        rejected,
        status: "ambiguous",
        ambiguityFlags,
        version: ARC_VERSION,
        isStrongEnoughForAutoSave: false,
      };
    }
  }

  const winner = topTierCandidates.sort((left, right) => {
    const leftConfidence = left.confidence ?? 0;
    const rightConfidence = right.confidence ?? 0;
    if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
    return (SOURCE_PRIORITY[right.source] ?? 0) - (SOURCE_PRIORITY[left.source] ?? 0);
  })[0];

  let confidence = Math.min(0.99, 0.55 + (winner.confidence ?? 0.5) * 0.35 + Math.min(topTier, 100) / 500);
  let evidenceScore = payableRanked.length;

  if (subtotal && vat) {
    const computedTotal = roundMoney(subtotal.value + vat.value);
    if (amountsClose(computedTotal, winner.value)) {
      confidence = Math.min(0.999, confidence + 0.1);
      evidenceScore += 2;
    } else {
      ambiguityFlags.push("vat_mismatch");
      confidence = Math.max(0.35, confidence - 0.2);
    }
  }

  if (currency !== "ILS") {
    ambiguityFlags.push("foreign_currency");
    confidence = Math.min(confidence, 0.79);
  }

  if (input.documentType === "quote") {
    confidence = Math.min(confidence, 0.79);
  }

  const reasonCode = reasonCodeForKind(winner.kind);
  const reason = reasonLabelForKind(winner.kind);
  const isStrongEnoughForAutoSave =
    confidence >= 0.8 &&
    ambiguityFlags.length === 0 &&
    input.documentType !== "quote" &&
    (currency === "ILS" || confidence >= 0.9);

  return {
    selectedAmount: roundMoney(winner.value),
    amountBeforeVat: subtotal?.value ?? null,
    vatAmount: vat?.value ?? null,
    currency,
    confidence: Number(confidence.toFixed(4)),
    evidenceScore,
    reason,
    reasonCode,
    candidates: ranked,
    rejected,
    status: "resolved",
    ambiguityFlags,
    version: ARC_VERSION,
    isStrongEnoughForAutoSave,
  };
}

export function moneyDecisionSelectedTotal(input: MoneyDecision) {
  return input.selectedAmount;
}

export { normalizePositiveAmount, rejectReason as rejectAmountCandidateReason };
