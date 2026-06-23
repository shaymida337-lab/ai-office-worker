import { buildDuplicateHash } from "../../lib/duplicate.js";
import type { CanonicalFingerprintResult } from "./sharedMatcher.js";
import { computeCanonicalFingerprint } from "./sharedMatcher.js";

export type SupplierPaymentIdentityLookups = {
  canonicalFingerprint: string;
  legacySemanticFingerprint: string;
  legacyCrossSourceFingerprint?: string | null;
  sourceFingerprint?: string | null;
  legacyDuplicateHash?: string | null;
  legacyGmailScanDuplicateKey?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  totalAmount: number | null;
  documentDate: Date | null;
};

function uniqueClauses(clauses: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  const unique: Array<Record<string, unknown>> = [];
  for (const clause of clauses) {
    const key = JSON.stringify(clause);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(clause);
  }
  return unique;
}

export function buildSupplierPaymentLookupClauses(input: SupplierPaymentIdentityLookups): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = [
    { documentFingerprint: input.canonicalFingerprint },
    { documentFingerprint: input.legacySemanticFingerprint },
    { duplicateHash: input.canonicalFingerprint },
    { duplicateHash: input.legacySemanticFingerprint },
  ];

  if (input.legacyCrossSourceFingerprint) {
    clauses.push({ documentFingerprint: input.legacyCrossSourceFingerprint });
    clauses.push({ duplicateHash: input.legacyCrossSourceFingerprint });
  }
  if (input.sourceFingerprint) {
    clauses.push({ sourceFingerprint: input.sourceFingerprint });
  }
  if (input.legacyDuplicateHash) {
    clauses.push({ duplicateHash: input.legacyDuplicateHash });
  }
  if (input.legacyGmailScanDuplicateKey) {
    clauses.push({ duplicateHash: input.legacyGmailScanDuplicateKey });
  }

  if (input.invoiceNumber?.trim() && input.totalAmount !== null) {
    clauses.push({
      invoiceNumber: input.invoiceNumber,
      amount: input.totalAmount,
    });
  }

  if (input.supplierName?.trim() && input.totalAmount !== null && input.documentDate) {
    const dayStart = new Date(input.documentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(input.documentDate);
    dayEnd.setHours(23, 59, 59, 999);
    clauses.push({
      supplier: { equals: input.supplierName, mode: "insensitive" },
      amount: input.totalAmount,
      date: { gte: dayStart, lte: dayEnd },
    });
  }

  return uniqueClauses(clauses);
}

export function buildClientGmailPaymentLookupClauses(input: {
  canonicalFingerprint: string;
  legacyDuplicateHash: string;
  supplier?: string | null;
  invoiceNumber?: string | null;
  amount: number | null;
  date: Date | string | null;
}): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = [
    { duplicateHash: input.canonicalFingerprint },
    { duplicateHash: input.legacyDuplicateHash },
    { documentFingerprint: input.canonicalFingerprint },
  ];

  if (input.invoiceNumber?.trim() && input.amount !== null) {
    clauses.push({ invoiceNumber: input.invoiceNumber, amount: input.amount });
  }

  const documentDate = input.date instanceof Date ? input.date : input.date ? new Date(input.date) : null;
  if (input.supplier?.trim() && input.amount !== null && documentDate && !Number.isNaN(documentDate.getTime())) {
    const dayStart = new Date(documentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(documentDate);
    dayEnd.setHours(23, 59, 59, 999);
    clauses.push({
      supplier: { equals: input.supplier, mode: "insensitive" },
      amount: input.amount,
      date: { gte: dayStart, lte: dayEnd },
    });
  }

  return uniqueClauses(clauses);
}

export function buildLegacyDuplicateHashForLookup(input: {
  organizationId: string;
  supplier: string;
  amount: number;
  dateIso: string;
  subject?: string | null;
}) {
  return buildDuplicateHash(input);
}

export function buildLegacyFileDuplicateHashForLookup(input: {
  organizationId: string;
  supplier: string;
  fileHash: string;
}) {
  return buildDuplicateHash({
    organizationId: input.organizationId,
    supplier: input.supplier,
    amount: 0,
    dateIso: "1970-01-01",
    subject: `file:${input.fileHash}`,
  });
}

export function resolvePaymentStorageFingerprints(input: {
  canonical: CanonicalFingerprintResult;
  legacyDuplicateHash?: string | null;
}) {
  const canonicalFingerprint = input.canonical.fingerprint ?? input.canonical.legacyFingerprint;
  return {
    documentFingerprint: canonicalFingerprint,
    duplicateHash: canonicalFingerprint,
    legacySemanticFingerprint: input.canonical.legacyFingerprint,
    legacyDuplicateHash: input.legacyDuplicateHash ?? null,
  };
}

export function buildPaymentLookupsFromCanonical(input: {
  organizationId: string;
  canonicalFingerprint: string;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  totalAmount: number | null;
  documentDate: Date | null;
  documentType?: string | null;
  fileSha256?: string | null;
  subject?: string | null;
  legacyGmailScanDuplicateKey?: string | null;
  sourceFingerprint?: string | null;
  legacyCrossSourceFingerprint?: string | null;
}) {
  const canonical = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.totalAmount,
    documentDate: input.documentDate,
    documentType: input.documentType,
    fileSha256: input.fileSha256,
  });
  const legacyDuplicateHash = buildLegacyDuplicateHashForLookup({
    organizationId: input.organizationId,
    supplier: input.supplierName ?? "unknown",
    amount: input.totalAmount ?? 0,
    dateIso: input.documentDate?.toISOString() ?? new Date().toISOString(),
    subject: input.subject,
  });
  const lookupClauses = buildSupplierPaymentLookupClauses({
    canonicalFingerprint: input.canonicalFingerprint,
    legacySemanticFingerprint: canonical.legacyFingerprint,
    legacyCrossSourceFingerprint: input.legacyCrossSourceFingerprint,
    sourceFingerprint: input.sourceFingerprint,
    legacyDuplicateHash,
    legacyGmailScanDuplicateKey: input.legacyGmailScanDuplicateKey,
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.totalAmount,
    documentDate: input.documentDate,
  });
  return {
    duplicateHash: input.canonicalFingerprint,
    legacyDuplicateHash,
    lookupClauses,
  };
}

export function logFingerprintShadowMode(input: {
  organizationId: string;
  source: string;
  canonical: CanonicalFingerprintResult;
  legacyDuplicateHash?: string | null;
}) {
  const canonicalShort = (input.canonical.fingerprint ?? "none").slice(0, 12);
  const legacyShort = input.canonical.legacyFingerprint.slice(0, 12);
  const legacyDupShort = (input.legacyDuplicateHash ?? "none").slice(0, 12);
  const prefixMismatch = input.canonical.fingerprint !== input.canonical.legacyFingerprint;
  console.log(
    `[scfc-shadow] org=${input.organizationId} source=${input.source} tier=${input.canonical.tier} canonical=${canonicalShort} legacy_semantic=${legacyShort} legacy_dupHash=${legacyDupShort} prefix_mismatch=${prefixMismatch}`
  );
}
