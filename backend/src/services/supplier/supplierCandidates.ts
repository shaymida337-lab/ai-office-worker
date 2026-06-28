import type { SupplierCandidate, SupplierCandidateKind, SupplierCandidateSource } from "./supplierTypes.js";

export function pushSupplierCandidate(
  out: SupplierCandidate[],
  input: {
    name: string | null | undefined;
    kind: SupplierCandidateKind;
    source: SupplierCandidateSource;
    vatNumber?: string | null;
    confidence?: number | null;
    label?: string | null;
    raw?: string | null;
  }
) {
  const name = input.name?.trim();
  if (!name) return;
  out.push({
    name,
    kind: input.kind,
    source: input.source,
    vatNumber: input.vatNumber ?? null,
    confidence: input.confidence ?? null,
    label: input.label ?? null,
    raw: input.raw ?? null,
  });
}

export function buildAnalysisSupplierCandidates(input: {
  supplier?: string | null;
  supplierTaxId?: string | null;
  source?: SupplierCandidateSource;
  aiConfidence?: number | null;
}) {
  const candidates: SupplierCandidate[] = [];
  const source = input.source ?? "claude_email";
  pushSupplierCandidate(candidates, {
    name: input.supplier,
    kind: "ai_extracted",
    source,
    vatNumber: input.supplierTaxId,
    confidence: input.aiConfidence ?? 0.8,
    label: "analysis.supplier",
  });
  if (input.supplierTaxId) {
    pushSupplierCandidate(candidates, {
      name: input.supplier,
      kind: "vat_registry",
      source: "registry",
      vatNumber: input.supplierTaxId,
      confidence: 0.95,
      label: "analysis.supplierTaxId",
    });
  }
  return candidates;
}

export function buildDocumentLabelSupplierCandidate(input: {
  supplier: string;
  vatNumber?: string | null;
  confidence?: number | null;
}) {
  return {
    name: input.supplier,
    kind: "document_labeled" as const,
    source: "regex_gmail" as const,
    vatNumber: input.vatNumber ?? null,
    confidence: input.confidence ?? 0.92,
    label: "document_label",
  };
}

export function buildOcrKeywordSupplierCandidate(input: {
  supplier: string;
  keyword: string;
  confidence?: number | null;
}) {
  return {
    name: input.supplier,
    kind: "ocr_keyword" as const,
    source: "ocr_keyword" as const,
    confidence: input.confidence ?? 0.9,
    label: input.keyword,
  };
}

export function buildHistoricalSupplierCandidate(input: {
  supplier: string;
  vatNumber?: string | null;
  priorInvoiceCount: number;
}) {
  return {
    name: input.supplier,
    kind: "historical" as const,
    source: "registry" as const,
    vatNumber: input.vatNumber ?? null,
    confidence: Math.min(0.9, 0.6 + input.priorInvoiceCount * 0.05),
    label: `prior_invoices:${input.priorInvoiceCount}`,
  };
}

export function buildUserCorrectedSupplierCandidate(input: {
  supplier: string;
  vatNumber?: string | null;
}) {
  return {
    name: input.supplier,
    kind: "user_corrected" as const,
    source: "user_input" as const,
    vatNumber: input.vatNumber ?? null,
    confidence: 1,
    label: "user_correction",
  };
}

export function buildSenderSupplierCandidates(input: {
  senderDisplayName?: string | null;
  senderDomain?: string | null;
}) {
  const candidates: SupplierCandidate[] = [];
  pushSupplierCandidate(candidates, {
    name: input.senderDisplayName,
    kind: "sender_display",
    source: "sender",
    confidence: 0.52,
    label: "sender_display",
  });
  if (input.senderDomain) {
    const domainLabel = input.senderDomain.replace(/^www\./i, "").split(".")[0] ?? input.senderDomain;
    pushSupplierCandidate(candidates, {
      name: domainLabel,
      kind: "email_domain",
      source: "domain",
      confidence: 0.35,
      label: input.senderDomain,
      raw: input.senderDomain,
    });
  }
  return candidates;
}

export function summarizeSupplierDecision(decision: {
  supplierName: string | null;
  canonicalSupplier: string | null;
  normalizedName: string;
  vatNumber: string | null;
  confidence: number;
  evidenceScore: number;
  reason: string;
  reasonCode: string;
  status: string;
  version: string;
  evidence: Array<{ type: string; label: string; value: string; matched: boolean }>;
  aliases: string[];
  isStrongEnoughForAutoSave?: boolean;
  candidates?: Array<{ kind?: string | null }>;
}) {
  return {
    supplierName: decision.supplierName,
    canonicalSupplier: decision.canonicalSupplier,
    normalizedName: decision.normalizedName,
    vatNumber: decision.vatNumber,
    confidence: decision.confidence,
    evidenceScore: decision.evidenceScore,
    reason: decision.reason,
    reasonCode: decision.reasonCode,
    status: decision.status,
    version: decision.version,
    evidence: decision.evidence,
    aliases: decision.aliases,
    isStrongEnoughForAutoSave: decision.isStrongEnoughForAutoSave ?? false,
    winnerKind: decision.candidates?.[0]?.kind ?? null,
  };
}
