import { createHash } from "node:crypto";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { analyzeEmailContent, analyzeInvoiceFile, type EmailAnalysis, type InvoiceScanResult } from "./claude.js";
import type { drive_v3 } from "googleapis";
import { ensureInvoiceFolderTree, findExistingSupplierDriveDocument, uploadInvoiceAttachmentToDrive } from "./driveService.js";
import { getGoogleClientsIfAvailable, type GoogleClients } from "./google.js";
import { appendSupplierPaymentToSheet } from "./supplierPaymentsSheet.js";
import { recordFinancialDocumentDecision } from "./financialDocuments.js";
import { isValidSupplierNameShared } from "./supplier/supplierValidation.js";
import { clampBusinessDateString } from "./dates/businessDate.js";
import {
  createSupplierPaymentIfTrusted,
  evaluateFinanceTrustGates,
} from "./trust/financeTrustPersistence.js";
import { parseTrustGatesFromParsedFields, trustGatesFailClosedReason } from "./trust/trustGatePersistence.js";
import { computeCanonicalFingerprint, matchFinancialDocuments, type DedupMatchResult, type FinancialDocumentFingerprintInput } from "./dedup/sharedMatcher.js";
import { buildLegacyFileDuplicateHashForLookup, buildPaymentLookupsFromCanonical } from "./dedup/fingerprintMigration.js";
import { resolveWhatsAppMoneyDecision, summarizeMoneyDecision } from "./amount/amountCandidates.js";
import { classifyBusinessDocument, pipelineActionForClassification } from "./classification/classifier.js";
import { maskSupplierForLog } from "./whatsappSafety.js";

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

export type WhatsAppDriveContext = {
  drive: drive_v3.Drive;
  rootFolderId: string;
};

export type WhatsAppInvoiceIngestionDeps = {
  getGoogleClientsIfAvailable?: (
    organizationId: string,
    context?: string
  ) => Promise<GoogleClients | null>;
  ensureWhatsAppDriveContextFn?: (
    organizationId: string,
    whatsappLogId: string,
    getGoogleClientsIfAvailableFn: WhatsAppInvoiceIngestionDeps["getGoogleClientsIfAvailable"]
  ) => Promise<WhatsAppDriveContext | null>;
  downloadTwilioMediaFn?: (url: string) => Promise<Buffer>;
  analyzeWhatsAppDocumentFn?: (input: {
    body: string;
    filename: string;
    mimeType: string;
    buffer: Buffer;
    fromNumber: string;
  }) => Promise<EmailAnalysis>;
  recordFinancialDocumentDecisionFn?: typeof recordFinancialDocumentDecision;
  findExistingCrossSourceDuplicateFn?: typeof findExistingCrossSourceDuplicate;
  findExistingSupplierDriveDocumentFn?: typeof findExistingSupplierDriveDocument;
  uploadInvoiceAttachmentToDriveFn?: typeof uploadInvoiceAttachmentToDrive;
  upsertWhatsAppSupplierPaymentFn?: typeof upsertWhatsAppSupplierPayment;
  organizationLookup?: (organizationId: string) => Promise<{ businessName: string | null } | null>;
};

