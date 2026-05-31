import { createHash } from "node:crypto";
import { buildDuplicateHash } from "../lib/duplicate.js";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { analyzeEmailContent, analyzeInvoiceFile, type EmailAnalysis, type InvoiceScanResult } from "./claude.js";
import { ensureInvoiceFolderTree, findExistingSupplierDriveDocument, uploadInvoiceAttachmentToDrive } from "./driveService.js";
import { getGoogleClients } from "./google.js";
import { appendSupplierPaymentToSheet } from "./supplierPaymentsSheet.js";

type WhatsAppMediaInput = {
  organizationId: string;
  clientId?: string | null;
  whatsappLogId: string;
  fromNumber: string;
  body: string;
  media: Array<{
    url: string;
    contentType: string;
    filename?: string | null;
  }>;
};

type ProcessedWhatsAppInvoice = {
  filename: string;
  supplier: string;
  amount: number | null;
  invoiceNumber: string | null;
  documentType: string;
  documentDate: string | null;
  driveLink: string | null;
  paymentId: string | null;
  invoiceId: string | null;
  created: boolean;
  duplicateDetected: boolean;
  duplicateReason: string | null;
};

const PDF_MIME = "application/pdf";
const IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png"]);

export async function ingestWhatsAppInvoiceMedia(input: WhatsAppMediaInput) {
  const supportedMedia = input.media.filter((item) => isSupportedDocumentMedia(item));
  if (!supportedMedia.length) {
    console.log(`[whatsapp-invoice] stop=no_supported_media logId=${input.whatsappLogId} media=${input.media.length}`);
    return { processed: [], skipped: input.media.length, reply: null };
  }

  console.log(`[whatsapp-invoice] google clients start logId=${input.whatsappLogId}`);
  const { drive } = await getGoogleClients(input.organizationId);
  const rootFolderId = await ensureInvoiceFolderTree(drive);
  console.log(`[whatsapp-invoice] drive root ready logId=${input.whatsappLogId} rootFolderId=${rootFolderId}`);
  const processed: ProcessedWhatsAppInvoice[] = [];

  for (const [index, media] of supportedMedia.entries()) {
    const mimeType = normalizeMediaMimeType(media);
    const filename = media.filename || whatsAppDocumentFilename(input.whatsappLogId, index, mimeType);
    console.log(`[whatsapp-invoice] media download start logId=${input.whatsappLogId} index=${index} filename="${filename}" mime=${mimeType}`);
    const buffer = await downloadTwilioMedia(media.url);
    console.log(`[whatsapp-invoice] media download done logId=${input.whatsappLogId} index=${index} bytes=${buffer.length}`);
    const fileHash = sha256(buffer);
    const fileMd5 = md5(buffer);
    console.log(`[whatsapp-invoice] extraction start logId=${input.whatsappLogId} index=${index} filename="${filename}" mime=${mimeType} bytes=${buffer.length}`);
    const analysis = await analyzeWhatsAppDocument({ body: input.body, filename, mimeType, buffer, fromNumber: input.fromNumber });
    console.log(`[whatsapp-invoice] extraction done logId=${input.whatsappLogId} supplier="${analysis.supplier}" supplierTaxId=${analysis.supplierTaxId ?? "null"} amount=${analysis.amount ?? "null"} invoiceNumber=${analysis.invoiceNumber ?? "null"} invoiceDate=${analysis.invoiceDate ?? "null"} dueDate=${analysis.dueDate ?? "null"} documentType=${analysis.documentType} confidence=${analysis.confidence}`);

    const supplier = usableSupplierName(analysis.supplier) ? analysis.supplier.trim() : "Unknown supplier";
    const amount = normalizeAmount(analysis.amount);
    if (supplier === "Unknown supplier" || amount === null || !analysis.invoiceNumber) {
      console.warn("[whatsapp-invoice] extraction incomplete", {
        logId: input.whatsappLogId,
        filename,
        supplier,
        amount,
        invoiceNumber: analysis.invoiceNumber,
        documentType: analysis.documentType,
      });
    }
    const duplicate = await findExistingCrossSourceDuplicate({
      organizationId: input.organizationId,
      supplier,
      supplierTaxId: analysis.supplierTaxId ?? null,
      invoiceNumber: analysis.invoiceNumber,
      amount,
      invoiceDate: analysis.invoiceDate,
      fileHash,
    });
    if (duplicate) {
      console.log(`[whatsapp-invoice] duplicate detected logId=${input.whatsappLogId} reason=${duplicate.reason} paymentId=${duplicate.paymentId ?? "null"}`);
      if (duplicate.paymentId) {
        await attachWhatsAppSourceToPayment({
          paymentId: duplicate.paymentId,
          whatsappLogId: input.whatsappLogId,
          fromNumber: input.fromNumber,
          duplicateReason: duplicate.reason,
        });
        await syncPaymentToSheet(input.organizationId, duplicate.paymentId, {
          supplierTaxId: analysis.supplierTaxId ?? null,
          invoiceNumber: analysis.invoiceNumber,
          invoiceDate: analysis.invoiceDate,
          driveLink: duplicate.driveLink,
          driveFolderLink: null,
        });
      }
      processed.push({
        filename,
        supplier: duplicate.supplier ?? supplier,
        amount: duplicate.amount ?? amount,
        invoiceNumber: analysis.invoiceNumber,
        documentType: analysis.documentType,
        documentDate: analysis.invoiceDate,
        driveLink: duplicate.driveLink,
        paymentId: duplicate.paymentId,
        invoiceId: null,
        created: false,
        duplicateDetected: true,
        duplicateReason: duplicate.reason,
      });
      continue;
    }

    const existingDriveFile = await findExistingSupplierDriveDocument({
      organizationId: input.organizationId,
      drive,
      rootFolderId,
      supplier,
      supplierTaxId: analysis.supplierTaxId ?? null,
      documentType: analysis.documentType,
      filename,
      fileSha256: fileHash,
      fileMd5,
    });
    if (existingDriveFile) {
      console.log(`[whatsapp-invoice] stop=drive_existing_file_without_payment_create logId=${input.whatsappLogId} driveFileId=${existingDriveFile.id ?? "null"}`);
      processed.push({
        filename,
        supplier,
        amount,
        invoiceNumber: analysis.invoiceNumber,
        documentType: analysis.documentType,
        documentDate: analysis.invoiceDate,
        driveLink: existingDriveFile.webViewLink ?? (existingDriveFile.id ? `https://drive.google.com/file/d/${existingDriveFile.id}/view` : null),
        paymentId: null,
        invoiceId: null,
        created: false,
        duplicateDetected: true,
        duplicateReason: "google_drive_existing_file",
      });
      continue;
    }

    const upload = await uploadInvoiceAttachmentToDrive({
      organizationId: input.organizationId,
      drive,
      rootFolderId,
      supplier,
      supplierTaxId: analysis.supplierTaxId ?? null,
      documentType: analysis.documentType,
      filename,
      mimeType,
      receivedAt: new Date(),
      buffer,
      fileSha256: fileHash,
      fileMd5,
    });
    console.log(`[whatsapp-invoice] drive upload done logId=${input.whatsappLogId} driveFileId=${upload.fileId ?? "null"} supplierFolderId=${upload.supplierFolderId ?? "null"}`);

    const supplierClientId = await findSupplierClientForWhatsAppDocument({
      organizationId: input.organizationId,
      preferredClientId: input.clientId ?? null,
      supplier,
      fromNumber: input.fromNumber,
    });
    const payment = await upsertWhatsAppSupplierPayment({
      organizationId: input.organizationId,
      clientId: supplierClientId,
      whatsappLogId: input.whatsappLogId,
      supplier,
      amount,
      documentType: analysis.documentType,
      paymentRequired: analysis.paymentRequired,
      dueDate: analysis.dueDate,
      invoiceDate: analysis.invoiceDate,
      invoiceNumber: analysis.invoiceNumber,
      driveLink: upload.webViewLink || null,
      fromNumber: input.fromNumber,
      filename,
      fileHash,
    });
    console.log(`[whatsapp-invoice] payment upsert done logId=${input.whatsappLogId} paymentId=${payment.id} created=${payment.created}`);
    const invoice = await upsertWhatsAppInvoiceRecord({
      organizationId: input.organizationId,
      clientId: supplierClientId,
      whatsappLogId: input.whatsappLogId,
      supplier,
      amount,
      currency: analysis.currency ?? "ILS",
      invoiceDate: analysis.invoiceDate,
      dueDate: analysis.dueDate,
      invoiceNumber: analysis.invoiceNumber,
      documentType: analysis.documentType,
      driveLink: upload.webViewLink || null,
      fromNumber: input.fromNumber,
      filename,
    });
    console.log(`[whatsapp-invoice] invoice upsert done logId=${input.whatsappLogId} invoiceId=${invoice?.id ?? "skipped_no_client"} created=${invoice?.created ?? false}`);
    await syncPaymentToSheet(input.organizationId, payment.id, {
      supplierTaxId: analysis.supplierTaxId ?? null,
      invoiceNumber: analysis.invoiceNumber,
      invoiceDate: analysis.invoiceDate,
      driveLink: upload.webViewLink || null,
      driveFolderLink: upload.supplierFolderId ? `https://drive.google.com/drive/folders/${upload.supplierFolderId}` : null,
    });
    console.log(`[whatsapp-invoice] sheets sync requested logId=${input.whatsappLogId} paymentId=${payment.id}`);

    processed.push({
      filename,
      supplier,
      amount,
      invoiceNumber: analysis.invoiceNumber,
      documentType: analysis.documentType,
      documentDate: analysis.invoiceDate,
      driveLink: upload.webViewLink || null,
      paymentId: payment.id,
      invoiceId: invoice?.id ?? null,
      created: payment.created,
      duplicateDetected: false,
      duplicateReason: null,
    });
  }

  return {
    processed,
    skipped: input.media.length - supportedMedia.length,
    reply: buildReply(processed),
  };
}

