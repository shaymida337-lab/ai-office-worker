import { prisma } from "../lib/prisma.js";
import { buildDuplicateHash } from "../lib/duplicate.js";
import { analyzeEmailContent } from "./claude.js";
import { getGoogleClientsForClient } from "./google.js";
import {
  ensureInvoiceFolderTree,
  uploadInvoiceAttachmentToDrive,
} from "./driveService.js";
import {
  writeClientInvoiceToSheet,
  writeClientTaskToSheet,
} from "./clientSheetsService.js";

const GMAIL_QUERIES = [
  "has:attachment newer_than:30d",
  "חשבונית newer_than:30d",
  "invoice newer_than:30d",
  "payment newer_than:30d",
];
const MAX_MESSAGES = 20;

export async function syncGmailForClient(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.gmailConnected) throw new Error("Client Gmail not connected");

  const organizationId = client.organizationId;
  let emailsProcessed = 0;
  let paymentsCreated = 0;
  let tasksCreated = 0;

  const { gmail, drive } = await getGoogleClientsForClient(clientId);
  const rootId = client.driveFolderId || (await ensureInvoiceFolderTree(drive));
  if (!client.driveFolderId) {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        driveFolderId: rootId,
        driveFolderUrl: `https://drive.google.com/drive/folders/${rootId}`,
      },
    });
  }

  const messages = await listMessages(gmail);

  for (const msgRef of messages) {
    if (!msgRef.id) continue;

    const existing = await prisma.emailMessage.findUnique({
      where: { organizationId_gmailId: { organizationId, gmailId: msgRef.id } },
    });
    if (existing?.processedAt) continue;

    const full = await gmail.users.messages.get({ userId: "me", id: msgRef.id, format: "full" });
    const headers = full.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "(ללא נושא)";
    const from = headers.find((h) => h.name === "From")?.value ?? "";
    const dateHeader = headers.find((h) => h.name === "Date")?.value ?? "";
    const receivedAt = dateHeader ? new Date(dateHeader) : new Date();
    const bodyText = extractBody(full.data.payload as PayloadPart | undefined);

    const emailRecord = await prisma.emailMessage.upsert({
      where: { organizationId_gmailId: { organizationId, gmailId: msgRef.id } },
      create: {
        organizationId,
        clientId,
        gmailId: msgRef.id,
        threadId: full.data.threadId ?? undefined,
        subject,
        fromAddress: from,
        snippet: full.data.snippet ?? undefined,
        bodyText,
        receivedAt,
        source: "gmail",
      },
      update: { bodyText, snippet: full.data.snippet ?? undefined, clientId },
    });

    emailsProcessed++;

    const parts = collectParts(full.data.payload as PayloadPart | undefined);
    const analysis = await analyzeEmailContent({
      subject,
      body: bodyText,
      filenames: parts.map((p) => p.filename).filter(Boolean) as string[],
      sender: from,
    });

    const driveLinks: string[] = [];
    for (const part of parts) {
      const attachmentId = part.body?.attachmentId;
      if (!part.filename || !attachmentId) continue;

      const att = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: msgRef.id,
        id: attachmentId,
      });
      const buffer = decodeAttachment(att.data.data ?? "");
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
      driveLinks.push(upload.webViewLink);
    }

    for (const taskTitle of analysis.tasks) {
      const exists = await prisma.task.findFirst({
        where: { organizationId, clientId, emailMessageId: emailRecord.id, title: taskTitle },
      });
      if (exists) continue;
      await prisma.task.create({
        data: {
          organizationId,
          clientId,
          title: taskTitle,
          supplier: analysis.supplier,
          priority: analysis.confidence < 0.7 ? "high" : "medium",
          source: "gmail",
          emailMessageId: emailRecord.id,
        },
      });
      await writeClientTaskToSheet(clientId, {
        date: receivedAt,
        from,
        subject,
        summary: taskTitle,
        action: taskTitle,
        priority: analysis.confidence < 0.7 ? "גבוה" : "בינוני",
        dueDate: analysis.dueDate ? new Date(analysis.dueDate) : null,
        status: "פתוח",
      });
      tasksCreated++;
    }

    if (analysis.amount != null || analysis.documentType !== "other") {
      const duplicateHash = buildDuplicateHash({
        organizationId,
        supplier: analysis.supplier,
        amount: analysis.amount ?? 0,
        dateIso: receivedAt.toISOString(),
        subject,
      });

      const existingPayment = await prisma.supplierPayment.findUnique({
        where: { organizationId_duplicateHash: { organizationId, duplicateHash } },
      });

      if (!existingPayment) {
        await prisma.supplierPayment.create({
          data: {
            organizationId,
            clientId,
            supplier: analysis.supplier,
            amount: analysis.amount ?? 0,
            currency: analysis.currency,
            date: receivedAt,
            dueDate: analysis.dueDate ? new Date(analysis.dueDate) : null,
            paid: false,
            documentLink: driveLinks[0],
            invoiceLink: driveLinks[0],
            emailSender: from,
            paymentRequired: analysis.paymentRequired,
            missingInvoice: false,
            duplicateHash,
            subject,
            source: "gmail",
            emailMessageId: emailRecord.id,
          },
        });
        await writeClientInvoiceToSheet(clientId, {
          date: receivedAt,
          supplier: analysis.supplier,
          amount: analysis.amount ?? 0,
          currency: analysis.currency,
          driveFileUrl: driveLinks[0],
          driveFolderUrl: client.driveFolderUrl,
          emailSubject: subject,
          status: "ממתין",
          notes: analysis.tasks.join(", "),
        });
        paymentsCreated++;
      }
    }

    await prisma.emailMessage.update({
      where: { id: emailRecord.id },
      data: { processedAt: new Date() },
    });
  }

  return { clientId, clientName: client.name, emailsProcessed, paymentsCreated, tasksCreated };
}

type PayloadPart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { attachmentId?: string | null; data?: string | null } | null;
  parts?: PayloadPart[] | null;
};

type GmailClient = Awaited<ReturnType<typeof getGoogleClientsForClient>>["gmail"];

async function listMessages(gmail: GmailClient) {
  const byId = new Map<string, { id?: string | null }>();
  for (const q of GMAIL_QUERIES) {
    const result = await gmail.users.messages.list({ userId: "me", q, maxResults: 10 });
    for (const m of result.data.messages ?? []) {
      if (m.id) byId.set(m.id, m);
    }
  }
  return [...byId.values()].slice(0, MAX_MESSAGES);
}

function collectParts(payload?: PayloadPart): PayloadPart[] {
  const out: PayloadPart[] = [];
  if (!payload) return out;
  if (payload.filename && payload.body?.attachmentId) out.push(payload);
  for (const p of payload.parts ?? []) out.push(...collectParts(p));
  return out;
}

function extractBody(payload?: PayloadPart): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeAttachment(payload.body.data).toString("utf8");
  for (const p of payload.parts ?? []) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      return decodeAttachment(p.body.data).toString("utf8");
    }
  }
  return "";
}

function decodeAttachment(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
