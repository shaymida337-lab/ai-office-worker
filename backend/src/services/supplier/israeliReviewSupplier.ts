import {
  buildGlobalSupplierDnaSeed,
  lookupSupplierByAlias,
  lookupSupplierByVat,
  resolveCanonicalDisplayName,
} from "./supplierRegistry.js";
import { normalizeSupplierName } from "../dedup/sharedMatcher.js";

/** שמות שגויים נפוצים מ-OCR שמתקנים לספק ישראלי מוכר (ללא שינוי צינור הסריקה). */
const KNOWN_OCR_MISREADS: Record<string, string> = {
  פרייזון: "פז",
  פריזון: "פז",
  "paz yellow": "פז",
  "yellow paz": "פז",
  paz: "פז",
  yellow: "פז",
  "פז ילו": "פז",
  "פז-ילו": "פז",
  פזילו: "פז",
  "israel electric": "חברת החשמל",
  "israel electric corporation": "חברת החשמל",
  iec: "חברת החשמל",
  "חברת החשמל לישראל": "חברת החשמל",
};

const FUEL_CONTEXT =
  /חשבונית|חשבון|קבלה|תשלום|חיוב|דלק|תחנה|תדלוק|fuel|gas|station|invoice|receipt|payment|yellow/u;
const PAZ_PATTERN = /(?:^|\s)פז(?:\s|$)|(?:^|\s)paz(?:\s|$)|yellow/u;
/** דורש הקשר חשבון חשמל — בניגוד ל-PAZ, מונע false positive על אזכור שולי ב-OCR. */
const IEC_CONTEXT =
  /חשבון\s*חשמל|חשבונית\s*חשמל|צריכת\s*חשמל|מונה\s*חשמל|קילו?וואט|\bkwh\b|חיוב\s*חשמל|תעריף\s*חשמל|electric(?:ity)?\s+bill|utility\s+bill|israel\s+electric/u;
const IEC_STRONG_NAME_PATTERN =
  /חברת\s+החשמל\s+לישראל|חברתהחשמללישראל|israel\s+electric(?:\s+corporation)?/u;
const IEC_NAME_PATTERN = /חברת\s+החשמל|חברתהחשמל/u;
const IEC_STANDALONE_PATTERN = /(?:^|\s)iec(?:\s|$)/u;

export function normalizeIsraeliReviewSupplierAlias(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;

  const misreadKey = trimmed.toLowerCase();
  if (KNOWN_OCR_MISREADS[trimmed]) return KNOWN_OCR_MISREADS[trimmed];
  if (KNOWN_OCR_MISREADS[misreadKey]) return KNOWN_OCR_MISREADS[misreadKey];

  const registry = buildGlobalSupplierDnaSeed();
  const byAlias = lookupSupplierByAlias(registry, trimmed);
  if (byAlias) return resolveCanonicalDisplayName(byAlias, trimmed);

  return trimmed;
}

export function matchIsraeliSupplierFromOcrText(text: string): string | null {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ");
  const compact = normalized.replace(/\s+/g, "");

  if (PAZ_PATTERN.test(normalized) || PAZ_PATTERN.test(compact)) {
    if (FUEL_CONTEXT.test(normalized) || FUEL_CONTEXT.test(compact) || /yellow/u.test(normalized)) {
      return "פז";
    }
  }
  const hasIecContext = IEC_CONTEXT.test(normalized) || IEC_CONTEXT.test(compact);
  if (IEC_STRONG_NAME_PATTERN.test(normalized) || IEC_STRONG_NAME_PATTERN.test(compact)) {
    return "חברת החשמל";
  }
  if (
    hasIecContext &&
    (IEC_NAME_PATTERN.test(normalized) ||
      IEC_NAME_PATTERN.test(compact) ||
      IEC_STANDALONE_PATTERN.test(normalized) ||
      IEC_STANDALONE_PATTERN.test(compact))
  ) {
    return "חברת החשמל";
  }
  return null;
}

/** Same strip as reviewSupplierResolution — registry keys like known:סופרפארם are not display names. */
const INTERNAL_SUPPLIER_KEY_REGEX = /^(?:known|canonical):\s*/i;

function stripInternalSupplierKey(name: string): string {
  let cleaned = name.trim();
  while (INTERNAL_SUPPLIER_KEY_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(INTERNAL_SUPPLIER_KEY_REGEX, "").trim();
  }
  return cleaned;
}

export function suppliersEquivalentForReview(a: string, b: string): boolean {
  const left = normalizeSupplierName(normalizeIsraeliReviewSupplierAlias(stripInternalSupplierKey(a)));
  const right = normalizeSupplierName(normalizeIsraeliReviewSupplierAlias(stripInternalSupplierKey(b)));
  return Boolean(left && right && left === right);
}
