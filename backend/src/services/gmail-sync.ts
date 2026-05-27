import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { buildDuplicateHash } from "../lib/duplicate.js";
import { analyzeEmailContent } from "./claude.js";
import { getGoogleClients } from "./google.js";
import { analyzeAndSaveMessage } from "./messageScanner.js";
import {
  ensureInvoiceFolderTree,
  folderForDocumentType,
  uploadInvoiceAttachmentToDrive,
} from "./driveService.js";
import { notifyNewInvoice } from "./whatsapp.js";

const MAX_MESSAGES_PER_SYNC = 500;
const MAX_MESSAGES_PER_QUICK_SCAN = 25;
const DRIVE_FULL_MESSAGE = "הסריקה הושלמה. לא ניתן לשמור ל-Drive - האחסון שלך מלא";
const INVOICE_KEYWORDS = ["חשבונית", "חשבון", "קבלה", "לתשלום", "invoice", "receipt", "payment", "פקטורה"];

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
    paymentsCreated: 0,
    tasksCreated: 0,
    clientsCreated: 0,
    invoicesCreated: 0,
    uniqueSenders: 0,
    potentialClients: 0,
    invoiceEmails: 0,
    invoiceAmountsExtracted: 0,
    quick: true,
    backgroundProcessing: true,
    scanSteps: [`נמצאו ${messages.length} מיילים ב-Gmail`, "העיבוד המלא ממשיך ברקע"],
  };
}

