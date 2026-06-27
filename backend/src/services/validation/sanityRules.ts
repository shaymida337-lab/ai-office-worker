import { MAX_REASONABLE_FINANCIAL_AMOUNT, documentTypeReviewCeiling } from "../financialAmountLimits.js";
import type {
  FinancialSanityInput,
  SanityRuleId,
  SanityRuleResult,
} from "./sanityTypes.js";

const VAT_TOLERANCE_ILS = 1.5;
const SEQUENCE_GAP_WARNING = 50;
const HISTORICAL_RANGE_HIGH_MULTIPLIER = 4;
const HISTORICAL_RANGE_LOW_MULTIPLIER = 0.05;

const INVOICE_NUMBER_REQUIRED_TYPES = new Set([
  "tax_invoice",
  "tax_invoice_receipt",
  "invoice",
]);

const POSITIVE_AMOUNT_TYPES = new Set([
  "tax_invoice",
  "tax_invoice_receipt",
  "receipt",
  "payment_request",
  "invoice",
  "quote",
]);

function pass(ruleId: SanityRuleId, message: string, details?: Record<string, unknown>): SanityRuleResult {
  return { ruleId, severity: "pass", passed: true, message, details };
}

function warn(ruleId: SanityRuleId, message: string, details?: Record<string, unknown>): SanityRuleResult {
  return { ruleId, severity: "warning", passed: false, message, details };
}

