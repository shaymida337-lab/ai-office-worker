/**
 * drive-backfill-report.ts — סיווג רשומות ללא קישור Drive + הערכת יכולת השלמה.
 *
 * READ-ONLY: אפס כתיבות. מסווג כל רשומה חסרת-Drive לפי סיבה ומקור שחזור:
 *   RECOVERABLE_FROM_GMAIL — יש EmailAttachment עם gmailAttachmentId → אפשר
 *     להוריד שוב מ-Gmail ולהעלות (המנגנון של retryPendingDriveUploads).
 *   NO_ATTACHMENT_RECORDED — לרשומת המייל אין צרופות בכלל → כנראה מסמך-גוף
 *     בלי קובץ; אין מה להשלים (וזה תקין).
 *   CAMERA_LOCAL_PRESENT / CAMERA_LOCAL_LOST — קובץ מצלמה מקומי קיים/אבד
 *     (הדיסק של Render אפמרלי — קבצים מלפני deploy אחרון אובדים).
 *   WHATSAPP_TWILIO_UNKNOWN — מדיה של Twilio; ייתכן שחזור בתלות ב-retention.
 *   NO_SOURCE — אין שום עוגן שחזור ידוע.
 *
 * הרצה ב-Render Shell:
 *   cd backend && ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/drive-backfill-report.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveDriveLink, isLocalUploadLink } from "../src/services/drive/driveLinkResolver.js";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(join(backendRoot, ".env"), "utf8");
  const line = envText.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found");
  return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}
const databaseUrl = loadDatabaseUrl();
const host = new URL(databaseUrl.replace(/^postgresql:/, "http:")).hostname;
const allowRemote = process.env.ALLOW_REMOTE_READONLY_REPORT === "1";
if (host !== "localhost" && host !== "127.0.0.1" && !allowRemote) {
  console.error(`REFUSING TO RUN: host "${host}" is not localhost. ALLOW_REMOTE_READONLY_REPORT=1 להרצה מרחוק (קריאה בלבד).`);
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

type Verdict =
  | "RECOVERABLE_FROM_GMAIL"
  | "NO_ATTACHMENT_RECORDED"
  | "CAMERA_LOCAL_PRESENT"
  | "CAMERA_LOCAL_LOST"
  | "WHATSAPP_TWILIO_UNKNOWN"
  | "NO_SOURCE";

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function printBuckets(title: string, map: Map<string, number>) {
  console.log(`\n### ${title}`);
  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(55)} ${count}`);
  }
}

async function main() {
  console.log(`drive-backfill-report | ${new Date().toISOString()} | host=${host} | READ-ONLY\n`);

  // אינדקס צרופות פר-הודעת-מייל (העוגן לשחזור מ-Gmail)
  const attachments = await prisma.emailAttachment.findMany({
    select: { emailMessageId: true, gmailAttachmentId: true, driveLink: true },
  });
  const attachmentsByEmail = new Map<string, { recoverable: number; total: number }>();
  for (const att of attachments) {
    const entry = attachmentsByEmail.get(att.emailMessageId) ?? { recoverable: 0, total: 0 };
    entry.total++;
    if (att.gmailAttachmentId) entry.recoverable++;
    attachmentsByEmail.set(att.emailMessageId, entry);
  }
  const emailIdByGmailId = new Map(
    (await prisma.emailMessage.findMany({ select: { id: true, gmailId: true } })).map((e) => [e.gmailId, e.id])
  );

  function gmailVerdict(gmailMessageId: string | null, emailMessageId?: string | null): Verdict {
    const emailId = emailMessageId ?? (gmailMessageId ? emailIdByGmailId.get(gmailMessageId) : null);
    if (!emailId) return "NO_SOURCE";
    const atts = attachmentsByEmail.get(emailId);
    if (!atts || atts.total === 0) return "NO_ATTACHMENT_RECORDED";
    return atts.recoverable > 0 ? "RECOVERABLE_FROM_GMAIL" : "NO_SOURCE";
  }
  function cameraVerdict(link: string | null): Verdict {
    if (link && isLocalUploadLink(link)) {
      return existsSync(join(process.cwd(), link.replace(/^\//, ""))) ? "CAMERA_LOCAL_PRESENT" : "CAMERA_LOCAL_LOST";
    }
    return "NO_SOURCE";
  }

  const totals = new Map<string, number>();

  // ---- GmailScanItem ----
  const gsi = await prisma.gmailScanItem.findMany({
    select: { gmailMessageId: true, emailMessageId: true, driveFileLink: true, driveUploadStatus: true },
  });
  const gsiBuckets = new Map<string, number>();
  for (const item of gsi) {
    if (resolveDriveLink({ driveFileLink: item.driveFileLink })) continue;
    const verdict = gmailVerdict(item.gmailMessageId, item.emailMessageId);
    bump(gsiBuckets, `${verdict} | status=${item.driveUploadStatus ?? "null"}`);
    bump(totals, verdict);
  }
  printBuckets(`GmailScanItem בלי Drive (${[...gsiBuckets.values()].reduce((a, b) => a + b, 0)})`, gsiBuckets);

  // ---- FinancialDocumentReview ----
  const fdr = await prisma.financialDocumentReview.findMany({
    select: { source: true, gmailMessageId: true, emailMessageId: true, whatsappLogId: true, driveFileUrl: true, driveUploadStatus: true, fileName: true },
  });
  const fdrBuckets = new Map<string, number>();
  for (const item of fdr) {
    const link = item.driveFileUrl;
    if (link && !isLocalUploadLink(link)) continue; // יש Drive אמיתי
    let verdict: Verdict;
    if (item.source === "camera") verdict = cameraVerdict(link);
    else if (item.source === "whatsapp") verdict = item.whatsappLogId ? "WHATSAPP_TWILIO_UNKNOWN" : "NO_SOURCE";
    else verdict = item.fileName ? gmailVerdict(item.gmailMessageId, item.emailMessageId) : gmailVerdict(item.gmailMessageId, item.emailMessageId);
    bump(fdrBuckets, `${item.source} | ${verdict} | status=${item.driveUploadStatus ?? "null"}`);
    bump(totals, verdict);
  }
  printBuckets(`FinancialDocumentReview בלי Drive (${[...fdrBuckets.values()].reduce((a, b) => a + b, 0)})`, fdrBuckets);

  // ---- SupplierPayment ----
  const payments = await prisma.supplierPayment.findMany({
    select: { source: true, emailMessageId: true, driveFileUrl: true, documentLink: true, invoiceLink: true, driveUploadStatus: true },
  });
  const payBuckets = new Map<string, number>();
  for (const payment of payments) {
    const link = resolveDriveLink(payment);
    if (link && !isLocalUploadLink(link)) continue;
    let verdict: Verdict;
    if (payment.source === "camera") verdict = cameraVerdict(payment.documentLink);
    else if (payment.source === "whatsapp") verdict = "WHATSAPP_TWILIO_UNKNOWN";
    else verdict = gmailVerdict(null, payment.emailMessageId);
    bump(payBuckets, `${payment.source} | ${verdict} | status=${payment.driveUploadStatus ?? "null"}`);
    bump(totals, verdict);
  }
  printBuckets(`SupplierPayment בלי Drive (${[...payBuckets.values()].reduce((a, b) => a + b, 0)})`, payBuckets);

  // ---- סיכום והערכה ----
  console.log("\n=== הערכת השלמה כוללת (רשומות, לא קבצים ייחודיים) ===");
  const recoverable = totals.get("RECOVERABLE_FROM_GMAIL") ?? 0;
  const noFile = totals.get("NO_ATTACHMENT_RECORDED") ?? 0;
  const cameraPresent = totals.get("CAMERA_LOCAL_PRESENT") ?? 0;
  const cameraLost = totals.get("CAMERA_LOCAL_LOST") ?? 0;
  const twilio = totals.get("WHATSAPP_TWILIO_UNKNOWN") ?? 0;
  const noSource = totals.get("NO_SOURCE") ?? 0;
  console.log(`✅ ניתן להשלים מ-Gmail (יש gmailAttachmentId): ${recoverable}`);
  console.log(`✅ ניתן להשלים מקובץ מצלמה מקומי קיים:        ${cameraPresent}`);
  console.log(`ℹ️  אין קובץ מקור בכלל (מייל בלי צרופה — תקין): ${noFile}`);
  console.log(`❓ WhatsApp — תלוי ב-retention של Twilio:        ${twilio}`);
  console.log(`❌ קובץ מצלמה אבד (דיסק אפמרלי):                ${cameraLost}`);
  console.log(`❌ אין עוגן שחזור:                                ${noSource}`);
  console.log("\n(רשומות GSI/FDR/Payment של אותו מסמך נספרות בנפרד — ההעלאה משלימה את כולן יחד)");
}

main()
  .catch((err) => {
    console.error("drive-backfill-report failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
