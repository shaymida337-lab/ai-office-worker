import { MAX_REASONABLE_FINANCIAL_AMOUNT } from "../financialAmountLimits.js";
import {
  amountsMateriallyConflict,
  detectDecimalShift,
  findDecimalShiftAmongCandidates,
} from "./decimalShift.js";
import { roundMoney } from "./parseAmountHelpers.js";

export const ARC_VERSION = "arc-v2" as const;

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
  | "DECIMAL_SHIFT"
  | "SOURCE_CONFLICT"
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

const AI_KINDS = new Set<AmountCandidateKind>(["ai_total", "ai_inferred"]);
const REGEX_KINDS = new Set<AmountCandidateKind>(["regex_labeled", "regex_currency"]);
const STRONG_LABEL_KINDS = new Set<AmountCandidateKind>([
  "invoice_total",
  "amount_due",
  "total_including_vat",
  "regex_labeled",
]);

function normalizePositiveAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value === 0) return null;
  return roundMoney(value);
}

function rejectReason(value: number) {
  if (!Number.isFinite(value) || value === 0) return "parsed amount looks invalid";
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

function isSubordinateAmountKind(kind: AmountCandidateKind) {
  return kind === "ai_inferred" || kind === "subtotal_before_vat" || kind === "line_item" || kind === "vat_only";
}

function sourceFamily(source: AmountCandidateSource) {
  if (source === "regex_gmail" || source === "regex_legacy") return "regex";
  if (source === "claude_file" || source === "claude_email") return "ai";
  return source;
}

function buildAmbiguousDecision(input: {
  currency: string;
  ranked: RankedAmountCandidate[];
  rejected: RejectedAmountCandidate[];
  subtotal: RankedAmountCandidate | null;
  vat: RankedAmountCandidate | null;
  reason: string;
  reasonCode: AmountReasonCode;
  ambiguityFlags: string[];
  evidenceScore?: number;
}): MoneyDecision {
  return {
    selectedAmount: null,
    amountBeforeVat: input.subtotal?.value ?? null,
    vatAmount: input.vat?.value ?? null,
    currency: input.currency,
    confidence: 0.4,
    evidenceScore: input.evidenceScore ?? input.ranked.length,
    reason: input.reason,
    reasonCode: input.reasonCode,
    candidates: input.ranked,
    rejected: input.rejected,
    status: "ambiguous",
    ambiguityFlags: input.ambiguityFlags,
    version: ARC_VERSION,
    isStrongEnoughForAutoSave: false,
  };
}

function findConsensusCluster(payable: RankedAmountCandidate[]) {
  const clusters: RankedAmountCandidate[][] = [];
  for (const candidate of payable) {
    const cluster = clusters.find((group) => group.some((item) => amountsClose(item.value, candidate.value)));
    if (cluster) cluster.push(candidate);
    else clusters.push([candidate]);
  }

  return clusters
    .map((group) => {
      const families = new Set(group.map((c) => sourceFamily(c.source)));
      const hasStrongLabel = group.some((c) => STRONG_LABEL_KINDS.has(c.kind));
      const hasRegex = group.some((c) => REGEX_KINDS.has(c.kind));
      const hasAi = group.some((c) => AI_KINDS.has(c.kind));
      const avgConfidence =
        group.reduce((sum, c) => sum + (c.confidence ?? 0.5), 0) / Math.max(group.length, 1);
      return {
        group,
        families: families.size,
        hasStrongLabel,
        hasRegex,
        hasAi,
        avgConfidence,
        value: roundMoney(group[0].value),
      };
    })
    .sort((left, right) => {
      const leftScore =
        (left.families >= 2 ? 100 : 0) +
        (left.hasStrongLabel ? 50 : 0) +
        (left.hasRegex && left.hasAi ? 40 : 0) +
        left.avgConfidence * 10;
      const rightScore =
        (right.families >= 2 ? 100 : 0) +
        (right.hasStrongLabel ? 50 : 0) +
        (right.hasRegex && right.hasAi ? 40 : 0) +
        right.avgConfidence * 10;
      return rightScore - leftScore;
    });
}

function detectCrossSourceConflict(payable: RankedAmountCandidate[]) {
  const aiValues = payable.filter((c) => AI_KINDS.has(c.kind)).map((c) => c.value);
  const regexValues = payable.filter((c) => REGEX_KINDS.has(c.kind)).map((c) => c.value);
  if (!aiValues.length || !regexValues.length) return null;

  for (const ai of aiValues) {
    for (const regex of regexValues) {
      if (amountsMateriallyConflict(ai, regex)) {
        const shift = detectDecimalShift(ai, regex) ?? detectDecimalShift(regex, ai);
        return {
          ai,
          regex,
          shift,
          flags: shift ? ["decimal_shift_suspicion", "source_conflict"] : ["source_conflict"],
        };
      }
    }
  }
  return null;
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
    accepted.push(candidate);
  }

  const ranked = accepted
    .map((candidate) => rankCandidate(candidate, input.documentType))
    .sort((left, right) => right.score - left.score);

  const { subtotal, vat } = pickBestSubtotalAndVat(ranked);
  const computed = maybeComputedTotal(subtotal, vat);
  if (computed) {
    ranked.push(rankCandidate(computed, input.documentType));
    ranked.sort((left, right) => right.score - left.score);
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

  const payableValues = payableRanked.map((c) => c.value);
  const decimalShift = findDecimalShiftAmongCandidates(payableValues);
  if (decimalShift) {
    return buildAmbiguousDecision({
      currency,
      ranked,
      rejected,
      subtotal,
      vat,
      reason: decimalShift.reason,
      reasonCode: "DECIMAL_SHIFT",
      ambiguityFlags: ["decimal_shift_suspicion"],
    });
  }

  const crossConflict = detectCrossSourceConflict(payableRanked);
  if (crossConflict) {
    return buildAmbiguousDecision({
      currency,
      ranked,
      rejected,
      subtotal,
      vat,
      reason: crossConflict.shift?.reason ?? `AI and regex totals conflict (${crossConflict.ai} vs ${crossConflict.regex})`,
      reasonCode: crossConflict.shift ? "DECIMAL_SHIFT" : "SOURCE_CONFLICT",
      ambiguityFlags: crossConflict.flags,
    });
  }

  if (subtotal && vat) {
    const computedTotal = roundMoney(subtotal.value + vat.value);
    const labeledTotal = payableRanked.find((candidate) =>
      ["invoice_total", "amount_due", "total_including_vat", "ai_total", "regex_labeled"].includes(candidate.kind)
    );
    if (
      labeledTotal &&
      !amountsClose(labeledTotal.value, computedTotal) &&
      (amountsMateriallyConflict(labeledTotal.value, computedTotal) ||
        detectDecimalShift(labeledTotal.value, computedTotal) !== null)
    ) {
      payableRanked.sort((left, right) => {
        if (left.value === labeledTotal.value && left.kind === labeledTotal.kind) return -1;
        if (right.value === labeledTotal.value && right.kind === labeledTotal.kind) return 1;
        return right.score - left.score;
      });
    } else {
      const conflictingTotal = payableRanked.find(
        (candidate) =>
          !isSubordinateAmountKind(candidate.kind) &&
          !amountsClose(candidate.value, computedTotal) &&
          (amountsMateriallyConflict(candidate.value, computedTotal) ||
            detectDecimalShift(candidate.value, computedTotal) !== null)
      );
      if (conflictingTotal) {
        return buildAmbiguousDecision({
          currency,
          ranked,
          rejected,
          subtotal,
          vat,
          reason: `Total ${conflictingTotal.value} conflicts with subtotal+VAT ${computedTotal}`,
          reasonCode: "SOURCE_CONFLICT",
          ambiguityFlags: ["vat_total_conflict"],
        });
      }
    }
  }

  const clusters = findConsensusCluster(payableRanked);
  let best = clusters[0];
  if (!best) {
    return buildAmbiguousDecision({
      currency,
      ranked,
      rejected,
      subtotal,
      vat,
      reason: "No consensus cluster",
      reasonCode: "AMBIGUOUS",
      ambiguityFlags: ["no_consensus"],
    });
  }

  let vatMismatchFlag = false;
  if (subtotal && vat) {
    const computedTotal = roundMoney(subtotal.value + vat.value);
    const vatConfirmed = clusters.find((cluster) => amountsClose(cluster.value, computedTotal));
    const labeledConflict = payableRanked.find(
      (candidate) =>
        STRONG_LABEL_KINDS.has(candidate.kind) &&
        !amountsClose(candidate.value, computedTotal)
    );
    if (labeledConflict) {
      vatMismatchFlag = true;
      const labeledCluster = clusters.find((cluster) =>
        cluster.group.some(
          (candidate) => candidate.value === labeledConflict.value && candidate.kind === labeledConflict.kind,
        ),
      );
      if (labeledCluster) best = labeledCluster;
    } else if (vatConfirmed) {
      best = vatConfirmed;
    }
  }

  if (clusters.length > 1 && amountsMateriallyConflict(clusters[0].value, clusters[1].value)) {
    const computedTotal = subtotal && vat ? roundMoney(subtotal.value + vat.value) : null;
    const vatConfirmed = computedTotal
      ? clusters.find((cluster) => amountsClose(cluster.value, computedTotal))
      : null;
    const primaryClusters = clusters.filter((cluster) =>
      cluster.group.some((candidate) => !isSubordinateAmountKind(candidate.kind))
    );
    if (vatConfirmed && amountsClose(vatConfirmed.value, best.value)) {
      best = vatConfirmed;
    } else if (primaryClusters.length === 1) {
      best = primaryClusters[0];
    } else {
      return buildAmbiguousDecision({
        currency,
        ranked,
        rejected,
        subtotal,
        vat,
        reason: `Conflicting payable totals (${clusters[0].value} vs ${clusters[1].value})`,
        reasonCode: findDecimalShiftAmongCandidates([clusters[0].value, clusters[1].value])
          ? "DECIMAL_SHIFT"
          : "SOURCE_CONFLICT",
        ambiguityFlags: findDecimalShiftAmongCandidates([clusters[0].value, clusters[1].value])
          ? ["decimal_shift_suspicion", "multiple_totals_conflict"]
          : ["multiple_totals_conflict"],
      });
    }
  }

  const multiSourceAgree =
    best.families >= 2 ||
    (best.hasRegex && best.hasAi) ||
    best.group.length >= 2;
  const singleStrongLabeled =
    best.hasStrongLabel && best.avgConfidence >= 0.85 && best.group.length === 1;
  const singleCandidate = payableRanked.length === 1;
  const vatConfirmedSingle =
    Boolean(subtotal && vat) &&
    amountsClose(best.value, roundMoney((subtotal?.value ?? 0) + (vat?.value ?? 0)));

  const nonSubordinatePayable = payableRanked.filter((candidate) => !isSubordinateAmountKind(candidate.kind));
  const singlePrimaryCandidate = nonSubordinatePayable.length === 1;

  if (!multiSourceAgree && !singleStrongLabeled && !singleCandidate && !singlePrimaryCandidate && !vatConfirmedSingle) {
    const distinctValues = [...new Set(payableValues.map((v) => roundMoney(v)))];
    if (distinctValues.length > 1) {
      return buildAmbiguousDecision({
        currency,
        ranked,
        rejected,
        subtotal,
        vat,
        reason: "Insufficient agreement between amount sources",
        reasonCode: "AMBIGUOUS",
        ambiguityFlags: ["insufficient_source_agreement"],
        evidenceScore: best.group.length,
      });
    }
  }

  const winner = best.group.sort((left, right) => {
    const leftConfidence = left.confidence ?? 0;
    const rightConfidence = right.confidence ?? 0;
    if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
    return (SOURCE_PRIORITY[right.source] ?? 0) - (SOURCE_PRIORITY[left.source] ?? 0);
  })[0];

  const ambiguityFlags: string[] = [];
  if (vatMismatchFlag) ambiguityFlags.push("vat_mismatch");
  let confidence = Math.min(0.99, 0.55 + (winner.confidence ?? 0.5) * 0.35 + (multiSourceAgree ? 0.15 : 0));
  let evidenceScore = best.group.length;

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
    multiSourceAgree &&
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
