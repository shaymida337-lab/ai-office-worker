import { parseSupplierGateFromParsedFields } from "./supplier/supplierGate.js";
import {
  matchIsraeliSupplierFromOcrText,
  normalizeIsraeliReviewSupplierAlias,
  suppliersEquivalentForReview,
} from "./supplier/israeliReviewSupplier.js";
import { lookupSupplierByVat, buildGlobalSupplierDnaSeed, lookupSupplierByAlias } from "./supplier/supplierRegistry.js";
import { resolveCanonicalDisplayName } from "./supplier/supplierRegistry.js";

export type ReviewSupplierConfidence = "high" | "low" | "missing";

export type ReviewSupplierState = {
  rawExtractedName?: string | null;
  confirmedName?: string | null;
  confirmedAt?: string | null;
  confirmedByUserId?: string | null;
};

export type ReviewSupplierResolution = {
  rawSupplierName: string | null;
  displaySupplierName: string | null;
  confirmedSupplierName: string | null;
  supplierConfidence: ReviewSupplierConfidence;
  supplierNeedsConfirmation: boolean;
  supplierUncertain: boolean;
  normalizationApplied: boolean;
  ocrHintSupplier: string | null;
  supplierGateVerdict: "pass" | "review" | "block" | null;
};

type ReviewSupplierInput = {
  supplierName?: string | null;
  sender?: string | null;
  supplierTaxId?: string | null;
  parsedFieldsJson?: unknown;
  rawAnalysis?: unknown;
};

function readReviewSupplierState(parsedFieldsJson: unknown): ReviewSupplierState | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object") return null;
  const state = (parsedFieldsJson as { reviewSupplier?: unknown }).reviewSupplier;
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  return {
    rawExtractedName: typeof record.rawExtractedName === "string" ? record.rawExtractedName : null,
    confirmedName: typeof record.confirmedName === "string" ? record.confirmedName : null,
    confirmedAt: typeof record.confirmedAt === "string" ? record.confirmedAt : null,
    confirmedByUserId: typeof record.confirmedByUserId === "string" ? record.confirmedByUserId : null,
  };
}

function readSirSummary(parsedFieldsJson: unknown): {
  supplierName?: string | null;
  canonicalSupplier?: string | null;
  isStrongEnoughForAutoSave?: boolean;
  status?: string | null;
} | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object") return null;
  const sir = (parsedFieldsJson as { sir?: unknown }).sir;
  if (!sir || typeof sir !== "object") return null;
  const record = sir as Record<string, unknown>;
  return {
    supplierName: typeof record.supplierName === "string" ? record.supplierName : null,
    canonicalSupplier: typeof record.canonicalSupplier === "string" ? record.canonicalSupplier : null,
    isStrongEnoughForAutoSave: record.isStrongEnoughForAutoSave === true,
    status: typeof record.status === "string" ? record.status : null,
  };
}

function collectOcrText(value: unknown, parts: string[], depth = 0): void {
  if (depth > 6 || parts.join("").length > 20_000) return;
  if (typeof value === "string") {
    if (/rawOcrText|ocrText|ocr_text/i.test(value) || value.length > 40) {
      parts.push(value);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectOcrText(entry, parts, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/rawOcrText|ocrText|ocr_text/i.test(key) && typeof entry === "string") {
      parts.push(entry);
      continue;
    }
    collectOcrText(entry, parts, depth + 1);
  }
}

function extractOcrText(input: ReviewSupplierInput): string {
  const parts: string[] = [];
  collectOcrText(input.parsedFieldsJson, parts);
  collectOcrText(input.rawAnalysis, parts);
  return parts.join("\n");
}

function resolveRawExtractedName(input: ReviewSupplierInput, reviewState: ReviewSupplierState | null): string | null {
  const fromState = reviewState?.rawExtractedName?.trim();
  if (fromState) return fromState;
  const fromColumn = input.supplierName?.trim();
  if (fromColumn) return fromColumn;
  const sir = readSirSummary(input.parsedFieldsJson);
  return sir?.supplierName?.trim() || null;
}

const UNKNOWN_SUPPLIER_PATTERN = /^(?:לא\s*ידוע|לא\s*זוהה|unknown|לא\s*נמצא)/iu;

function readClaudeSupplier(rawAnalysis: unknown): string | null {
  if (!rawAnalysis || typeof rawAnalysis !== "object") return null;
  const analysis = (rawAnalysis as { analysis?: unknown }).analysis;
  if (!analysis || typeof analysis !== "object") return null;
  const supplier = (analysis as { supplier?: unknown }).supplier;
  return typeof supplier === "string" ? supplier.trim() : null;
}

function isWeakUnknownSupplier(name: string | null | undefined): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return true;
  return UNKNOWN_SUPPLIER_PATTERN.test(trimmed);
}