export function parseTwilioMedia(body: Record<string, unknown>) {
  const count = Number(body.NumMedia ?? 0);
  const media: WhatsAppMediaInput["media"] = [];
  for (let i = 0; i < count; i += 1) {
    const url = body[`MediaUrl${i}`];
    if (typeof url !== "string" || !url) continue;
    const contentTypeValue = body[`MediaContentType${i}`];
    const filenameValue = body[`MediaFileName${i}`] ?? body[`MediaFilename${i}`];
    media.push({
      url,
      contentType: typeof contentTypeValue === "string" ? contentTypeValue : "",
      filename: typeof filenameValue === "string" ? filenameValue : null,
    });
  }
  return media;
}

async function downloadTwilioMedia(url: string) {
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    throw new Error("Twilio credentials are required to download WhatsApp media");
  }
  const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    throw new Error(`Twilio media download failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function extractPdfText(buffer: Buffer) {
  let parser: { getText(): Promise<{ text?: string }>; destroy(): Promise<void> } | null = null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const parsed = await parser.getText();
    return parsed.text?.trim() ?? "";
  } catch (err) {
    console.warn("[whatsapp-invoice] PDF text extraction failed", err instanceof Error ? err.message : String(err));
    return "";
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

async function analyzeWhatsAppDocument(input: {
  body: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  fromNumber: string;
}): Promise<EmailAnalysis> {
  let fileScan: InvoiceScanResult | null = null;
  try {
    fileScan = await analyzeInvoiceFile({
      fileBase64: input.buffer.toString("base64"),
      mimeType: input.mimeType,
      filename: input.filename,
    });
  } catch (err) {
    console.error("[whatsapp-invoice] file OCR extraction failed", {
      filename: input.filename,
      mimeType: input.mimeType,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const textAnalysis = input.mimeType === PDF_MIME || !fileScan || !usableSupplierName(fileScan.supplier) || fileScan.amount === null || !fileScan.invoiceNumber
    ? await analyzeWhatsAppDocumentTextFallback(input).catch((err) => {
        console.error("[whatsapp-invoice] text fallback extraction failed", {
          filename: input.filename,
          mimeType: input.mimeType,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      })
    : null;

  const imageScan = mergeInvoiceScan(fileScan, textAnalysis);
  return {
    supplier: imageScan.supplier,
    supplierTaxId: imageScan.supplierTaxId ?? null,
    amount: imageScan.amount,
    currency: imageScan.currency,
    documentType: imageScan.documentType ?? "other",
    paymentRequired: imageScan.paymentRequired ?? imageScan.documentType !== "receipt",
    dueDate: imageScan.dueDate ?? null,
    invoiceDate: imageScan.date,
    invoiceNumber: imageScan.invoiceNumber,
    tasks: [],
    confidence: 0.85,
  };
}

async function analyzeWhatsAppDocumentTextFallback(input: {
  body: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  fromNumber: string;
}) {
  const pdfText = input.mimeType === PDF_MIME ? await extractPdfText(input.buffer) : "";
  return analyzeEmailContent({
    subject: `WhatsApp document ${input.filename}`,
    body: [
      input.body,
      pdfText && `--- WHATSAPP PDF TEXT ---\n${pdfText}`,
      `Filename: ${input.filename}`,
    ].filter(Boolean).join("\n\n"),
    filenames: [input.filename],
    sender: input.fromNumber,
  });
}

function mergeInvoiceScan(fileScan: InvoiceScanResult | null, fallback: EmailAnalysis | null): InvoiceScanResult {
  return {
    supplier: usableSupplierName(fileScan?.supplier) ? fileScan!.supplier : fallback?.supplier ?? "לא ידוע",
    supplierTaxId: fileScan?.supplierTaxId ?? fallback?.supplierTaxId ?? null,
    amount: normalizeAmount(fileScan?.amount) ?? normalizeAmount(fallback?.amount),
    date: fileScan?.date ?? fallback?.invoiceDate ?? null,
    dueDate: fileScan?.dueDate ?? fallback?.dueDate ?? null,
    invoiceNumber: fileScan?.invoiceNumber ?? fallback?.invoiceNumber ?? null,
    documentType: fileScan?.documentType ?? fallback?.documentType ?? "other",
    paymentRequired: fileScan?.paymentRequired ?? fallback?.paymentRequired ?? fileScan?.documentType !== "receipt",
    currency: fileScan?.currency ?? fallback?.currency ?? "ILS",
  };
}

async function findSupplierClientForWhatsAppDocument(input: {
  organizationId: string;
  preferredClientId: string | null;
  supplier: string;
  fromNumber: string;
}) {
  if (input.preferredClientId) return input.preferredClientId;
  const existing = await prisma.client.findFirst({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      name: input.supplier,
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.client.update({ where: { id: existing.id }, data: { lastSeen: new Date() } });
    return existing.id;
  }

  if (!config.twilio.createClientsEnabled) {
    console.log(`[whatsapp-invoice] supplier client creation disabled supplier="${input.supplier}" from=${input.fromNumber}`);
    return null;
  }

  const digits = input.fromNumber.replace(/\D/g, "").slice(-10) || String(Date.now());
  const created = await prisma.client.create({
    data: {
      organizationId: input.organizationId,
      name: input.supplier,
      email: `whatsapp-supplier-${digits}@whatsapp.local`,
      firstSeen: new Date(),
      lastSeen: new Date(),
      color: "#F59E0B",
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertWhatsAppInvoiceRecord(input: {
  organizationId: string;
  clientId: string | null;
  whatsappLogId: string;
  supplier: string;
  amount: number | null;
  currency: string;
  invoiceDate: string | null;
  dueDate: string | null;
  invoiceNumber: string | null;
  documentType: string;
  driveLink: string | null;
  fromNumber: string;
  filename: string;
}) {
  if (!input.clientId) return null;
  const date = normalizeDate(input.invoiceDate) ?? new Date();
  const emailId = `whatsapp:${input.whatsappLogId}:${input.invoiceNumber ?? input.filename}`;
  const existing = await prisma.invoice.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      emailId,
      invoiceNumber: input.invoiceNumber,
    },
    select: { id: true },
  });
  if (existing) {
    const updated = await prisma.invoice.update({
      where: { id: existing.id },
      data: {
        amount: input.amount ?? 0,
        currency: input.currency || "ILS",
        date,
        dueDate: normalizeDate(input.dueDate),
        status: input.documentType === "receipt" ? "paid" : "pending",
        description: `WhatsApp ${input.documentType}: ${input.supplier}`,
        driveUrl: input.driveLink,
        fromEmail: input.fromNumber,
        gmailMessageId: `whatsapp:${input.whatsappLogId}`,
      },
      select: { id: true },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.invoice.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      invoiceNumber: input.invoiceNumber,
      amount: input.amount ?? 0,
      currency: input.currency || "ILS",
      date,
      dueDate: normalizeDate(input.dueDate),
      status: input.documentType === "receipt" ? "paid" : "pending",
      description: `WhatsApp ${input.documentType}: ${input.supplier}`,
      driveUrl: input.driveLink,
      emailId,
      fromEmail: input.fromNumber,
      gmailMessageId: `whatsapp:${input.whatsappLogId}`,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function upsertWhatsAppSupplierPayment(input: {
  organizationId: string;
  clientId: string | null;
  whatsappLogId: string;
  supplier: string;
  amount: number | null;
  documentType: string;
  paymentRequired: boolean;
  dueDate: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  driveLink: string | null;
  fromNumber: string;
  filename: string;
  fileHash: string;
}) {
  const date = normalizeDate(input.invoiceDate) ?? new Date();
  const duplicateHash = buildDuplicateHash({
    organizationId: input.organizationId,
    supplier: input.supplier,
    amount: input.amount ?? 0,
    dateIso: input.fileHash ? "1970-01-01" : date.toISOString(),
    subject: input.fileHash ? `file:${input.fileHash}` : `whatsapp:${input.whatsappLogId}:${input.filename}:${input.invoiceNumber ?? ""}`,
  });
  const invoiceLink = input.documentType === "invoice" || input.documentType === "receipt" ? input.driveLink : null;
  const documentLink = input.documentType === "payment_request" ? input.driveLink : invoiceLink ?? input.driveLink;

  const existing = await prisma.supplierPayment.findUnique({
    where: { organizationId_duplicateHash: { organizationId: input.organizationId, duplicateHash } },
  });
  if (existing) {
    const updated = await prisma.supplierPayment.update({
      where: { id: existing.id },
      data: {
        clientId: input.clientId ?? existing.clientId,
        amount: input.amount ?? existing.amount,
        dueDate: normalizeDate(input.dueDate) ?? existing.dueDate,
        documentLink: documentLink ?? existing.documentLink,
        invoiceLink: invoiceLink ?? existing.invoiceLink,
        emailSender: input.fromNumber,
        paymentRequired: input.paymentRequired,
        missingInvoice: Boolean(input.paymentRequired && !invoiceLink),
        subject: duplicateSubject(input.invoiceNumber ? `WhatsApp ${input.invoiceNumber}` : `WhatsApp ${input.filename}`, false, null),
        firstSource: existing.firstSource ?? existing.source,
        lastSource: "whatsapp",
        sourceCount: Math.max(existing.sourceCount ?? 1, 1),
        duplicateDetected: false,
        duplicateReason: null,
        lastSeenAt: new Date(),
      },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.supplierPayment.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      supplier: input.supplier,
      amount: input.amount ?? 0,
      currency: "ILS",
      date,
      dueDate: normalizeDate(input.dueDate),
      paid: input.documentType === "receipt",
      documentLink,
      invoiceLink,
      emailSender: input.fromNumber,
      paymentRequired: input.paymentRequired || input.documentType !== "receipt",
      missingInvoice: Boolean(input.paymentRequired && !invoiceLink),
      duplicateHash,
      subject: duplicateSubject(input.invoiceNumber ? `WhatsApp ${input.invoiceNumber}` : `WhatsApp ${input.filename}`, false, null),
      source: "whatsapp",
      firstSource: "whatsapp",
      lastSource: "whatsapp",
      sourceCount: 1,
      duplicateDetected: false,
      duplicateReason: null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      emailMessageId: `whatsapp:${input.whatsappLogId}`,
    },
  });
  return { id: created.id, created: true };
}

async function findExistingCrossSourceDuplicate(input: {
  organizationId: string;
  supplier: string;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  amount: number | null;
  invoiceDate: string | null;
  fileHash: string;
}) {
  const byFileHash = await prisma.supplierPayment.findFirst({
    where: {
      organizationId: input.organizationId,
      duplicateHash: buildDuplicateHash({
        organizationId: input.organizationId,
        supplier: input.supplier,
        amount: input.amount ?? 0,
        dateIso: "1970-01-01",
        subject: `file:${input.fileHash}`,
      }),
    },
  });
  if (byFileHash) {
    return paymentDuplicate(byFileHash, "file_hash");
  }

  if (input.supplierTaxId && input.invoiceNumber) {
    const scanItems = await prisma.gmailScanItem.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const matchingScanItem = scanItems.find((item) => {
      const raw = item.rawAnalysis as Record<string, any> | null;
      const taxId = normalizeTaxId(raw?.supplierTaxId ?? raw?.supplier?.taxId ?? raw?.analysis?.supplierTaxId);
      const invoiceNumber = normalizeInvoiceNumber(raw?.invoiceNumber ?? raw?.analysis?.invoiceNumber);
      return taxId === normalizeTaxId(input.supplierTaxId) && invoiceNumber === normalizeInvoiceNumber(input.invoiceNumber);
    });
    if (matchingScanItem) {
      const payment = matchingScanItem.emailMessageId
        ? await prisma.supplierPayment.findFirst({
            where: { organizationId: input.organizationId, emailMessageId: matchingScanItem.emailMessageId },
          })
        : null;
      return {
        paymentId: payment?.id ?? null,
        supplier: payment?.supplier ?? matchingScanItem.supplierName,
        amount: payment?.amount ?? matchingScanItem.amount,
        driveLink: payment?.invoiceLink ?? payment?.documentLink ?? matchingScanItem.driveFileLink,
        reason: "supplier_tax_id_invoice_number",
      };
    }
  }

  if (input.amount !== null && input.invoiceDate) {
    const date = normalizeDate(input.invoiceDate);
    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      const payment = await prisma.supplierPayment.findFirst({
        where: {
          organizationId: input.organizationId,
          supplier: { equals: input.supplier, mode: "insensitive" },
          amount: input.amount,
          date: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { createdAt: "desc" },
      });
      if (payment) return paymentDuplicate(payment, "supplier_amount_invoice_date");
    }
  }

  return null;
}

async function attachWhatsAppSourceToPayment(input: {
  paymentId: string;
  whatsappLogId: string;
  fromNumber: string;
  duplicateReason: string;
}) {
  const payment = await prisma.supplierPayment.findUnique({ where: { id: input.paymentId } });
  if (!payment) return;
  await prisma.supplierPayment.update({
    where: { id: input.paymentId },
    data: {
      source: payment.source === "gmail" || payment.source === "both" ? "both" : payment.source,
      emailSender: input.fromNumber,
      lastSource: "whatsapp",
      sourceCount: Math.max(payment.sourceCount ?? 1, 1) + 1,
      duplicateDetected: true,
      duplicateReason: input.duplicateReason,
      firstSeenAt: payment.firstSeenAt ?? payment.createdAt,
      lastSeenAt: new Date(),
      subject: duplicateSubject(payment.subject, true, input.duplicateReason),
    },
  });
}

async function syncPaymentToSheet(
  organizationId: string,
  paymentId: string,
  metadata: {
    supplierTaxId?: string | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    driveLink?: string | null;
    driveFolderLink?: string | null;
  }
) {
  const payment = await prisma.supplierPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return;
  const sheet = await appendSupplierPaymentToSheet({
    organizationId,
    paymentId: payment.id,
    supplier: payment.supplier,
    amount: payment.amount,
    date: payment.date,
    dueDate: payment.dueDate,
    paid: payment.paid,
    missingInvoice: payment.missingInvoice,
    documentLink: payment.documentLink ?? metadata.driveLink,
    invoiceLink: payment.invoiceLink ?? metadata.driveLink,
    supplierTaxId: metadata.supplierTaxId ?? null,
    invoiceNumber: metadata.invoiceNumber ?? null,
    invoiceDate: metadata.invoiceDate ?? payment.date,
    source: payment.source,
    duplicateDetected: payment.duplicateDetected,
    duplicateReason: payment.duplicateReason,
    driveFolderLink: metadata.driveFolderLink ?? null,
    paidDate: payment.paid ? payment.updatedAt : null,
    receiptLink: payment.paid ? payment.documentLink ?? metadata.driveLink ?? null : null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  });
  console.log(`[whatsapp-invoice] sheets sync done paymentId=${paymentId} row=${sheet.row ?? "null"} spreadsheet=${sheet.spreadsheetId}`);
}

function paymentDuplicate(payment: {
  id: string;
  supplier: string;
  amount: number;
  invoiceLink: string | null;
  documentLink: string | null;
}, reason: string) {
  return {
    paymentId: payment.id,
    supplier: payment.supplier,
    amount: payment.amount,
    driveLink: payment.invoiceLink ?? payment.documentLink,
    reason,
  };
}

function isSupportedDocumentMedia(media: { contentType: string; url: string; filename?: string | null }) {
  const mimeType = media.contentType.toLowerCase();
  const filename = media.filename ?? media.url;
  return mimeType.includes("pdf") ||
    IMAGE_MIMES.has(mimeType) ||
    /\.(pdf|jpe?g|png)(?:$|\?)/i.test(filename);
}

function normalizeMediaMimeType(media: { contentType: string; filename?: string | null; url: string }) {
  const mimeType = media.contentType.toLowerCase();
  if (mimeType.includes("pdf") || /\.pdf(?:$|\?)/i.test(media.filename ?? media.url)) return PDF_MIME;
  if (mimeType.includes("png") || /\.png(?:$|\?)/i.test(media.filename ?? media.url)) return "image/png";
  return "image/jpeg";
}

function whatsAppDocumentFilename(logId: string, index: number, mimeType: string) {
  const extension = mimeType === PDF_MIME ? "pdf" : mimeType === "image/png" ? "png" : "jpg";
  return `whatsapp_${logId.slice(-8)}_${index + 1}.${extension}`;
}

function usableSupplierName(value: string | null | undefined) {
  if (!value?.trim()) return false;
  return !/^(לא ידוע|unknown|unknown supplier)$/i.test(value.trim());
}

function normalizeAmount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildReply(items: ProcessedWhatsAppInvoice[]) {
  if (!items.length) return null;
  if (items.every((item) => item.duplicateDetected)) {
    return "המסמך כבר קיים במערכת. לא נוצרה כפילות.";
  }
  return items.map((item, index) => [
    items.length > 1 ? `מסמך ${index + 1}:` : null,
    `שם ספק: ${item.supplier}`,
    `סכום: ${item.amount ? `${item.amount.toLocaleString("he-IL")} ₪` : "לא זוהה"}`,
    `תאריך: ${item.documentDate ?? "לא זוהה"}`,
    `סטטוס: ${item.duplicateDetected ? "המסמך כבר קיים במערכת. לא נוצרה כפילות." : item.created ? "נוצר תשלום ספק" : "עודכן תשלום ספק קיים"}`,
    `קישור למסמך: ${item.driveLink ?? "לא זמין"}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function md5(buffer: Buffer) {
  return createHash("md5").update(buffer).digest("hex");
}

function normalizeTaxId(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeInvoiceNumber(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function duplicateSubject(subject: string | null, duplicateDetected: boolean, duplicateReason: string | null) {
  const clean = (subject ?? "WhatsApp document").replace(/\s*\[duplicate:[^\]]+\]/g, "");
  return duplicateDetected && duplicateReason ? `${clean} [duplicate:${duplicateReason}]` : clean;
}
