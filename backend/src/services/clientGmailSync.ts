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
import { recordFinancialDocumentDecision } from "./financialDocuments.js";
import {
  computeCanonicalFingerprint,
  matchFinancialDocuments,
  type DedupMatchResult,
  type FinancialDocumentFingerprintInput,
} from "./dedup/sharedMatcher.js";
import { buildClientGmailPaymentLookupClauses } from "./dedup/fingerprintMigration.js";
import { resolveClientGmailMoneyDecision } from "./amount/amountCandidates.js";
import { classifyJunk, shouldAutoClassifyAfterJunkFilter } from "./classification/junkFilter.js";

const GMAIL_QUERIES = [
  "has:attachment newer_than:30d",
  "חשבונית newer_than:30d",
  "invoice newer_than:30d",
  "payment newer_than:30d",
];
const MAX_MESSAGES = 20;
const DRIVE_FULL_MESSAGE = "הסריקה הושלמה. לא ניתן לשמור ל-Drive - האחסון שלך מלא";

export type ClientGmailJunkAction = "drop" | "review" | "proceed";

export function decideClientGmailJunkAction(input: {
  subject: string;
  body: string;
  sender: string;
  attachmentFilenames: string[];
  junkDecision: ReturnType<typeof classifyJunk>;
}): ClientGmailJunkAction {
  if (input.junkDecision.bucket === "CERTAIN_JUNK") {
    return "drop";
  }
  if (!shouldAutoClassifyAfterJunkFilter(input.junkDecision)) {
    return "review";
  }
  return "proceed";
}

export function selectClientInvoiceAmount(input: {
  amount: number | null | undefined;
  totalAmount: number | null | undefined;
  organizationId?: string;
  documentType?: string | null;
  currency?: string;
  confidence?: number;
}): number | null {
  if (!input.organizationId) {
    return input.totalAmount ?? input.amount ?? null;
  }
  return resolveClientGmailMoneyDecision({
    organizationId: input.organizationId,
    documentType: input.documentType ?? "invoice",
    analysis: {
      amount: input.amount ?? null,
      totalAmount: input.totalAmount ?? null,
      amountBeforeVat: null,
      vatAmount: null,
      currency: input.currency ?? "ILS",
      confidence: input.confidence ?? 0.8,
    },
  }).selectedAmount;
}

