import { isLikelyJunkSupplierName } from "../supplierNameValidation.js";
import { looksLikeEmailAddress } from "./supplierValidation.js";

const MEKOR_LABEL_LINE = /(?:^|[\n\r])\s*\[מקור\]\s*([^,\n\r]+)/;

const TECHNICAL_MEKOR_NAME = /\b(?:ocr\s*\/\s*ai|rawocr|json|parsed|firststring)\b/i;

function normalizeMekorSupplierName(value: string): string {
  return value
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function isAcceptableMekorSupplierName(name: string): boolean {
  const cleaned = normalizeMekorSupplierName(name);
  if (!cleaned || cleaned.length < 2) return false;
  if (isLikelyJunkSupplierName(cleaned)) return false;
  if (looksLikeEmailAddress(cleaned)) return false;
  if (cleaned.includes("@")) return false;
  if (TECHNICAL_MEKOR_NAME.test(cleaned)) return false;
  return true;
}

export function extractSupplierFromMekorLabel(documentText: string | null | undefined): string | null {
  if (!documentText?.trim()) return null;
  const match = documentText.match(MEKOR_LABEL_LINE);
  if (!match?.[1]) return null;
  const candidate = normalizeMekorSupplierName(match[1]);
  if (!isAcceptableMekorSupplierName(candidate)) return null;
  return candidate;
}

export function resolveSupplierWithMekorLabel(
  extractedSupplier: string | null | undefined,
  documentText: string | null | undefined
): string | null {
  const mekorSupplier = extractSupplierFromMekorLabel(documentText);
  if (mekorSupplier) return mekorSupplier;
  const trimmed = extractedSupplier?.trim();
  return trimmed || null;
}
