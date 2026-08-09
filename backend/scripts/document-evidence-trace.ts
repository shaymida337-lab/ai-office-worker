/**
 * document-evidence-trace — נתיב ראיות מלא למסמך אחד, קריאה בלבד.
 *
 * הרצה (Render Shell, או מקומית מול פרודקשן):
 *   ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/document-evidence-trace.ts --search "פז"
 *   ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/document-evidence-trace.ts --review <reviewId>
 *
 * מדפיס לכל שלב: טבלה, מפתח ראשי, שמות שדות וערכים בפועל — כולל rawAnalysis,
 * parsedFieldsJson (sir/gates/reviewSupplier/arc), חישוב חי של supplier context
 * ו-readiness, רשומת SupplierPayment, יומני audit, ומטריצת נראות לכל מסך.
 * אין שום כתיבה ל-DB.
 */
import { prisma } from "../src/lib/prisma.js";
import {
  resolveReviewSupplierContext,
  resolveSupplierNameForApproval,
} from "../src/services/reviewSupplierResolution.js";
import { evaluateReviewApprovalReadiness } from "../src/services/financialDocuments.js";
import { resolveDocumentReviewDisplayAmount } from "../src/services/amount/financeDisplayAmount.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
if (!isLocal && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("🛑 DATABASE_URL אינו localhost. להרצה מול פרודקשן (קריאה בלבד) הוסף ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}
if (!isLocal) {
  console.log("⚠️  READ-ONLY MODE מול DB מרוחק — הסקריפט מבצע קריאות בלבד.\n");
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const SEARCH = argValue("--search");
const REVIEW_ID = argValue("--review");

function h(title: string) {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

function j(value: unknown, maxLen = 8000): string {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return text.length > maxLen ? `${text.slice(0, maxLen)}\n... [נחתך, אורך מלא ${text.length}]` : text;
}

async function main() {
  // ---- בחירת המסמך ----
  let review = null;
  if (REVIEW_ID) {
    review = await prisma.financialDocumentReview.findUnique({ where: { id: REVIEW_ID } });
  } else if (SEARCH) {
    const matches = await prisma.financialDocumentReview.findMany({
      where: {
        OR: [
          { supplierName: { contains: SEARCH } },
          { subject: { contains: SEARCH } },
          { fileName: { contains: SEARCH } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    console.log(`נמצאו ${matches.length} התאמות ל-"${SEARCH}" (החדשות ביותר):`);
    for (const m of matches) {
      console.log(
        `  ${m.id} | ${m.createdAt.toISOString()} | source=${m.source} | supplierName="${m.supplierName}" | status=${m.reviewStatus} | amount=${m.totalAmount}`
      );
    }
    review = matches[0] ?? null;
    if (matches.length > 1) console.log(`\n(נבחרה הראשונה; להרצה על אחרת: --review <id>)`);
  } else {
    console.error('שימוש: --search "פז" או --review <id>');
    process.exit(1);
  }
  if (!review) {
    console.error("לא נמצאה רשומת FinancialDocumentReview מתאימה.");
    process.exit(1);
  }

  // ---- שלבים 1-2: OCR + חילוץ Claude (מה שנשמר בקליטה) ----
  h("שלבים 1-2 | קלט הקליטה: OCR + חילוץ Claude");
  console.log(`טבלה: FinancialDocumentReview | PK: id=${review.id}`);
  console.log(`שדה rawAnalysis (החילוץ הגולמי כפי שנשמר, כולל analysis של Claude ו-OCR אם קיים):`);
  console.log(j(review.rawAnalysis, 12000));

  if (review.gmailMessageId) {
    const scanItem = await prisma.gmailScanItem.findFirst({
      where: { organizationId: review.organizationId, gmailMessageId: review.gmailMessageId },
    });
    if (scanItem) {
      console.log(`\nטבלה: GmailScanItem | PK: id=${scanItem.id}`);
      console.log(
        j({
          supplierName: scanItem.supplierName,
          reviewStatus: scanItem.reviewStatus,
          confidenceScore: scanItem.confidenceScore,
          decisionReason: scanItem.decisionReason,
          sender: scanItem.sender,
          senderEmail: (scanItem as Record<string, unknown>).senderEmail ?? null,
          subject: scanItem.subject,
          attachmentFilename: (scanItem as Record<string, unknown>).attachmentFilename ?? null,
        })
      );
    } else {
      console.log("\n(אין רשומת GmailScanItem מקושרת)");
    }
  } else {
    console.log(`\n(מקור: ${review.source} — אין שלב GmailScanItem; ב-whatsapp/camera החילוץ נשמר רק ב-rawAnalysis למעלה)`);
  }

  // ---- שלב 3: נרמול ספק ----
  h("שלב 3 | נרמול/רזולוציית ספק — מה שנשמר ומה שמחושב היום");
  const parsed = (review.parsedFieldsJson ?? {}) as Record<string, unknown>;
  console.log(`parsedFieldsJson.sir (הרזולוציה שנשמרה בקליטה):`);
  console.log(j(parsed.sir ?? null));
  console.log(`\nparsedFieldsJson.reviewSupplier (אישור/עריכת משתמש, אם היו):`);
  console.log(j(parsed.reviewSupplier ?? null));
  console.log(`\nparsedFieldsJson.gates (פסקי הדין שנשמרו):`);
  console.log(j(parsed.gates ?? null));
  console.log(`\nparsedFieldsJson.arc (רזולוציית סכום):`);
  console.log(j(parsed.arc ?? null));

  const supplierContext = resolveReviewSupplierContext({
    supplierName: review.supplierName,
    sender: review.sender,
    supplierTaxId: review.supplierTaxId,
    parsedFieldsJson: review.parsedFieldsJson,
    rawAnalysis: review.rawAnalysis,
  });
  console.log(`\nresolveReviewSupplierContext (חישוב חי, reviewSupplierResolution.ts):`);
  console.log(j(supplierContext));

  console.log(`\nresolveSupplierNameForApproval (מה האישור היה משתמש בו — חישוב חי):`);
  try {
    const approvalName = resolveSupplierNameForApproval({
      supplierName: review.supplierName,
      sender: review.sender,
      supplierTaxId: review.supplierTaxId,
      parsedFieldsJson: review.parsedFieldsJson,
      rawAnalysis: review.rawAnalysis,
    });
    console.log(`  ✔ מחזיר: "${approvalName}"`);
    if (approvalName !== review.supplierName) {
      console.log(`  ⚠️ שונה מהעמודה supplierName="${review.supplierName}" — שם האישור ≠ שם הגולמי`);
    }
    if (supplierContext.displaySupplierName && approvalName !== supplierContext.displaySupplierName) {
      console.log(`  ⚠️ שונה מהתצוגה supplierDisplayName="${supplierContext.displaySupplierName}"`);
    }
  } catch (err) {
    console.log(`  ✘ זורק: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  (כלומר אישור בלי supplierName בגוף הבקשה היה נכשל 422 בדיוק עם ההודעה הזו)`);
  }

  // ---- שלב 4: רשומת ה-review המלאה ----
  h("שלב 4 | FinancialDocumentReview — הרשומה המלאה");
  const { parsedFieldsJson: _p, rawAnalysis: _r, ...scalarFields } = review as Record<string, unknown>;
  console.log(`טבלה: FinancialDocumentReview | PK: id=${review.id}`);
  console.log(j(scalarFields));

  // ---- שלב 5: תשובת ה-API כפי שה-frontend מקבל ----
  h("שלב 5 | תשובת GET /api/document-reviews לפריט הזה (שחזור מדויק של ה-route)");
  const display = resolveDocumentReviewDisplayAmount({
    totalAmount: review.totalAmount,
    amountBeforeVat: review.amountBeforeVat,
    vatAmount: review.vatAmount,
    parsedFieldsJson: review.parsedFieldsJson,
    currency: review.currency,
  });
  let readiness: Record<string, unknown>;
  if (review.reviewStatus !== "needs_review") {
    readiness = { canApprove: false, blockReason: null, recommendedAction: "approve", supplierNeedsConfirmation: false, note: "לא needs_review — אין חישוב" };
  } else {
    readiness = (await evaluateReviewApprovalReadiness(review)) as unknown as Record<string, unknown>;
  }
  const apiItem = {
    id: review.id,
    supplierName: review.supplierName,
    supplierDisplayName: supplierContext.displaySupplierName,
    rawSupplierName: supplierContext.rawSupplierName,
    confirmedSupplierName: supplierContext.confirmedSupplierName,
    supplierConfidence: supplierContext.supplierConfidence,
    supplierNeedsConfirmation: supplierContext.supplierNeedsConfirmation || readiness.supplierNeedsConfirmation === true,
    supplierUncertain: supplierContext.supplierUncertain,
    totalAmount: review.totalAmount,
    displayAmount: display.amount,
    amountLabel: display.amountLabel,
    amountResolved: display.resolved,
    documentType: review.documentType,
    reviewStatus: review.reviewStatus,
    uncertaintyReason: review.uncertaintyReason,
    confidenceScore: review.confidenceScore,
    driveFileUrl: review.driveFileUrl ? `${review.driveFileUrl.slice(0, 60)}...` : null,
    fileName: review.fileName,
    documentDate: review.documentDate,
    invoiceNumber: review.invoiceNumber,
    canApprove: readiness.canApprove,
    blockReason: readiness.blockReason,
    recommendedAction: readiness.recommendedAction,
  };
  console.log(j(apiItem));

  // ---- שלב 6: מה ה-UI יגזור ----
  h("שלב 6 | גזירת מצב הכרטיס (presentation.ts, מחושב מהשדות למעלה)");
  const serverContract = typeof apiItem.canApprove === "boolean";
  const uiState = !serverContract
    ? "fallback מקומי (אין חוזה מהשרת)"
    : apiItem.recommendedAction === "approve" && apiItem.canApprove && !apiItem.supplierNeedsConfirmation
      ? 'מוכן לאישור → "אשר והעבר לחשבוניות"'
      : apiItem.recommendedAction === "edit_supplier" || (apiItem.recommendedAction === "approve" && apiItem.supplierNeedsConfirmation)
        ? 'ספק לא בטוח → "ערוך ספק"'
        : apiItem.recommendedAction === "reject"
          ? 'לא רלוונטי לאישור'
          : 'דורש השלמה → "השלם פרטים"';
  console.log(`חוזה שרת קיים: ${serverContract} | מצב כרטיס: ${uiState}`);
  console.log(`blockReason שיוצג (אחרי מיפוי לעברית בצד לקוח): ${apiItem.blockReason ?? "(אין)"}`);

  // ---- שלבים 7-8: מה קרה באישור (audit) ----
  h("שלבים 7-8 | היסטוריית אישור בפועל — platformAuditLog");
  const audits = await prisma.platformAuditLog.findMany({
    where: { organizationId: review.organizationId, entityId: review.id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (!audits.length) {
    console.log("(אין רשומות audit לרשומה הזו — האישור מעולם לא הצליח, או שנוסה לפני שה-audit נוסף)");
  }
  for (const audit of audits) {
    console.log(`\n[${audit.createdAt.toISOString()}] action=${audit.action} actor=${(audit as Record<string, unknown>).actorType ?? "?"}`);
    console.log(`  before: ${j((audit as Record<string, unknown>).beforeState, 1500)}`);
    console.log(`  after:  ${j((audit as Record<string, unknown>).afterState, 1500)}`);
    console.log(`  reason: ${(audit as Record<string, unknown>).reason ?? "-"} | metadata: ${j((audit as Record<string, unknown>).metadata, 500)}`);
  }

  // ---- שלב 9: SupplierPayment ----
  h("שלב 9 | SupplierPayment — קיים או לא, ולמה");
  const payment = review.supplierPaymentId
    ? await prisma.supplierPayment.findUnique({ where: { id: review.supplierPaymentId } })
    : review.documentFingerprint
      ? await prisma.supplierPayment.findFirst({
          where: { organizationId: review.organizationId, documentFingerprint: review.documentFingerprint },
        })
      : null;
  if (!payment) {
    console.log(`אין SupplierPayment. supplierPaymentId=${review.supplierPaymentId ?? "null"} | fingerprint=${review.documentFingerprint ?? "null"}`);
    console.log(`הסבר: תשלום נוצר רק באישור מוצלח או ב-auto-accept; reviewStatus כרגע=${review.reviewStatus}, readiness.blockReason=${readiness.blockReason ?? "null"}`);
  } else {
    console.log(`טבלה: SupplierPayment | PK: id=${payment.id}`);
    console.log(
      j({
        supplier: payment.supplier,
        supplierName: payment.supplierName,
        amount: payment.amount,
        totalAmount: payment.totalAmount,
        approvalStatus: payment.approvalStatus,
        paid: payment.paid,
        documentTypeDetailed: payment.documentTypeDetailed,
        normalizedDocumentDate: payment.normalizedDocumentDate,
        documentFingerprint: payment.documentFingerprint,
        source: payment.source,
        sourcesJson: payment.sourcesJson,
        createdAt: payment.createdAt,
        lastSeenAt: (payment as Record<string, unknown>).lastSeenAt ?? null,
      })
    );
  }

  // ---- שלב 10: מטריצת נראות ----
  h("שלב 10 | איפה הרשומה מופיעה עכשיו — לפי ה-WHERE האמיתי של כל מסך");
  const rows: string[] = [];
  rows.push(
    `document-reviews תור ממתינים (reviewStatus='needs_review'): ${review.reviewStatus === "needs_review" ? "✔ מופיעה" : "✘ לא (status=" + review.reviewStatus + ")"}`
  );
  rows.push(
    `document-reviews לשונית הושלמו (reviewStatus='approved'): ${review.reviewStatus === "approved" ? "✔ מופיעה (שים לב: בתצוגת ברירת המחדל מוצגות רק של היום)" : "✘ לא"}`
  );
  if (payment) {
    rows.push(`payments תור ראשי (approvalStatus='approved' AND frontend מסנן !paid): ${payment.approvalStatus === "approved" && !payment.paid ? "✔ מופיעה" : `✘ לא (paid=${payment.paid})`}`);
    rows.push(`payments ארכיון חודשי (לפי normalizedDocumentDate=${payment.normalizedDocumentDate?.toISOString?.() ?? payment.normalizedDocumentDate}): ${payment.approvalStatus === "approved" ? "✔ מופיעה" : "✘"}`);
  } else {
    rows.push("payments: ✘ אין רשומת תשלום");
  }
  rows.push(
    `invoices (מיזוג reviews עם reviewStatus לפי לשונית): needs_review⇒לשונית ממתינים, approved/auto_saved⇒לשונית מאושרים. status הנוכחי=${review.reviewStatus}`
  );
  console.log(rows.join("\n"));

  console.log("\n--- סוף נתיב הראיות ---");
}

main()
  .catch((err) => {
    console.error("שגיאה:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
