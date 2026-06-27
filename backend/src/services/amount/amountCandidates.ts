import type { EmailAnalysis, InvoiceScanResult } from "../claude.js";
import type { AmountCandidate, AmountCandidateSource, CanonicalAmountDocumentType } from "./canonicalAmount.js";
import { computeCanonicalAmount, normalizePositiveAmount, type MoneyDecision } from "./canonicalAmount.js";

export function mapAnalysisDocumentTypeForAmount(
  documentType: string | null | undefined
): CanonicalAmountDocumentType {
  const normalized = (documentType ?? "").toLowerCase();
  if (/credit|זיכוי/.test(normalized)) return "credit_note";
  if (/tax_invoice_receipt|invoice_receipt|חשבונית\s*מס\s*קבלה/.test(normalized)) return "tax_invoice_receipt";
  if (/quote|proposal|estimate|הצעת\s*מחיר/.test(normalized)) return "quote";
  if (/payment_request|payment request|דרישת|בקשת/.test(normalized)) return "payment_request";
  if (/receipt|קבלה/.test(normalized)) return "receipt";
  if (/invoice|tax_invoice|חשבונית/.test(normalized)) return "tax_invoice";
  return "unknown";
}

function pushCandidate(
  out: AmountCandidate[],
  input: {
    value: number | null | undefined;
    kind: AmountCandidate["kind"];
    source: AmountCandidateSource;
    label?: string | null;
    confidence?: number | null;
    currency?: string | null;
  }
) {
  const value = normalizePositiveAmount(input.value);
  if (value == null) return;
  out.push({
    value,
    kind: input.kind,
    source: input.source,
    label: input.label ?? null,
    confidence: input.confidence ?? null,
    currency: input.currency ?? null,
  });
}

export function buildAnalysisAmountCandidates(input: {
  analysis: Pick<EmailAnalysis, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency">;
  source: AmountCandidateSource;
  aiConfidence?: number | null;
}) {
  const candidates: AmountCandidate[] = [];
  pushCandidate(candidates, {
    value: input.analysis.totalAmount,
    kind: "ai_total",
    source: input.source,
    label: "totalAmount",
    confidence: input.aiConfidence ?? 0.85,
    currency: input.analysis.currency,
  });
  pushCandidate(candidates, {
    value: input.analysis.amount,
    kind: "ai_inferred",
    source: input.source,
    label: "amount",
    confidence: (input.aiConfidence ?? 0.85) - 0.05,
    currency: input.analysis.currency,
  });
  pushCandidate(candidates, {
    value: input.analysis.amountBeforeVat,
    kind: "subtotal_before_vat",
    source: input.source,
    label: "amountBeforeVat",
    confidence: input.aiConfidence ?? 0.8,
    currency: input.analysis.currency,
  });
  pushCandidate(candidates, {
    value: input.analysis.vatAmount,
    kind: "vat_only",
    source: input.source,
    label: "vatAmount",
    confidence: input.aiConfidence ?? 0.8,
    currency: input.analysis.currency,
  });
  return candidates;
}

export function buildInvoiceScanAmountCandidates(input: {
  scan: Pick<InvoiceScanResult, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "ocrConfidence">;
  aiConfidence?: number | null;
}) {
  return buildAnalysisAmountCandidates({
    analysis: {
      amount: input.scan.amount,
      totalAmount: input.scan.totalAmount,
      amountBeforeVat: input.scan.amountBeforeVat,
      vatAmount: input.scan.vatAmount,
      currency: input.scan.currency,
    },
    source: "claude_file",
    aiConfidence: input.aiConfidence ?? input.scan.ocrConfidence ?? 0.85,
  });
}

export function buildRegexAmountCandidate(input: {
  value: number | null | undefined;
  label?: string | null;
  confidence?: number | null;
}) {
  const value = normalizePositiveAmount(input.value);
  if (value == null) return [];
  return [{
    value,
    kind: "regex_labeled" as const,
    source: "regex_gmail" as const,
    label: input.label ?? "regex_extracted",
    confidence: input.confidence ?? 0.7,
  }];
}

