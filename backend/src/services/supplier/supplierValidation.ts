import { isLikelyJunkSupplierName } from "../supplierNameValidation.js";
import type { SupplierCandidate, SupplierCandidateKind } from "./supplierTypes.js";

const UNKNOWN_PLACEHOLDER = /^(unknown|unknown supplier|לא\s*ידוע|לא\s*מזוהה|לא\s*זוהה|n\/a|none|null|undefined|current|name|address|details|document|documents|number|supplier|vendor|issuer)$/i;

const PHONE_PATTERN = /^(?:\+?\d[\d\s().-]{6,}\d|\d{9,12})$/;
const PHONE_LABEL_PATTERN = /^(?:phone|tel|mobile|נייד|טלפון)\b/i;

const ADDRESS_PATTERN =
  /(?:רח(?:וב)?\.?|שדר(?:ות)?\.?|street|st\.|avenue|ave\.|boulevard|blvd\.|road|rd\.)/i;
const ADDRESS_POSTAL_PATTERN = /\b\d{5,7}\b.*[\p{L}]/u;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const DOMAIN_PATTERN = /^[\w.-]+\.[a-z]{2,}$/i;
const OCR_AI_OUTPUT_PATTERN = /\b(?:ocr\s*\/\s*ai|ocr|ai)\s+output\b/i;

const WEAK_ONLY_KINDS = new Set<SupplierCandidateKind>(["email_domain", "sender_display"]);

/**
 * טוקנים גנריים של תיבות שולח ("Info", "Team", "צוות", "מערכת") שלעולם אינם
 * שם ספק בפני עצמם. התאמה מדויקת בלבד על הטוקן המנורמל — שם עסק שמכיל את
 * המילה כחלק משם ארוך יותר ("שירות מוניציפלי בע"מ") אינו נחסם.
 */
export const GENERIC_SENDER_TOKENS = new Set(
  [
    "info",
    "team",
    "admin",
    "office",
    "mail",
    "mailer",
    "notification",
    "notifications",
    "alert",
    "alerts",
    "update",
    "updates",
    "newsletter",
    "service",
    "services",
    "system",
    "do not reply",
    "donotreply",
    "no reply",
    "noreply",
    "צוות",
    "מערכת",
    "עדכונים",
    "התראות",
    "שירות לקוחות",
    "אין להשיב",
  ].map((token) => token.toLowerCase())
);