export async function syncGmailForOrganization(organizationId: string, options: { daysBack?: number; isFirstTime?: boolean; forceReprocess?: boolean } = {}) {
  const activeLog = await prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "gmail_scan",
      status: "running",
      finishedAt: null,
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
  if (options.forceReprocess) {
    logStep(`[gmail-sync] Force reprocess enabled for ${daysBack} day scan`);
  }

  const activeLogAfterReset = await prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "gmail_scan",
      status: "running",
      finishedAt: null,
    },
  });
  if (activeLogAfterReset) {
    return { emailsProcessed: 0, paymentsCreated: 0, tasksCreated: 0, clientsCreated: 0, invoicesCreated: 0, uniqueSenders: 0, potentialClients: 0, invoiceEmails: 0, invoiceAmountsExtracted: 0, inProgress: true, scanSteps: ["סריקת Gmail כבר רצה"] };
  }

  const log = await prisma.syncLog.create({
    data: {
      organizationId,
      type: "gmail_scan",
      status: "running",
    },
  });

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
    const messages = await listCandidateMessages(gmail, daysBack);
    logStep(`Found ${messages.length} emails in last ${daysBack} days`);
    const scannedEmails: ScannedEmail[] = [];

    for (const msgRef of messages) {
      if (!msgRef.id) continue;

      const existing = await prisma.emailMessage.findUnique({
        where: {
          organizationId_gmailId: {
            organizationId,
            gmailId: msgRef.id,
          },
        },
      });
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msgRef.id,
        format: "full",
      });

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
      if (!sender.email) continue;
      const source = /whatsapp|וואטסאפ/i.test(subject + from)
        ? "whatsapp_forward"
        : "gmail";

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

      await analyzeAndSaveMessage({
        organizationId,
        channel: "gmail",
        externalId: msgRef.id,
        emailMessageId: emailRecord.id,
        from,
        senderName: sender.name,
        senderEmail: sender.email,
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
        domain: sender.domain,
        bodyText,
        receivedAt,
        source,
        parts: collectAttachmentParts(full.data.payload as PayloadPart | undefined),
        fullPayload: full.data.payload as PayloadPart | undefined,
        alreadyProcessed: Boolean(existing?.processedAt),
      });
      emailsProcessed++;
    }

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
      if (sender.count < 2) continue;
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
    }
    logStep(`Found ${potentialClients} potential clients`);

    for (const email of scannedEmails) {
      let clientId = clientIdByDomain.get(email.domain);
      if (clientId) {
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { clientId },
        });
      }

      if (email.alreadyProcessed && !options.forceReprocess) continue;

      const pdfText = await extractPdfTextFromParts(gmail, email.gmailId, email.parts);
      const bodyForAnalysis = pdfText ? `${email.bodyText}\n\n--- PDF ATTACHMENT TEXT ---\n${pdfText}` : email.bodyText;
      const analysis = await analyzeEmailContent({
        subject: email.subject,
        body: bodyForAnalysis,
        filenames: email.parts.map((p) => p.filename).filter(Boolean) as string[],
        sender: email.from,
      });
      const invoiceMatch = detectInvoice(email.subject, bodyForAnalysis, email.parts);
      if (invoiceMatch.isInvoice) invoiceEmails++;
      if (invoiceMatch.amount !== null) invoiceAmountsExtracted++;
      if (!clientId && invoiceMatch.isInvoice && email.domain) {
        const saved = await upsertPotentialClient({
          organizationId,
          name: email.senderName || email.domain,
          email: email.senderEmail,
          domain: email.domain,
          firstSeen: email.receivedAt,
          lastSeen: email.receivedAt,
        });
        clientId = saved.id;
        clientIdByDomain.set(email.domain, saved.id);
        if (saved.created) clientsCreated++;
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { clientId },
        });
      }
      const driveLinks: { type: string; link: string }[] = [];

      for (const part of email.parts) {
        const attachmentId = part.body?.attachmentId;
        if (!part.filename || !attachmentId) continue;

        const existingAttachment = await prisma.emailAttachment.findFirst({
          where: {
            emailMessageId: email.emailRecordId,
            gmailAttachmentId: attachmentId,
          },
        });
        if (existingAttachment?.driveLink) {
          driveLinks.push({ type: folderForDocumentType(analysis.documentType), link: existingAttachment.driveLink });
          continue;
        }

        const folderType = folderForDocumentType(analysis.documentType);
        try {
          if (!rootId) {
            throw new Error("Drive root unavailable");
          }

          const att = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId: email.gmailId,
            id: attachmentId,
          });
          const buffer = decodeGmailAttachment(att.data.data ?? "");
          const upload = await uploadInvoiceAttachmentToDrive({
            drive,
            rootFolderId: rootId,
            supplier: analysis.supplier,
            documentType: analysis.documentType,
            filename: part.filename,
            mimeType: part.mimeType,
            receivedAt: email.receivedAt,
            buffer,
          });
          const link = upload.webViewLink;
          driveLinks.push({ type: folderType, link });
          if (existingAttachment) {
            await prisma.emailAttachment.update({
              where: { id: existingAttachment.id },
              data: { driveFileId: upload.fileId ?? undefined, driveLink: link },
            });
          } else {
            await prisma.emailAttachment.create({
              data: {
                emailMessageId: email.emailRecordId,
                filename: part.filename,
                mimeType: part.mimeType ?? undefined,
                gmailAttachmentId: attachmentId,
                driveFileId: upload.fileId ?? undefined,
                driveLink: link,
              },
            });
          }
        } catch (err) {
          driveUploadFailed = true;
          console.error("Drive upload failed; continuing Gmail sync without attachment upload", err);
          if (!existingAttachment) {
            await prisma.emailAttachment.create({
              data: {
                emailMessageId: email.emailRecordId,
                filename: part.filename,
                mimeType: part.mimeType ?? undefined,
                gmailAttachmentId: attachmentId,
              },
            });
          }
        }
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
            supplier: analysis.supplier,
            priority: analysis.confidence < 0.7 ? "high" : "medium",
            source: email.source,
            emailMessageId: email.emailRecordId,
          },
        });
        tasksCreated++;
      }

      const amount = invoiceMatch.amount ?? analysis.amount;
      if (clientId && invoiceMatch.isInvoice && amount != null) {
        const createdInvoice = await saveDetectedInvoice({
          organizationId,
          clientId,
          amount,
          date: email.receivedAt,
          fromEmail: email.senderEmail,
          subject: email.subject,
          gmailMessageId: email.gmailId,
          driveUrl: driveLinks[0]?.link ?? null,
        });
        if (createdInvoice) invoicesCreated++;
      }

      if (amount != null || analysis.documentType !== "other" || invoiceMatch.isInvoice) {
        const dateIso = email.receivedAt.toISOString();
        const duplicateHash = buildDuplicateHash({
          organizationId,
          supplier: analysis.supplier || email.senderName || email.domain,
          amount: amount ?? 0,
          dateIso,
          subject: email.subject,
        });

        const existingPayment = await prisma.supplierPayment.findUnique({
          where: { organizationId_duplicateHash: { organizationId, duplicateHash } },
        });

        const documentLink =
          analysis.documentType === "payment_request"
            ? driveLinks[0]?.link
            : existingPayment?.documentLink;
        const invoiceLink =
          analysis.documentType === "invoice" || analysis.documentType === "receipt"
            ? driveLinks[0]?.link
            : existingPayment?.invoiceLink;

        const missingInvoice =
          Boolean(analysis.paymentRequired || analysis.documentType === "payment_request") &&
          !invoiceLink &&
          Boolean(documentLink || analysis.paymentRequired);

        if (existingPayment) {
          await prisma.supplierPayment.update({
            where: { id: existingPayment.id },
            data: {
              documentLink: documentLink ?? existingPayment.documentLink,
              invoiceLink: invoiceLink ?? existingPayment.invoiceLink,
              missingInvoice,
              amount: amount ?? existingPayment.amount,
              dueDate: analysis.dueDate ? new Date(analysis.dueDate) : existingPayment.dueDate,
              emailSender: email.from,
            },
          });
        } else {
          const dueDate = analysis.dueDate ? new Date(analysis.dueDate) : null;
          await prisma.supplierPayment.create({
            data: {
              organizationId,
              supplier: analysis.supplier || email.senderName || email.domain,
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

          if (analysis.documentType === "invoice" || missingInvoice) {
            await prisma.alert.create({
              data: {
                organizationId,
                type: missingInvoice ? "missing_invoice" : "new_invoice",
                title: missingInvoice
                  ? `חסרה חשבונית: ${analysis.supplier}`
                  : `חשבונית חדשה: ${analysis.supplier}`,
                body: `${email.subject} — ₪${amount ?? "?"}`,
              },
            });
            if (!missingInvoice) {
              await notifyNewInvoice(organizationId, analysis.supplier, amount);
            }
          }
        }
      }

      await prisma.emailMessage.update({
        where: { id: email.emailRecordId },
        data: { processedAt: new Date() },
      });
    }
    logStep(`Found ${invoiceEmails} invoice emails, extracted ${invoiceAmountsExtracted} amounts`);
    logStep(`Saved ${clientsCreated} clients, ${invoicesCreated} invoices to database`);

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        emailsProcessed,
        paymentsCreated,
        tasksCreated,
        finishedAt: new Date(),
        status: "success",
      },
    });

    return {
      emailsProcessed,
      paymentsCreated,
      tasksCreated,
      clientsCreated,
      invoicesCreated,
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
      data: { status: "error", errorMessage: message, finishedAt: new Date() },
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

async function listCandidateMessages(gmail: GmailClient, daysBack: number, maxMessages = MAX_MESSAGES_PER_SYNC): Promise<GmailMessageRef[]> {
  const byId = new Map<string, GmailMessageRef>();
  const from = new Date(Date.now() - Math.max(1, Math.ceil(daysBack)) * 24 * 60 * 60 * 1000);
  const queryDate = `${from.getFullYear()}/${String(from.getMonth() + 1).padStart(2, "0")}/${String(from.getDate()).padStart(2, "0")}`;
  const q = `after:${queryDate}`;
  console.log(`Searching Gmail from ${queryDate} to today`);
  let pageToken: string | undefined;

  do {
    const result = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(100, maxMessages),
      pageToken,
    });

    for (const message of result.data.messages ?? []) {
      if (message.id && !byId.has(message.id)) {
        byId.set(message.id, message);
      }
    }
    pageToken = result.data.nextPageToken ?? undefined;
  } while (pageToken && byId.size < maxMessages);

  return [...byId.values()].slice(0, maxMessages);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
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