function fail(ruleId: SanityRuleId, message: string, details?: Record<string, unknown>): SanityRuleResult {
  return { ruleId, severity: "error", passed: false, message, details };
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCurrency(value?: string | null): string {
  return (value ?? "ILS").trim().toUpperCase();
}

function isCreditDocument(documentType: string): boolean {
  return documentType === "credit_note" || documentType.includes("credit");
}

function extractNumericInvoiceSuffix(value: string | null | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function evaluateVatArithmetic(input: FinancialSanityInput): SanityRuleResult {
  const { moneyDecision } = input;
  const { selectedAmount, amountBeforeVat, vatAmount, currency } = moneyDecision;

  if (selectedAmount == null) {
    return pass(
      "vat_arithmetic",
      "VAT arithmetic was not evaluated because no invoice total was resolved."
    );
  }

  if (amountBeforeVat == null && vatAmount == null) {
    return pass(
      "vat_arithmetic",
      "No subtotal or VAT breakdown was extracted, so arithmetic consistency could not be checked."
    );
  }

  if (amountBeforeVat != null && vatAmount != null) {
    const computedTotal = amountBeforeVat + vatAmount;
    const delta = Math.abs(computedTotal - selectedAmount);
    if (delta > VAT_TOLERANCE_ILS) {
      return fail(
        "vat_arithmetic",
        `Subtotal (${formatMoney(amountBeforeVat, currency)}) plus VAT (${formatMoney(vatAmount, currency)}) equals ${formatMoney(computedTotal, currency)}, which does not match the invoice total ${formatMoney(selectedAmount, currency)}.`,
        { amountBeforeVat, vatAmount, selectedAmount, delta }
      );
    }
    return pass(
      "vat_arithmetic",
      `Subtotal and VAT add up to the invoice total within the allowed tolerance (${VAT_TOLERANCE_ILS} ${currency}).`,
      { amountBeforeVat, vatAmount, selectedAmount, delta }
    );
  }

  const vatRate = input.context?.vatRate ?? input.vatRate ?? 0.18;
  if (amountBeforeVat != null && vatAmount == null) {
    const expectedVat = amountBeforeVat * vatRate;
    const impliedTotal = amountBeforeVat + expectedVat;
    const delta = Math.abs(impliedTotal - selectedAmount);
    if (delta > VAT_TOLERANCE_ILS * 2) {
      return warn(
        "vat_arithmetic",
        `Only subtotal was extracted (${formatMoney(amountBeforeVat, currency)}). At ${Math.round(vatRate * 100)}% VAT the expected total would be about ${formatMoney(impliedTotal, currency)}, but the resolved total is ${formatMoney(selectedAmount, currency)}.`,
        { amountBeforeVat, expectedVat, impliedTotal, selectedAmount, vatRate }
      );
    }
  }

  if (vatAmount != null && amountBeforeVat == null && selectedAmount != null) {
    const impliedSubtotal = selectedAmount - vatAmount;
    if (impliedSubtotal <= 0) {
      return fail(
        "vat_arithmetic",
        `VAT amount (${formatMoney(vatAmount, currency)}) is larger than or equal to the invoice total (${formatMoney(selectedAmount, currency)}), which is not possible.`,
        { vatAmount, selectedAmount }
      );
    }
  }

  return pass("vat_arithmetic", "Available VAT fields are internally consistent.");
}

export function evaluateImpossibleAmount(input: FinancialSanityInput): SanityRuleResult {
  const amount = input.moneyDecision.selectedAmount;
  if (amount == null) {
    return pass("impossible_amount", "No amount was resolved, so impossible-amount checks were skipped.");
  }

  const absAmount = Math.abs(amount);
  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    return fail(
      "impossible_amount",
      "The resolved amount is not a valid number, which usually indicates a parsing failure.",
      { amount }
    );
  }

  if (absAmount > MAX_REASONABLE_FINANCIAL_AMOUNT) {
    return fail(
      "impossible_amount",
      `Amount ${formatMoney(absAmount, input.moneyDecision.currency)} exceeds the maximum reasonable business document limit of ${formatMoney(MAX_REASONABLE_FINANCIAL_AMOUNT, input.moneyDecision.currency)}.`,
      { amount, limit: MAX_REASONABLE_FINANCIAL_AMOUNT }
    );
  }

  if (absAmount === 0 && !isCreditDocument(input.invoiceData.documentType)) {
    return warn(
      "impossible_amount",
      "Invoice total is exactly zero, which is unusual for a payable document unless this is a credit adjustment.",
      { amount }
    );
  }

  return pass("impossible_amount", "Resolved amount is within a plausible business range.");
}

export function evaluateSupplierHistoricalRange(input: FinancialSanityInput): SanityRuleResult {
  const amount = input.moneyDecision.selectedAmount;
  const history = input.context?.supplierHistory;
  if (amount == null) {
    return pass("supplier_historical_range", "Historical range check skipped because no amount was resolved.");
  }
  if (!history || history.invoiceCount < 2) {
    return pass(
      "supplier_historical_range",
      "Not enough supplier history exists yet to compare this amount against prior invoices."
    );
  }

  const absAmount = Math.abs(amount);
  const { minAmount, maxAmount, averageAmount } = history;
  if (maxAmount != null && absAmount > maxAmount * HISTORICAL_RANGE_HIGH_MULTIPLIER) {
    return warn(
      "supplier_historical_range",
      `Amount ${formatMoney(absAmount, input.moneyDecision.currency)} is more than ${HISTORICAL_RANGE_HIGH_MULTIPLIER}x the supplier's historical maximum of ${formatMoney(maxAmount, input.moneyDecision.currency)}, which may indicate OCR or supplier mismatch.`,
      { amount: absAmount, maxAmount, invoiceCount: history.invoiceCount }
    );
  }

  if (minAmount != null && minAmount > 0 && absAmount < minAmount * HISTORICAL_RANGE_LOW_MULTIPLIER) {
    return warn(
      "supplier_historical_range",
      `Amount ${formatMoney(absAmount, input.moneyDecision.currency)} is far below this supplier's typical minimum of ${formatMoney(minAmount, input.moneyDecision.currency)}, which may indicate a partial amount was captured instead of the invoice total.`,
      { amount: absAmount, minAmount, invoiceCount: history.invoiceCount }
    );
  }

  if (averageAmount != null && averageAmount > 0) {
    const ratio = absAmount / averageAmount;
    if (ratio > 10) {
      return warn(
        "supplier_historical_range",
        `Amount ${formatMoney(absAmount, input.moneyDecision.currency)} is ${ratio.toFixed(1)}x the supplier average of ${formatMoney(averageAmount, input.moneyDecision.currency)}, which is unusually high.`,
        { amount: absAmount, averageAmount, ratio }
      );
    }
  }

  return pass(
    "supplier_historical_range",
    "Amount is consistent with this supplier's historical invoice range."
  );
}

export function evaluateFutureInvoiceDate(input: FinancialSanityInput): SanityRuleResult {
  const documentDate = parseDate(input.documentDate);
  if (!documentDate) {
    return warn(
      "future_invoice_date",
      "Document date is missing, so the invoice cannot be verified as chronologically valid."
    );
  }

  const reference = parseDate(input.context?.referenceDate) ?? new Date();
  const referenceDay = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const documentDay = new Date(documentDate.getFullYear(), documentDate.getMonth(), documentDate.getDate());

  if (documentDay.getTime() > referenceDay.getTime()) {
    return fail(
      "future_invoice_date",
      `Invoice date ${documentDay.toISOString().slice(0, 10)} is in the future relative to the processing date ${referenceDay.toISOString().slice(0, 10)}, which is not valid for issued invoices.`,
      { documentDate: documentDay.toISOString(), referenceDate: referenceDay.toISOString() }
    );
  }

  return pass("future_invoice_date", "Invoice date is not in the future.");
}

export function evaluateDuplicateSuspicion(input: FinancialSanityInput): SanityRuleResult {
  const fingerprint = input.fingerprint?.fingerprint ?? null;
  const duplicates = input.context?.duplicateFingerprints ?? [];

  if (fingerprint && duplicates.includes(fingerprint)) {
    return fail(
      "duplicate_suspicion",
      `Document fingerprint ${fingerprint.slice(0, 24)}… matches an existing invoice in this organization, so this is likely a duplicate submission.`,
      { fingerprint }
    );
  }

  if (input.fingerprint && !input.fingerprint.isStrongEnoughForAutoSaveDedup && fingerprint) {
    return warn(
      "duplicate_suspicion",
      `Fingerprint tier "${input.fingerprint.tier}" is weak, so duplicate detection confidence is limited and manual review is recommended.`,
      { tier: input.fingerprint.tier, fingerprint }
    );
  }

  const supplier = input.supplierDecision.supplierName ?? input.supplierDecision.canonicalSupplier;
  const amount = input.moneyDecision.selectedAmount;
  const date = parseDate(input.documentDate);
  if (supplier && amount != null && date) {
    const semanticKey = `${supplier}|${Math.abs(amount)}|${date.toISOString().slice(0, 10)}`;
    if (duplicates.includes(semanticKey)) {
      return fail(
        "duplicate_suspicion",
        `Another document already exists for supplier "${supplier}" with the same amount and date, which strongly suggests a duplicate.`,
        { semanticKey }
      );
    }
  }

  return pass("duplicate_suspicion", "No duplicate fingerprint or semantic duplicate was detected.");
}

export function evaluateMissingInvoiceNumber(input: FinancialSanityInput): SanityRuleResult {
  const documentType = input.invoiceData.documentType;
  const invoiceNumber = (input.invoiceNumber ?? "").trim();

  if (INVOICE_NUMBER_REQUIRED_TYPES.has(documentType) && !invoiceNumber) {
    return fail(
      "missing_invoice_number",
      `Document type "${documentType}" requires an invoice number for accounting traceability, but none was extracted.`,
      { documentType }
    );
  }

  if (!invoiceNumber && (documentType === "receipt" || documentType === "payment_request")) {
    return warn(
      "missing_invoice_number",
      `No invoice or receipt number was found on this ${documentType.replace(/_/g, " ")}.`
    );
  }

  if (invoiceNumber.length > 0 && invoiceNumber.length < 2) {
    return warn(
      "missing_invoice_number",
      `Invoice number "${invoiceNumber}" is unusually short and may be an OCR fragment rather than a real document number.`
    );
  }

  return pass("missing_invoice_number", "Invoice number presence looks acceptable for this document type.");
}

export function evaluateCurrencyMismatch(input: FinancialSanityInput): SanityRuleResult {
  const resolvedCurrency = normalizeCurrency(input.moneyDecision.currency);
  const expectedCurrency = normalizeCurrency(
    input.context?.expectedCurrency ??
      input.currency ??
      input.context?.supplierHistory?.typicalCurrency ??
      resolvedCurrency
  );

  if (resolvedCurrency !== expectedCurrency) {
    return fail(
      "currency_mismatch",
      `Resolved currency ${resolvedCurrency} does not match the expected supplier/document currency ${expectedCurrency}, which may indicate the wrong amount field was selected.`,
      { resolvedCurrency, expectedCurrency }
    );
  }

  const candidateCurrencies = new Set(
    input.moneyDecision.candidates
      .map((candidate) => normalizeCurrency(candidate.currency))
      .filter((currency) => currency.length > 0)
  );
  if (candidateCurrencies.size > 1) {
    return warn(
      "currency_mismatch",
      `Multiple currencies appeared among amount candidates (${[...candidateCurrencies].join(", ")}), so currency resolution may be ambiguous.`,
      { candidateCurrencies: [...candidateCurrencies] }
    );
  }

  return pass("currency_mismatch", "Currency is consistent across resolved amount and expectations.");
}

export function evaluateNegativeInvoiceValidation(input: FinancialSanityInput): SanityRuleResult {
  const amount = input.moneyDecision.selectedAmount;
  if (amount == null) {
    return pass("negative_invoice_validation", "Sign validation skipped because no amount was resolved.");
  }

  const documentType = input.invoiceData.documentType;
  if (isCreditDocument(documentType)) {
    if (amount > 0) {
      return warn(
        "negative_invoice_validation",
        `Credit document type "${documentType}" has a positive total ${formatMoney(amount, input.moneyDecision.currency)}; credit notes are usually negative or explicitly marked as credits.`,
        { amount, documentType }
      );
    }
    return pass("negative_invoice_validation", "Credit document amount sign looks appropriate.");
  }

  if (POSITIVE_AMOUNT_TYPES.has(documentType) && amount < 0) {
    return fail(
      "negative_invoice_validation",
      `Document type "${documentType}" has a negative total ${formatMoney(amount, input.moneyDecision.currency)}, which is invalid unless this is a credit note.`,
      { amount, documentType }
    );
  }

  return pass("negative_invoice_validation", "Invoice amount sign matches the document type.");
}

export function evaluateCreditNoteValidation(input: FinancialSanityInput): SanityRuleResult {
  const documentType = input.invoiceData.documentType;
  if (!isCreditDocument(documentType)) {
    return pass("credit_note_validation", "Not a credit note; credit-specific validation skipped.");
  }

  const amount = input.moneyDecision.selectedAmount;
  if (amount == null) {
    return fail(
      "credit_note_validation",
      "Credit note is missing a resolved total amount, so the credit cannot be validated."
    );
  }

  if (amount > 0) {
    return warn(
      "credit_note_validation",
      `Credit note total is positive (${formatMoney(amount, input.moneyDecision.currency)}). Credits should reduce payable balance and are usually recorded as negative amounts.`,
      { amount }
    );
  }

  const { amountBeforeVat, vatAmount } = input.moneyDecision;
  if (amountBeforeVat != null && amountBeforeVat > 0) {
    return fail(
      "credit_note_validation",
      `Credit note subtotal is positive (${formatMoney(amountBeforeVat, input.moneyDecision.currency)}), but credit note line items should be negative or zero.`,
      { amountBeforeVat }
    );
  }

  if (vatAmount != null && vatAmount > 0 && amount < 0) {
    return fail(
      "credit_note_validation",
      `Credit note VAT is positive (${formatMoney(vatAmount, input.moneyDecision.currency)}) while the total is negative, which breaks VAT direction consistency.`,
      { vatAmount, amount }
    );
  }

  const referenced = input.invoiceData.referencedInvoiceNumber?.trim();
  if (!referenced) {
    return warn(
      "credit_note_validation",
      "Credit note does not reference an original invoice number, making reconciliation harder."
    );
  }

  return pass("credit_note_validation", "Credit note fields are internally consistent.");
}

export function evaluateInvoiceSequenceAnomaly(input: FinancialSanityInput): SanityRuleResult {
  const current = extractNumericInvoiceSuffix(input.invoiceNumber);
  const history = input.context?.supplierHistory;
  const last = extractNumericInvoiceSuffix(history?.lastInvoiceNumber);

  if (current == null) {
    return pass(
      "invoice_sequence_anomaly",
      "Invoice number is not numeric, so sequential anomaly checks were skipped."
    );
  }

  if (last == null) {
    return pass(
      "invoice_sequence_anomaly",
      "No prior numeric invoice number exists for this supplier, so sequence checks were skipped."
    );
  }

  const recent = (history?.recentInvoiceNumbers ?? [])
    .map((value) => extractNumericInvoiceSuffix(value))
    .filter((value): value is number => value != null);
  if (recent.includes(current)) {
    return fail(
      "invoice_sequence_anomaly",
      `Invoice number ${current} already appears in this supplier's recent invoice history, suggesting a repeated document number.`,
      { current, recent }
    );
  }

  if (current < last) {
    return warn(
      "invoice_sequence_anomaly",
      `Invoice number ${current} is lower than the supplier's last seen invoice number ${last}, which may indicate an old document, a different branch series, or OCR error.`,
      { current, last }
    );
  }

  const gap = current - last;
  if (gap > SEQUENCE_GAP_WARNING) {
    return warn(
      "invoice_sequence_anomaly",
      `Invoice number jumped from ${last} to ${current} (gap of ${gap}), which is unusually large and may mean invoices are missing or the number was misread.`,
      { current, last, gap }
    );
  }

  return pass("invoice_sequence_anomaly", "Invoice number progression looks plausible.");
}

export function evaluateOcrSuspiciousPatterns(input: FinancialSanityInput): SanityRuleResult {
  const raw = (input.invoiceData.rawOcrText ?? "").trim();
  if (!raw) {
    return pass("ocr_suspicious_patterns", "No OCR text was provided, so OCR pattern checks were skipped.");
  }

  const suspiciousReasons: string[] = [];

  if (/(.)\1{7,}/.test(raw)) {
    suspiciousReasons.push("OCR text contains long repeated character runs, which often indicates garbage recognition.");
  }

  if (/\b[0O]{6,}\b|\b[1Il]{6,}\b/.test(raw)) {
    suspiciousReasons.push("OCR text contains long runs of easily confused characters (0/O or 1/I/l), which commonly corrupt amounts and invoice numbers.");
  }

  if (/(?:₪|ILS|NIS)\s*0{4,}/i.test(raw)) {
    suspiciousReasons.push("OCR captured a currency label followed by many zeros, which often means the decimal point was lost.");
  }

  const amount = input.moneyDecision.selectedAmount;
  if (amount != null) {
    const digits = String(Math.round(Math.abs(amount)));
    if (digits.length >= 4 && /^(\d)\1+$/.test(digits)) {
      suspiciousReasons.push(
        `Resolved amount ${amount} uses repeated identical digits (${digits}), which is a common OCR hallucination pattern.`
      );
    }
  }

  const alphaRatio = (raw.match(/[A-Za-z\u0590-\u05FF]/g)?.length ?? 0) / raw.length;
  const digitRatio = (raw.match(/\d/g)?.length ?? 0) / raw.length;
  if (raw.length > 80 && alphaRatio < 0.05 && digitRatio > 0.8) {
    suspiciousReasons.push("OCR output is mostly digits with almost no letters, which is atypical for real invoices and may be noise.");
  }

  if (suspiciousReasons.length > 0) {
    return warn(
      "ocr_suspicious_patterns",
      suspiciousReasons.join(" "),
      { suspiciousReasons }
    );
  }

  return pass("ocr_suspicious_patterns", "No suspicious OCR artifact patterns were detected.");
}

export function evaluateDocumentTypeCeiling(input: FinancialSanityInput): SanityRuleResult {
  const amount = input.moneyDecision.selectedAmount;
  if (amount == null) {
    return pass("document_type_ceiling", "Document-type ceiling skipped because no amount was resolved.");
  }
  const ceiling = documentTypeReviewCeiling(input.invoiceData.documentType);
  if (ceiling == null) {
    return pass("document_type_ceiling", "No document-type ceiling configured for this document.");
  }
  if (Math.abs(amount) > ceiling) {
    return warn(
      "document_type_ceiling",
      `Amount ${formatMoney(Math.abs(amount), input.moneyDecision.currency)} exceeds the conservative ${input.invoiceData.documentType} review ceiling of ${formatMoney(ceiling, input.moneyDecision.currency)}.`,
      { amount, ceiling, documentType: input.invoiceData.documentType }
    );
  }
  return pass("document_type_ceiling", "Amount is within the document-type review ceiling.");
}

export const SANITY_RULE_ORDER: SanityRuleId[] = [
  "vat_arithmetic",
  "impossible_amount",
  "document_type_ceiling",
  "supplier_historical_range",
  "future_invoice_date",
  "duplicate_suspicion",
  "missing_invoice_number",
  "currency_mismatch",
  "negative_invoice_validation",
  "credit_note_validation",
  "invoice_sequence_anomaly",
  "ocr_suspicious_patterns",
];

export const SANITY_RULE_EVALUATORS: Record<SanityRuleId, (input: FinancialSanityInput) => SanityRuleResult> = {
  vat_arithmetic: evaluateVatArithmetic,
  impossible_amount: evaluateImpossibleAmount,
  supplier_historical_range: evaluateSupplierHistoricalRange,
  future_invoice_date: evaluateFutureInvoiceDate,
  duplicate_suspicion: evaluateDuplicateSuspicion,
  missing_invoice_number: evaluateMissingInvoiceNumber,
  currency_mismatch: evaluateCurrencyMismatch,
  negative_invoice_validation: evaluateNegativeInvoiceValidation,
  credit_note_validation: evaluateCreditNoteValidation,
  invoice_sequence_anomaly: evaluateInvoiceSequenceAnomaly,
  ocr_suspicious_patterns: evaluateOcrSuspiciousPatterns,
  document_type_ceiling: evaluateDocumentTypeCeiling,
};

export function evaluateAllSanityRules(input: FinancialSanityInput): SanityRuleResult[] {
  return SANITY_RULE_ORDER.map((ruleId) => SANITY_RULE_EVALUATORS[ruleId](input));
}