export function normalizeSupplierDisplayName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b(?:ltd|limited|inc|llc|corp|corporation|company|co)\b\.?/gi, " ")
    .replace(/\b(?:invoice|invoices|receipt|receipts|billing|payments?|accounts?|support|noreply|no.?reply)\b/gi, " ")
    .replace(/\b(?:בע"מ|בע״מ|בעמ|חברה|חשבוניות|חשבונית|קבלה|תשלומים|גבייה)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeEmailAddress(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

export function looksLikeDomain(value: string) {
  const cleaned = value.trim();
  return DOMAIN_PATTERN.test(cleaned) && !cleaned.includes("@");
}

export function looksLikePhoneNumber(value: string) {
  const cleaned = value.trim();
  if (PHONE_LABEL_PATTERN.test(cleaned)) return true;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  return PHONE_PATTERN.test(cleaned) || /^[\d\s().+-]+$/.test(cleaned);
}

export function looksLikeAddress(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return false;
  if (ADDRESS_PATTERN.test(cleaned)) return true;
  if (ADDRESS_POSTAL_PATTERN.test(cleaned) && /\d/.test(cleaned)) return true;
  if (/(?:תל\s*אביב|ירושלים|חיפה|רמת\s*גן|tel\s*aviv|jerusalem)/iu.test(cleaned) && /\d/.test(cleaned)) {
    return true;
  }
  return false;
}

export function isUnknownPlaceholder(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return true;
  if (cleaned === "." || cleaned === ".name" || cleaned.startsWith(".")) return true;
  return UNKNOWN_PLACEHOLDER.test(cleaned);
}

export function isTaxIdLikeSupplierName(value: string, vatNumber?: string | null) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const digits = trimmed.replace(/\D/g, "");
  const normalizedTaxId = (vatNumber ?? "").replace(/\D/g, "");
  if (normalizedTaxId && digits === normalizedTaxId) return true;
  if (/^\d+$/.test(trimmed)) return true;
  const withoutTaxLabels = trimmed
    .replace(/(?:ח\.?פ\.?|חברה\s*מספר|עוסק\s*מורשה|מספר\s*עוסק|תיק\s*עוסק|company\s*(?:id|number)|tax\s*id|vat\s*(?:id|number))/gi, "")
    .trim();
  return digits.length >= 7 && digits.length <= 10 && /^[\d\s.-]+$/.test(withoutTaxLabels);
}

export function isWeakEvidenceKind(kind: SupplierCandidateKind) {
  return WEAK_ONLY_KINDS.has(kind);
}

export function isStrongEvidenceKind(kind: SupplierCandidateKind) {
  return !isWeakEvidenceKind(kind) && kind !== "phone" && kind !== "address" && kind !== "unknown";
}

export function rejectSupplierCandidateReason(
  candidate: SupplierCandidate,
  ownerEmails: Set<string> = new Set()
): string | null {
  const name = candidate.name.trim();
  if (!name) return "empty_name";

  if (candidate.kind === "phone" || looksLikePhoneNumber(name)) return "phone_not_supplier";
  if (candidate.kind === "address" || looksLikeAddress(name)) return "address_not_supplier";
  if (isUnknownPlaceholder(name)) return "unknown_placeholder";
  if (isLikelyJunkSupplierName(name)) return "junk_supplier_name";
  if (OCR_AI_OUTPUT_PATTERN.test(name)) return "ocr_ai_output_not_supplier";
  if (looksLikeEmailAddress(name)) return "email_not_supplier";
  if (candidate.kind !== "email_domain" && looksLikeDomain(name)) return "domain_not_supplier";
  if (isTaxIdLikeSupplierName(name, candidate.vatNumber)) return "tax_id_as_name";

  const normalizedToken = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (GENERIC_SENDER_TOKENS.has(normalizedToken)) return "generic_sender_token";
  if ([...ownerEmails].some((email) => name.toLowerCase().includes(email.toLowerCase()))) return "owner_email_match";
  if (name.length < 2 || name.length > 60) return "invalid_length";
  if (/[\r\n]/.test(name)) return "multiline_name";
  if (!/[\p{L}]/u.test(name) && candidate.kind !== "vat_registry") return "no_letters";

  return null;
}

export function isValidSupplierCandidate(
  candidate: SupplierCandidate,
  ownerEmails: Set<string> = new Set()
) {
  return rejectSupplierCandidateReason(candidate, ownerEmails) === null;
}

export function isValidSupplierNameShared(value?: string | null): boolean {
  const supplier = value?.trim() ?? "";
  if (!supplier) return false;
  if (isLikelyJunkSupplierName(supplier)) return false;
  if (isUnknownPlaceholder(supplier)) return false;
  if (looksLikeEmailAddress(supplier)) return false;
  if (looksLikeDomain(supplier)) return false;
  return supplier.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
}

export function isUsableSupplierNameShared(value: string, ownerEmails: Set<string> = new Set()): boolean {
  const cleaned = value.trim();
  if (!isValidSupplierNameShared(cleaned)) return false;
  if (isLikelyJunkSupplierName(cleaned)) return false;
  if (cleaned.length < 2 || cleaned.length > 60) return false;
  if (/[\r\n]/.test(value)) return false;
  if ([...ownerEmails].some((email) => cleaned.toLowerCase().includes(email.toLowerCase()))) return false;
  if (/^(invoice|receipt|payment|support|noreply|no reply|billing|accounts?|gmail|googlemail|outlook|hotmail|yahoo)$/i.test(cleaned)) {
    return false;
  }
  if (cleaned.includes("/")) return false;
  if (OCR_AI_OUTPUT_PATTERN.test(cleaned)) return false;
  const normalizedToken = cleaned.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (GENERIC_SENDER_TOKENS.has(normalizedToken)) return false;
  if (/\boutput\b/i.test(normalizedToken)) return false;
  if (looksLikePhoneNumber(cleaned)) return false;
  if (looksLikeAddress(cleaned)) return false;
  if (isTaxIdLikeSupplierName(cleaned)) return false;
  return /[\p{L}]/u.test(cleaned);
}
