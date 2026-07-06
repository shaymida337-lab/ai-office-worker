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
const IEC_PATTERN = /חברת\s*החשמל|חברתהחשמל|israel\s+electric|(?:^|\s)iec(?:\s|$)/u;

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
  if (IEC_PATTERN.test(normalized) || IEC_PATTERN.test(compact)) {
    return "חברת החשמל";
  }
  return null;
}

export function suppliersEquivalentForReview(a: string, b: string): boolean {
  const left = normalizeSupplierName(normalizeIsraeliReviewSupplierAlias(a));
  const right = normalizeSupplierName(normalizeIsraeliReviewSupplierAlias(b));
  return Boolean(left && right && left === right);
}
