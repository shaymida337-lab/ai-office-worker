import { createHash, randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { buildDuplicateHash } from "../lib/duplicate.js";
import { analyzeEmailContent, type EmailAnalysis } from "./claude.js";
import { getGoogleClients } from "./google.js";
import { analyzeAndSaveMessage } from "./messageScanner.js";
import {
  ensureInvoiceFolderTree,
  folderForDocumentType,
  uploadInvoiceAttachmentToDrive,
} from "./driveService.js";
import { appendSupplierPaymentToSheet } from "./supplierPaymentsSheet.js";
import { notifyNewInvoice } from "./whatsapp.js";

const MAX_MESSAGES_PER_SYNC = 500;
const MAX_MESSAGES_PER_QUICK_SCAN = 25;
const GMAIL_SCAN_BATCH_SIZE = 10;
const GMAIL_PROGRESS_EMAIL_INTERVAL = 25;
const GMAIL_PROGRESS_MIN_INTERVAL_MS = 30_000;
const DRIVE_FULL_MESSAGE = "הסריקה הושלמה. לא ניתן לשמור ל-Drive - האחסון שלך מלא";
const GMAIL_EXCLUDE_QUERY = "-category:promotions -category:social -in:spam -in:trash";
const INVOICE_KEYWORDS = [
  "חשבונית מס קבלה",
  "חשבונית",
  "חשבונית מס",
  "חשבון",
  "קבלה",
  "דרישת תשלום",
  "בקשת תשלום",
  "לתשלום",
  "שולם",
  "invoice",
  "tax invoice",
  "receipt",
  "subscription receipt",
  "subscription invoice",
  "payment",
  "payment due",
  "payment request",
  "bill",
  "supplier bill",
  "paid",
  "statement",
  "utility bill",
  "electricity bill",
  "water bill",
  "internet bill",
  "monthly bill",
  "google payments",
  "google workspace",
  "google cloud",
  "apple receipt",
  "paypal receipt",
  "meta receipt",
  "facebook receipt",
  "openai invoice",
  "chatgpt receipt",
  "wolt invoice",
  "wolt receipt",
  "חברת חשמל",
  "חשבון חשמל",
  "חשבון מים",
  "ארנונה",
  "בזק",
  "סלקום",
  "פרטנר",
  "הוט",
  "חשבון אינטרנט",
  "פקטורה",
  "icount",
  "i-count",
  "green invoice",
  "greeninvoice",
  "חשבונית ירוקה",
  "morning",
  "meshulam",
  "משולם",
];
const PAYMENT_REQUEST_KEYWORDS = [
  "דרישת תשלום",
  "בקשת תשלום",
  "לתשלום",
  "נא לשלם",
  "payment request",
  "payment due",
  "please pay",
  "balance due",
  "amount due",
];
const RECEIPT_KEYWORDS = [
  "חשבונית מס קבלה",
  "קבלה",
  "receipt",
  "subscription receipt",
  "payment received",
  "paypal receipt",
  "apple receipt",
  "google receipt",
  "meta receipt",
  "openai receipt",
  "wolt receipt",
  "paid",
  "שולם",
];
const FINANCIAL_SENDER_DOMAINS = [
  "poalim.co.il",
  "bankhapoalim",
  "leumi.co.il",
  "bankleumi",
  "discountbank.co.il",
  "mizrahi-tefahot.co.il",
  "mizrahi",
  "fibi.co.il",
  "bankotsar",
  "mercantile",
  "jbank.co.il",
  "bankyahav",
  "massad",
  "pagi",
  "u-bank.net",
  "onezero",
];
const INVOICE_KEYWORD_PATTERNS = [
  /חשבונית\s*מס\s*קבלה/i,
  /חשבונית\s*מס/i,
  /חשבונית/i,
  /tax\s+invoice/i,
  /\binvoice\b/i,
  /\breceipt\b/i,
  /subscription\s+(receipt|invoice)/i,
  /(google|apple|paypal|meta|facebook|openai|chatgpt|wolt).*(receipt|invoice|payment)/i,
  /(electricity|water|internet|utility|monthly)\s+bill/i,
  /(חשבונית|קבלה|תשלום|חשבון).*(חשמל|מים|אינטרנט|בזק|סלקום|פרטנר|הוט|ארנונה)/i,
];
const SUPPLIER_KEYWORDS = [
  "supplier",
  "vendor",
  "billing",
  "accounts",
  "finance",
  "statement",
  "quote",
  "bill",
  "tax invoice",
  "icount",
  "i-count",
  "green invoice",
  "greeninvoice",
  "חשבונית ירוקה",
  "morning",
  "meshulam",
  "ספק",
  "ספקים",
  "חשבונות",
  "גבייה",
  "תשלום",
  "הצעת מחיר",
  "חשבונית",
  "קבלה",
];
const REVIEWABLE_DOCUMENT_TYPES = new Set<GmailDocumentType>([
  "invoice",
  "receipt",
  "payment_request",
  "supplier_message",
  "unknown_needs_review",
]);

export async function quickScanGmailForOrganization(organizationId: string, options: { daysBack?: number } = {}) {
  const daysBack = options.daysBack ?? 7;
  const { gmail } = await getGoogleClients(organizationId);
  const messages = await withTimeout(
    listCandidateMessages(gmail, daysBack, MAX_MESSAGES_PER_QUICK_SCAN),
    8_000,
    "Gmail quick scan timed out"
  );

  await prisma.syncLog.create({
    data: {
      organizationId,
      type: "gmail_scan",
      status: "success",
      emailsProcessed: messages.length,
      finishedAt: new Date(),
    },
  });

  return {
    emailsProcessed: messages.length,
    emailsFound: messages.length,
    paymentsCreated: 0,
    tasksCreated: 0,
    clientsCreated: 0,
    invoicesCreated: 0,
    duplicatesSkipped: 0,
    recordsSaved: 0,
    uniqueSenders: 0,
    potentialClients: 0,
    invoiceEmails: 0,
    invoiceAmountsExtracted: 0,
    quick: true,
    backgroundProcessing: true,
    scanSteps: [`נמצאו ${messages.length} מיילים ב-Gmail`, "העיבוד המלא ממשיך ברקע"],
  };
}

let gmailScanQueue: Promise<unknown> = Promise.resolve();

type GmailSyncOptions = {
  daysBack?: number;
  since?: Date;
  isFirstTime?: boolean;
  forceReprocess?: boolean;
  scanLogId?: string;
  scanMode?: "manual" | "auto_daily" | "auto_weekly" | "retry" | "first_time";
  retryOfId?: string;
};

export async function syncGmailForOrganization(organizationId: string, options: GmailSyncOptions = {}) {
  const queuedRun = gmailScanQueue
    .catch(() => undefined)
    .then(() => runGmailSyncForOrganization(organizationId, options));
  gmailScanQueue = queuedRun.catch(() => undefined);
  return queuedRun;
}

async function runGmailSyncForOrganization(organizationId: string, options: GmailSyncOptions = {}) {
  const activeLog = await prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "gmail_scan",
      status: "running",
      finishedAt: null,
      ...(options.scanLogId ? { id: { not: options.scanLogId } } : {}),
    },
  });
  if (activeLog) {
    const staleAfterMs = 30 * 60 * 1000;
    if (activeLog.startedAt.getTime() > Date.now() - staleAfterMs) {
      console.log(`[gmail-sync] Existing Gmail scan still running org=${organizationId} log=${activeLog.id}`);
      return { emailsProcessed: 0, paymentsCreated: 0, tasksCreated: 0, clientsCreated: 0, invoicesCreated: 0, uniqueSenders: 0, potentialClients: 0, invoiceEmails: 0, invoiceAmountsExtracted: 0, inProgress: true, scanSteps: ["סריקת Gmail כבר רצה"] };
    }
    console.warn(`[gmail-sync] Closing stale Gmail scan log org=${organizationId} log=${activeLog.id}`);
    await prisma.syncLog.update({
      where: { id: activeLog.id },
      data: { status: "error", errorMessage: "Stale running scan was reset", finishedAt: new Date() },
    });
  }

  const scanSteps: string[] = [];
  const logStep = (message: string) => {
    scanSteps.push(message);
    console.log(message);
  };

  const daysBack = options.isFirstTime ? 90 : options.daysBack ?? 90;
  const scanMode = options.scanMode ?? (options.isFirstTime ? "first_time" : "manual");
  if (options.forceReprocess) {
    logStep(`[gmail-sync] Force reprocess enabled for ${daysBack} day scan`);
  }
  if (options.since) {
    logStep(`[gmail-sync] Incremental scan since ${options.since.toISOString()}`);
  }

  const activeLogAfterReset = await prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "gmail_scan",
      status: "running",
      finishedAt: null,
      ...(options.scanLogId ? { id: { not: options.scanLogId } } : {}),
    },
  });
  if (activeLogAfterReset) {
    return { emailsProcessed: 0, paymentsCreated: 0, tasksCreated: 0, clientsCreated: 0, invoicesCreated: 0, uniqueSenders: 0, potentialClients: 0, invoiceEmails: 0, invoiceAmountsExtracted: 0, inProgress: true, scanSteps: ["סריקת Gmail כבר רצה"] };
  }

  const existingScanLog = options.scanLogId
    ? await prisma.syncLog.findFirst({
        where: { id: options.scanLogId, organizationId, type: "gmail_scan" },
      })
    : null;
  const log = existingScanLog ?? await prisma.syncLog.create({
    data: {
      organizationId,
      type: "gmail_scan",
      status: "running",
      scanMode,
      retryOfId: options.retryOfId,
    },
  });
  if (existingScanLog) {
    await prisma.syncLog.update({
      where: { id: existingScanLog.id },
      data: { status: "running", errorMessage: null, finishedAt: null, scanMode, retryOfId: options.retryOfId },
    });
  }

  let emailsProcessed = 0;
  let paymentsCreated = 0;
  let tasksCreated = 0;
  let driveUploadFailed = false;
  let clientsCreated = 0;
  let invoicesCreated = 0;
  let invoiceEmails = 0;
  let invoiceAmountsExtracted = 0;
  let uniqueSenders = 0;
  let potentialClients = 0;
  let duplicatesSkipped = 0;
  let relevantEmailsFound = 0;
  let receiptsFound = 0;
  let paymentRequestsFound = 0;
  let supplierMessagesFound = 0;
  let needsReviewCount = 0;
  let errorsCount = 0;
  let emailsSavedToGmailScanItem = 0;
  let emailsParsed = 0;
  let parserRejectedCount = 0;
  let dbEmailMessageUpserts = 0;
  let dbGmailScanItemUpserts = 0;
  let driveUploadsAttempted = 0;
  let driveUploadsSucceeded = 0;
  let driveUploadsSkipped = 0;
  let driveUploadsFailed = 0;
  let sheetsUpdated = 0;
  let lastProgressWriteAt = 0;
  let lastProgressEmailsProcessed = 0;
  let invoiceDetectionPositive = 0;
  let invoiceDetectionNegative = 0;
  let ignoredCount = 0;
  const ignoredReasons: Record<string, number> = {};
  const maybeSaveScanProgress = async (force = false) => {
    const now = Date.now();
    const emailDelta = emailsProcessed - lastProgressEmailsProcessed;
    if (
      !force &&
      emailDelta < GMAIL_PROGRESS_EMAIL_INTERVAL &&
      now - lastProgressWriteAt < GMAIL_PROGRESS_MIN_INTERVAL_MS
    ) {
      return;
    }
    await saveScanProgress(log.id, {
      emailsProcessed,
      emailsSaved: emailsSavedToGmailScanItem,
      invoicesFound: invoicesCreated,
      paymentsCreated,
      tasksCreated,
      driveUploaded: driveUploadsSucceeded,
      sheetsUpdated,
      errorsCount,
    });
    lastProgressWriteAt = now;
    lastProgressEmailsProcessed = emailsProcessed;
  };

  const ignoreMessage = (reason: string, messageId?: string | null) => {
    ignoredCount++;
    ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1;
    logStep(`[gmail-sync] ignored message=${messageId ?? "unknown"} reason="${reason}"`);
  };

  const saveRejectedScanItem = async (email: ScannedEmail, reason: string) => {
    const attachmentFilename = primaryAttachmentFilename(email.parts);
    const supplierName = normalizeSupplierName(email.senderName || email.domain || "Unknown supplier");
    const duplicateKey = buildGmailScanDuplicateKey({
      gmailMessageId: email.gmailId,
      attachmentFilename,
      supplierName,
      amount: null,
    });
    logStep(`[gmail-sync] DB fallback GmailScanItem upsert attempt message=${email.gmailId} reason="${reason}"`);
    const saved = await prisma.gmailScanItem.upsert({
      where: { organizationId_duplicateKey: { organizationId, duplicateKey } },
      create: {
        organizationId,
        emailMessageId: email.emailRecordId,
        gmailMessageId: email.gmailId,
        gmailMessageLink: gmailMessageLink(email.gmailId),
        sender: email.from || "unknown",
        senderEmail: email.senderEmail || null,
        subject: email.subject,
        occurredAt: email.receivedAt,
        amount: null,
        supplierName,
        documentType: "unknown_needs_review",
        attachmentFilename,
        driveFileLink: null,
        confidenceScore: "low",
        reviewStatus: "needs_review",
        duplicateKey,
        decisionReason: reason,
        rawAnalysis: {
          parserRejected: true,
          reason,
          bodyLength: email.bodyText.length,
          hasAttachment: email.parts.length > 0,
          filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
        },
      },
      update: {
        emailMessageId: email.emailRecordId,
        gmailMessageLink: gmailMessageLink(email.gmailId),
        sender: email.from || "unknown",
        senderEmail: email.senderEmail || null,
        subject: email.subject,
        occurredAt: email.receivedAt,
        amount: null,
        supplierName,
        documentType: "unknown_needs_review",
        attachmentFilename,
        confidenceScore: "low",
        reviewStatus: "needs_review",
        decisionReason: reason,
        rawAnalysis: {
          parserRejected: true,
          reason,
          bodyLength: email.bodyText.length,
          hasAttachment: email.parts.length > 0,
          filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
        },
      },
    });
    emailsSavedToGmailScanItem++;
    dbGmailScanItemUpserts++;
    parserRejectedCount++;
    ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1;
    logStep(`[gmail-sync] DB fallback GmailScanItem upsert success message=${email.gmailId} id=${saved.id} reason="${reason}"`);
    return saved;
  };

  const saveFetchErrorScanItem = async (orgId: string, gmailMessageId: string, reason: string) => {
    const duplicateKey = createHash("sha256")
      .update(`${gmailMessageId}|fetch-error`)
      .digest("hex")
      .slice(0, 40);
    const saved = await prisma.gmailScanItem.upsert({
      where: { organizationId_duplicateKey: { organizationId: orgId, duplicateKey } },
      create: {
        organizationId: orgId,
        gmailMessageId,
        gmailMessageLink: gmailMessageLink(gmailMessageId),
        sender: "unknown",
        senderEmail: null,
        subject: "(fetch failed)",
        occurredAt: new Date(),
        amount: null,
        supplierName: "Unknown supplier",
        documentType: "unknown_needs_review",
        attachmentFilename: null,
        driveFileLink: null,
        confidenceScore: "low",
        reviewStatus: "needs_review",
        duplicateKey,
        decisionReason: reason,
        rawAnalysis: { parserRejected: true, reason, stage: "fetch_parse_save" },
      },
      update: {
        decisionReason: reason,
        reviewStatus: "needs_review",
        rawAnalysis: { parserRejected: true, reason, stage: "fetch_parse_save" },
      },
    });
    emailsSavedToGmailScanItem++;
    dbGmailScanItemUpserts++;
    ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1;
    logStep(`[gmail-sync] DB fetch-error GmailScanItem upsert success message=${gmailMessageId} id=${saved.id}`);
  };

  try {
    logStep("[gmail-sync] Checking Gmail token and creating Google clients");
    const { gmail, drive } = await getGoogleClients(organizationId);
    let rootId: string | null = null;
    try {
      logStep("[gmail-sync] Checking Drive invoice folder");
      rootId = await ensureInvoiceFolderTree(drive);
    } catch (err) {
      driveUploadFailed = true;
      console.error("Drive setup failed; continuing Gmail sync without Drive", err);
    }
    logStep(`[gmail-sync] Searching Gmail from last ${daysBack} days`);
    const messages = await listCandidateMessages(gmail, daysBack, MAX_MESSAGES_PER_SYNC, options.since);
    logStep(`[gmail-sync] total emails fetched from Gmail=${messages.length}`);
    const scannedEmails: ScannedEmail[] = [];

    let fetchBatchNumber = 0;
    for (const batch of chunkArray(messages, GMAIL_SCAN_BATCH_SIZE)) {
      fetchBatchNumber++;
      logStep(`[gmail-sync] fetch batch ${fetchBatchNumber}/${Math.ceil(messages.length / GMAIL_SCAN_BATCH_SIZE)} size=${batch.length}`);
      for (const msgRef of batch) {
        if (!msgRef.id) {
          ignoreMessage("missing_gmail_message_id", msgRef.id);
          continue;
        }

        try {
        const existing = await prisma.emailMessage.findUnique({
          where: {
            organizationId_gmailId: {
              organizationId,
              gmailId: msgRef.id,
            },
          },
        });
        const full = await withRetry(
          () => gmail.users.messages.get({
            userId: "me",
            id: msgRef.id!,
            format: "full",
          }),
          `[gmail-sync] Gmail message fetch retry message=${msgRef.id}`
        );

      const headers = full.data.payload?.headers ?? [];
      const subject =
        headers.find((h) => h.name === "Subject")?.value ?? "(ללא נושא)";
      const from =
        headers.find((h) => h.name === "From")?.value ?? "";
      const dateHeader =
        headers.find((h) => h.name === "Date")?.value ?? "";
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date();
      const bodyText = extractBody(full.data.payload as PayloadPart | undefined);
      const sender = parseSender(from);
      const source = /whatsapp|וואטסאפ/i.test(subject + from)
        ? "whatsapp_forward"
        : "gmail";

      const attachmentParts = collectAttachmentParts(full.data.payload as PayloadPart | undefined);
      logStep(`[gmail-sync] fetched message=${msgRef.id} sender="${from || "unknown"}" subject="${subject}" date="${receivedAt.toISOString()}" attachments=${attachmentParts.length ? attachmentParts.map((part) => `${part.filename || "unnamed"}:${part.mimeType || "unknown"}`).join(", ") : "none"} bodyLength=${bodyText.length}`);
      emailsParsed++;
      if (!bodyText.trim() && attachmentParts.length === 0) {
        parserRejectedCount++;
        ignoredReasons.empty_body_and_no_attachments = (ignoredReasons.empty_body_and_no_attachments ?? 0) + 1;
        logStep(`[gmail-sync] parser decision message=${msgRef.id} rejected=true reason="empty_body_and_no_attachments"`);
      } else {
        logStep(`[gmail-sync] parser decision message=${msgRef.id} rejected=false reason="body_or_attachment_present"`);
      }

        const emailRecord = await prisma.emailMessage.upsert({
          where: {
            organizationId_gmailId: { organizationId, gmailId: msgRef.id },
          },
          create: {
            organizationId,
            gmailId: msgRef.id,
            threadId: full.data.threadId ?? undefined,
            subject,
            fromAddress: from,
            snippet: full.data.snippet ?? undefined,
            bodyText,
            receivedAt,
            source,
          },
          update: {
            bodyText,
            snippet: full.data.snippet ?? undefined,
            fromAddress: from,
            receivedAt,
          },
        });
        logStep(`[gmail-sync] DB upsert EmailMessage success message=${msgRef.id} id=${emailRecord.id}`);
        dbEmailMessageUpserts++;

      await analyzeAndSaveMessage({
        organizationId,
        channel: "gmail",
        externalId: msgRef.id,
        emailMessageId: emailRecord.id,
        from,
        senderName: sender.name,
        senderEmail: sender.email ?? "",
        senderPhone: extractPhoneFromText(bodyText),
        subject,
        bodyText,
        occurredAt: receivedAt,
        createLead: true,
      }).catch((err) => {
        console.warn("[gmail-sync] message intelligence scan failed", err instanceof Error ? err.message : String(err));
      });

        scannedEmails.push({
          gmailId: msgRef.id,
          emailRecordId: emailRecord.id,
          subject,
          from,
          senderEmail: sender.email,
          senderName: sender.name,
          domain: sender.domain ?? "",
          bodyText,
          receivedAt,
          source,
          parts: attachmentParts,
          fullPayload: full.data.payload as PayloadPart | undefined,
          alreadyProcessed: Boolean(existing?.processedAt),
        });
        emailsProcessed++;
        } catch (err) {
          errorsCount++;
          console.error(`[gmail-sync] fetch/parse/save failed message=${msgRef.id}`, err);
          logStep(`[gmail-sync] error message=${msgRef.id} stage=fetch_parse_save reason="${err instanceof Error ? err.message : String(err)}"`);
          try {
            await saveFetchErrorScanItem(organizationId, msgRef.id, `fetch_parse_save_failed: ${err instanceof Error ? err.message : String(err)}`);
          } catch (fallbackErr) {
            console.error(`[gmail-sync] fetch-error GmailScanItem save failed message=${msgRef.id}`, fallbackErr);
            logStep(`[gmail-sync] error message=${msgRef.id} stage=fetch_error_scan_item_save reason="${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}"`);
          }
        }
      }
      await maybeSaveScanProgress();
    }
    await maybeSaveScanProgress(true);

    const senderCounts = new Map<string, { count: number; email: string; name: string; firstSeen: Date; lastSeen: Date }>();
    for (const email of scannedEmails) {
      const current = senderCounts.get(email.domain);
      if (!current) {
        senderCounts.set(email.domain, {
          count: 1,
          email: email.senderEmail,
          name: email.senderName || email.domain,
          firstSeen: email.receivedAt,
          lastSeen: email.receivedAt,
        });
      } else {
        current.count++;
        if (email.receivedAt < current.firstSeen) current.firstSeen = email.receivedAt;
        if (email.receivedAt > current.lastSeen) current.lastSeen = email.receivedAt;
      }
    }
    uniqueSenders = senderCounts.size;
    logStep(`Found ${uniqueSenders} unique senders`);
    const clientIdByDomain = new Map<string, string>();
    for (const [domain, sender] of senderCounts) {
      if (sender.count < 2) {
        logStep(`[gmail-sync] client candidate skipped domain="${domain || "unknown"}" email="${sender.email || "unknown"}" reason="single_message_sender" count=${sender.count}`);
        continue;
      }
      potentialClients++;
      const saved = await upsertPotentialClient({
        organizationId,
        name: sender.name,
        email: sender.email,
        domain,
        firstSeen: sender.firstSeen,
        lastSeen: sender.lastSeen,
      });
      clientIdByDomain.set(domain, saved.id);
      if (saved.created) clientsCreated++;
      logStep(`[gmail-sync] DB upsert Client success domain="${domain}" id=${saved.id} created=${saved.created}`);
    }
    logStep(`Found ${potentialClients} potential clients`);

    let processBatchNumber = 0;
    for (const batch of chunkArray(scannedEmails, GMAIL_SCAN_BATCH_SIZE)) {
      processBatchNumber++;
      logStep(`[gmail-sync] process batch ${processBatchNumber}/${Math.ceil(scannedEmails.length / GMAIL_SCAN_BATCH_SIZE)} size=${batch.length}`);
      for (const email of batch) {
        let scanItemPersisted = false;
        let currentDuplicateKey: string | null = null;
        try {
      let clientId = clientIdByDomain.get(email.domain);
      if (clientId) {
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { clientId },
        });
      }

      if (email.alreadyProcessed && !options.forceReprocess) {
        logStep(`[gmail-sync] message=${email.gmailId} already processed; still tracing parser/persistence before duplicate handling`);
      }

      const pdfText = await extractPdfTextFromParts(gmail, email.gmailId, email.parts);
      const visualAttachmentText = await extractVisualAttachmentHints(gmail, email.gmailId, email.parts, email.from);
      const bodyForAnalysis = [email.bodyText, pdfText && `--- PDF ATTACHMENT TEXT ---\n${pdfText}`, visualAttachmentText && `--- VISUAL ATTACHMENT ANALYSIS ---\n${visualAttachmentText}`].filter(Boolean).join("\n\n");
      logStep(`[gmail-sync] parsed message=${email.gmailId} bodyLength=${email.bodyText.length} pdfTextLength=${pdfText.length} visualTextLength=${visualAttachmentText.length}`);
      const analysis = await analyzeEmailContent({
        subject: email.subject,
        body: bodyForAnalysis,
        filenames: email.parts.map((p) => p.filename).filter(Boolean) as string[],
        sender: email.from,
      });
      logStep(`[gmail-sync] ai message=${email.gmailId} supplier="${analysis.supplier}" amount=${analysis.amount ?? "unknown"} documentType=${analysis.documentType} paymentRequired=${analysis.paymentRequired} confidence=${analysis.confidence}`);
      const invoiceMatch = detectInvoice(email.subject, bodyForAnalysis, email.parts);
      if (invoiceMatch.isInvoice) invoiceDetectionPositive++;
      else invoiceDetectionNegative++;
      const amount = normalizeDetectedAmount(invoiceMatch.amount ?? analysis.amount);
      logStep(`[gmail-sync] invoice detection message=${email.gmailId} isInvoice=${invoiceMatch.isInvoice} detectedAmount=${invoiceMatch.amount ?? "none"} aiAmount=${analysis.amount ?? "none"} finalAmount=${amount ?? "none"}`);
      const attachmentFilename = primaryAttachmentFilename(email.parts);
      const supplierName = normalizeSupplierName(analysis.supplier || email.senderName || email.domain || "Unknown supplier");
      const classification = classifyGmailScanCandidate({
        subject: email.subject,
        bodyText: bodyForAnalysis,
        attachmentFilenames: email.parts.map((part) => part.filename).filter(Boolean) as string[],
        analysis,
        amount,
        supplierName,
        senderEmail: email.senderEmail,
        senderDomain: email.domain,
      });
      const duplicateKey = buildGmailScanDuplicateKey({
        gmailMessageId: email.gmailId,
        attachmentFilename,
        supplierName,
        amount,
      });
      currentDuplicateKey = duplicateKey;
      const existingScanItem = await prisma.gmailScanItem.findUnique({
        where: { organizationId_duplicateKey: { organizationId, duplicateKey } },
      });
      if (existingScanItem) {
        duplicatesSkipped++;
        logStep(`[gmail-sync] decision duplicate message=${email.gmailId} type=${existingScanItem.documentType} supplier="${existingScanItem.supplierName}" amount=${existingScanItem.amount ?? "unknown"}`);
      }
      logStep(`[gmail-sync] decision message=${email.gmailId} type=${classification.documentType} confidence=${classification.confidenceScore} review=${classification.reviewStatus} reason="${classification.decisionReason}"`);

      if (classification.isRelevant) relevantEmailsFound++;
      if (classification.documentType === "invoice") invoiceEmails++;
      if (classification.documentType === "receipt") receiptsFound++;
      if (classification.documentType === "payment_request") paymentRequestsFound++;
      if (classification.documentType === "supplier_message") supplierMessagesFound++;
      if (classification.reviewStatus === "needs_review") needsReviewCount++;
      if (invoiceMatch.amount !== null) invoiceAmountsExtracted++;
      if (!clientId && classification.isRelevant && email.domain) {
        const saved = await upsertPotentialClient({
          organizationId,
          name: normalizeSupplierName(email.senderName || email.domain),
          email: email.senderEmail,
          domain: email.domain,
          firstSeen: email.receivedAt,
          lastSeen: email.receivedAt,
        });
        clientId = saved.id;
        clientIdByDomain.set(email.domain, saved.id);
        if (saved.created) clientsCreated++;
        const leadSaved = await upsertGmailLead({
          organizationId,
          name: normalizeSupplierName(email.senderName || supplierName || email.domain),
          company: supplierName || email.domain,
          email: email.senderEmail,
          phone: extractPhoneFromText(bodyForAnalysis),
          notes: `${email.subject}\n\n${bodyForAnalysis}`.slice(0, 1200),
        });
        logStep(`[gmail-sync] DB upsert Lead success message=${email.gmailId} id=${leadSaved.id} created=${leadSaved.created}`);
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { clientId },
        });
        logStep(`[gmail-sync] client/lead message=${email.gmailId} clientId=${clientId} clientCreated=${saved.created}`);
      }
      const driveLinks: { type: string; link: string }[] = [];

      for (const part of email.parts) {
        const attachmentId = part.body?.attachmentId;
        if (!part.filename || !attachmentId) {
          driveUploadsSkipped++;
          logStep(`[gmail-sync] Drive upload skipped message=${email.gmailId} file="${part.filename || "unnamed"}" reason="missing_filename_or_attachment_id"`);
          continue;
        }
        const filename = part.filename;

        const existingAttachment = await prisma.emailAttachment.findFirst({
          where: {
            emailMessageId: email.emailRecordId,
            gmailAttachmentId: attachmentId,
          },
        });
        if (existingAttachment?.driveLink) {
          driveLinks.push({ type: folderForDocumentType(classification.documentType), link: existingAttachment.driveLink });
          driveUploadsSkipped++;
          logStep(`[gmail-sync] Drive upload skipped message=${email.gmailId} file="${filename}" reason="existing_drive_link" link=${existingAttachment.driveLink}`);
          continue;
        }

        const folderType = folderForDocumentType(classification.documentType);
        try {
          driveUploadsAttempted++;
          logStep(`[gmail-sync] Drive upload attempt message=${email.gmailId} file="${filename}" folder=${folderType}`);
          if (!rootId) {
            throw new Error("Drive root unavailable");
          }

          const att = await withRetry(
            () => gmail.users.messages.attachments.get({
              userId: "me",
              messageId: email.gmailId,
              id: attachmentId,
            }),
            `[gmail-sync] Gmail attachment fetch retry message=${email.gmailId} file="${filename}"`
          );
          const buffer = decodeGmailAttachment(att.data.data ?? "");
          const upload = await withRetry(
            () => uploadInvoiceAttachmentToDrive({
              drive,
              rootFolderId: rootId,
              supplier: supplierName,
              documentType: classification.documentType,
              filename,
              mimeType: part.mimeType,
              receivedAt: email.receivedAt,
              buffer,
            }),
            `[gmail-sync] Drive upload retry message=${email.gmailId} file="${filename}"`
          );
          const link = upload.webViewLink;
          driveLinks.push({ type: folderType, link });
          driveUploadsSucceeded++;
          logStep(`[gmail-sync] Drive upload success message=${email.gmailId} file="${filename}" link=${link ?? "none"}`);
          if (existingAttachment) {
            await prisma.emailAttachment.update({
              where: { id: existingAttachment.id },
              data: { driveFileId: upload.fileId ?? undefined, driveLink: link },
            });
          } else {
            await prisma.emailAttachment.create({
              data: {
                emailMessageId: email.emailRecordId,
                filename,
                mimeType: part.mimeType ?? undefined,
                gmailAttachmentId: attachmentId,
                driveFileId: upload.fileId ?? undefined,
                driveLink: link,
              },
            });
          }
        } catch (err) {
          driveUploadFailed = true;
          driveUploadsFailed++;
          errorsCount++;
          console.error("Drive upload failed; continuing Gmail sync without attachment upload", err);
          logStep(`[gmail-sync] Drive upload failed message=${email.gmailId} file="${filename}" reason="${err instanceof Error ? err.message : String(err)}"`);
          if (!existingAttachment) {
            await prisma.emailAttachment.create({
              data: {
                emailMessageId: email.emailRecordId,
                filename,
                mimeType: part.mimeType ?? undefined,
                gmailAttachmentId: attachmentId,
              },
            });
          }
        }
      }

      logStep(`[gmail-sync] DB GmailScanItem upsert attempt message=${email.gmailId} duplicateKey=${duplicateKey} type=${classification.documentType}`);
      const savedScanItem = await prisma.gmailScanItem.upsert({
        where: { organizationId_duplicateKey: { organizationId, duplicateKey } },
        create: {
          organizationId,
          emailMessageId: email.emailRecordId,
          gmailMessageId: email.gmailId,
          gmailMessageLink: gmailMessageLink(email.gmailId),
          sender: email.from || "unknown",
          senderEmail: email.senderEmail || null,
          subject: email.subject,
          occurredAt: email.receivedAt,
          amount,
          supplierName,
          documentType: classification.documentType,
          attachmentFilename,
          driveFileLink: driveLinks[0]?.link ?? null,
          confidenceScore: classification.confidenceScore,
          reviewStatus: classification.reviewStatus,
          duplicateKey,
          decisionReason: classification.decisionReason,
          rawAnalysis: {
            analysis,
            relevant: classification.isRelevant,
            hasAttachment: email.parts.length > 0,
            filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
          },
        },
        update: {
          emailMessageId: email.emailRecordId,
          gmailMessageLink: gmailMessageLink(email.gmailId),
          sender: email.from || "unknown",
          senderEmail: email.senderEmail || null,
          subject: email.subject,
          occurredAt: email.receivedAt,
          amount,
          supplierName,
          documentType: classification.documentType,
          attachmentFilename,
          driveFileLink: driveLinks[0]?.link ?? existingScanItem?.driveFileLink ?? null,
          confidenceScore: classification.confidenceScore,
          reviewStatus: classification.reviewStatus,
          decisionReason: classification.decisionReason,
          rawAnalysis: {
            analysis,
            relevant: classification.isRelevant,
            hasAttachment: email.parts.length > 0,
            filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
          },
        },
      });
      scanItemPersisted = true;
      emailsSavedToGmailScanItem++;
      dbGmailScanItemUpserts++;
      logStep(`[gmail-sync] saved GmailScanItem message=${email.gmailId} id=${savedScanItem.id} type=${savedScanItem.documentType} review=${savedScanItem.reviewStatus} relevant=${classification.isRelevant}`);

      if (existingScanItem && !options.forceReprocess) {
        logStep(`[gmail-sync] duplicate GmailScanItem message=${email.gmailId}; continuing idempotent invoice/payment persistence`);
      }

      for (const taskTitle of analysis.tasks) {
        const existingTask = await prisma.task.findFirst({
          where: {
            organizationId,
            emailMessageId: email.emailRecordId,
            title: taskTitle,
          },
        });
        if (existingTask) continue;

        await prisma.task.create({
          data: {
            organizationId,
            title: taskTitle,
            supplier: supplierName,
            priority: analysis.confidence < 0.7 ? "high" : "medium",
            source: email.source,
            emailMessageId: email.emailRecordId,
          },
        });
        tasksCreated++;
      }

      if (isInvoiceRecordDocument(classification.documentType)) {
        if (!clientId) {
          const saved = await ensureInvoiceClient({
            organizationId,
            supplierName,
            senderEmail: email.senderEmail,
            domain: email.domain,
            receivedAt: email.receivedAt,
          });
          clientId = saved.id;
          if (email.domain) clientIdByDomain.set(email.domain, saved.id);
          if (saved.created) clientsCreated++;
          await prisma.emailMessage.update({
            where: { id: email.emailRecordId },
            data: { clientId },
          });
          logStep(`[gmail-sync] invoice client created message=${email.gmailId} clientId=${clientId} supplier="${supplierName}"`);
        }
        logStep(`[gmail-sync] invoice detected message=${email.gmailId} type=${classification.documentType} clientId=${clientId ?? "none"} amount=${amount ?? "missing"} drive=${driveLinks[0]?.link ? "yes" : "no"}`);
      }

      if (clientId && isInvoiceRecordDocument(classification.documentType)) {
        const invoiceAmount = amount ?? 0;
        const invoiceNumber = analysis.invoiceNumber ?? extractInvoiceNumber([email.subject, bodyForAnalysis, attachmentFilename ?? ""].join("\n"));
        const invoiceDate = normalizeBusinessDate(analysis.invoiceDate, email.receivedAt) ?? email.receivedAt;
        if (amount == null) {
          logStep(`[gmail-sync] invoice amount missing message=${email.gmailId}; saving Invoice with amount=0 for review`);
        }
        logStep(`[gmail-sync] DB Invoice insert attempt message=${email.gmailId} clientId=${clientId} supplier="${supplierName}" amount=${invoiceAmount} invoiceNumber=${invoiceNumber ?? "none"} date=${invoiceDate.toISOString()} type=${classification.documentType}`);
        try {
          const createdInvoice = await saveDetectedInvoice({
            organizationId,
            clientId,
            amount: invoiceAmount,
            currency: analysis.currency,
            date: invoiceDate,
            dueDate: normalizeBusinessDate(analysis.dueDate, null),
            invoiceNumber,
            supplierName,
            documentType: classification.documentType,
            fromEmail: email.senderEmail,
            subject: email.subject,
            emailMessageId: email.emailRecordId,
            gmailMessageId: email.gmailId,
            driveUrl: driveLinks[0]?.link ?? null,
          });
          if (createdInvoice) {
            invoicesCreated++;
            logStep(`[gmail-sync] invoice save success message=${email.gmailId} invoiceId=${createdInvoice.id} amount=${invoiceAmount} supplier="${supplierName}" drive=${driveLinks[0]?.link ?? "none"}`);
          } else {
            duplicatesSkipped++;
            logStep(`[gmail-sync] duplicate invoice ignored message=${email.gmailId} supplier="${supplierName}" invoiceNumber=${invoiceNumber ?? "none"} amount=${invoiceAmount} date=${invoiceDate.toISOString()}`);
          }
        } catch (err) {
          errorsCount++;
          logStep(`[gmail-sync] invoice save failed message=${email.gmailId} supplier="${supplierName}" reason="${err instanceof Error ? err.message : String(err)}"`);
          throw err;
        }
      } else {
        const reasons = [
          isInvoiceRecordDocument(classification.documentType) && !clientId && "no_client_id",
          !isInvoiceRecordDocument(classification.documentType) && `document_type_${classification.documentType}`,
        ].filter(Boolean);
        logStep(`[gmail-sync] invoice rejected message=${email.gmailId} reason="${reasons.join(",") || "unknown"}"`);
      }

      if (classification.reviewStatus === "auto_saved" && classification.isRelevant && (amount != null || analysis.documentType !== "other" || classification.documentType !== "supplier_message")) {
        const dateIso = email.receivedAt.toISOString();
        const duplicateHash = duplicateKey || buildDuplicateHash({
          organizationId,
          supplier: supplierName,
          amount: amount ?? 0,
          dateIso,
          subject: email.subject,
        });

        const existingPayment = await findExistingSupplierPayment({
          organizationId,
          duplicateHash,
          emailMessageId: email.emailRecordId,
          supplier: supplierName,
          amount,
          date: email.receivedAt,
        });

        const documentLink =
          classification.documentType === "payment_request"
            ? driveLinks[0]?.link
            : existingPayment?.documentLink;
        const invoiceLink =
          classification.documentType === "invoice" || classification.documentType === "receipt"
            ? driveLinks[0]?.link
            : existingPayment?.invoiceLink;

        const missingInvoice =
          Boolean(analysis.paymentRequired || classification.documentType === "payment_request") &&
          !invoiceLink &&
          Boolean(documentLink || analysis.paymentRequired);

        if (existingPayment) {
          duplicatesSkipped++;
          logStep(`[gmail-sync] DB SupplierPayment update attempt message=${email.gmailId} id=${existingPayment.id}`);
          await prisma.supplierPayment.update({
            where: { id: existingPayment.id },
            data: {
              documentLink: documentLink ?? existingPayment.documentLink,
              invoiceLink: invoiceLink ?? existingPayment.invoiceLink,
              missingInvoice,
              amount: amount ?? existingPayment.amount,
              dueDate: normalizeBusinessDate(analysis.dueDate, existingPayment.dueDate),
              emailSender: email.from,
            },
          });
          await appendSupplierPaymentToSheet({
            organizationId,
            paymentId: existingPayment.id,
            supplier: supplierName,
            amount: amount ?? existingPayment.amount,
            date: email.receivedAt,
            dueDate: normalizeBusinessDate(analysis.dueDate, existingPayment.dueDate),
            paid: existingPayment.paid,
            missingInvoice,
            documentLink,
            invoiceLink,
            gmailLink: gmailMessageLink(email.gmailId),
          }).then((sheet) => {
            sheetsUpdated++;
            logStep(`[gmail-sync] Sheets append success message=${email.gmailId} paymentId=${existingPayment.id} spreadsheet=${sheet.spreadsheetId}`);
          }).catch((err) => {
            console.error(`[gmail-sync] Sheets append failed message=${email.gmailId} paymentId=${existingPayment.id}`, err);
            logStep(`[gmail-sync] Sheets append failed message=${email.gmailId} reason="${err instanceof Error ? err.message : String(err)}"`);
          });
          if (missingInvoice) {
            await createMissingInvoiceTaskOnce({
              organizationId,
              supplierName,
              subject: email.subject,
              amount,
              emailMessageId: email.emailRecordId,
              gmailMessageId: email.gmailId,
            });
          } else if (invoiceLink) {
            await closeMissingInvoiceTask(organizationId, email.emailRecordId);
          }
          logStep(`[gmail-sync] updated SupplierPayment message=${email.gmailId} id=${existingPayment.id}`);
        } else {
          const dueDate = normalizeBusinessDate(analysis.dueDate, null);
          logStep(`[gmail-sync] DB SupplierPayment insert attempt message=${email.gmailId} amount=${amount ?? 0} supplier="${supplierName}"`);
          const payment = await prisma.supplierPayment.create({
            data: {
              organizationId,
              supplier: supplierName,
              amount: amount ?? 0,
              currency: analysis.currency,
              date: email.receivedAt,
              dueDate,
              paid: false,
              documentLink,
              invoiceLink,
              emailSender: email.from,
              paymentRequired: analysis.paymentRequired,
              missingInvoice,
              duplicateHash,
              subject: email.subject,
              source: email.source,
              emailMessageId: email.emailRecordId,
            },
          });
          paymentsCreated++;
          await appendSupplierPaymentToSheet({
            organizationId,
            paymentId: payment.id,
            supplier: supplierName,
            amount: amount ?? 0,
            date: email.receivedAt,
            dueDate,
            paid: false,
            missingInvoice,
            documentLink,
            invoiceLink,
            gmailLink: gmailMessageLink(email.gmailId),
          }).then((sheet) => {
            sheetsUpdated++;
            logStep(`[gmail-sync] Sheets append success message=${email.gmailId} paymentId=${payment.id} spreadsheet=${sheet.spreadsheetId}`);
          }).catch((err) => {
            console.error(`[gmail-sync] Sheets append failed message=${email.gmailId} paymentId=${payment.id}`, err);
            logStep(`[gmail-sync] Sheets append failed message=${email.gmailId} reason="${err instanceof Error ? err.message : String(err)}"`);
          });
          logStep(`[gmail-sync] saved SupplierPayment message=${email.gmailId} id=${payment.id} amount=${amount ?? 0} supplier="${supplierName}"`);

          if (classification.documentType === "invoice" || missingInvoice) {
            await createPaymentAlertOnce({
              organizationId,
              type: missingInvoice ? "missing_invoice" : "new_invoice",
              supplierName,
              subject: email.subject,
              amount,
              gmailMessageId: email.gmailId,
            });
            if (missingInvoice) {
              await createMissingInvoiceTaskOnce({
                organizationId,
                supplierName,
                subject: email.subject,
                amount,
                emailMessageId: email.emailRecordId,
                gmailMessageId: email.gmailId,
              });
            }
            if (!missingInvoice) {
              await notifyNewInvoice(organizationId, supplierName, amount);
            }
          }
        }
      } else {
        const reasons = [
          classification.heldForFinancialSender && "held_for_financial_sender",
          classification.reviewStatus !== "auto_saved" && "needs_review",
          !classification.isRelevant && "not_relevant",
          amount == null && analysis.documentType === "other" && classification.documentType === "supplier_message" && "supplier_message_without_amount_or_ai_document_type",
        ].filter(Boolean);
        logStep(`[gmail-sync] SupplierPayment save skipped message=${email.gmailId} reason="${reasons.join(",") || "unknown"}"`);
      }

      await prisma.emailMessage.update({
        where: { id: email.emailRecordId },
        data: { processedAt: new Date() },
      });
      logStep(`[gmail-sync] DB mark processed success message=${email.gmailId}`);
        } catch (err) {
          errorsCount++;
          console.error(`[gmail-sync] processing failed message=${email.gmailId}`, err);
          logStep(`[gmail-sync] error message=${email.gmailId} stage=process_save reason="${err instanceof Error ? err.message : String(err)}"`);
          if (!scanItemPersisted) {
            try {
              await saveRejectedScanItem(email, `process_save_failed: ${err instanceof Error ? err.message : String(err)}`);
            } catch (fallbackErr) {
              console.error(`[gmail-sync] fallback GmailScanItem save failed message=${email.gmailId}`, fallbackErr);
              logStep(`[gmail-sync] error message=${email.gmailId} stage=fallback_scan_item_save reason="${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}"`);
            }
          } else if (currentDuplicateKey) {
            try {
              await prisma.gmailScanItem.update({
                where: { organizationId_duplicateKey: { organizationId, duplicateKey: currentDuplicateKey } },
                data: {
                  reviewStatus: "needs_review",
                  decisionReason: `process_save_failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              });
            } catch (markErr) {
              console.error(`[gmail-sync] failed marking GmailScanItem error message=${email.gmailId}`, markErr);
              logStep(`[gmail-sync] error message=${email.gmailId} stage=mark_scan_item_error reason="${markErr instanceof Error ? markErr.message : String(markErr)}"`);
            }
          }
        }
      }
      await maybeSaveScanProgress();
    }
    const recordsSaved = paymentsCreated + invoicesCreated + tasksCreated + clientsCreated;
    logStep(`Found ${relevantEmailsFound} relevant emails (${invoiceEmails} invoices, ${receiptsFound} receipts, ${paymentRequestsFound} payment requests, ${supplierMessagesFound} supplier messages)`);
    logStep(`[gmail-sync] parser totals scanned=${messages.length} parsed=${emailsParsed} rejected=${parserRejectedCount} rejectedReasons=${JSON.stringify(ignoredReasons)}`);
    logStep(`[gmail-sync] invoice detection totals positive=${invoiceDetectionPositive} negative=${invoiceDetectionNegative} invoicesCreated=${invoicesCreated}`);
    logStep(`[gmail-sync] DB totals emailMessageUpserts=${dbEmailMessageUpserts} gmailScanItemUpserts=${dbGmailScanItemUpserts} clientsCreated=${clientsCreated} potentialClients=${potentialClients} paymentsCreated=${paymentsCreated} invoicesCreated=${invoicesCreated}`);
    logStep(`[gmail-sync] Drive totals attempted=${driveUploadsAttempted} succeeded=${driveUploadsSucceeded} skipped=${driveUploadsSkipped} failed=${driveUploadsFailed}`);
    logStep(`Saved ${emailsSavedToGmailScanItem}/${emailsProcessed} fetched emails to GmailScanItem`);
    logStep(`Ignored ${ignoredCount} emails with reasons: ${JSON.stringify(ignoredReasons)}`);
    logStep(`Marked ${needsReviewCount} emails as Needs Review, extracted ${invoiceAmountsExtracted} amounts`);
    logStep(`Saved ${recordsSaved} records (${clientsCreated} clients, ${invoicesCreated} invoices, ${paymentsCreated} payments, ${tasksCreated} tasks)`);
    logStep(`Skipped ${duplicatesSkipped} duplicates or already processed emails`);
    const { backfillInvoicesFromGmailScanItems } = await import("./invoiceBackfill.js");
    const invoiceBackfill = await backfillInvoicesFromGmailScanItems(organizationId, 200);
    if (invoiceBackfill.created || invoiceBackfill.errors.length) {
      logStep(`[gmail-sync] invoice backfill candidates=${invoiceBackfill.candidates} created=${invoiceBackfill.created} duplicates=${invoiceBackfill.duplicates} skipped=${invoiceBackfill.skipped} errors=${invoiceBackfill.errors.length}`);
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        emailsProcessed,
        emailsSaved: emailsSavedToGmailScanItem,
        invoicesFound: invoicesCreated + invoiceBackfill.created,
        paymentsCreated,
        tasksCreated,
        driveUploaded: driveUploadsSucceeded,
        sheetsUpdated,
        errorsCount,
        finishedAt: new Date(),
        status: "success",
      },
    });

    return {
      emailsProcessed,
      totalEmailsChecked: emailsProcessed,
      relevantEmailsFound,
      emailsFound: emailsProcessed,
      paymentsCreated,
      tasksCreated,
      clientsCreated,
      invoicesCreated,
      invoiceBackfillCreated: invoiceBackfill.created,
      receiptsFound,
      paymentRequestsFound,
      supplierMessagesFound,
      duplicatesSkipped,
      recordsSaved,
      needsReviewCount,
      errorsCount,
      emailsSavedToGmailScanItem,
      emailsParsed,
      parserRejectedCount,
      dbEmailMessageUpserts,
      dbGmailScanItemUpserts,
      driveUploadsAttempted,
      driveUploadsSucceeded,
      driveUploadsSkipped,
      driveUploadsFailed,
      sheetsUpdated,
      invoiceDetectionPositive,
      invoiceDetectionNegative,
      ignoredCount,
      ignoredReasons,
      uniqueSenders,
      potentialClients,
      invoiceEmails,
      invoiceAmountsExtracted,
      driveUploadFailed,
      scanSteps,
      message: driveUploadFailed ? DRIVE_FULL_MESSAGE : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "error", errorMessage: message, errorsCount: Math.max(errorsCount, 1), finishedAt: new Date() },
    });
    throw err;
  }
}

type PayloadPart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { attachmentId?: string | null; data?: string | null } | null;
  parts?: PayloadPart[] | null;
};

type GmailClient = Awaited<ReturnType<typeof getGoogleClients>>["gmail"];
type GmailMessageRef = { id?: string | null; threadId?: string | null };
type GmailDocumentType = "invoice" | "receipt" | "payment_request" | "supplier_message" | "unknown_needs_review";
type GmailConfidenceScore = "high" | "medium" | "low";
type ScannedEmail = {
  gmailId: string;
  emailRecordId: string;
  subject: string;
  from: string;
  senderEmail: string;
  senderName: string;
  domain: string;
  bodyText: string;
  receivedAt: Date;
  source: string;
  parts: PayloadPart[];
  fullPayload?: PayloadPart;
  alreadyProcessed: boolean;
};

export type GmailScanClassification = {
  documentType: GmailDocumentType;
  confidenceScore: GmailConfidenceScore;
  reviewStatus: "auto_saved" | "needs_review";
  isRelevant: boolean;
  decisionReason: string;
  heldForFinancialSender: boolean;
};

export function classifyGmailScanCandidate(input: {
  subject: string;
  bodyText: string;
  attachmentFilenames: string[];
  analysis: Pick<EmailAnalysis, "documentType" | "confidence" | "paymentRequired">;
  amount: number | null;
  supplierName: string;
  senderEmail?: string;
  senderDomain?: string;
}): GmailScanClassification {
  const text = `${input.subject}\n${input.bodyText}\n${input.attachmentFilenames.join("\n")}`.toLowerCase();
  const hasAttachment = input.attachmentFilenames.length > 0;
  const hasPdf = input.attachmentFilenames.some((filename) => /\.pdf$/i.test(filename));
  const hasInvoice = INVOICE_KEYWORD_PATTERNS.some((pattern) => pattern.test(text)) || /green invoice|greeninvoice|icount|i-count|חשבונית ירוקה/.test(text);
  const hasReceipt = RECEIPT_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasPaymentRequest = PAYMENT_REQUEST_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasSupplierSignal = SUPPLIER_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasAmount = input.amount !== null;
  const aiType = input.analysis.documentType;

  let documentType: GmailDocumentType = "unknown_needs_review";
  if (hasReceipt || aiType === "receipt") documentType = "receipt";
  else if (aiType === "invoice" || hasInvoice || (hasPdf && hasAmount)) documentType = "invoice";
  else if (aiType === "payment_request" || input.analysis.paymentRequired || hasPaymentRequest) documentType = "payment_request";
  else if (hasSupplierSignal || hasAttachment || hasAmount) documentType = "supplier_message";

  const isRelevant = documentType !== "unknown_needs_review" || hasSupplierSignal || hasAmount || hasAttachment;
  const evidence = [
    hasPdf && "pdf attachment",
    hasAttachment && !hasPdf && "attachment",
    hasAmount && "amount detected",
    hasInvoice && "invoice keyword",
    hasReceipt && "receipt keyword",
    hasPaymentRequest && "payment keyword",
    hasSupplierSignal && "supplier-like keyword",
    aiType !== "other" && `ai:${aiType}`,
  ].filter(Boolean) as string[];

  const confidenceScore = confidenceBucket(input.analysis.confidence, evidence.length, documentType);
  const heldForFinancialSender = isFinancialSender(input.senderEmail, input.senderDomain);
  const autoSaveHoldReasons = [
    !(documentType === "invoice" || documentType === "payment_request") && `documentType is ${documentType}`,
    confidenceScore !== "high" && `confidence is ${confidenceScore}`,
    !hasAmount && "no valid amount",
  ].filter(Boolean) as string[];
  const canAutoSave = autoSaveHoldReasons.length === 0;
  const reviewStatus = heldForFinancialSender
    ? "needs_review"
    : canAutoSave
      ? "auto_saved"
      : "needs_review";
  const decisionReason = heldForFinancialSender
    ? "Held for review: sender is a financial institution (bank)"
    : canAutoSave
      ? `Auto-saved: ${documentType} with high confidence and valid amount`
      : `Held for review: ${autoSaveHoldReasons.join(" / ")}`;

  return {
    documentType,
    confidenceScore,
    reviewStatus,
    isRelevant,
    decisionReason,
    heldForFinancialSender,
  };
}

function isFinancialSender(senderEmail?: string, senderDomain?: string) {
  const values = [senderEmail, senderDomain]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return values.some((value) => {
    const domain = value.match(/@([^>\s]+)/)?.[1] ?? value;
    return FINANCIAL_SENDER_DOMAINS.some((financialDomain) => domain.includes(financialDomain));
  });
}

export function buildGmailScanDuplicateKey(input: {
  gmailMessageId: string;
  attachmentFilename?: string | null;
  supplierName: string;
  amount: number | null;
}) {
  const normalized = [
    input.gmailMessageId,
    (input.attachmentFilename ?? "no-attachment").trim().toLowerCase(),
    canonicalSupplierKey(input.supplierName),
    input.amount === null ? "unknown-amount" : input.amount.toFixed(2),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 40);
}

function confidenceBucket(confidence: number, evidenceCount: number, documentType: GmailDocumentType): GmailConfidenceScore {
  if (documentType === "unknown_needs_review") return "low";
  if (confidence >= 0.78 && evidenceCount >= 2) return "high";
  if (confidence >= 0.5 || evidenceCount >= 2) return "medium";
  return "low";
}

function primaryAttachmentFilename(parts: PayloadPart[]) {
  return parts.find((part) => part.filename)?.filename ?? null;
}

function gmailMessageLink(gmailMessageId: string) {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(gmailMessageId)}`;
}

function isInvoiceRecordDocument(documentType: GmailDocumentType) {
  return documentType === "invoice" || documentType === "receipt";
}

function extractInvoiceNumber(text: string) {
  const patterns = [
    /(?:invoice|receipt|חשבונית|קבלה|מספר)\s*(?:no\.?|number|#|מס׳|מספר)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
    /(?:inv|rcpt)[-_]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/[.,;:]+$/, "").slice(0, 80);
  }
  return null;
}

async function listCandidateMessages(gmail: GmailClient, daysBack: number, maxMessages = MAX_MESSAGES_PER_SYNC, since?: Date): Promise<GmailMessageRef[]> {
  const byId = new Map<string, GmailMessageRef>();
  const safeDaysBack = Math.max(1, Math.ceil(daysBack));
  const dateFilter = since
    ? `after:${formatGmailSearchDate(since)}`
    : `newer_than:${safeDaysBack}d`;
  const keywordOr = "{invoice receipt payment \"payment request\" חשבונית קבלה תשלום \"דרישת תשלום\"}";
  let totalPagesScanned = 0;
  let totalMessagesSeen = 0;
  const queries = [
    `${dateFilter} has:attachment ${keywordOr} ${GMAIL_EXCLUDE_QUERY}`,
    `${dateFilter} ${keywordOr} ${GMAIL_EXCLUDE_QUERY}`,
    `${dateFilter} {${SUPPLIER_KEYWORDS.map((keyword) => keyword.includes(" ") ? `"${keyword}"` : keyword).join(" ")}} ${GMAIL_EXCLUDE_QUERY}`,
  ];

  for (const q of queries) {
    console.log(`[gmail-sync] Searching Gmail query="${q}" maxMessages=${maxMessages}`);
    let pageToken: string | undefined;
    let queryPages = 0;
    let queryMessagesSeen = 0;
    do {
      const remaining = maxMessages - byId.size;
      if (remaining <= 0) break;
      queryPages++;
      totalPagesScanned++;
      const result = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: Math.min(100, remaining),
        pageToken,
      });

      const pageMessages = result.data.messages ?? [];
      queryMessagesSeen += pageMessages.length;
      totalMessagesSeen += pageMessages.length;
      console.log(`[gmail-sync] Gmail page query="${q}" page=${queryPages} messages=${pageMessages.length} uniqueSoFar=${byId.size} nextPage=${Boolean(result.data.nextPageToken)}`);
      for (const message of pageMessages) {
        if (message.id && !byId.has(message.id)) {
          byId.set(message.id, message);
        }
      }
      pageToken = result.data.nextPageToken ?? undefined;
    } while (pageToken && byId.size < maxMessages);
    console.log(`[gmail-sync] Gmail query complete pages=${queryPages} messagesSeen=${queryMessagesSeen} uniqueTotal=${byId.size}`);
  }

  console.log(`[gmail-sync] Gmail list returned ${byId.size} candidate messages pagesScanned=${totalPagesScanned} messagesSeen=${totalMessagesSeen} maxMessages=${maxMessages}`);
  return [...byId.values()].slice(0, maxMessages);
}

function formatGmailSearchDate(date: Date) {
  const safeDate = new Date(date.getTime() - 60 * 60 * 1000);
  const yyyy = safeDate.getUTCFullYear();
  const mm = String(safeDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(safeDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isRetryableError(err)) break;
      console.warn(`${label} attempt=${attempt} reason="${err instanceof Error ? err.message : String(err)}"`);
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function isRetryableError(err: unknown) {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const status = typeof err === "object" && err !== null && "code" in err ? Number((err as { code?: unknown }).code) : 0;
  return status === 429 || status >= 500 || message.includes("timeout") || message.includes("rate") || message.includes("temporarily") || message.includes("socket");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function saveScanProgress(logId: string, data: {
  emailsProcessed: number;
  emailsSaved?: number;
  invoicesFound?: number;
  paymentsCreated: number;
  tasksCreated: number;
  driveUploaded?: number;
  sheetsUpdated?: number;
  errorsCount?: number;
}) {
  await prisma.syncLog.update({
    where: { id: logId },
    data,
  });
}

function collectAttachmentParts(payload?: PayloadPart): PayloadPart[] {
  const out: PayloadPart[] = [];
  if (!payload) return out;
  if (payload.filename && payload.body?.attachmentId) out.push(payload);
  for (const p of payload.parts ?? []) out.push(...collectAttachmentParts(p));
  return out;
}

function extractBody(payload?: PayloadPart): string {
  if (!payload) return "";
  const chunks: string[] = [];
  collectBodyText(payload, chunks);
  return chunks.join("\n").trim();
}

function collectBodyText(payload: PayloadPart, chunks: string[]) {
  if (payload.body?.data && (payload.mimeType === "text/plain" || payload.mimeType === "text/html" || !payload.parts?.length)) {
    const decoded = decodeGmailAttachment(payload.body.data).toString("utf8");
    chunks.push(payload.mimeType === "text/html" ? stripHtml(decoded) : decoded);
  }
  for (const p of payload.parts ?? []) collectBodyText(p, chunks);
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

function decodeGmailAttachment(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function extractPdfTextFromParts(gmail: GmailClient, messageId: string, parts: PayloadPart[]) {
  const pdfParts = parts.filter((part) => part.body?.attachmentId && (part.mimeType === "application/pdf" || /\.pdf$/i.test(part.filename ?? "")));
  const texts: string[] = [];
  for (const part of pdfParts) {
    let parser: { getText(): Promise<{ text?: string }>; destroy(): Promise<void> } | null = null;
    try {
      const attachment = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.body!.attachmentId!,
      });
      const { PDFParse } = await import("pdf-parse");
      parser = new PDFParse({ data: new Uint8Array(decodeGmailAttachment(attachment.data.data ?? "")) });
      const parsed = await parser.getText();
      if (parsed.text?.trim()) texts.push(parsed.text.trim());
    } catch (err) {
      console.warn("[gmail-sync] PDF text extraction failed", err instanceof Error ? err.message : String(err));
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
  }
  return texts.join("\n\n");
}

async function extractVisualAttachmentHints(gmail: GmailClient, messageId: string, parts: PayloadPart[], sender: string) {
  const visualParts = parts.filter((part) =>
    part.body?.attachmentId &&
    (part.mimeType?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(part.filename ?? ""))
  );
  const hints: string[] = [];
  for (const part of visualParts) {
    try {
      const attachment = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.body!.attachmentId!,
      });
      const { analyzeInvoiceFile } = await import("./claude.js");
      const result = await analyzeInvoiceFile({
        fileBase64: attachment.data.data ?? "",
        mimeType: part.mimeType || "image/jpeg",
        filename: part.filename ?? undefined,
      });
      hints.push(`filename=${part.filename ?? "image"} supplier=${result.supplier} amount=${result.amount ?? "unknown"} date=${result.date ?? "unknown"} invoiceNumber=${result.invoiceNumber ?? "unknown"} currency=${result.currency}`);
    } catch (err) {
      console.warn(`[gmail-sync] Image OCR/vision failed message=${messageId} sender="${sender}" file="${part.filename ?? "image"}"`, err instanceof Error ? err.message : String(err));
    }
  }
  return hints.join("\n");
}

function parseSender(from: string) {
  const email = (from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const name = normalizeSupplierName(from
    .replace(/<[^>]+>/g, "")
    .replace(/["']/g, "")
    .trim());
  return { email, domain, name };
}

function normalizeSupplierName(value: string) {
  const cleaned = value
    .replace(/<[^>]+>/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b(?:invoice|invoices|receipt|receipts|billing|payments?|accounts?|support|no.?reply|noreply)\b/gi, " ")
    .replace(/\b(?:ltd|limited|inc|llc|corp|company|co)\b\.?/gi, " ")
    .replace(/\b(?:בע\"מ|בע״מ|בעמ|חברה|חשבוניות|חשבונית|קבלה|תשלומים|גבייה)\b/g, " ")
    .replace(/[|:;,\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || value.trim() || "Unknown supplier";
}

function canonicalSupplierKey(value: string) {
  return normalizeSupplierName(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function detectInvoice(subject: string, body: string, parts: PayloadPart[]) {
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const hasKeyword =
    INVOICE_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase())) ||
    INVOICE_KEYWORD_PATTERNS.some((pattern) => pattern.test(text));
  const hasPdf = parts.some((part) => /\.pdf$/i.test(part.filename ?? "") || part.mimeType === "application/pdf");
  return {
    isInvoice: hasKeyword || hasPdf,
    amount: extractInvoiceAmount(text),
  };
}

function extractInvoiceAmount(text: string) {
  const normalized = text.replace(/&nbsp;/gi, " ").replace(/\u00a0/g, " ");
  const patterns = [
    /(?:סה["״']?כ|סך\s*הכל|לתשלום|total\s*(?:due|amount)?|amount\s*(?:due)?|balance\s*due)[^\d₪$€]{0,40}(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)?\s*([0-9][0-9.,\s]*(?:\.[0-9]{1,2})?)/gi,
    /₪\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/g,
    /([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)\s*(?:ש["״']?ח|שקל|שקלים)/g,
    /(?:ils|nis)\s*([0-9][0-9.,\s]*(?:\.[0-9]{1,2})?)/gi,
    /([0-9][0-9.,\s]*(?:\.[0-9]{1,2})?)\s*(?:ils|nis)/gi,
  ];
  const amounts: number[] = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const amount = parseAmount(match[1]);
      if (amount !== null && isReasonableDetectedAmount(amount)) amounts.push(amount);
    }
  }
  return amounts.length ? Math.max(...amounts) : null;
}

function extractPhoneFromText(text: string) {
  return text.match(/(?:\+972|0)(?:[-\s]?\d){8,10}/)?.[0]?.replace(/[\s-]/g, "") ?? undefined;
}

function parseAmount(raw: string) {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  let compact = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    compact = cleaned.replace(new RegExp(`\\${decimalSeparator === "," ? "." : ","}`, "g"), "").replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    compact = cleaned.length - lastComma - 1 === 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastDot !== -1) {
    compact = cleaned.length - lastDot - 1 === 2 ? cleaned : cleaned.replace(/\./g, "");
  }
  compact = compact.replace(/\s/g, "");
  const amount = Number(compact);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeDetectedAmount(amount: number | null | undefined) {
  if (amount == null) return null;
  return isReasonableDetectedAmount(amount) ? amount : null;
}

function isReasonableDetectedAmount(amount: number) {
  return Number.isFinite(amount) && amount > 0 && amount <= 10_000_000;
}

function normalizeBusinessDate(value: string | null | undefined, fallback: Date | null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const now = Date.now();
  const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;
  if (date.getTime() < now - twoYearsMs || date.getTime() > now + twoYearsMs) return fallback;
  return date;
}

async function upsertPotentialClient(input: {
  organizationId: string;
  name: string;
  email: string;
  domain: string;
  firstSeen: Date;
  lastSeen: Date;
}) {
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "Client" WHERE "organizationId" = $1 AND ("email" = $2 OR "domain" = $3) AND "isActive" = true ORDER BY "createdAt" ASC LIMIT 1',
    input.organizationId,
    input.email,
    input.domain
  );
  if (existing[0]?.id) {
    await prisma.$executeRawUnsafe(
      'UPDATE "Client" SET "domain" = COALESCE("domain", $2), "firstSeen" = COALESCE("firstSeen", $3), "lastSeen" = GREATEST(COALESCE("lastSeen", $4), $4), "updatedAt" = NOW() WHERE "id" = $1',
      existing[0].id,
      input.domain,
      input.firstSeen,
      input.lastSeen
    );
    return { id: existing[0].id, created: false };
  }

  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    'INSERT INTO "Client" ("id","organizationId","name","email","domain","firstSeen","lastSeen","gmailConnected","color","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,true,NOW(),NOW())',
    id,
    input.organizationId,
    input.name || input.domain,
    input.email,
    input.domain,
    input.firstSeen,
    input.lastSeen,
    "#6366F1"
  );
  return { id, created: true };
}

async function ensureInvoiceClient(input: {
  organizationId: string;
  supplierName: string;
  senderEmail: string;
  domain: string;
  receivedAt: Date;
}) {
  const supplierKey = canonicalSupplierKey(input.supplierName) || "invoice-supplier";
  const domain = input.domain || `${supplierKey}.local`;
  const email = input.senderEmail || `invoice-${supplierKey}@local.invalid`;
  return upsertPotentialClient({
    organizationId: input.organizationId,
    name: input.supplierName || domain,
    email,
    domain,
    firstSeen: input.receivedAt,
    lastSeen: input.receivedAt,
  });
}

async function upsertGmailLead(input: {
  organizationId: string;
  name: string;
  company: string;
  email: string;
  phone?: string;
  notes: string;
}) {
  const existing = await prisma.lead.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [
        { email: input.email },
        ...(input.phone ? [{ phone: input.phone }, { whatsapp: input.phone }] : []),
      ],
    },
  });
  if (existing) return { id: existing.id, created: false };

  const lead = await prisma.lead.create({
    data: {
      organizationId: input.organizationId,
      name: input.name || input.company || input.email,
      company: input.company,
      email: input.email,
      phone: input.phone,
      whatsapp: input.phone,
      source: "email",
      stage: "חדש",
      notes: input.notes,
      score: 45,
      priorityStars: 2,
      lastContactAt: new Date(),
      timeline: {
        create: {
          type: "gmail_scan",
          content: "נוצר אוטומטית מסריקת Gmail",
          channel: "email",
        },
      },
    },
  });
  return { id: lead.id, created: true };
}

async function findExistingSupplierPayment(input: {
  organizationId: string;
  duplicateHash: string;
  emailMessageId: string;
  supplier: string;
  amount: number | null;
  date: Date;
}) {
  const byHash = await prisma.supplierPayment.findUnique({
    where: {
      organizationId_duplicateHash: {
        organizationId: input.organizationId,
        duplicateHash: input.duplicateHash,
      },
    },
  });
  if (byHash) return byHash;

  const dayStart = new Date(input.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(input.date);
  dayEnd.setHours(23, 59, 59, 999);

  const bySameEmail = await prisma.supplierPayment.findFirst({
    where: {
      organizationId: input.organizationId,
      emailMessageId: input.emailMessageId,
    },
  });
  if (bySameEmail) return bySameEmail;

  if (input.amount !== null) {
    return prisma.supplierPayment.findFirst({
      where: {
        organizationId: input.organizationId,
        supplier: input.supplier,
        amount: input.amount,
        date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  return null;
}

async function createPaymentAlertOnce(input: {
  organizationId: string;
  type: "missing_invoice" | "new_invoice";
  supplierName: string;
  subject: string;
  amount: number | null;
  gmailMessageId: string;
}) {
  const title = input.type === "missing_invoice"
    ? `חסרה חשבונית: ${input.supplierName}`
    : `חשבונית חדשה: ${input.supplierName}`;
  const body = `${input.subject} — ₪${input.amount ?? "?"} — ${input.gmailMessageId}`;
  const existing = await prisma.alert.findFirst({
    where: {
      organizationId: input.organizationId,
      type: input.type,
      title,
      body,
    },
  });
  if (existing) return existing;
  return prisma.alert.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      title,
      body,
    },
  });
}

async function createMissingInvoiceTaskOnce(input: {
  organizationId: string;
  supplierName: string;
  subject: string;
  amount: number | null;
  emailMessageId: string;
  gmailMessageId: string;
}) {
  await createPaymentAlertOnce({
    organizationId: input.organizationId,
    type: "missing_invoice",
    supplierName: input.supplierName,
    subject: input.subject,
    amount: input.amount,
    gmailMessageId: input.gmailMessageId,
  });
  const existing = await prisma.task.findFirst({
    where: {
      organizationId: input.organizationId,
      emailMessageId: input.emailMessageId,
      title: { startsWith: "MissingInvoice:" },
      status: "open",
    },
  });
  if (existing) return existing;
  return prisma.task.create({
    data: {
      organizationId: input.organizationId,
      title: `MissingInvoice: ${input.supplierName}`,
      description: `${input.subject}\nGmail: ${gmailMessageLink(input.gmailMessageId)}\nAmount: ${input.amount ?? "unknown"}`,
      supplier: input.supplierName,
      priority: "high",
      status: "open",
      source: "gmail",
      emailMessageId: input.emailMessageId,
    },
  });
}

async function closeMissingInvoiceTask(organizationId: string, emailMessageId: string) {
  await prisma.task.updateMany({
    where: {
      organizationId,
      emailMessageId,
      title: { startsWith: "MissingInvoice:" },
      status: "open",
    },
    data: { status: "completed" },
  });
}

async function saveDetectedInvoice(input: {
  organizationId: string;
  clientId: string;
  amount: number;
  currency: string;
  date: Date;
  dueDate: Date | null;
  invoiceNumber: string | null;
  supplierName: string;
  documentType: GmailDocumentType;
  fromEmail: string;
  subject: string;
  emailMessageId: string;
  gmailMessageId: string;
  driveUrl: string | null;
}) {
  const existingByGmail = await prisma.invoice.findFirst({
    where: { organizationId: input.organizationId, gmailMessageId: input.gmailMessageId },
    select: { id: true },
  });
  if (existingByGmail) return null;

  const dateStart = new Date(input.date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(input.date);
  dateEnd.setHours(23, 59, 59, 999);
  const existingByBusinessKey = await prisma.invoice.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      amount: input.amount,
      date: { gte: dateStart, lte: dateEnd },
      ...(input.invoiceNumber
        ? { invoiceNumber: input.invoiceNumber }
        : { description: { contains: input.supplierName, mode: "insensitive" } }),
    },
    select: { id: true },
  });
  if (existingByBusinessKey) return null;

  return prisma.invoice.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      invoiceNumber: input.invoiceNumber,
      amount: input.amount,
      currency: input.currency || "ILS",
      date: input.date,
      dueDate: input.dueDate,
      status: input.documentType === "receipt" ? "paid" : "pending",
      description: `${input.supplierName} · ${input.subject}\nGmail: ${gmailMessageLink(input.gmailMessageId)}`,
      driveUrl: input.driveUrl,
      emailId: input.emailMessageId,
      fromEmail: input.fromEmail,
      gmailMessageId: input.gmailMessageId,
    },
  });
}

