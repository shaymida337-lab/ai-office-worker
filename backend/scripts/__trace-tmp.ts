/**
 * READ-ONLY diagnostic trace — findMany בלבד, אפס כתיבות.
 * מדפיס: commit חי, SyncLog אחרונים, ו-trace מלא ל-25 ההודעות האחרונות
 * (EmailMessage / GmailScanItem / FinancialDocumentReview / SupplierPayment /
 * Invoice, processedAt, gates, duplicateDetected) עם הכרעת FAIL-POINT לכל הודעה.
 * הרצה: npm exec -w backend -- tsx scripts/__trace-tmp.ts   (אופציונלי: DAYS=21)
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const DAYS = Number(process.env.DAYS ?? 14);
const since = new Date(Date.now() - DAYS * 864e5);

async function main() {
  console.log(`LIVE COMMIT (RENDER_GIT_COMMIT) = ${process.env.RENDER_GIT_COMMIT ?? "unavailable"}`);
  console.log(`678f89b LIVE: ${(process.env.RENDER_GIT_COMMIT ?? "").startsWith("678f89b") ? "YES" : "NO"}`);

  let gateMod: any = null;
  let junkMod: any = null;
  let amtMod: any = null;
  try {
    gateMod = await import("../src/services/classification/invoiceCandidateGate.js");
  } catch {
    console.log("(invoiceCandidateGate לא קיים ב-checkout הזה — קוד ישן)");
  }
  try {
    junkMod = await import("../src/services/classification/junkFilter.js");
  } catch {}
  try {
    amtMod = await import("../src/services/gmail-sync.js");
  } catch {}

  const logs = await prisma.syncLog.findMany({
    where: { type: "gmail_scan", startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 6,
  });
  console.log("\n=== SyncLog ===");
  for (const s of logs) {
    console.log(
      `  ${s.startedAt.toISOString()} mode=${(s as any).scanMode} status=${s.status} processed=${s.emailsProcessed} saved=${s.emailsSaved} errors=${s.errorsCount} truncated=${(s as any).windowTruncated} finished=${s.finishedAt ? "yes" : "STUCK"}`
    );
  }

  const emails = await prisma.emailMessage.findMany({
    where: { receivedAt: { gte: since } },
    include: { attachments: true },
    orderBy: { receivedAt: "desc" },
    take: 25,
  });
  console.log(
    `\n=== ${emails.length} ההודעות האחרונות ב-DB (חלון ${DAYS} ימים) — אם חשבונית חסרה כאן, היא לא נשלפה מ-Gmail (שלב ה-listing) ===`
  );

  for (const e of emails) {
    const isMicrosoft = /microsoft/i.test(`${e.fromAddress} ${e.subject}`);
    console.log(`\n--- ${e.gmailId}${isMicrosoft ? " ***MICROSOFT***" : ""}`);
    console.log(`  from="${e.fromAddress}" subject="${e.subject.slice(0, 90)}"`);
    console.log(
      `  receivedAt=${e.receivedAt.toISOString()} processedAt=${e.processedAt?.toISOString() ?? "NULL"}`
    );
    console.log(
      `  attachments=${e.attachments.map((a) => `${a.filename}|${a.mimeType}`).join(";") || "none"}`
    );

    const [scans, reviews, pays, invs] = await Promise.all([
      prisma.gmailScanItem.findMany({ where: { gmailMessageId: e.gmailId } }),
      prisma.financialDocumentReview.findMany({
        where: { OR: [{ gmailMessageId: e.gmailId }, { emailMessageId: e.id }] },
      }),
      prisma.supplierPayment.findMany({ where: { emailMessageId: e.id } }),
      prisma.invoice.findMany({ where: { emailId: e.id } }).catch(() => [] as any[]),
    ]);
    console.log(`  scan=${scans.length} review=${reviews.length} payment=${pays.length} invoice=${invs.length}`);

    for (const r of reviews as any[]) {
      console.log(
        `  review: status=${r.reviewStatus} supplier="${r.supplierName}" total=${r.totalAmount} ${r.currency} updatedAt=${r.updatedAt?.toISOString?.() ?? "-"} reason="${(r.uncertaintyReason ?? "").slice(0, 120)}" gates=${JSON.stringify((r.parsedFieldsJson as any)?.gates ?? null)?.slice(0, 300)}`
      );
    }
    for (const p of pays as any[]) {
      console.log(
        `  payment: status=${p.approvalStatus} supplier="${p.supplier}" amount=${p.amount} dupDetected=${p.duplicateDetected} dupReason="${(p.duplicateReason ?? "").slice(0, 80)}"`
      );
    }
    for (const s of scans as any[]) {
      console.log(
        `  scan: status=${s.reviewStatus} type=${s.documentType} supplier="${s.supplierName}" amount=${s.amount} reason="${(s.decisionReason ?? "").slice(0, 120)}"`
      );
    }

    if (junkMod && gateMod) {
      const files = e.attachments.map((a) => a.filename).filter(Boolean);
      const j = junkMod.classifyJunk({
        sender: e.fromAddress,
        subject: e.subject,
        body: e.bodyText ?? "",
        channel: "gmail",
        attachmentFilenames: files,
      });
      const g = gateMod.isInvoiceCandidate({
        sender: e.fromAddress,
        subject: e.subject,
        body: e.bodyText ?? "",
        attachmentFilenames: files,
      });
      console.log(
        `  gates(now): junk=${j.bucket}/${j.reason} invoiceGate=${g.isInvoice ? "PASS" : "BLOCK"}/${g.reasons.join(",")}`
      );
    }

    if (amtMod && isMicrosoft) {
      const a = amtMod.extractInvoiceAmount(`${e.subject}\n${e.bodyText ?? ""}`);
      console.log(
        `  MICROSOFT extractInvoiceAmount(now)=${a.amount} rejected="${a.rejectedReason}" (ערך כאן + רשומה ריקה => לא בוצע reprocess)`
      );
    }

    const total = scans.length + reviews.length + pays.length + invs.length;
    if (!e.processedAt) {
      console.log("  >>> FAIL-POINT: נשלף אך לא עובד — סריקה נקטעה");
    } else if (total === 0) {
      console.log(
        '  >>> FAIL-POINT: עובד אך אפס רשומות — הופל בשער (הכרעה: grep בלוגים "INVOICE_GATE_BLOCKED" / "junk dropped" עבור ה-gmailId)'
      );
    } else {
      console.log("  >>> נכנס לצינור — הכשל (אם יש) בערכים למעלה");
    }
  }

  console.log("\nTRACE COMPLETE");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