export async function ensureWhatsAppDriveContext(
  organizationId: string,
  whatsappLogId: string,
  getGoogleClientsIfAvailableFn: NonNullable<WhatsAppInvoiceIngestionDeps["getGoogleClientsIfAvailable"]> = getGoogleClientsIfAvailable
): Promise<WhatsAppDriveContext | null> {
  const clients = await getGoogleClientsIfAvailableFn(organizationId, "whatsapp_invoice_drive_phase");
  if (!clients) {
    console.warn(JSON.stringify({
      event: "whatsapp_drive_phase_skipped",
      reason: "google_not_connected",
      organizationId,
      whatsappLogId,
    }));
    return null;
  }

  try {
    const rootFolderId = await ensureInvoiceFolderTree(clients.drive);
    return { drive: clients.drive, rootFolderId };
  } catch (err) {
    console.warn(JSON.stringify({
      event: "whatsapp_drive_phase_skipped",
      reason: "drive_folder_setup_failed",
      organizationId,
      whatsappLogId,
      error: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

export async function ingestWhatsAppInvoiceMedia(input: WhatsAppMediaInput, deps: WhatsAppInvoiceIngestionDeps = {}) {
  const getGoogleClientsIfAvailableFn = deps.getGoogleClientsIfAvailable ?? getGoogleClientsIfAvailable;
  const ensureDriveContextFn = deps.ensureWhatsAppDriveContextFn
    ?? ((organizationId, whatsappLogId) => ensureWhatsAppDriveContext(organizationId, whatsappLogId, getGoogleClientsIfAvailableFn));
  const downloadMedia = deps.downloadTwilioMediaFn ?? downloadTwilioMedia;
  const analyzeDocument = deps.analyzeWhatsAppDocumentFn ?? analyzeWhatsAppDocument;
  const recordDocumentDecision = deps.recordFinancialDocumentDecisionFn ?? recordFinancialDocumentDecision;
  const findCrossSourceDuplicate = deps.findExistingCrossSourceDuplicateFn ?? findExistingCrossSourceDuplicate;
  const findExistingDriveDocument = deps.findExistingSupplierDriveDocumentFn ?? findExistingSupplierDriveDocument;
  const uploadToDrive = deps.uploadInvoiceAttachmentToDriveFn ?? uploadInvoiceAttachmentToDrive;
  const upsertSupplierPayment = deps.upsertWhatsAppSupplierPaymentFn ?? upsertWhatsAppSupplierPayment;

  const supportedMedia = input.media.filter((item) => isSupportedDocumentMedia(item));
  if (!supportedMedia.length) {
    console.log(`[whatsapp-invoice] stop=no_supported_media logId=${input.whatsappLogId} media=${input.media.length}`);
    return { processed: [], skipped: input.media.length, reply: null };
  }

  const organization = deps.organizationLookup
    ? await deps.organizationLookup(input.organizationId)
    : await prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { businessName: true },
      });
  const processed: ProcessedWhatsAppInvoice[] = [];
  let driveContextPromise: Promise<WhatsAppDriveContext | null> | null = null;
  const resolveDriveContext = () => {
    if (!driveContextPromise) {
      driveContextPromise = ensureDriveContextFn(input.organizationId, input.whatsappLogId, getGoogleClientsIfAvailableFn);
    }
    return driveContextPromise;
  };

  for (const [index, media] of supportedMedia.entries()) {
    const mimeType = normalizeMediaMimeType(media);
    const filename = media.filename || whatsAppDocumentFilename(input.whatsappLogId, index, mimeType);
    console.log(`[whatsapp-invoice] media download start logId=${input.whatsappLogId} index=${index} filename="${filename}" mime=${mimeType}`);
    const buffer = await downloadMedia(media.url);
    console.log(`[whatsapp-invoice] media download done logId=${input.whatsappLogId} index=${index} bytes=${buffer.length}`);
    const fileHash = sha256(buffer);
    const fileMd5 = md5(buffer);
    console.log(`[whatsapp-invoice] extraction start logId=${input.whatsappLogId} index=${index} filename="${filename}" mime=${mimeType} bytes=${buffer.length}`);
    const analysis = await analyzeDocument({ body: input.body, filename, mimeType, buffer, fromNumber: input.fromNumber });
    console.log(`[whatsapp-invoice] extraction done logId=${input.whatsappLogId} supplier="${maskSupplierForLog(analysis.supplier)}" amount=${analysis.amount ?? "null"} invoiceNumber=${analysis.invoiceNumber ? "present" : "null"} documentType=${analysis.documentType} confidence=${analysis.confidence}`);

    // F4: גבול שפיות ±2 שנים על תאריכים — זהה למסלול Gmail, דרך המודול המשותף.
    // תאריך מחוץ לטווח מתאפס ל-null (ולא נשמר כתאריך עתידי/עתיק שגוי).
    const rawInvoiceDate = analysis.invoiceDate;
    const rawDueDate = analysis.dueDate;
    analysis.invoiceDate = clampBusinessDateString(analysis.invoiceDate);
    analysis.dueDate = clampBusinessDateString(analysis.dueDate);
    if (rawInvoiceDate !== analysis.invoiceDate || rawDueDate !== analysis.dueDate) {
      console.warn(`[whatsapp-invoice] date outside ±2y window dropped logId=${input.whatsappLogId} invoiceDate="${rawInvoiceDate}" dueDate="${rawDueDate}"`);
    }

    const supplier = usableSupplierName(analysis.supplier) ? analysis.supplier.trim() : "Unknown supplier";
    const moneyDecision = resolveWhatsAppMoneyDecision({
      organizationId: input.organizationId,
      documentType: analysis.documentType,
      analysis,
    });
    const amount = moneyDecision.selectedAmount;
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
    const documentDecision = await recordDocumentDecision({
      organizationId: input.organizationId,
      source: "whatsapp",
      sender: input.fromNumber,
      subject: input.body,
      fileName: filename,
      fileSize: buffer.length,
      supplierName: supplier,
      supplierTaxId: analysis.supplierTaxId ?? null,
      invoiceNumber: analysis.invoiceNumber,
      documentDate: analysis.invoiceDate,
      dueDate: analysis.dueDate,
      amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
      vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
      totalAmount: amount,
      documentType: analysis.documentType,
      confidenceScore: analysis.confidence,
      uncertaintyReason: supplier === "Unknown supplier" || amount === null || !analysis.invoiceNumber
        ? "חסרים פרטי ספק, סכום או מספר חשבונית"
        : null,
      rawAnalysis: { analysis, whatsappLogId: input.whatsappLogId },
      whatsappLogId: input.whatsappLogId,
      fileSha256: fileHash,
    });
    if (documentDecision.action !== "accepted") {
      processed.push({
        filename,
        supplier,
        amount,
        invoiceNumber: analysis.invoiceNumber,
        documentType: analysis.documentType,
        documentDate: analysis.invoiceDate,
        driveLink: null,
        paymentId: documentDecision.action === "duplicate" ? documentDecision.payment.id : null,
        invoiceId: null,
        created: false,
        duplicateDetected: documentDecision.action === "duplicate",
        duplicateReason: documentDecision.action,
      });
      continue;
    }
    const businessClassification = classifyBusinessDocument({
      sender: input.fromNumber,
      subject: input.body,
      body: input.body,
      documentType: analysis.documentType,
      supplierName: supplier,
      businessName: organization?.businessName ?? undefined,
      issuedBy: supplier,
      issuedTo: organization?.businessName ?? undefined,
      paymentRequired: analysis.paymentRequired,
      channel: "whatsapp",
      metadata: { whatsappLogId: input.whatsappLogId, filename },
    });
    const pipelineAction = pipelineActionForClassification(businessClassification);
    if (pipelineAction === "NEEDS_REVIEW") {
      const reviewDecision = await recordDocumentDecision({
        organizationId: input.organizationId,
        source: "whatsapp",
        sender: input.fromNumber,
        subject: input.body,
        fileName: filename,
        fileSize: buffer.length,
        supplierName: supplier,
        supplierTaxId: analysis.supplierTaxId ?? null,
        invoiceNumber: analysis.invoiceNumber,
        documentDate: analysis.invoiceDate,
        dueDate: analysis.dueDate,
        amountBeforeVat: analysis.amountBeforeVat ?? null,
        vatAmount: analysis.vatAmount ?? null,
        totalAmount: analysis.totalAmount ?? amount,
        documentType: "payment_request",
        confidenceScore: Math.min(analysis.confidence, 0.79),
        uncertaintyReason: `classifier:${businessClassification.reason}`,
        rawAnalysis: { analysis, businessClassification, whatsappLogId: input.whatsappLogId },
        whatsappLogId: input.whatsappLogId,
        fileSha256: fileHash,
      });
      processed.push({
        filename,
        supplier,
        amount,
        invoiceNumber: analysis.invoiceNumber,
        documentType: analysis.documentType,
        documentDate: analysis.invoiceDate,
        driveLink: null,
        paymentId: null,
        invoiceId: null,
        created: false,
        duplicateDetected: false,
        duplicateReason: reviewDecision.action,
      });
      continue;
    }
    const isSupplierExpense = pipelineAction === "SUPPLIER_EXPENSE";
    const invoiceClientId = pipelineAction === "CUSTOMER_INVOICE"
      ? await findSupplierClientForWhatsAppDocument({
          organizationId: input.organizationId,
          preferredClientId: input.clientId ?? null,
          supplier,
          fromNumber: input.fromNumber,
        })
      : null;
    const duplicate = isSupplierExpense ? await findCrossSourceDuplicate({
      organizationId: input.organizationId,
      supplier,
      supplierTaxId: analysis.supplierTaxId ?? null,
      invoiceNumber: analysis.invoiceNumber,
      amount,
      invoiceDate: analysis.invoiceDate,
      fileHash,
    }) : null;
    if (duplicate?.matchResult === "UNSURE") {
      const reviewDecision = await recordDocumentDecision({
        organizationId: input.organizationId,
        source: "whatsapp",
        sender: input.fromNumber,
        subject: input.body,
        fileName: filename,
        fileSize: buffer.length,
        supplierName: supplier,
        supplierTaxId: analysis.supplierTaxId ?? null,
        invoiceNumber: analysis.invoiceNumber,
        documentDate: analysis.invoiceDate,
        dueDate: analysis.dueDate,
        amountBeforeVat: analysis.amountBeforeVat ?? null,
        vatAmount: analysis.vatAmount ?? null,
        totalAmount: analysis.totalAmount ?? amount,
        documentType: analysis.documentType,
        confidenceScore: Math.min(analysis.confidence, 0.79),
        uncertaintyReason: `possible duplicate: ${duplicate.reason}`,
        rawAnalysis: { analysis, whatsappLogId: input.whatsappLogId, duplicateReasons: duplicate.reasons },
        whatsappLogId: input.whatsappLogId,
        fileSha256: fileHash,
      });
      processed.push({
        filename,
        supplier,
        amount,
        invoiceNumber: analysis.invoiceNumber,
        documentType: analysis.documentType,
        documentDate: analysis.invoiceDate,
        driveLink: null,
        paymentId: null,
        invoiceId: null,
        created: false,
        duplicateDetected: false,
        duplicateReason: reviewDecision.action,
      });
      continue;
    }
    if (duplicate) {
      console.log(`[whatsapp-invoice] duplicate detected logId=${input.whatsappLogId} reason=${duplicate.reason} paymentId=${duplicate.paymentId ?? "null"}`);
      if (duplicate.paymentId) {
        await attachWhatsAppSourceToPayment({
          paymentId: duplicate.paymentId,
          whatsappLogId: input.whatsappLogId,
          fromNumber: input.fromNumber,
          duplicateReason: duplicate.reason,
          supplier,
          amount,
          invoiceDate: analysis.invoiceDate,
          dueDate: analysis.dueDate,
          invoiceNumber: analysis.invoiceNumber,
          documentType: analysis.documentType,
          supplierTaxId: analysis.supplierTaxId ?? null,
          amountBeforeVat: analysis.amountBeforeVat ?? null,
          vatAmount: analysis.vatAmount ?? null,
          totalAmount: analysis.totalAmount ?? amount,
          confidenceScore: analysis.confidence,
          documentFingerprint: documentDecision.documentFingerprint,
          sourceFingerprint: documentDecision.sourceFingerprint,
          driveLink: duplicate.driveLink,
        });
        await syncPaymentToSheetSafely(input.organizationId, duplicate.paymentId, {
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

    const driveCtx = await resolveDriveContext();
    if (!driveCtx) {
      processed.push({
        filename,
        supplier,
        amount,
        invoiceNumber: analysis.invoiceNumber,
        documentType: analysis.documentType,
        documentDate: analysis.invoiceDate,
        driveLink: null,
        paymentId: null,
        invoiceId: null,
        created: false,
        duplicateDetected: false,
        duplicateReason: "google_not_connected",
      });
      continue;
    }
    const { drive, rootFolderId } = driveCtx;

    const existingDriveFile = await findExistingDriveDocument({
      organizationId: input.organizationId,
      drive,
      rootFolderId,
      clientId: invoiceClientId,
      supplier,
      supplierTaxId: analysis.supplierTaxId ?? null,
      documentType: analysis.documentType,
      filename,
      fileSha256: fileHash,
      fileMd5,
      documentDate: analysis.invoiceDate,
      invoiceNumber: analysis.invoiceNumber,
      amount,
      totalAmount: analysis.totalAmount ?? amount,
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

    const upload = await uploadToDrive({
      organizationId: input.organizationId,
      drive,
      rootFolderId,
      clientId: invoiceClientId,
      supplier,
      supplierTaxId: analysis.supplierTaxId ?? null,
      documentType: analysis.documentType,
      filename,
      mimeType,
      receivedAt: new Date(),
      documentDate: analysis.invoiceDate,
      invoiceNumber: analysis.invoiceNumber,
      amount,
      totalAmount: analysis.totalAmount ?? amount,
      buffer,
      fileSha256: fileHash,
      fileMd5,
    });
    console.log(`[whatsapp-invoice] drive upload done logId=${input.whatsappLogId} driveFileId=${upload.fileId ?? "null"} folderPath="${upload.folderPath}"`);

    const payment = isSupplierExpense ? await upsertSupplierPayment({
      organizationId: input.organizationId,
      clientId: null,
      whatsappLogId: input.whatsappLogId,
      supplier,
      amount,
      documentType: analysis.documentType,
      paymentRequired: analysis.paymentRequired,
      dueDate: analysis.dueDate,
      invoiceDate: analysis.invoiceDate,
      invoiceNumber: analysis.invoiceNumber,
      driveLink: upload.webViewLink || null,
      driveFileId: upload.fileId,
      driveFileUrl: upload.webViewLink || null,
      driveFolderId: upload.folderId,
      driveClientFolderId: upload.clientFolderId,
      driveSupplierFolderId: upload.supplierFolderId,
      driveFolderPath: upload.folderPath,
      invoiceMonth: upload.invoiceMonth,
      invoiceYear: upload.invoiceYear,
      documentFingerprint: documentDecision.documentFingerprint,
      sourceFingerprint: documentDecision.sourceFingerprint,
      documentTypeDetailed: documentDecision.documentType,
      supplierTaxId: analysis.supplierTaxId ?? null,
      amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
      vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
      totalAmount: amount,
      confidenceScore: analysis.confidence,
      fromNumber: input.fromNumber,
      filename,
      fileHash,
    }) : null;
    if (payment) {
      console.log(`[whatsapp-invoice] payment upsert done logId=${input.whatsappLogId} paymentId=${payment.id} created=${payment.created}`);
    }
    const invoice = pipelineAction === "CUSTOMER_INVOICE" ? await upsertWhatsAppInvoiceRecord({
      organizationId: input.organizationId,
      clientId: invoiceClientId,
      whatsappLogId: input.whatsappLogId,
      supplier,
      amount,
      currency: analysis.currency ?? "ILS",
      invoiceDate: analysis.invoiceDate,
      dueDate: analysis.dueDate,
      invoiceNumber: analysis.invoiceNumber,
      documentType: analysis.documentType,
      driveLink: upload.webViewLink || null,
      driveFileId: upload.fileId,
      driveFileUrl: upload.webViewLink || null,
      driveFolderId: upload.folderId,
      driveClientFolderId: upload.clientFolderId,
      driveSupplierFolderId: upload.supplierFolderId,
      driveFolderPath: upload.folderPath,
      invoiceMonth: upload.invoiceMonth,
      invoiceYear: upload.invoiceYear,
      documentFingerprint: documentDecision.documentFingerprint,
      sourceFingerprint: documentDecision.sourceFingerprint,
      documentTypeDetailed: documentDecision.documentType,
      supplierTaxId: analysis.supplierTaxId ?? null,
      amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
      vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
      totalAmount: amount,
      confidenceScore: analysis.confidence,
      fromNumber: input.fromNumber,
      filename,
    }) : null;
    console.log(`[whatsapp-invoice] invoice upsert done logId=${input.whatsappLogId} invoiceId=${invoice?.id ?? "skipped_no_client"} created=${invoice?.created ?? false}`);
    if (payment?.id) {
      await syncPaymentToSheetSafely(input.organizationId, payment.id, {
        supplierTaxId: analysis.supplierTaxId ?? null,
        invoiceNumber: analysis.invoiceNumber,
        invoiceDate: analysis.invoiceDate,
        driveLink: upload.webViewLink || null,
        driveFolderLink: upload.folderWebViewLink,
      });
      console.log(`[whatsapp-invoice] sheets sync requested logId=${input.whatsappLogId} paymentId=${payment.id}`);
    }

    processed.push({
      filename,
      supplier,
      amount,
      invoiceNumber: analysis.invoiceNumber,
      documentType: analysis.documentType,
      documentDate: analysis.invoiceDate,
      driveLink: upload.webViewLink || null,
      paymentId: payment?.id ?? null,
      invoiceId: invoice?.id ?? null,
      created: payment?.created ?? invoice?.created ?? false,
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
    amountBeforeVat: imageScan.amountBeforeVat ?? null,
    vatAmount: imageScan.vatAmount ?? null,
    totalAmount: imageScan.totalAmount ?? imageScan.amount,
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
    amountBeforeVat: normalizeAmount(fileScan?.amountBeforeVat) ?? normalizeAmount(fallback?.amountBeforeVat),
    vatAmount: normalizeAmount(fileScan?.vatAmount) ?? normalizeAmount(fallback?.vatAmount),
    totalAmount: normalizeAmount(fileScan?.totalAmount) ?? normalizeAmount(fallback?.totalAmount) ?? normalizeAmount(fileScan?.amount) ?? normalizeAmount(fallback?.amount),
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
    console.log(`[whatsapp-invoice] supplier client not linked supplier="${maskSupplierForLog(input.supplier)}"`);
    return null;
  }

  console.warn(
    `[whatsapp-invoice] supplier client auto-create blocked for pilot safety supplier="${maskSupplierForLog(input.supplier)}"`
  );
  return null;
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
  driveFileId: string | null;
  driveFileUrl: string | null;
  driveFolderId: string | null;
  driveClientFolderId: string | null;
  driveSupplierFolderId: string | null;
  driveFolderPath: string | null;
  invoiceMonth: number | null;
  invoiceYear: number | null;
  documentFingerprint: string;
  sourceFingerprint: string;
  documentTypeDetailed: string;
  supplierTaxId: string | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
  confidenceScore: number;
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
      OR: [
        { emailId, invoiceNumber: input.invoiceNumber },
        {
          invoiceNumber: input.invoiceNumber,
          amount: input.amount ?? 0,
          date: {
            gte: startOfDay(date),
            lte: endOfDay(date),
          },
        },
      ],
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
        driveFileId: input.driveFileId,
        driveFileUrl: input.driveFileUrl,
        driveFolderId: input.driveFolderId,
        driveClientFolderId: input.driveClientFolderId,
        driveSupplierFolderId: input.driveSupplierFolderId,
        driveFolderPath: input.driveFolderPath,
        supplierName: input.supplier,
        invoiceMonth: input.invoiceMonth,
        invoiceYear: input.invoiceYear,
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
      driveFileId: input.driveFileId,
      driveFileUrl: input.driveFileUrl,
      driveFolderId: input.driveFolderId,
      driveClientFolderId: input.driveClientFolderId,
      driveSupplierFolderId: input.driveSupplierFolderId,
      driveFolderPath: input.driveFolderPath,
      supplierName: input.supplier,
      invoiceMonth: input.invoiceMonth,
      invoiceYear: input.invoiceYear,
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
  driveFileId: string | null;
  driveFileUrl: string | null;
  driveFolderId: string | null;
  driveClientFolderId: string | null;
  driveSupplierFolderId: string | null;
  driveFolderPath: string | null;
  invoiceMonth: number | null;
  invoiceYear: number | null;
  documentFingerprint: string;
  sourceFingerprint: string;
  documentTypeDetailed: string;
  supplierTaxId: string | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
  confidenceScore: number;
  fromNumber: string;
  filename: string;
  fileHash: string;
  parsedFieldsJson?: unknown;
}) {
  const trustEvaluation = evaluateFinanceTrustGates({
    parsedFieldsJson: input.parsedFieldsJson,
    selectedAmount: input.totalAmount ?? input.amount,
    needsReview: false,
    documentType: input.documentTypeDetailed,
    confidenceScore: input.confidenceScore,
  });
  if (!trustEvaluation.shouldCreatePayment) {
    console.log(`[whatsapp-invoice] payment blocked reason=${trustEvaluation.blockReason ?? trustGatesFailClosedReason(parseTrustGatesFromParsedFields(input.parsedFieldsJson))}`);
    return { id: null, created: false };
  }

  const date = normalizeDate(input.invoiceDate) ?? new Date();
  const paymentIdentity = buildPaymentLookupsFromCanonical({
    organizationId: input.organizationId,
    canonicalFingerprint: input.documentFingerprint,
    supplierName: input.supplier,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.totalAmount ?? input.amount,
    documentDate: date,
    documentType: input.documentTypeDetailed,
    fileSha256: input.fileHash,
    subject: input.fileHash ? `file:${input.fileHash}` : `whatsapp:${input.whatsappLogId}:${input.filename}:${input.invoiceNumber ?? ""}`,
    sourceFingerprint: input.sourceFingerprint,
  });
  const duplicateHash = paymentIdentity.duplicateHash;
  const invoiceLink = input.documentType === "invoice" || input.documentType === "receipt" || input.documentType === "tax_invoice_receipt" ? input.driveLink : null;
  const documentLink = input.documentType === "payment_request" ? input.driveLink : invoiceLink ?? input.driveLink;

  const existing = await prisma.supplierPayment.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: paymentIdentity.lookupClauses,
    },
    orderBy: { createdAt: "desc" },
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
        driveFileId: input.driveFileId ?? existing.driveFileId,
        driveFileUrl: input.driveFileUrl ?? existing.driveFileUrl,
        driveFolderId: input.driveFolderId ?? existing.driveFolderId,
        driveClientFolderId: input.driveClientFolderId ?? existing.driveClientFolderId,
        driveSupplierFolderId: input.driveSupplierFolderId ?? existing.driveSupplierFolderId,
        driveFolderPath: input.driveFolderPath ?? existing.driveFolderPath,
        supplier: input.supplier,
        supplierName: input.supplier,
        invoiceMonth: input.invoiceMonth ?? existing.invoiceMonth,
        invoiceYear: input.invoiceYear ?? existing.invoiceYear,
        invoiceNumber: input.invoiceNumber ?? existing.invoiceNumber,
        documentFingerprint: input.documentFingerprint,
        sourceFingerprint: input.sourceFingerprint,
        documentTypeDetailed: input.documentTypeDetailed,
        supplierTaxId: input.supplierTaxId ?? existing.supplierTaxId,
        amountBeforeVat: input.amountBeforeVat ?? existing.amountBeforeVat,
        vatAmount: input.vatAmount ?? existing.vatAmount,
        totalAmount: input.totalAmount ?? existing.totalAmount,
        confidenceScore: input.confidenceScore,
        approvalStatus: "approved",
        sourcesJson: existing.source === "gmail" || existing.source === "both" ? ["gmail", "whatsapp"] : ["whatsapp"],
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

  const createResult = await createSupplierPaymentIfTrusted({
    evaluation: trustEvaluation,
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
      driveFileId: input.driveFileId,
      driveFileUrl: input.driveFileUrl,
      driveFolderId: input.driveFolderId,
      driveClientFolderId: input.driveClientFolderId,
      driveSupplierFolderId: input.driveSupplierFolderId,
      driveFolderPath: input.driveFolderPath,
      supplierName: input.supplier,
      invoiceMonth: input.invoiceMonth,
      invoiceYear: input.invoiceYear,
      invoiceNumber: input.invoiceNumber,
      documentFingerprint: input.documentFingerprint,
      sourceFingerprint: input.sourceFingerprint,
      documentTypeDetailed: input.documentTypeDetailed,
      supplierTaxId: input.supplierTaxId,
      amountBeforeVat: input.amountBeforeVat,
      vatAmount: input.vatAmount,
      totalAmount: input.totalAmount,
      confidenceScore: input.confidenceScore,
      approvalStatus: "approved",
      sourcesJson: ["whatsapp"],
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
      parsedFieldsJson: input.parsedFieldsJson as any,
    },
  });
  if (createResult.skipped || !createResult.payment) {
    console.log(`[whatsapp-invoice] payment blocked reason=${createResult.reason ?? "trust_gate_blocked"}`);
    return { id: null, created: false };
  }
  return { id: createResult.payment.id, created: true };
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
  const currentDocument = whatsappFinancialDocumentInput({
    organizationId: input.organizationId,
    supplier: input.supplier,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    invoiceDate: input.invoiceDate,
    fileHash: input.fileHash,
  });
  const canonical = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplier,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.amount,
    documentDate: input.invoiceDate,
    fileSha256: input.fileHash,
  });
  const legacyFileHash = buildLegacyFileDuplicateHashForLookup({
    organizationId: input.organizationId,
    supplier: input.supplier,
    fileHash: input.fileHash,
  });
  const fileLookupClauses: Array<Record<string, unknown>> = [
    { duplicateHash: legacyFileHash },
  ];
  if (canonical.fingerprint) {
    fileLookupClauses.push({ duplicateHash: canonical.fingerprint });
    fileLookupClauses.push({ documentFingerprint: canonical.fingerprint });
  }
  fileLookupClauses.push({ documentFingerprint: canonical.legacyFingerprint });
  const byFileHash = await prisma.supplierPayment.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: fileLookupClauses,
    },
    orderBy: { createdAt: "desc" },
  });
  if (byFileHash) {
    return matchedPaymentDuplicate(currentDocument, paymentFinancialDocumentInput(byFileHash, input.fileHash), byFileHash, "file_hash");
  }

  if (input.supplierTaxId && input.invoiceNumber) {
    const scanItems = await prisma.gmailScanItem.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    let matchingScanItem: (typeof scanItems)[number] | null = null;
    let matchingScanItemResult: ReturnType<typeof matchWhatsAppFinancialDocumentCandidate> | null = null;
    for (const item of scanItems) {
      const raw = item.rawAnalysis as Record<string, any> | null;
      const taxId = normalizeTaxId(raw?.supplierTaxId ?? raw?.supplier?.taxId ?? raw?.analysis?.supplierTaxId);
      const invoiceNumber = normalizeInvoiceNumber(raw?.invoiceNumber ?? raw?.analysis?.invoiceNumber);
      const match = matchWhatsAppFinancialDocumentCandidate(currentDocument, {
        organizationId: input.organizationId,
        supplierName: item.supplierName,
        supplierTaxId: taxId,
        invoiceNumber,
        totalAmount: item.amount,
        documentDate: raw?.date ?? raw?.invoiceDate ?? raw?.analysis?.date ?? raw?.analysis?.invoiceDate,
        documentType: raw?.documentType ?? raw?.analysis?.documentType,
      });
      if (match.result === "MATCH") {
        matchingScanItem = item;
        matchingScanItemResult = match;
        break;
      }
      if (match.result === "UNSURE" && !matchingScanItem) {
        matchingScanItem = item;
        matchingScanItemResult = match;
      }
    }
    if (matchingScanItem) {
      const payment = matchingScanItem.emailMessageId
        ? await prisma.supplierPayment.findFirst({
            where: { organizationId: input.organizationId, emailMessageId: matchingScanItem.emailMessageId },
          })
        : null;
      if (matchingScanItemResult?.result === "UNSURE") {
        return possibleDuplicateReview("supplier_tax_id_invoice_number", matchingScanItemResult.reasons, payment?.id ?? null);
      }
      return {
        matchResult: "MATCH" as const,
        paymentId: payment?.id ?? null,
        supplier: payment?.supplier ?? matchingScanItem.supplierName,
        amount: payment?.amount ?? matchingScanItem.amount,
        driveLink: payment?.invoiceLink ?? payment?.documentLink ?? matchingScanItem.driveFileLink,
        reason: `supplier_tax_id_invoice_number:${matchingScanItemResult?.reasons.join(",") ?? "match"}`,
        reasons: matchingScanItemResult?.reasons ?? ["match"],
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
      if (payment) {
        return matchedPaymentDuplicate(currentDocument, paymentFinancialDocumentInput(payment), payment, "supplier_amount_invoice_date");
      }
    }
  }

  return null;
}

export function matchWhatsAppFinancialDocumentCandidate(
  current: FinancialDocumentFingerprintInput,
  candidate: FinancialDocumentFingerprintInput
) {
  return matchFinancialDocuments(current, candidate);
}

function whatsappFinancialDocumentInput(input: {
  organizationId: string;
  supplier: string;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  amount: number | null;
  invoiceDate: string | null;
  fileHash: string;
}): FinancialDocumentFingerprintInput {
  return {
    organizationId: input.organizationId,
    supplierName: input.supplier,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.amount,
    documentDate: input.invoiceDate,
    documentType: "invoice",
    fileSha256: input.fileHash,
  };
}

function paymentFinancialDocumentInput(payment: {
  organizationId?: string | null;
  supplier: string;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  amount: number;
  totalAmount?: number | null;
  date?: Date | string | null;
  documentTypeDetailed?: string | null;
}, fileSha256?: string | null): FinancialDocumentFingerprintInput {
  return {
    organizationId: payment.organizationId,
    supplierName: payment.supplierName ?? payment.supplier,
    supplierTaxId: payment.supplierTaxId,
    invoiceNumber: payment.invoiceNumber,
    totalAmount: payment.totalAmount ?? payment.amount,
    documentDate: payment.date,
    documentType: payment.documentTypeDetailed,
    fileSha256,
  };
}

function matchedPaymentDuplicate(
  current: FinancialDocumentFingerprintInput,
  candidate: FinancialDocumentFingerprintInput,
  payment: {
    id: string;
    supplier: string;
    amount: number;
    invoiceLink: string | null;
    documentLink: string | null;
  },
  legacyReason: string
) {
  const match = matchWhatsAppFinancialDocumentCandidate(current, candidate);
  if (match.result === "MATCH") return paymentDuplicate(payment, `${legacyReason}:${match.reasons.join(",")}`, match.result, match.reasons);
  if (match.result === "UNSURE") return possibleDuplicateReview(legacyReason, match.reasons, payment.id);
  return null;
}

function possibleDuplicateReview(reason: string, reasons: string[], paymentId: string | null) {
  return {
    matchResult: "UNSURE" as const,
    paymentId,
    supplier: null,
    amount: null,
    driveLink: null,
    reason: `${reason}:${reasons.join(",")}`,
    reasons,
  };
}

async function attachWhatsAppSourceToPayment(input: {
  paymentId: string;
  whatsappLogId: string;
  fromNumber: string;
  duplicateReason: string;
  supplier: string;
  amount: number | null;
  invoiceDate: string | null;
  dueDate: string | null;
  invoiceNumber: string | null;
  documentType: string;
  supplierTaxId: string | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
  confidenceScore: number;
  documentFingerprint: string;
  sourceFingerprint: string;
  driveLink: string | null;
}) {
  const payment = await prisma.supplierPayment.findUnique({ where: { id: input.paymentId } });
  if (!payment) return;
  const incomingSupplierIsValid = usableSupplierName(input.supplier);
  const shouldReplaceSupplier = incomingSupplierIsValid && !usableSupplierName(payment.supplier);
  const mergedDate = normalizeDate(input.invoiceDate) ?? payment.date;
  const mergedDueDate = normalizeDate(input.dueDate) ?? payment.dueDate;
  const invoiceLink = isInvoiceLikeDocument(input.documentType) ? input.driveLink ?? payment.invoiceLink : payment.invoiceLink;
  const documentLink = input.documentType === "payment_request" ? input.driveLink ?? payment.documentLink : payment.documentLink ?? invoiceLink ?? input.driveLink;
  const hasCompleteIncomingInvoice =
    incomingSupplierIsValid &&
    Boolean(input.invoiceNumber?.trim()) &&
    input.amount !== null &&
    input.amount > 0 &&
    Boolean(mergedDate);
  await prisma.supplierPayment.update({
    where: { id: input.paymentId },
    data: {
      source: payment.source === "gmail" || payment.source === "both" ? "both" : payment.source,
      supplier: shouldReplaceSupplier ? input.supplier : payment.supplier,
      supplierName: shouldReplaceSupplier ? input.supplier : payment.supplierName ?? payment.supplier,
      amount: input.amount ?? payment.amount,
      date: mergedDate,
      dueDate: mergedDueDate,
      invoiceNumber: input.invoiceNumber ?? payment.invoiceNumber,
      documentLink,
      invoiceLink,
      driveFileUrl: input.driveLink ?? payment.driveFileUrl,
      supplierTaxId: input.supplierTaxId ?? payment.supplierTaxId,
      amountBeforeVat: input.amountBeforeVat ?? payment.amountBeforeVat,
      vatAmount: input.vatAmount ?? payment.vatAmount,
      totalAmount: input.totalAmount ?? payment.totalAmount,
      confidenceScore: Math.max(payment.confidenceScore ?? 0, input.confidenceScore),
      documentFingerprint: input.documentFingerprint,
      sourceFingerprint: input.sourceFingerprint,
      documentTypeDetailed: input.documentType,
      approvalStatus: hasCompleteIncomingInvoice ? "approved" : payment.approvalStatus,
      emailSender: input.fromNumber,
      lastSource: "whatsapp",
      sourceCount: Math.max(payment.sourceCount ?? 1, 1) + 1,
      duplicateDetected: hasCompleteIncomingInvoice ? false : true,
      duplicateReason: hasCompleteIncomingInvoice ? null : input.duplicateReason,
      firstSeenAt: payment.firstSeenAt ?? payment.createdAt,
      lastSeenAt: new Date(),
      subject: hasCompleteIncomingInvoice
        ? duplicateSubject(input.invoiceNumber ? `WhatsApp ${input.invoiceNumber}` : payment.subject, false, null)
        : duplicateSubject(payment.subject, true, input.duplicateReason),
    },
  });
}

async function syncPaymentToSheetSafely(
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
  try {
    await syncPaymentToSheet(organizationId, paymentId, metadata);
  } catch (err) {
    console.warn(JSON.stringify({
      event: "whatsapp_sheets_sync_skipped",
      organizationId,
      paymentId,
      reason: err instanceof Error ? err.message : String(err),
    }));
  }
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
}, reason: string, matchResult: DedupMatchResult = "MATCH", reasons: string[] = [reason]) {
  return {
    matchResult,
    paymentId: payment.id,
    supplier: payment.supplier,
    amount: payment.amount,
    driveLink: payment.invoiceLink ?? payment.documentLink,
    reason,
    reasons,
  };
}

function isInvoiceLikeDocument(documentType: string) {
  return documentType === "invoice" || documentType === "receipt" || documentType === "tax_invoice_receipt";
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
  const supplier = value?.trim() ?? "";
  if (!supplier) return false;
  if (/^(null|undefined)$/i.test(supplier)) return false;
  if (supplier === ".name" || supplier.startsWith(".")) return false;
  // ולידציה משותפת: חוסמת גם זבל טכני (isLikelyJunkSupplierName), placeholders,
  // כתובות מייל ודומיינים — בעבר המסלול הזה דילג על בדיקת הזבל לגמרי.
  return isValidSupplierNameShared(supplier);
}

function normalizeAmount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function selectWhatsAppInvoiceAmount(input: {
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
  return resolveWhatsAppMoneyDecision({
    organizationId: input.organizationId,
    documentType: input.documentType ?? "invoice",
    analysis: {
      amount: input.amount ?? null,
      totalAmount: input.totalAmount ?? null,
      amountBeforeVat: null,
      vatAmount: null,
      currency: input.currency ?? "ILS",
      confidence: input.confidence ?? 0.85,
    },
  }).selectedAmount;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
