import { prisma } from "../lib/prisma.js";
import { buildDuplicateHash } from "../lib/duplicate.js";
import { analyzeEmailContent } from "./claude.js";
import { getGoogleClients } from "./google.js";
import {
  ensureInvoiceFolderTree,
  folderForDocumentType,
  uploadInvoiceAttachmentToDrive,
} from "./driveService.js";
import { notifyNewInvoice } from "./whatsapp.js";

const GMAIL_QUERIES = [
  "has:attachment newer_than:30d",
  "חשבונית newer_than:30d",
  "קבלה newer_than:30d",
  "תשלום newer_than:30d",
  "invoice newer_than:30d",
  "receipt newer_than:30d",
  "payment newer_than:30d",
  "payment request newer_than:30d",
];
const MAX_MESSAGES_PER_SYNC = 20;
const DRIVE_FULL_MESSAGE = "הסריקה הושלמה. לא ניתן לשמור ל-Drive - האחסון שלך מלא";

export async function syncGmailForOrganization(organizationId: string) {
  const activeLog = await prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "gmail_scan",
      status: "running",
      finishedAt: null,
    },
  });
  if (activeLog) {
    return { emailsProcessed: 0, paymentsCreated: 0, tasksCreated: 0, inProgress: true };
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

  try {
    const { gmail, drive } = await getGoogleClients(organizationId);
    let rootId: string | null = null;
    try {
      rootId = await ensureInvoiceFolderTree(drive);
    } catch (err) {
      driveUploadFailed = true;
      console.error("Drive setup failed; continuing Gmail sync without Drive", err);
    }
    const messages = await listCandidateMessages(gmail);

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
      if (existing?.processedAt) continue;

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
        update: { bodyText, snippet: full.data.snippet ?? undefined },
      });

      emailsProcessed++;

      const parts = collectAttachmentParts(full.data.payload as PayloadPart | undefined);
      const analysis = await analyzeEmailContent({
        subject,
        body: bodyText,
        filenames: parts.map((p) => p.filename).filter(Boolean) as string[],
        sender: from,
      });
      const driveLinks: { type: string; link: string }[] = [];

      for (const part of parts) {
        const attachmentId = part.body?.attachmentId;
        if (!part.filename || !attachmentId) continue;

        const existingAttachment = await prisma.emailAttachment.findFirst({
          where: {
            emailMessageId: emailRecord.id,
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
            messageId: msgRef.id,
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
            receivedAt,
            buffer,
          });
          const link = upload.webViewLink;
          driveLinks.push({ type: folderType, link });
          await prisma.emailAttachment.create({
            data: {
              emailMessageId: emailRecord.id,
              filename: part.filename,
              mimeType: part.mimeType ?? undefined,
              gmailAttachmentId: attachmentId,
              driveFileId: upload.fileId ?? undefined,
              driveLink: link,
            },
          });
        } catch (err) {
          driveUploadFailed = true;
          console.error("Drive upload failed; continuing Gmail sync without attachment upload", err);
          await prisma.emailAttachment.create({
            data: {
              emailMessageId: emailRecord.id,
              filename: part.filename,
              mimeType: part.mimeType ?? undefined,
              gmailAttachmentId: attachmentId,
            },
          });
        }
      }

      for (const taskTitle of analysis.tasks) {
        const existingTask = await prisma.task.findFirst({
          where: {
            organizationId,
            emailMessageId: emailRecord.id,
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
            source,
            emailMessageId: emailRecord.id,
          },
        });
        tasksCreated++;
      }

      if (analysis.amount != null || analysis.documentType !== "other") {
        const dateIso = receivedAt.toISOString();
        const duplicateHash = buildDuplicateHash({
          organizationId,
          supplier: analysis.supplier,
          amount: analysis.amount ?? 0,
          dateIso,
          subject,
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
              amount: analysis.amount ?? existingPayment.amount,
              dueDate: analysis.dueDate ? new Date(analysis.dueDate) : existingPayment.dueDate,
              emailSender: from,
            },
          });
        } else {
          const dueDate = analysis.dueDate ? new Date(analysis.dueDate) : null;
          await prisma.supplierPayment.create({
            data: {
              organizationId,
              supplier: analysis.supplier,
              amount: analysis.amount ?? 0,
              currency: analysis.currency,
              date: receivedAt,
              dueDate,
              paid: false,
              documentLink,
              invoiceLink,
              emailSender: from,
              paymentRequired: analysis.paymentRequired,
              missingInvoice,
              duplicateHash,
              subject,
              source,
              emailMessageId: emailRecord.id,
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
                body: `${subject} — ₪${analysis.amount ?? "?"}`,
              },
            });
            if (!missingInvoice) {
              await notifyNewInvoice(organizationId, analysis.supplier, analysis.amount);
            }
          }
        }
      }

      await prisma.emailMessage.update({
        where: { id: emailRecord.id },
        data: { processedAt: new Date() },
      });
    }

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
      driveUploadFailed,
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

async function listCandidateMessages(gmail: GmailClient): Promise<GmailMessageRef[]> {
  const byId = new Map<string, GmailMessageRef>();

  for (const q of GMAIL_QUERIES) {
    const result = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: 10,
    });

    for (const message of result.data.messages ?? []) {
      if (message.id && !byId.has(message.id)) {
        byId.set(message.id, message);
      }
    }
  }

  return [...byId.values()].slice(0, MAX_MESSAGES_PER_SYNC);
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
  if (payload.body?.data) {
    return decodeGmailAttachment(payload.body.data).toString("utf8");
  }
  for (const p of payload.parts ?? []) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      return decodeGmailAttachment(p.body.data).toString("utf8");
    }
  }
  return "";
}

function decodeGmailAttachment(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