export async function syncGmailForClient(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.gmailConnected) throw new Error("Client Gmail not connected");

  const organizationId = client.organizationId;
  let emailsProcessed = 0;
  let paymentsCreated = 0;
  let tasksCreated = 0;
  let driveUploadFailed = false;

  const { gmail, drive } = await getGoogleClientsForClient(clientId);
  let rootId: string | null = null;
  try {
    rootId = await ensureInvoiceFolderTree(drive);
    const driveFolderUrl = `https://drive.google.com/drive/folders/${rootId}`;
    if (client.driveFolderId !== rootId || client.driveFolderUrl !== driveFolderUrl) {
      await prisma.client.update({
        where: { id: clientId },
        data: { driveFolderId: rootId, driveFolderUrl },
      });
    }
  } catch (err) {
    rootId = client.driveFolderId ?? null;
    driveUploadFailed = true;
    console.error("Client Drive setup failed; continuing Gmail sync without Drive", err);
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
    const pdfText = await extractPdfTextFromParts(gmail, msgRef.id, parts);
    const bodyForAnalysis = pdfText ? `${bodyText}\n\n--- PDF ATTACHMENT TEXT ---\n${pdfText}` : bodyText;
    const attachmentFilenames = parts.map((p) => p.filename).filter(Boolean) as string[];
    const junkDecision = classifyJunk({
      sender: from,
      subject,
      body: bodyForAnalysis,
      channel: "gmail",
      attachmentFilenames,
      metadata: { gmailMessageId: msgRef.id, clientId },
    });
    const junkAction = decideClientGmailJunkAction({
      subject,
      body: bodyForAnalysis,
      sender: from,
      attachmentFilenames,
      junkDecision,
    });
    if (junkAction === "drop") {
      await prisma.emailMessage.update({
        where: { id: emailRecord.id },
        data: { processedAt: new Date() },
      });
      continue;
    }
    if (junkAction === "review") {
      await recordFinancialDocumentDecision({
        organizationId,
        source: "gmail",
        sender: from || null,
        subject,
        fileName: parts.find((part) => part.filename)?.filename ?? null,
        fileSize: null,
        supplierName: from || null,
        supplierTaxId: null,
        invoiceNumber: null,
        documentDate: receivedAt,
        dueDate: null,
        amountBeforeVat: null,
        vatAmount: null,
        totalAmount: null,
        documentType: "payment_request",
        driveFileUrl: null,
        confidenceScore: 0,
        uncertaintyReason: `junk_filter:${junkDecision.reason}`,
        rawAnalysis: { junkDecision, gmailMessageId: msgRef.id },
        emailMessageId: emailRecord.id,
        gmailMessageId: msgRef.id,
      });
      await prisma.emailMessage.update({
        where: { id: emailRecord.id },
        data: { processedAt: new Date() },
      });
      continue;
    }
    const analysis = await analyzeEmailContent({
      subject,
      body: bodyForAnalysis,
      filenames: attachmentFilenames,
      sender: from,
    });

    const driveLinks: string[] = [];
    for (const part of parts) {
      const attachmentId = part.body?.attachmentId;
      if (!part.filename || !attachmentId) continue;

      try {
        if (!rootId) {
          throw new Error("Drive root unavailable");
        }

        const att = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: msgRef.id,
          id: attachmentId,
        });
        const buffer = decodeAttachment(att.data.data ?? "");
        // FUTURE: Drive upload runs before dedup by design - review records need
        // driveFileUrl. Revisit with an explicit review-artifact schema so UNSURE
        // items don't create orphan Drive files. Tech-debt, not a blocking leak.
        const upload = await uploadInvoiceAttachmentToDrive({
          organizationId,
          drive,
          rootFolderId: rootId,
          clientId,
          clientName: client.name,
          supplier: analysis.supplier,
          supplierTaxId: analysis.supplierTaxId,
          documentType: analysis.documentType,
          filename: part.filename,
          mimeType: part.mimeType,
          receivedAt,
          documentDate: analysis.invoiceDate ?? receivedAt,
          invoiceNumber: analysis.invoiceNumber,
          amount: analysis.amount,
          totalAmount: analysis.totalAmount ?? analysis.amount,
          buffer,
        });
        driveLinks.push(upload.webViewLink);
      } catch (err) {
        driveUploadFailed = true;
        console.error("Client Drive upload failed; continuing Gmail sync without attachment upload", err);
      }
    }

    const pendingTaskCreates: Array<{
      title: string;
      supplier: string;
      priority: string;
    }> = [];
    for (const taskTitle of analysis.tasks) {
      const exists = await prisma.task.findUnique({
        where: {
          organizationId_emailMessageId: {
            organizationId,
            emailMessageId: emailRecord.id,
          },
        },
      });
      if (exists) continue;
      pendingTaskCreates.push({
        title: taskTitle,
        supplier: analysis.supplier,
        priority: analysis.confidence < 0.7 ? "high" : "medium",
      });
    }

    if (analysis.amount != null || analysis.documentType !== "other") {
      const legacyDuplicateHash = buildDuplicateHash({
        organizationId,
        supplier: analysis.supplier,
        amount: analysis.amount ?? 0,
        dateIso: receivedAt.toISOString(),
        subject,
      });
      const canonicalFingerprint = computeCanonicalFingerprint({
        organizationId,
        supplierName: analysis.supplier,
        supplierTaxId: analysis.supplierTaxId,
        invoiceNumber: analysis.invoiceNumber,
        totalAmount: analysis.totalAmount ?? analysis.amount ?? null,
        documentDate: analysis.invoiceDate ?? receivedAt,
        documentType: analysis.documentType,
      }).fingerprint ?? legacyDuplicateHash;
      const duplicateHash = canonicalFingerprint;

      const duplicateCandidates = await prisma.supplierPayment.findMany({
        where: {
          organizationId,
          OR: buildClientGmailPaymentLookupClauses({
            canonicalFingerprint,
            legacyDuplicateHash,
            supplier: analysis.supplier,
            invoiceNumber: analysis.invoiceNumber,
            amount: analysis.totalAmount ?? analysis.amount ?? null,
            date: analysis.invoiceDate ?? receivedAt,
          }),
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const duplicateDecision = decideClientGmailFinancialDocumentDuplicate({
        current: {
          organizationId,
          supplierName: analysis.supplier,
          supplierTaxId: analysis.supplierTaxId,
          invoiceNumber: analysis.invoiceNumber,
          totalAmount: analysis.totalAmount ?? analysis.amount ?? null,
          documentDate: analysis.invoiceDate ?? receivedAt,
          documentType: analysis.documentType,
        },
        legacyDuplicateHash,
        canonicalFingerprint,
        candidates: duplicateCandidates,
      });
      const existingPayment = duplicateDecision.result === "MATCH" ? duplicateDecision.candidate : null;

      if (duplicateDecision.result === "UNSURE") {
        await recordFinancialDocumentDecision({
          organizationId,
          source: "gmail",
          sender: from,
          subject,
          supplierName: analysis.supplier,
          supplierTaxId: analysis.supplierTaxId,
          invoiceNumber: analysis.invoiceNumber,
          documentDate: analysis.invoiceDate ?? receivedAt,
          dueDate: analysis.dueDate,
          amountBeforeVat: analysis.amountBeforeVat,
          vatAmount: analysis.vatAmount,
          totalAmount: analysis.totalAmount ?? analysis.amount ?? null,
          documentType: analysis.documentType,
          driveFileUrl: driveLinks[0],
          confidenceScore: Math.min(analysis.confidence, 0.79),
          uncertaintyReason: `possible duplicate: ${duplicateDecision.reasons.join(", ")}`,
          rawAnalysis: analysis,
          emailMessageId: emailRecord.id,
          gmailMessageId: msgRef.id,
        });
      } else if (!existingPayment) {
        if (shouldCreateClientGmailTasksAfterDedup(duplicateDecision)) {
          for (const pendingTask of pendingTaskCreates) {
            const existingTask = await prisma.task.findUnique({
              where: {
                organizationId_emailMessageId: {
                  organizationId,
                  emailMessageId: emailRecord.id,
                },
              },
            });
            if (existingTask) continue;
            await prisma.task.upsert({
              where: {
                organizationId_emailMessageId: {
                  organizationId,
                  emailMessageId: emailRecord.id,
                },
              },
              update: {},
              create: {
                organizationId,
                clientId,
                title: pendingTask.title,
                supplier: pendingTask.supplier,
                priority: pendingTask.priority,
                source: "gmail",
                emailMessageId: emailRecord.id,
              },
            });
            tasksCreated++;
            if (shouldWriteClientGmailTaskSheetAfterDedup(duplicateDecision)) {
              try {
                await writeClientTaskToSheet(clientId, {
                  date: receivedAt,
                  from,
                  subject,
                  summary: pendingTask.title,
                  action: pendingTask.title,
                  priority: pendingTask.priority === "high" ? "גבוה" : "בינוני",
                  dueDate: analysis.dueDate ? new Date(analysis.dueDate) : null,
                  status: "פתוח",
                });
              } catch (err) {
                console.error("Client task sheet write failed; continuing Gmail sync", err);
              }
            }
          }
        }
        const clientMoneyDecision = resolveClientGmailMoneyDecision({
          organizationId,
          documentType: analysis.documentType,
          analysis,
        });
        const clientInvoiceAmount = clientMoneyDecision.selectedAmount;
        await recordFinancialDocumentDecision({
          organizationId,
          source: "gmail",
          sender: from,
          subject,
          supplierName: analysis.supplier,
          supplierTaxId: analysis.supplierTaxId,
          invoiceNumber: analysis.invoiceNumber,
          documentDate: analysis.invoiceDate ?? receivedAt,
          dueDate: analysis.dueDate,
          amountBeforeVat: analysis.amountBeforeVat,
          vatAmount: analysis.vatAmount,
          totalAmount: clientInvoiceAmount,
          documentType: analysis.documentType,
          driveFileUrl: driveLinks[0],
          confidenceScore: analysis.confidence,
          uncertaintyReason: "trust.gates_missing",
          parsedFieldsJson: {},
          rawAnalysis: analysis,
          emailMessageId: emailRecord.id,
          gmailMessageId: msgRef.id,
        });
        try {
          if (clientInvoiceAmount != null) {
            await writeClientInvoiceToSheet(clientId, {
              date: receivedAt,
              supplier: analysis.supplier,
              amount: clientInvoiceAmount,
              currency: analysis.currency,
              driveFileUrl: driveLinks[0],
              driveFolderUrl: client.driveFolderUrl,
              emailSubject: subject,
              status: "ממתין",
              notes: analysis.tasks.join(", "),
            });
          }
        } catch (err) {
          console.error("Client invoice sheet write failed; continuing Gmail sync", err);
        }
      }
    }

    await prisma.emailMessage.update({
      where: { id: emailRecord.id },
      data: { processedAt: new Date() },
    });
  }

  return {
    clientId,
    clientName: client.name,
    emailsProcessed,
    paymentsCreated,
    tasksCreated,
    driveUploadFailed,
    message: driveUploadFailed ? DRIVE_FULL_MESSAGE : undefined,
  };
}

export type ClientGmailDuplicateCandidate = {
  id: string;
  supplier?: string | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  totalAmount?: number | null;
  date?: Date | string | null;
  documentTypeDetailed?: string | null;
  duplicateHash?: string | null;
  documentFingerprint?: string | null;
};

export function decideClientGmailFinancialDocumentDuplicate(input: {
  current: FinancialDocumentFingerprintInput;
  legacyDuplicateHash: string;
  canonicalFingerprint: string;
  candidates: ClientGmailDuplicateCandidate[];
}): {
  result: DedupMatchResult;
  candidate: ClientGmailDuplicateCandidate | null;
  reasons: string[];
} {
  let unsure: { candidate: ClientGmailDuplicateCandidate; reasons: string[] } | null = null;
  let legacyFallback: ClientGmailDuplicateCandidate | null = null;

  for (const candidate of input.candidates) {
    const match = matchFinancialDocuments(input.current, {
      organizationId: input.current.organizationId,
      supplierName: candidate.supplierName ?? candidate.supplier,
      supplierTaxId: candidate.supplierTaxId,
      invoiceNumber: candidate.invoiceNumber,
      totalAmount: candidate.totalAmount ?? candidate.amount,
      documentDate: candidate.date,
      documentType: candidate.documentTypeDetailed,
    });
    if (match.result === "MATCH") {
      return { result: "MATCH", candidate, reasons: match.reasons };
    }
    if (match.result === "UNSURE" && !unsure) {
      unsure = { candidate, reasons: match.reasons };
    }
    if (
      (candidate.duplicateHash === input.legacyDuplicateHash || candidate.duplicateHash === input.canonicalFingerprint || candidate.documentFingerprint === input.canonicalFingerprint) &&
      !legacyFallback
    ) {
      legacyFallback = candidate;
    }
  }

  if (unsure) return { result: "UNSURE", candidate: unsure.candidate, reasons: unsure.reasons };
  if (legacyFallback) return { result: "MATCH", candidate: legacyFallback, reasons: ["legacy_duplicate_hash"] };
  return { result: "NO_MATCH", candidate: null, reasons: ["no_candidate_match"] };
}

export function shouldCreateClientGmailTasksAfterDedup(input: { result: DedupMatchResult; candidate: ClientGmailDuplicateCandidate | null }) {
  return input.result === "NO_MATCH" && input.candidate === null;
}

export function shouldWriteClientGmailTaskSheetAfterDedup(input: { result: DedupMatchResult; candidate: ClientGmailDuplicateCandidate | null }) {
  return input.result === "NO_MATCH" && input.candidate === null;
}

function normalizeDate(value: Date | string | null | undefined) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
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
      parser = new PDFParse({ data: new Uint8Array(decodeAttachment(attachment.data.data ?? "")) });
      const parsed = await parser.getText();
      if (parsed.text?.trim()) texts.push(parsed.text.trim());
    } catch (err) {
      console.warn("[client-gmail-sync] PDF text extraction failed", err instanceof Error ? err.message : String(err));
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
  }
  return texts.join("\n\n");
}