/**
 * מפתחות פנימיים של ה-registry (למשל "known:פז" מ-SIR ב-gmail-sync) לעולם אינם
 * שם ספק לתצוגה או לתשלום — מוסרים את הקידומת ומשאירים את השם בלבד.
 * ראיה מפרודקשן: SupplierPayment נשמר עם supplier="known:פז" במקום "פז".
 */
const INTERNAL_SUPPLIER_KEY_REGEX = /^(?:known|canonical):\s*/i;

export function stripInternalSupplierKey(name: string): string {
  let cleaned = name.trim();
  while (INTERNAL_SUPPLIER_KEY_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(INTERNAL_SUPPLIER_KEY_REGEX, "").trim();
  }
  return cleaned;
}

function toDisplaySupplierName(name: string, preferredName?: string | null): string {
  const preferred = preferredName?.trim();
  if (preferred && !INTERNAL_SUPPLIER_KEY_REGEX.test(preferred)) {
    return normalizeIsraeliReviewSupplierAlias(preferred);
  }
  const stripped = stripInternalSupplierKey(name);
  const registry = buildGlobalSupplierDnaSeed();
  const byAlias = lookupSupplierByAlias(registry, stripped);
  if (byAlias) return resolveCanonicalDisplayName(byAlias, stripped);
  return normalizeIsraeliReviewSupplierAlias(stripped);
}

/** מנרמל מפתח supplier לפני שמירה ב-SupplierPayment (כולל yellow→פז, known: stripping). */
export function normalizeSupplierPaymentKey(name: string): string {
  return normalizeIsraeliReviewSupplierAlias(stripInternalSupplierKey(name));
}

function shouldAllowOcrSupplierOverride(
  input: ReviewSupplierInput,
  raw: string | null,
  sir: ReturnType<typeof readSirSummary>,
  ocrHint: string
): boolean {
  if (sir?.status === "ambiguous" || sir?.status === "rejected") return false;

  const claude = readClaudeSupplier(input.rawAnalysis);
  if (claude && !isWeakUnknownSupplier(claude) && !suppliersEquivalentForReview(ocrHint, claude)) {
    return false;
  }

  if (raw && !isWeakUnknownSupplier(raw) && !suppliersEquivalentForReview(ocrHint, raw)) {
    return false;
  }

  if (
    sir?.supplierName &&
    sir.status === "resolved" &&
    !isWeakUnknownSupplier(sir.supplierName) &&
    !suppliersEquivalentForReview(ocrHint, sir.supplierName)
  ) {
    return false;
  }

  return true;
}

