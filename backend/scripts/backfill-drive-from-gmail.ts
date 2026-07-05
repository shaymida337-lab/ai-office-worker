/**
 * backfill-drive-from-gmail.ts — השלמת קבצי Drive לרשומות RECOVERABLE_FROM_GMAIL.
 *
 * מטפל אך ורק בעוגני השחזור: רשומות EmailAttachment עם gmailAttachmentId
 * שלצרופה שלהן אין קישור Drive ויש להן רשומות תלויות (GSI/FDR/תשלום) חסרות
 * קישור. לא נוגע ב"תקינות" (מיילים בלי צרופה) ולא ב"אבודות" (בלי עוגן).
 *
 * שני שלבים:
 *   Phase 0 (הפצה בלבד, בלי API): צרופות שכבר יש להן driveLink אבל הרשומות
 *     התלויות לא קיבלו אותו → העתקת הקישור בלבד.
 *   Phase 1 (הורדה+העלאה): הורדת הצרופה מ-Gmail (attachments.get), העלאה
 *     ל-Drive באותו מנגנון של הצינור (uploadInvoiceAttachmentToDrive —
 *     אידמפוטנטי: מזהה קובץ קיים לפי שם+SHA ולא מעלה פעמיים), והפצת הקישור.
 *
 * בטיחות:
 *   - dry-run כברירת מחדל: סופר ומדגים, אפס הורדות/העלאות/כתיבות.
 *   - --apply לביצוע; --limit N מגביל פר-ריצה (ברירת מחדל 100).
 *   - batches של 25 עם השהיות (250ms פר-פריט, 3s בין batches) — כיבוד
 *     rate limits של Gmail/Drive.
 *   - ניתן לקטיעה והמשך: ריצה חוזרת מדלגת על מה שכבר הושלם (הבחירה
 *     שולפת רק צרופות/תלויות שעדיין חסרות קישור).
 *
 * הרצה (Render Shell):
 *   cd backend && npx tsx scripts/backfill-drive-from-gmail.ts             # dry-run
 *   cd backend && npx tsx scripts/backfill-drive-from-gmail.ts --apply --limit 100
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { isUsableSupplierNameShared } from "../src/services/supplier/supplierValidation.js";

const APPLY = process.argv.includes("--apply");
function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}
const LIMIT = Number(argValue("--limit") ?? 100);
const INCLUDE_SUSPECTS = process.argv.includes("--include-suspects");
const BATCH_SIZE = 25;
const ITEM_DELAY_MS = 250;
const BATCH_DELAY_MS = 3_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(join(backendRoot, ".env"), "utf8");
  const line = envText.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found");
  return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}
const prisma = new PrismaClient({ datasources: { db: { url: loadDatabaseUrl() } } });

type Target = {
  attachmentId: string;
  gmailAttachmentId: string | null;
  filename: string;
  mimeType: string | null;
  driveLink: string | null;
  organizationId: string;
  emailMessageId: string;
  gmailId: string;
  receivedAt: Date;
  dependents: { gsi: number; fdr: number; payments: number };
  metadata: {
    supplierName: string;
    documentType: string;
    documentDate: Date | null;
    invoiceNumber: string | null;
    totalAmount: number | null;
    reviewStatus: string | null;
  };
};

function missingLink(value: string | null): boolean {
  return !value || !value.trim() || value.trim().startsWith("/uploads/");
}

// סינון ספק-זבל ל-Phase 1: קבצים שכנראה אינם מסמכים (לוגו/חתימת מייל/תמונת
// פוסט) לא מועלים כברירת מחדל — Gmail נשאר הארכיון שלהם. PDF תמיד עובר.
// תמונה עוברת רק אם שם הקובץ לא זבל-מובהק וגם יש ספק תקין או סכום חיובי.
const SUSPECT_IMAGE_NAME = /logo|banner|icon|signature|footer|header|avatar|^image0*\d+\.|^post_?\d+|\.gif$/i;
function isSuspectFile(target: Target): boolean {
  const name = target.filename.toLowerCase();
  const mime = (target.mimeType ?? "").toLowerCase();
  const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
  if (isPdf) return false;
  const isImage = mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name);
  if (!isImage) return true; // html/ics/וכו' — לא מסמך חשבונית
  if (SUSPECT_IMAGE_NAME.test(name)) return true;
  const supplierOk = isUsableSupplierNameShared(target.metadata.supplierName);
  const amountOk = typeof target.metadata.totalAmount === "number" && target.metadata.totalAmount > 0;
  return !supplierOk && !amountOk;
}

async function propagateLink(target: Target, link: string) {
  await prisma.emailAttachment.update({
    where: { id: target.attachmentId },
    data: { driveLink: link, driveUploadStatus: "uploaded" },
  });
  await prisma.gmailScanItem.updateMany({
    where: {
      organizationId: target.organizationId,
      OR: [{ emailMessageId: target.emailMessageId }, { gmailMessageId: target.gmailId }],
      AND: [{ OR: [{ attachmentFilename: target.filename }, { attachmentFilename: null }] }],
      driveFileLink: null,
    },
    data: { driveFileLink: link, driveUploadStatus: "uploaded" },
  });
  await prisma.financialDocumentReview.updateMany({
    where: {
      organizationId: target.organizationId,
      OR: [{ emailMessageId: target.emailMessageId }, { gmailMessageId: target.gmailId }],
      driveFileUrl: null,
    },
    data: { driveFileUrl: link, driveUploadStatus: "uploaded" },
  });
  await prisma.supplierPayment.updateMany({
    where: {
      organizationId: target.organizationId,
      emailMessageId: target.emailMessageId,
      driveFileUrl: null,
      documentLink: null,
      invoiceLink: null,
    },
    data: { driveFileUrl: link, driveUploadStatus: "uploaded" },
  });
}

async function main() {
  console.log(`backfill-drive-from-gmail | ${new Date().toISOString()} | mode=${APPLY ? "APPLY" : "DRY-RUN"} | limit=${LIMIT}`);
  if (!APPLY) console.log("(dry-run: אפס הורדות/העלאות/כתיבות. לביצוע: --apply)\n");

  // ── בחירת מטרות ב-4 שאילתות bulk (לא N+1 — בפרודקשן זה ההבדל בין
  //    שניות לשעות: אין אינדקס על gmailMessageId ב-FDR, ו-connection_limit=1) ──
  const [attachments, gsiAll, fdrAll, paymentsAll] = await Promise.all([
    prisma.emailAttachment.findMany({
      where: { gmailAttachmentId: { not: null } },
      select: {
        id: true, gmailAttachmentId: true, filename: true, mimeType: true, driveLink: true,
        emailMessage: { select: { id: true, organizationId: true, gmailId: true, receivedAt: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.gmailScanItem.findMany({
      where: { driveFileLink: null },
      select: { organizationId: true, emailMessageId: true, gmailMessageId: true, supplierName: true, documentType: true, amount: true, reviewStatus: true, normalizedDocumentDate: true },
    }),
    prisma.financialDocumentReview.findMany({
      where: { driveFileUrl: null },
      select: { organizationId: true, emailMessageId: true, gmailMessageId: true, supplierName: true, documentType: true, totalAmount: true, invoiceNumber: true, documentDate: true, reviewStatus: true },
    }),
    prisma.supplierPayment.findMany({
      where: { driveFileUrl: null, documentLink: null, invoiceLink: null, emailMessageId: { not: null } },
      select: { organizationId: true, emailMessageId: true, supplier: true, amount: true, invoiceNumber: true, date: true },
    }),
  ]);
  console.log(`נטענו: ${attachments.length} צרופות עם עוגן Gmail | חסרות-קישור: GSI=${gsiAll.length} FDR=${fdrAll.length} Payments=${paymentsAll.length}`);

  // אינדוקס בזיכרון לפי org|emailMessageId ו-org|gmailMessageId
  function indexRows<T extends { organizationId: string; emailMessageId?: string | null; gmailMessageId?: string | null }>(rows: T[]) {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      if (row.emailMessageId) {
        const k = `${row.organizationId}|e|${row.emailMessageId}`;
        map.set(k, [...(map.get(k) ?? []), row]);
      }
      if (row.gmailMessageId) {
        const k = `${row.organizationId}|g|${row.gmailMessageId}`;
        map.set(k, [...(map.get(k) ?? []), row]);
      }
    }
    return map;
  }
  const gsiIndex = indexRows(gsiAll);
  const fdrIndex = indexRows(fdrAll);
  const paymentIndex = indexRows(paymentsAll);
  function lookup<T>(index: Map<string, T[]>, organizationId: string, emailMessageId: string, gmailId: string): T[] {
    const byEmail = index.get(`${organizationId}|e|${emailMessageId}`) ?? [];
    const byGmail = index.get(`${organizationId}|g|${gmailId}`) ?? [];
    return byEmail.length || byGmail.length ? [...new Set([...byEmail, ...byGmail])] : [];
  }

  const targets: Target[] = [];
  for (const att of attachments) {
    const { organizationId } = att.emailMessage;
    const gsiRows = lookup(gsiIndex, organizationId, att.emailMessage.id, att.emailMessage.gmailId);
    const fdrRows = lookup(fdrIndex, organizationId, att.emailMessage.id, att.emailMessage.gmailId);
    const paymentRows = lookup(paymentIndex, organizationId, att.emailMessage.id, att.emailMessage.gmailId);
    if (!gsiRows.length && !fdrRows.length && !paymentRows.length) continue; // אין תלויות חסרות — לא נוגעים

    const fdr = fdrRows[0];
    const gsi = gsiRows[0];
    const payment = paymentRows[0];
    targets.push({
      attachmentId: att.id,
      gmailAttachmentId: att.gmailAttachmentId,
      filename: att.filename,
      mimeType: att.mimeType,
      driveLink: att.driveLink,
      organizationId,
      emailMessageId: att.emailMessage.id,
      gmailId: att.emailMessage.gmailId,
      receivedAt: att.emailMessage.receivedAt,
      dependents: { gsi: gsiRows.length, fdr: fdrRows.length, payments: paymentRows.length },
      metadata: {
        supplierName: fdr?.supplierName ?? gsi?.supplierName ?? payment?.supplier ?? "לא זוהה",
        documentType: fdr?.documentType ?? gsi?.documentType ?? "invoice",
        documentDate: fdr?.documentDate ?? gsi?.normalizedDocumentDate ?? payment?.date ?? null,
        invoiceNumber: fdr?.invoiceNumber ?? payment?.invoiceNumber ?? null,
        totalAmount: fdr?.totalAmount ?? gsi?.amount ?? payment?.amount ?? null,
        reviewStatus: fdr?.reviewStatus ?? gsi?.reviewStatus ?? null,
      },
    });
  }

  const propagateOnly = targets.filter((t) => t.driveLink && !missingLink(t.driveLink));
  const uploadCandidates = targets.filter((t) => missingLink(t.driveLink));
  const suspects = uploadCandidates.filter((t) => isSuspectFile(t));
  const clean = uploadCandidates.filter((t) => !isSuspectFile(t));
  const needUpload = (INCLUDE_SUSPECTS ? uploadCandidates : clean).slice(0, LIMIT);
  const byOrg = new Map<string, Target[]>();
  for (const t of needUpload) byOrg.set(t.organizationId, [...(byOrg.get(t.organizationId) ?? []), t]);

  console.log(`Phase 0 — הפצת קישור קיים בלבד (בלי API): ${propagateOnly.length} צרופות`);
  console.log(`Phase 1 — מועמדים להורדה+העלאה: ${uploadCandidates.length} | נקיים: ${clean.length} | ספק-זבל (מדולגים${INCLUDE_SUSPECTS ? " — נכללים עם --include-suspects" : ""}): ${suspects.length}`);
  console.log(`Phase 1 — ירוצו בפועל: ${needUpload.length} (limit=${LIMIT}) ב-${byOrg.size} ארגונים`);
  if (suspects.length) {
    console.log("--- דוגמיות ספק-זבל (עד 15, נשארים ב-Gmail — לא אבודים) ---");
    for (const t of suspects.slice(0, 15)) {
      console.log(`  SUSPECT "${t.filename}" | supplier="${t.metadata.supplierName}" | amount=${t.metadata.totalAmount ?? "-"}`);
    }
  }
  const depTotals = targets.reduce(
    (acc, t) => ({ gsi: acc.gsi + t.dependents.gsi, fdr: acc.fdr + t.dependents.fdr, payments: acc.payments + t.dependents.payments }),
    { gsi: 0, fdr: 0, payments: 0 }
  );
  console.log(`רשומות תלויות שיקבלו קישור: GSI=${depTotals.gsi} FDR=${depTotals.fdr} Payments=${depTotals.payments}\n`);

  if (!APPLY) {
    console.log("--- דוגמית (עד 15 ראשונות ל-Phase 1) ---");
    for (const t of needUpload.slice(0, 15)) {
      console.log(`  ${t.organizationId} | "${t.filename}" | supplier="${t.metadata.supplierName}" | deps: gsi=${t.dependents.gsi} fdr=${t.dependents.fdr} pay=${t.dependents.payments}`);
    }
    console.log("\nDRY-RUN הסתיים — שום דבר לא הורד, הועלה או נכתב.");
    return;
  }

  // ── APPLY ──
  const { getGoogleClients } = await import("../src/services/google.js");
  const { ensureInvoiceFolderTree, uploadInvoiceAttachmentToDrive } = await import("../src/services/driveService.js");

  let done = 0;
  let failed = 0;

  for (const t of propagateOnly) {
    try {
      await propagateLink(t, t.driveLink!);
      console.log(`PROPAGATED ${t.filename} → deps gsi=${t.dependents.gsi} fdr=${t.dependents.fdr} pay=${t.dependents.payments}`);
    } catch (err) {
      console.warn(`DRIVE_BACKFILL_FAILED phase=propagate attachment=${t.attachmentId} reason=${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [organizationId, orgTargets] of byOrg) {
    let gmail, drive, rootFolderId;
    try {
      ({ gmail, drive } = await getGoogleClients(organizationId));
      rootFolderId = await ensureInvoiceFolderTree(drive);
    } catch (err) {
      console.warn(`DRIVE_BACKFILL_FAILED org=${organizationId} reason=google_clients: ${err instanceof Error ? err.message : String(err)} — מדלג על הארגון`);
      failed += orgTargets.length;
      continue;
    }
    for (let i = 0; i < orgTargets.length; i++) {
      const t = orgTargets[i];
      try {
        const data = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: t.gmailId,
          id: t.gmailAttachmentId!,
        });
        const raw = (data.data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
        const buffer = Buffer.from(raw, "base64");
        if (!buffer.length) throw new Error("empty attachment data");
        const upload = await uploadInvoiceAttachmentToDrive({
          organizationId,
          drive,
          rootFolderId,
          supplier: t.metadata.supplierName,
          documentType: t.metadata.documentType,
          reviewStatus: t.metadata.reviewStatus === "needs_review" ? "needs_review" : "auto_saved",
          filename: t.filename,
          mimeType: t.mimeType,
          receivedAt: t.receivedAt,
          documentDate: t.metadata.documentDate,
          invoiceNumber: t.metadata.invoiceNumber,
          amount: t.metadata.totalAmount,
          totalAmount: t.metadata.totalAmount,
          buffer,
          fileSha256: createHash("sha256").update(buffer).digest("hex"),
        });
        await propagateLink(t, upload.webViewLink);
        done++;
        console.log(`[${done}/${needUpload.length}] UPLOADED "${t.filename}" org=${organizationId}${upload.duplicateDetected ? " (existing Drive file reused)" : ""}`);
      } catch (err) {
        failed++;
        console.warn(`DRIVE_BACKFILL_FAILED attachment=${t.attachmentId} file="${t.filename}" reason=${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(ITEM_DELAY_MS);
      if ((i + 1) % BATCH_SIZE === 0) {
        console.log(`--- batch נגמר (${i + 1}/${orgTargets.length} בארגון) — השהיה ${BATCH_DELAY_MS}ms ---`);
        await sleep(BATCH_DELAY_MS);
      }
    }
  }

  console.log(`\nסיכום: הועלו ${done}, נכשלו ${failed}, הופצו-בלבד ${propagateOnly.length}.`);
  console.log("ריצה חוזרת תמשיך מהנקודה הזו (מדלגת אוטומטית על מה שהושלם).");
}

main()
  .catch((err) => {
    console.error("backfill-drive-from-gmail failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
