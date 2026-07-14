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
import { isWithinBusinessDateWindow } from "../dates/businessDate.js";

export type CameraDateGate =
  | { action: "proceed" }
  | { action: "confirm_required"; warning: string };

/**
 * שער תאריך רך: תאריך מחוץ ל-±2 שנים כבר לא מחזיר 400 שמעלים את המסמך —
 * הוא דורש אישור מפורש מהמשתמש (dateConfirmed) או תיקון, ועד אז המסמך
 * נשאר שמור ב-needs_review עם אזהרה ברורה.
 */
export function resolveCameraDateGate(input: {
  invoiceDate: Date;
  dueDate?: Date | null;
  dateConfirmed?: boolean;
  nowMs?: number;
}): CameraDateGate {
  const nowMs = input.nowMs ?? Date.now();
  const outOfWindow =
    !isWithinBusinessDateWindow(input.invoiceDate, nowMs) ||
    (input.dueDate ? !isWithinBusinessDateWindow(input.dueDate, nowMs) : false);
  if (!outOfWindow || input.dateConfirmed === true) return { action: "proceed" };
  return {
    action: "confirm_required",
    warning: `תאריך החשבונית (${input.invoiceDate.toISOString().slice(0, 10)}) חורג מהטווח הרגיל (עד שנתיים אחורה או קדימה) — תקן את התאריך או אשר אותו במפורש`,
  };
}

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

export type CameraConfirmInput = {
  organizationId: string;
  reviewId: string;
  supplier: string;
  amount: number;
  currency?: string | null;
  invoiceNumber?: string | null;
  documentDate?: Date | null;
  dueDate?: Date | null;
  userId?: string | null;
};

export type CameraConfirmResult =
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "approved"; reviewId: string; supplierPaymentId: string; alreadyApproved: boolean }
  | { status: "needs_review"; reviewId: string; reason: string | null };

export type CameraConfirmDeps = {
  prismaClient?: Pick<typeof prisma, "financialDocumentReview">;
  recordManualEntry?: (input: Record<string, unknown>) => Promise<{
    action: string;
    payment?: { id: string } | null;
    review?: { uncertaintyReason?: string | null } | null;
  }>;
};

/**
 * אישור מהיר של draft קיים: בלי base64, בלי OCR מחדש, בלי העלאה חוזרת.
 * ממיר את אותה רשומה לתשלום ספק מאושר דרך שרשרת האמון הקיימת (אותה טביעת
 * אצבע file-tier ⇒ אפס רשומות כפולות), ואידמפוטנטי ללחיצה כפולה.
 */
