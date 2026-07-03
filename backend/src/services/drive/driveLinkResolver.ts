/**
 * מקור אמת אחד לקריאת קישור Drive מרשומה (שלב 5).
 *
 * חמישה מודלים שומרים קישור Drive בחמש סכימות שמות שונות:
 *   EmailAttachment.driveLink | GmailScanItem.driveFileLink |
 *   FinancialDocumentReview.driveFileUrl | SupplierPayment.driveFileUrl/documentLink/invoiceLink |
 *   Invoice.driveUrl/driveFileUrl
 * במקום מיגרציית DB — שכבת קריאה אחידה: כל מי שצריך "את הקישור" קורא לפונקציה
 * הזו במקום לנחש שדות. סדר העדיפויות: השדה הקנוני החדש ביותר קודם.
 */

export type DriveLinkCarrier = {
  driveFileUrl?: string | null;
  driveUrl?: string | null;
  driveFileLink?: string | null;
  driveLink?: string | null;
  invoiceLink?: string | null;
  documentLink?: string | null;
};

const LINK_FIELD_PRECEDENCE = [
  "driveFileUrl",
  "driveUrl",
  "driveFileLink",
  "driveLink",
  "invoiceLink",
  "documentLink",
] as const;

export function resolveDriveLink(record: DriveLinkCarrier | null | undefined): string | null {
  if (!record) return null;
  for (const field of LINK_FIELD_PRECEDENCE) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** קישור מקומי (uploads/) אינו קישור Drive — רלוונטי למסלול המצלמה לפני ההעלאה. */
export function isLocalUploadLink(link: string | null | undefined): boolean {
  return typeof link === "string" && link.trim().startsWith("/uploads/");
}

/** האם לרשומה יש קישור Drive אמיתי (לא קובץ מקומי שממתין להעלאה). */
export function hasDriveLink(record: DriveLinkCarrier | null | undefined): boolean {
  const link = resolveDriveLink(record);
  return link !== null && !isLocalUploadLink(link);
}