function resolveNormalizedDisplayName(raw: string | null, input: ReviewSupplierInput): {
  display: string | null;
  normalizationApplied: boolean;
  registryNormalized: boolean;
  ocrHintSupplier: string | null;
} {
  if (!raw) {
    const ocrText = extractOcrText(input);
    const ocrHint = ocrText ? matchIsraeliSupplierFromOcrText(ocrText) : null;
    const sir = readSirSummary(input.parsedFieldsJson);
    const display =
      ocrHint && shouldAllowOcrSupplierOverride(input, raw, sir, ocrHint)
        ? toDisplaySupplierName(ocrHint)
        : null;
    return {
      display,
      normalizationApplied: Boolean(display),
      registryNormalized: false,
      ocrHintSupplier: ocrHint,
    };
  }

  const registry = buildGlobalSupplierDnaSeed();
  const byVat = lookupSupplierByVat(registry, input.supplierTaxId);
  if (byVat) {
    const display = toDisplaySupplierName(resolveCanonicalDisplayName(byVat, raw));
    return {
      display,
      normalizationApplied: !suppliersEquivalentForReview(display, raw),
      registryNormalized: true,
      ocrHintSupplier: null,
    };
  }

  const byAlias = lookupSupplierByAlias(registry, raw);
  if (byAlias) {
    const display = toDisplaySupplierName(resolveCanonicalDisplayName(byAlias, raw));
    return {
      display,
      normalizationApplied: !suppliersEquivalentForReview(display, raw),
      registryNormalized: true,
      ocrHintSupplier: null,
    };
  }

  const aliasNormalized = toDisplaySupplierName(raw);
  if (!suppliersEquivalentForReview(aliasNormalized, raw)) {
    return {
      display: aliasNormalized,
      normalizationApplied: true,
      registryNormalized: false,
      ocrHintSupplier: null,
    };
  }

  const sir = readSirSummary(input.parsedFieldsJson);
  const sirCanonical = sir?.canonicalSupplier?.trim();
  if (sirCanonical && !suppliersEquivalentForReview(sirCanonical, raw)) {
    return {
      display: toDisplaySupplierName(sirCanonical, sir?.supplierName),
      normalizationApplied: true,
      registryNormalized: false,
      ocrHintSupplier: null,
    };
  }

  const supplierGate = parseSupplierGateFromParsedFields(input.parsedFieldsJson);
  const gateCanonical = supplierGate?.canonicalSupplierName?.trim();
  if (gateCanonical && supplierGate?.verdict === "pass") {
    const equivalent = suppliersEquivalentForReview(gateCanonical, raw);
    // When known:/canonical: is only an internal key for the same supplier, keep the
    // extracted display name and do not treat it as a normalization that needs confirmation.
    return {
      display: equivalent
        ? toDisplaySupplierName(raw)
        : toDisplaySupplierName(gateCanonical, sir?.supplierName),
      normalizationApplied: !equivalent,
      registryNormalized: false,
      ocrHintSupplier: null,
    };
  }

  const ocrText = extractOcrText(input);
  const ocrHint = ocrText ? matchIsraeliSupplierFromOcrText(ocrText) : null;
  if (ocrHint && shouldAllowOcrSupplierOverride(input, raw, sir, ocrHint) && !suppliersEquivalentForReview(ocrHint, raw)) {
    return {
      display: toDisplaySupplierName(ocrHint),
      normalizationApplied: true,
      registryNormalized: false,
      ocrHintSupplier: ocrHint,
    };
  }

  return {
    display: aliasNormalized,
    normalizationApplied: false,
    registryNormalized: false,
    ocrHintSupplier: ocrHint,
  };
}

export function resolveReviewSupplierContext(input: ReviewSupplierInput): ReviewSupplierResolution {
  const reviewState = readReviewSupplierState(input.parsedFieldsJson);
  const rawSupplierName = resolveRawExtractedName(input, reviewState);
  const confirmedSupplierName = reviewState?.confirmedName?.trim() || null;
  const supplierGate = parseSupplierGateFromParsedFields(input.parsedFieldsJson);
  const supplierGateVerdict = supplierGate?.verdict ?? null;
  const sir = readSirSummary(input.parsedFieldsJson);

  const normalized = resolveNormalizedDisplayName(rawSupplierName, input);
  const displaySupplierName = confirmedSupplierName
    ? toDisplaySupplierName(confirmedSupplierName)
    : normalized.display;

  if (!displaySupplierName) {
    return {
      rawSupplierName,
      displaySupplierName: null,
      confirmedSupplierName,
      supplierConfidence: "missing",
      supplierNeedsConfirmation: true,
      supplierUncertain: true,
      normalizationApplied: false,
      ocrHintSupplier: normalized.ocrHintSupplier,
      supplierGateVerdict,
    };
  }

  if (confirmedSupplierName) {
    return {
      rawSupplierName,
      displaySupplierName,
      confirmedSupplierName,
      supplierConfidence: "high",
      supplierNeedsConfirmation: false,
      supplierUncertain: false,
      normalizationApplied: normalized.normalizationApplied,
      ocrHintSupplier: normalized.ocrHintSupplier,
      supplierGateVerdict,
    };
  }

  const gateLow =
    supplierGateVerdict === "review" ||
    supplierGateVerdict === "block" ||
    sir?.status === "ambiguous" ||
    sir?.status === "rejected" ||
    sir?.isStrongEnoughForAutoSave === false;

  if (supplierGateVerdict === "pass") {
    const displayDiffersFromRaw =
      Boolean(rawSupplierName && displaySupplierName) &&
      !suppliersEquivalentForReview(displaySupplierName!, rawSupplierName!);
    if (displayDiffersFromRaw || normalized.normalizationApplied) {
      return {
        rawSupplierName,
        displaySupplierName,
        confirmedSupplierName,
        supplierConfidence: "low",
        supplierNeedsConfirmation: true,
        supplierUncertain: true,
        normalizationApplied: normalized.normalizationApplied,
        ocrHintSupplier: normalized.ocrHintSupplier,
        supplierGateVerdict,
      };
    }
    return {
      rawSupplierName,
      displaySupplierName,
      confirmedSupplierName,
      supplierConfidence: "high",
      supplierNeedsConfirmation: false,
      supplierUncertain: false,
      normalizationApplied: normalized.normalizationApplied,
      ocrHintSupplier: normalized.ocrHintSupplier,
      supplierGateVerdict,
    };
  }

  const uncertain =
    gateLow ||
    (normalized.normalizationApplied &&
      !normalized.registryNormalized &&
      !suppliersEquivalentForReview(normalized.display ?? "", rawSupplierName ?? "")) ||
    Boolean(
      normalized.ocrHintSupplier &&
        !suppliersEquivalentForReview(normalized.ocrHintSupplier, rawSupplierName ?? "")
    );

  const supplierConfidence: ReviewSupplierConfidence = uncertain ? "low" : "high";

  return {
    rawSupplierName,
    displaySupplierName,
    confirmedSupplierName,
    supplierConfidence,
    supplierNeedsConfirmation: uncertain,
    supplierUncertain: uncertain,
    normalizationApplied: normalized.normalizationApplied,
    ocrHintSupplier: normalized.ocrHintSupplier,
    supplierGateVerdict,
  };
}