function parseSender(from: string) {
  const email = (from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const name = from
    .replace(/<[^>]+>/g, "")
    .replace(/["']/g, "")
    .trim();
  return { email, domain, name };
}

function detectInvoice(subject: string, body: string, parts: PayloadPart[]) {
  const text = `${subject}\n${body}`;
  const hasKeyword = INVOICE_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
  const hasPdf = parts.some((part) => /\.pdf$/i.test(part.filename ?? "") || part.mimeType === "application/pdf");
  return {
    isInvoice: hasKeyword || hasPdf,
    amount: extractInvoiceAmount(text),
  };
}

function extractInvoiceAmount(text: string) {
  const normalized = text.replace(/&nbsp;/gi, " ").replace(/\u00a0/g, " ");
  const patterns = [
    /₪\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/g,
    /([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)\s*(?:ש["״']?ח|שקל|שקלים)/g,
  ];
  const amounts: number[] = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const amount = parseAmount(match[1]);
      if (amount !== null) amounts.push(amount);
    }
  }
  return amounts.length ? Math.max(...amounts) : null;
}

function extractPhoneFromText(text: string) {
  return text.match(/(?:\+972|0)(?:[-\s]?\d){8,10}/)?.[0]?.replace(/[\s-]/g, "") ?? undefined;
}

function parseAmount(raw: string) {
  const compact = raw.replace(/\s/g, "").replace(/,/g, "");
  const amount = Number(compact);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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

async function saveDetectedInvoice(input: {
  organizationId: string;
  clientId: string;
  amount: number;
  date: Date;
  fromEmail: string;
  subject: string;
  gmailMessageId: string;
  driveUrl: string | null;
}) {
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "Invoice" WHERE "organizationId" = $1 AND "gmailMessageId" = $2 LIMIT 1',
    input.organizationId,
    input.gmailMessageId
  );
  if (existing.length) return false;

  await prisma.$executeRawUnsafe(
    'INSERT INTO "Invoice" ("id","clientId","organizationId","amount","currency","date","status","description","driveUrl","emailId","fromEmail","gmailMessageId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,\'ILS\',$5,\'pending\',$6,$7,$8,$9,$10,NOW(),NOW())',
    randomUUID(),
    input.clientId,
    input.organizationId,
    input.amount,
    input.date,
    input.subject,
    input.driveUrl,
    input.gmailMessageId,
    input.fromEmail,
    input.gmailMessageId
  );
  return true;
}

