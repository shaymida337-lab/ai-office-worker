/**
 * READ-ONLY dry-run: מריץ את שער isInvoiceCandidate על מיילים היסטוריים
 * אמיתיים מה-DB, בלי לשנות כלום, ומדפיס:
 *   1. כמה מיילים היו נחסמים (לפי סיבה)
 *   2. דגימה של 20 שנחסמו — שולח/נושא/סיבה
 *   3. בדיקת false negatives: מיילים שהשער היה חוסם אבל בפועל הפכו
 *      לרשומה פיננסית מאושרת/שמורה (auto_saved / approved) — אלה
 *      חשבוניות אמיתיות שהשער היה מפספס.
 *
 * הרצה (סביבה עם DATABASE_URL): cd backend && npx tsx scripts/invoice-gate-dry-run.ts
 * אופציונלי: DAYS_BACK=180 (ברירת מחדל 365), LIMIT=5000
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { classifyJunk } from "../src/services/classification/junkFilter.js";
import { isInvoiceCandidate } from "../src/services/classification/invoiceCandidateGate.js";

const DAYS_BACK = Number(process.env.DAYS_BACK ?? 365);
const LIMIT = Number(process.env.LIMIT ?? 5000);

async function main() {
  const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);
  const emails = await prisma.emailMessage.findMany({
    where: { receivedAt: { gte: since } },
    select: {
      id: true,
      gmailId: true,
      subject: true,
      fromAddress: true,
      bodyText: true,
      receivedAt: true,
      attachments: { select: { filename: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: LIMIT,
  });

  console.log(`invoice-gate dry-run | emails=${emails.length} | since=${since.toISOString().slice(0, 10)}\n`);

  type Blocked = { gmailId: string; sender: string; subject: string; reasons: string[]; stage: string };
  const blocked: Blocked[] = [];
  let junkDropped = 0;
  let passed = 0;

  for (const email of emails) {
    const filenames = email.attachments.map((a) => a.filename).filter(Boolean);
    // אותו סדר כמו gmail-sync: קודם פילטר הזבל (CERTAIN_JUNK נופל גם היום), ואז השער
    const junk = classifyJunk({
      sender: email.fromAddress,
      subject: email.subject,
      body: email.bodyText ?? "",
      channel: "gmail",
      attachmentFilenames: filenames,
    });
    if (junk.bucket === "CERTAIN_JUNK") {
      junkDropped++;
      continue;
    }
    const gate = isInvoiceCandidate({
      sender: email.fromAddress,
      subject: email.subject,
      body: email.bodyText ?? "",
      attachmentFilenames: filenames,
    });
    if (gate.isInvoice) {
      passed++;
    } else {
      blocked.push({
        gmailId: email.gmailId,
        sender: email.fromAddress,
        subject: email.subject,
        reasons: gate.reasons,
        stage: "invoice_gate",
      });
    }
  }

  // --- 1. סיכום ---
  const byReason = new Map<string, number>();
  for (const b of blocked) {
    const key = b.reasons[0] ?? "unknown";
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  console.log("=== 1. סיכום ===");
  console.log(`נבדקו (אחרי CERTAIN_JUNK של הפילטר הקיים): ${emails.length - junkDropped}`);
  console.log(`CERTAIN_JUNK (נחסם גם היום, לא קשור לשער): ${junkDropped}`);
  console.log(`עוברים את השער: ${passed}`);
  console.log(`נחסמים ע"י השער: ${blocked.length}`);
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  // --- 2. דגימה של 20 ---
  console.log("\n=== 2. דגימה של 20 מיילים שנחסמו ===");
  for (const b of blocked.slice(0, 20)) {
    console.log(`  [${b.reasons.join(",")}] from="${b.sender.slice(0, 60)}" subject="${b.subject.slice(0, 90)}"`);
  }

  // --- 3. false negatives: נחסם אבל בפועל הפך לרשומה פיננסית שמורה ---
  console.log("\n=== 3. בדיקת false negatives ===");
  const blockedGmailIds = blocked.map((b) => b.gmailId);
  const emailIdByGmailId = new Map(emails.map((e) => [e.gmailId, e.id]));

  const scanHits = blockedGmailIds.length
    ? await prisma.gmailScanItem.findMany({
        where: { gmailMessageId: { in: blockedGmailIds } },
        select: { gmailMessageId: true, reviewStatus: true, supplierName: true, amount: true, subject: true },
      })
    : [];
  const paymentHits = blockedGmailIds.length
    ? await prisma.supplierPayment.findMany({
        where: { emailMessageId: { in: blockedGmailIds.map((g) => emailIdByGmailId.get(g)).filter(Boolean) as string[] } },
        select: { emailMessageId: true, approvalStatus: true, supplier: true, amount: true, subject: true },
      })
    : [];

  const realScan = scanHits.filter((s) => s.reviewStatus === "auto_saved");
  const realPayments = paymentHits.filter((p) => p.approvalStatus === "approved");
  console.log(`מתוך ${blocked.length} חסומים: GmailScanItem auto_saved=${realScan.length}, SupplierPayment approved=${realPayments.length}`);
  console.log(`(רשומות needs_review על מיילים חסומים הן בדיוק הזבל שהשער נועד למנוע: ${scanHits.length - realScan.length})`);
  if (realScan.length || realPayments.length) {
    console.log("\n*** אזהרה: אלה כנראה חשבוניות אמיתיות שהשער היה חוסם — לבדוק לפני deploy: ***");
    for (const s of realScan.slice(0, 20)) {
      console.log(`  scan: supplier="${s.supplierName}" amount=${s.amount} subject="${s.subject?.slice(0, 80)}"`);
    }
    for (const p of realPayments.slice(0, 20)) {
      console.log(`  payment: supplier="${p.supplier}" amount=${p.amount} subject="${p.subject?.slice(0, 80)}"`);
    }
  } else {
    console.log("לא נמצאה אף רשומה פיננסית שמורה/מאושרת שמקורה במייל שהשער חוסם. ✅");
  }
}

main()
  .catch((err) => {
    console.error("[invoice-gate-dry-run] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