export function buildGmailOrgAmountCandidates(input: {
  analysis: Pick<EmailAnalysis, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "confidence">;
  extractedFieldsAmount?: number | null;
  regexDetectedAmount?: number | null;
  attachmentAnalysis?: Pick<EmailAnalysis, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "confidence"> | null;
  isImageInvoicePart?: boolean;
}) {
  const candidates: AmountCandidate[] = [
    ...buildAnalysisAmountCandidates({
      analysis: input.analysis,
      source: "claude_email",
      aiConfidence: input.analysis.confidence,
    }),
    ...buildRegexAmountCandidate({
      value: input.extractedFieldsAmount,
      label: "parsed_fields_json.amount",
      confidence: 0.72,
    }),
    ...buildRegexAmountCandidate({
      value: input.regexDetectedAmount,
      label: "detect_invoice.amount",
      confidence: 0.68,
    }),
  ];

  if (input.attachmentAnalysis) {
    candidates.push(
      ...buildAnalysisAmountCandidates({
        analysis: input.attachmentAnalysis,
        source: "claude_file",
        aiConfidence: input.attachmentAnalysis.confidence,
      })
    );
  }

  return candidates;
}

export function resolveCanonicalAmount(input: {
  organizationId: string;
  documentType: CanonicalAmountDocumentType;
  currency?: string | null;
  source: string;
  candidates: AmountCandidate[];
}): MoneyDecision {
  return computeCanonicalAmount(input);
}

export function resolveGmailOrgMoneyDecision(input: {
  organizationId: string;
  documentType: string | null | undefined;
  analysis: Pick<EmailAnalysis, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "confidence">;
  extractedFieldsAmount?: number | null;
  regexDetectedAmount?: number | null;
  attachmentAnalysis?: Pick<EmailAnalysis, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "confidence"> | null;
}) {
  return resolveCanonicalAmount({
    organizationId: input.organizationId,
    documentType: mapAnalysisDocumentTypeForAmount(input.documentType),
    currency: input.analysis.currency,
    source: "gmail",
    candidates: buildGmailOrgAmountCandidates(input),
  });
}

export function resolveClientGmailMoneyDecision(input: {
  organizationId: string;
  documentType: string | null | undefined;
  analysis: Pick<EmailAnalysis, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "confidence">;
}) {
  return resolveCanonicalAmount({
    organizationId: input.organizationId,
    documentType: mapAnalysisDocumentTypeForAmount(input.documentType),
    currency: input.analysis.currency,
    source: "gmail_client",
    candidates: buildAnalysisAmountCandidates({
      analysis: input.analysis,
      source: "claude_email",
      aiConfidence: input.analysis.confidence,
    }),
  });
}

export function resolvePersistedTotalAmount(moneyDecision: MoneyDecision): number | null {
  if (moneyDecision.status !== "resolved" || moneyDecision.selectedAmount == null) return null;
  return moneyDecision.selectedAmount;
}

export function moneyDecisionUncertaintySuffix(moneyDecision: MoneyDecision): string | null {
  if (moneyDecision.status === "resolved") return null;
  return `amount_${moneyDecision.status}:${moneyDecision.reasonCode}`;
}

export function summarizeMoneyDecision(decision: MoneyDecision) {
  return {
    selectedAmount: decision.selectedAmount,
    amountBeforeVat: decision.amountBeforeVat,
    vatAmount: decision.vatAmount,
    currency: decision.currency,
    confidence: decision.confidence,
    evidenceScore: decision.evidenceScore,
    reason: decision.reason,
    reasonCode: decision.reasonCode,
    status: decision.status,
    version: decision.version,
    ambiguityFlags: decision.ambiguityFlags,
    candidates: decision.candidates.map((candidate) => ({
      value: candidate.value,
      kind: candidate.kind,
      source: candidate.source,
      label: candidate.label ?? null,
      confidence: candidate.confidence ?? null,
    })),
    rejected: decision.rejected.map((candidate) => ({
      value: candidate.value,
      kind: candidate.kind,
      source: candidate.source,
      reason: candidate.reason,
    })),
  };
}

export function resolveWhatsAppMoneyDecision(input: {
  organizationId: string;
  documentType: string | null | undefined;
  analysis: Pick<EmailAnalysis, "amount" | "totalAmount" | "amountBeforeVat" | "vatAmount" | "currency" | "confidence">;
}) {
  return resolveCanonicalAmount({
    organizationId: input.organizationId,
    documentType: mapAnalysisDocumentTypeForAmount(input.documentType),
    currency: input.analysis.currency,
    source: "whatsapp",
    candidates: buildAnalysisAmountCandidates({
      analysis: input.analysis,
      source: "claude_file",
      aiConfidence: input.analysis.confidence,
    }),
  });
}
