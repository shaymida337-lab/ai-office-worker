/**
 * Persist-first למסלול ההעלאה הישירה (/camera).
 *
 * הבעיה שזה פותר: עד עכשיו ה-preview היה stateless לחלוטין — הקובץ חי רק
 * בזיכרון הדפדפן עד שהמשתמש השלים "אשר ושמור", וכשל חילוץ (ספק/סכום חסרים,
 * OCR שנכשל) חסם את השמירה. התוצאה בפרודקשן: העלאות שנעלמו בלי שום רשומה.
 *
 * העיקרון: רשומת draft נוצרת ב-DB *לפני* ה-OCR. החילוץ רק מעדכן את אותה
 * רשומה; כשל חילוץ משאיר אותה ב"השלמת חשבוניות" עם סיבה ברורה. מסמך שנבחר
 * לעולם לא נעלם.
 *
 * מניעת כפילות: טביעת האצבע היא הטיר הקנוני של קובץ (sha256) — אותה טביעה
 * בדיוק ש-recordManualEntryFinancialDocument מחשב בשלב האישור, ולכן האישור
 * המלא עושה upsert על אותה רשומה ולא יוצר שנייה. העלאה חוזרת של אותו קובץ
 * פוגעת גם היא באותה רשומה.
 */

import { createHash } from "crypto";
import { prisma } from "../../lib/prisma.js";
import { computeCanonicalFingerprint } from "../dedup/sharedMatcher.js";
import { saveLocalIngestedDocument } from "../documents/documentReviewPreview.js";
import { roundMoneyOrNull } from "../amount/parseAmountHelpers.js";

export type CameraExtractionPreview = {
  supplier: string | null;
  amount: number | null;
  date: string | null;
  invoiceNumber: string | null;
  currency: string;
  documentType?: string | null;
};

export type CameraIngestionInput = {
  organizationId: string;
  filename: string;
  mimeType: string;
  fileBase64: string;
};

export type CameraIngestionResult = {
  reviewId: string;
  fileSha256: string;
  documentLink: string | null;
  preview: CameraExtractionPreview | null;
  extractionError: string | null;
  uncertaintyReason: string;
};

export type CameraIngestionDeps = {
  prismaClient?: Pick<typeof prisma, "financialDocumentReview">;
  analyzeFile?: (input: { fileBase64: string; mimeType: string; filename?: string }) => Promise<CameraExtractionPreview>;
  saveLocalFile?: (input: { channel: "camera"; filename: string; buffer: Buffer }) => Promise<string>;
};

export function cameraDraftFingerprints(organizationId: string, fileSha256: string) {
  // אותו חישוב קנוני כמו recordFinancialDocumentDecision: עם fileSha256 הטיר
  // הוא "file" ואינו תלוי בספק/סכום/תאריך — ולכן יציב בין draft לאישור.
  const canonical = computeCanonicalFingerprint({
    organizationId,
    supplierName: null,
    supplierTaxId: null,
    invoiceNumber: null,
    totalAmount: null,
    documentDate: null,
    documentType: "tax_invoice",
    fileSha256,
  });
  const documentFingerprint =
    canonical.fingerprint ??
    createHash("sha256").update(`camera-file|${organizationId}|${fileSha256}`).digest("hex").slice(0, 48);
  const sourceFingerprint = createHash("sha256")
    .update(`camera-src|${organizationId}|${fileSha256}`)
    .digest("hex")
    .slice(0, 48);
  return { documentFingerprint, sourceFingerprint };
}

function draftUncertaintyReason(preview: CameraExtractionPreview | null, extractionError: string | null): string {
  if (extractionError) {
    return `סריקת המסמך נכשלה — השלם את הפרטים ידנית (${extractionError.slice(0, 120)})`;
  }
  if (!preview) return "בעיבוד — סריקת המסמך החלה";
  const missing: string[] = [];
  if (!preview.supplier?.trim()) missing.push("ספק");
  if (preview.amount == null) missing.push("סכום");
  if (missing.length > 0) return `לא זוהה ${missing.join(" ו")} — השלם ידנית`;
  return "ממתין לאישורך במסך השלמת חשבוניות";
}

