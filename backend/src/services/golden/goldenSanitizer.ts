export const SANITIZED_EMAIL = "[EMAIL]" as const;
export const SANITIZED_PHONE = "[PHONE]" as const;
export const SANITIZED_ADDRESS = "[ADDRESS]" as const;
export const SANITIZED_TAX_ID = "[TAX_ID]" as const;
export const SANITIZED_NAME = "[NAME]" as const;
export const SANITIZED_INVOICE = "INV-****" as const;
export const SANITIZED_OCR_PLACEHOLDER = "[OCR_REDACTED]" as const;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}(?:[\s.-]?\d{1,5})?/g;
const TAX_ID_PATTERN = /\b\d{9}\b/g;
const INVOICE_NUMBER_PATTERN =
  /\bINV[-\s#:/][A-Z0-9][A-Z0-9\-\/]{2,}\b|\b(?:חשבונית(?:\s*מס)?|מס['׳]?\s*#?|מספר\s*חשבונית)\s*[#:\-]?\s*[A-Z0-9][A-Z0-9\-\/]{2,}\b/gi;
const STANDALONE_INVOICE_TOKEN_PATTERN = /\b[A-Z]{1,4}-\d{3,}\b/gi;
const ADDRESS_PATTERN =
  /\b\d{1,5}\s+(?:[A-Za-z\u0590-\u05FF][\w\u0590-\u05FF.'-]*\s+){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|רחוב|שדרות|דרך)\b/gi;
const OBVIOUS_NAME_PATTERN =
  /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b|\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g;

export function maskEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, SANITIZED_EMAIL);
}

export function maskPhoneNumbers(text: string): string {
  return text.replace(PHONE_PATTERN, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7) return match;
    return SANITIZED_PHONE;
  });
}

export function maskAddresses(text: string): string {
  return text.replace(ADDRESS_PATTERN, SANITIZED_ADDRESS);
}

export function maskTaxIds(text: string): string {
  return text.replace(TAX_ID_PATTERN, SANITIZED_TAX_ID);
}

export function maskInvoiceNumbers(text: string): string {
  let result = text.replace(INVOICE_NUMBER_PATTERN, SANITIZED_INVOICE);
  result = result.replace(STANDALONE_INVOICE_TOKEN_PATTERN, SANITIZED_INVOICE);
  return result;
}

export function maskObviousPersonalNames(text: string): string {
  return text.replace(OBVIOUS_NAME_PATTERN, SANITIZED_NAME);
}

export function sanitizeFreeText(text: string | null | undefined): string | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  let sanitized = trimmed;
  sanitized = maskEmails(sanitized);
  sanitized = maskPhoneNumbers(sanitized);
  sanitized = maskAddresses(sanitized);
  sanitized = maskTaxIds(sanitized);
  sanitized = maskInvoiceNumbers(sanitized);
  sanitized = maskObviousPersonalNames(sanitized);
  return sanitized.trim() || null;
}

export function minimizeRawOcrText(text: string | null | undefined): string | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const sanitized = sanitizeFreeText(trimmed);
  if (!sanitized) return SANITIZED_OCR_PLACEHOLDER;

  const collapsed = sanitized.replace(/\s+/g, " ");
  if (collapsed.length <= 80) return collapsed;
  return `${collapsed.slice(0, 77)}...`;
}

export function sanitizeSupplierLabel(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed.toLowerCase() === "unknown") return trimmed || null;

  if (EMAIL_PATTERN.test(trimmed)) return SANITIZED_EMAIL;
  if (PHONE_PATTERN.test(trimmed) && trimmed.replace(/\D/g, "").length >= 7) return SANITIZED_PHONE;

  const sanitized = sanitizeFreeText(trimmed);
  return sanitized ?? trimmed;
}

export function containsLikelyPii(text: string): boolean {
  const probe = text
    .replaceAll(SANITIZED_EMAIL, "")
    .replaceAll(SANITIZED_PHONE, "")
    .replaceAll(SANITIZED_ADDRESS, "")
    .replaceAll(SANITIZED_TAX_ID, "")
    .replaceAll(SANITIZED_NAME, "")
    .replaceAll(SANITIZED_INVOICE, "");

  if (EMAIL_PATTERN.test(probe)) return true;

  const phoneMatches = probe.match(PHONE_PATTERN) ?? [];
  if (
    phoneMatches.some((match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return false;
      if (/^\d{4}-\d{2}-\d{2}$/.test(match.trim())) return false;
      return true;
    })
  ) {
    return true;
  }

  if (TAX_ID_PATTERN.test(probe)) return true;
  if (INVOICE_NUMBER_PATTERN.test(probe)) return true;
  if (STANDALONE_INVOICE_TOKEN_PATTERN.test(probe)) return true;
  return false;
}

function sanitizeUnknown(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeFreeText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (key === "vatNumber" || key === "supplierTaxId" || key === "businessId") {
        output[key] = nested == null ? nested : SANITIZED_TAX_ID;
        continue;
      }
      if (key === "invoiceNumber" || key === "lastInvoiceNumber") {
        output[key] = nested == null ? nested : SANITIZED_INVOICE;
        continue;
      }
      if (key === "rawOcrText") {
        output[key] = minimizeRawOcrText(typeof nested === "string" ? nested : null);
        continue;
      }
      if (key === "duplicateMatchIdentity" && typeof nested === "string") {
        output[key] = sanitizeFreeText(nested);
        continue;
      }
      output[key] = sanitizeUnknown(nested);
    }
    return output;
  }
  return value;
}

export function sanitizeJsonValue<T>(value: T): T {
  return sanitizeUnknown(value) as T;
}