export async function confirmCameraDocument(
  input: CameraConfirmInput,
  deps: CameraConfirmDeps = {}
): Promise<CameraConfirmResult> {
  const db = (deps.prismaClient ?? prisma) as typeof prisma;
  // אימות בעלות דו-שלבי: organizationId מגיע אך ורק מה-auth context של הבקשה.
  // רשומה קיימת ששייכת לארגון אחר ⇒ forbidden (403 בלי לחשוף פרטים);
  // רשומה שאינה קיימת ⇒ not_found (404).
  // לא מסננים לפי source===camera: preview עלול לעשות upsert על אותה
  // טביעת-קובץ שכבר נקלטה מ-whatsapp/gmail (file-tier), ואז reviewId מצביע
  // על הרשומה הקיימת — סינון לפי source שובר את האישור ומפיל ל-legacy בלי
  // verifiedTenantScope (503 תחת containment) למרות שזיהוי הצליח.
  const row = await db.financialDocumentReview.findFirst({
    where: { id: input.reviewId },
  });
  if (!row) return { status: "not_found" };
  if (row.organizationId !== input.organizationId) return { status: "forbidden" };
  const draft = row;

  // הבעלות אומתה בשאילתת id+organizationId — ההקשר המוקלד הזה הוא מה שמתיר
  // לפעולה הספציפית הזו לעבור את financial-ingestion containment, בלי
  // להחליש את ה-guard לשום מסלול אחר.
  const verifiedTenantScope = {
    tenantScopeVerified: true as const,
    organizationId: input.organizationId,
    source: "camera" as const,
    reviewId: draft.id,
  };

  // לחיצה כפולה: הרשומה כבר אושרה — מחזירים את אותה תשובה בלי לעבד שוב
  if (draft.reviewStatus === "approved" && draft.supplierPaymentId) {
    return {
      status: "approved",
      reviewId: draft.id,
      supplierPaymentId: draft.supplierPaymentId,
      alreadyApproved: true,
    };
  }

  const cameraMeta =
    draft.parsedFieldsJson && typeof draft.parsedFieldsJson === "object"
      ? ((draft.parsedFieldsJson as Record<string, unknown>).camera as Record<string, unknown> | undefined)
      : undefined;

  const recordManualEntry =
    deps.recordManualEntry ??
    ((await import("../financialDocuments.js")).recordManualEntryFinancialDocument as unknown as NonNullable<
      CameraConfirmDeps["recordManualEntry"]
    >);

  const decision = await recordManualEntry({
    organizationId: input.organizationId,
    verifiedTenantScope,
    source: "camera",
    subject: draft.subject ?? (input.invoiceNumber ? `Camera invoice scan #${input.invoiceNumber}` : "Camera invoice scan"),
    fileName: draft.fileName,
    fileSize: draft.fileSize,
    // אותו fileSha256 מה-ingest ⇒ אותה טביעת אצבע קנונית ⇒ אותה רשומה
    fileSha256: (cameraMeta?.fileSha256 as string | undefined) ?? null,
    supplierName: input.supplier,
    supplierTaxId: null,
    invoiceNumber: input.invoiceNumber ?? draft.invoiceNumber,
    documentDate: input.documentDate ?? draft.documentDate ?? new Date(),
    dueDate: input.dueDate ?? null,
    totalAmount: input.amount,
    currency: input.currency ?? draft.currency ?? "ILS",
    documentType: "tax_invoice",
    // הקובץ כבר נשמר ב-preview — אין העלאה חוזרת; Drive יושלם ברקע (pending_retry)
    driveFileUrl: draft.driveFileUrl,
    driveUploadStatus: draft.driveUploadStatus ?? "pending_retry",
    userId: input.userId ?? undefined,
    sourceRoute: "POST /camera/invoices (confirm)",
  });

  const paymentId =
    (decision.action === "accepted" || decision.action === "duplicate") && decision.payment?.id
      ? decision.payment.id
      : null;

  if (paymentId) {
    await db.financialDocumentReview
      .update({
        where: { id: draft.id },
        data: {
          reviewStatus: "approved",
          supplierPaymentId: paymentId,
          supplierName: input.supplier,
          totalAmount: input.amount,
          // תאריך ומטבע חייבים להיכתב — בלעדיהם הרשומה אינה "complete"
          // ולא תופיע במסך חשבוניות (assessInvoiceCompleteness דורש אותם).
          // normalizedDocumentDate נדרש לסינון לפי חודש במסך החשבוניות.
          documentDate: input.documentDate ?? draft.documentDate ?? new Date(),
          normalizedDocumentDate: input.documentDate ?? draft.documentDate ?? new Date(),
          currency: input.currency ?? draft.currency ?? "ILS",
          ...(input.invoiceNumber ? { invoiceNumber: input.invoiceNumber } : {}),
          uncertaintyReason: null,
        },
      })
      .catch(() => {
        // האישור עצמו הצליח; כשל סימון הרשומה לא מפיל את התשובה
      });
    return { status: "approved", reviewId: draft.id, supplierPaymentId: paymentId, alreadyApproved: false };
  }

  // שערי אמון חסמו — הרשומה נשארת בהשלמת חשבוניות עם הסיבה שנכתבה עליה
  return {
    status: "needs_review",
    reviewId: draft.id,
    reason: decision.review?.uncertaintyReason ?? null,
  };
}

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
    return "לא ניתן היה לזהות את כל הפרטים — יש להשלים ידנית";
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