export function mergeReviewSupplierConfirmation(
  parsedFieldsJson: unknown,
  input: {
    rawExtractedName: string | null;
    confirmedName: string;
    userId?: string | null;
  }
): Record<string, unknown> {
  const base =
    parsedFieldsJson && typeof parsedFieldsJson === "object" && !Array.isArray(parsedFieldsJson)
      ? { ...(parsedFieldsJson as Record<string, unknown>) }
      : {};
  const confirmed = normalizeIsraeliReviewSupplierAlias(input.confirmedName);
  base.reviewSupplier = {
    rawExtractedName: input.rawExtractedName,
    confirmedName: confirmed,
    confirmedAt: new Date().toISOString(),
    confirmedByUserId: input.userId ?? null,
  };
  const existingSir =
    base.sir && typeof base.sir === "object" && !Array.isArray(base.sir)
      ? { ...(base.sir as Record<string, unknown>) }
      : {};
  base.sir = {
    ...existingSir,
    supplierName: confirmed,
    canonicalSupplier: confirmed,
    status: "resolved",
    isStrongEnoughForAutoSave: true,
    reasonCode: "supplier.manually_confirmed",
  };
  return base;
}

export function resolveSupplierNameForApproval(
  review: ReviewSupplierInput,
  confirmedSupplierName?: string | null
): string {
  const trimmed = confirmedSupplierName?.trim();
  if (trimmed) {
    const normalized = normalizeSupplierPaymentKey(trimmed);
    const context = resolveReviewSupplierContext(review);
    if (context.supplierNeedsConfirmation) {
      const acceptableDisplay = context.displaySupplierName;
      if (!acceptableDisplay || !suppliersEquivalentForReview(normalized, acceptableDisplay)) {
        throw new Error(
          "לא ניתן לאשר מסמך — יש לאשר או לערוך את שם הספק לפני האישור (supplier.needs_confirmation)"
        );
      }
    }
    return normalized;
  }

  const context = resolveReviewSupplierContext(review);
  if (context.confirmedSupplierName) return normalizeSupplierPaymentKey(context.confirmedSupplierName);

  if (context.supplierNeedsConfirmation || context.supplierConfidence === "low") {
    throw new Error("לא ניתן לאשר מסמך — יש לאשר או לערוך את שם הספק לפני האישור (supplier.needs_confirmation)");
  }

  const gateCanonical = parseSupplierGateFromParsedFields(review.parsedFieldsJson)?.canonicalSupplierName?.trim();
  if (gateCanonical) {
    const cleaned = normalizeSupplierPaymentKey(gateCanonical);
    if (cleaned) return cleaned;
  }

  if (context.displaySupplierName) return normalizeSupplierPaymentKey(context.displaySupplierName);

  throw new Error("Cannot approve document without a verified supplier name");
}