function parsePreviewDate(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * שלב 1 של /camera: שמירת הקובץ + יצירת רשומת draft לפני OCR, ואז חילוץ
 * שמעדכן את אותה רשומה. לעולם לא זורק בגלל כשל חילוץ — רק בגלל קלט לא תקין.
 */
export async function ingestCameraDocument(
  input: CameraIngestionInput,
  deps: CameraIngestionDeps = {}
): Promise<CameraIngestionResult> {
  const db = deps.prismaClient ?? prisma;
  const buffer = Buffer.from(input.fileBase64, "base64");
  const fileSha256 = createHash("sha256").update(buffer).digest("hex");
  const { documentFingerprint, sourceFingerprint } = cameraDraftFingerprints(input.organizationId, fileSha256);

  // שמירת קובץ מקומית — כשל דיסק לא מפיל את יצירת ה-draft
  let documentLink: string | null = null;
  try {
    const saveLocal = deps.saveLocalFile ?? saveLocalIngestedDocument;
    documentLink = await saveLocal({ channel: "camera", filename: input.filename, buffer });
  } catch {
    documentLink = null;
  }

  // persist-first: הרשומה קיימת לפני שה-OCR התחיל
  const draft = await db.financialDocumentReview.upsert({
    where: {
      organizationId_documentFingerprint: {
        organizationId: input.organizationId,
        documentFingerprint,
      },
    },
    create: {
      organizationId: input.organizationId,
      source: "camera",
      subject: `העלאה ישירה — ${input.filename}`,
      fileName: input.filename,
      fileSize: buffer.length,
      sourceFingerprint,
      documentFingerprint,
      documentType: "tax_invoice",
      reviewStatus: "needs_review",
      uncertaintyReason: "בעיבוד — סריקת המסמך החלה",
      confidenceScore: 0,
      driveFileUrl: documentLink,
      parsedFieldsJson: { camera: { mimeType: input.mimeType, fileSha256, processingStatus: "processing" } },
    },
    update: {
      fileName: input.filename,
      ...(documentLink ? { driveFileUrl: documentLink } : {}),
    },
  });

  // חילוץ — כשל לעולם לא מוחק את ה-draft, רק מתועד עליו
  let preview: CameraExtractionPreview | null = null;
  let extractionError: string | null = null;
  try {
    const analyze =
      deps.analyzeFile ??
      ((await import("../claude.js")).analyzeInvoiceFile as NonNullable<CameraIngestionDeps["analyzeFile"]>);
    preview = await analyze({ fileBase64: input.fileBase64, mimeType: input.mimeType, filename: input.filename });
  } catch (err) {
    extractionError = err instanceof Error ? err.message : String(err);
  }

  const uncertaintyReason = draftUncertaintyReason(preview, extractionError);
  await db.financialDocumentReview
    .update({
      where: { id: draft.id },
      data: {
        ...(preview?.supplier?.trim() ? { supplierName: preview.supplier.trim() } : {}),
        ...(preview && preview.amount != null ? { totalAmount: roundMoneyOrNull(preview.amount) } : {}),
        ...(preview?.invoiceNumber ? { invoiceNumber: preview.invoiceNumber } : {}),
        ...(preview?.currency ? { currency: preview.currency } : {}),
        ...(parsePreviewDate(preview?.date) ? { documentDate: parsePreviewDate(preview?.date)! } : {}),
        uncertaintyReason,
        parsedFieldsJson: {
          camera: {
            mimeType: input.mimeType,
            fileSha256,
            processingStatus: extractionError ? "extraction_failed" : "extracted",
            ...(extractionError ? { extractionError: extractionError.slice(0, 300) } : {}),
          },
        },
      },
    })
    .catch(() => {
      // עדכון שנכשל לא מאבד את המסמך — ה-draft כבר קיים
    });

  return {
    reviewId: draft.id,
    fileSha256,
    documentLink,
    preview,
    extractionError,
    uncertaintyReason,
  };
}
