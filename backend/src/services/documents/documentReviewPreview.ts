import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { drive_v3 } from "googleapis";
import { prisma } from "../../lib/prisma.js";
import {
  findExistingSupplierDriveDocument,
  uploadInvoiceAttachmentToDrive,
  type UploadedDriveFile,
} from "../driveService.js";

export type DocumentIngestChannel = "whatsapp" | "camera" | "gmail";

export type IngestedDocumentPreviewResult = {
  previewUrl: string | null;
  driveFileId: string | null;
  driveUploadStatus: "uploaded" | "pending_retry";
  upload: UploadedDriveFile | null;
  duplicateDetected: boolean;
  duplicateReason: string | null;
};

export type PersistIngestedDocumentPreviewInput = {
  channel: DocumentIngestChannel;
  organizationId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  supplier: string;
  supplierTaxId?: string | null;
  documentType: string;
  documentDate?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  totalAmount?: number | null;
  fileSha256: string;
  fileMd5?: string;
  clientId?: string | null;
  receivedAt?: Date;
  drive?: drive_v3.Drive | null;
  rootFolderId?: string | null;
  findExistingDriveDocumentFn?: typeof findExistingSupplierDriveDocument;
  uploadToDriveFn?: typeof uploadInvoiceAttachmentToDrive;
};

export async function saveLocalIngestedDocument(input: {
  channel: DocumentIngestChannel;
  filename: string;
  buffer: Buffer;
}): Promise<string> {
  const uploadDir = path.join(process.cwd(), "uploads", `${input.channel}-invoices`);
  await mkdir(uploadDir, { recursive: true });
  const safeName = input.filename.replace(/[\\/:*?"<>|]/g, "-");
  const storedName = `${Date.now()}_${safeName}`;
  await writeFile(path.join(uploadDir, storedName), input.buffer);
  return `/uploads/${input.channel}-invoices/${storedName}`;
}

export async function persistIngestedDocumentPreview(
  input: PersistIngestedDocumentPreviewInput,
): Promise<IngestedDocumentPreviewResult> {
  const findExisting = input.findExistingDriveDocumentFn ?? findExistingSupplierDriveDocument;
  const uploadToDrive = input.uploadToDriveFn ?? uploadInvoiceAttachmentToDrive;
  const receivedAt = input.receivedAt ?? new Date();

  if (input.drive && input.rootFolderId) {
    const existingDriveFile = await findExisting({
      organizationId: input.organizationId,
      drive: input.drive,
      rootFolderId: input.rootFolderId,
      clientId: input.clientId ?? null,
      supplier: input.supplier,
      supplierTaxId: input.supplierTaxId ?? null,
      documentType: input.documentType,
      filename: input.filename,
      fileSha256: input.fileSha256,
      fileMd5: input.fileMd5,
      documentDate: input.documentDate,
      invoiceNumber: input.invoiceNumber ?? null,
      amount: input.amount ?? null,
      totalAmount: input.totalAmount ?? input.amount ?? null,
    });
    if (existingDriveFile) {
      const previewUrl =
        existingDriveFile.webViewLink ??
        (existingDriveFile.id ? `https://drive.google.com/file/d/${existingDriveFile.id}/view` : null);
      return {
        previewUrl,
        driveFileId: existingDriveFile.id ?? null,
        driveUploadStatus: "uploaded",
        upload: null,
        duplicateDetected: true,
        duplicateReason: "google_drive_existing_file",
      };
    }

    try {
      const upload = await uploadToDrive({
        organizationId: input.organizationId,
        drive: input.drive,
        rootFolderId: input.rootFolderId,
        clientId: input.clientId ?? null,
        supplier: input.supplier,
        supplierTaxId: input.supplierTaxId ?? null,
        documentType: input.documentType,
        reviewStatus: "needs_review",
        filename: input.filename,
        mimeType: input.mimeType,
        receivedAt,
        documentDate: input.documentDate,
        invoiceNumber: input.invoiceNumber ?? null,
        amount: input.amount ?? null,
        totalAmount: input.totalAmount ?? input.amount ?? null,
        buffer: input.buffer,
        fileSha256: input.fileSha256,
        fileMd5: input.fileMd5,
      });
      return {
        previewUrl: upload.webViewLink || null,
        driveFileId: upload.fileId,
        driveUploadStatus: upload.webViewLink ? "uploaded" : "pending_retry",
        upload,
        duplicateDetected: false,
        duplicateReason: null,
      };
    } catch (err) {
      console.warn(
        `[document-preview] drive upload failed channel=${input.channel} org=${input.organizationId} reason=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const localPath = await saveLocalIngestedDocument({
    channel: input.channel,
    filename: input.filename,
    buffer: input.buffer,
  });
  return {
    previewUrl: localPath,
    driveFileId: null,
    driveUploadStatus: "pending_retry",
    upload: null,
    duplicateDetected: false,
    duplicateReason: null,
  };
}

type DocumentDecisionWithReview = {
  action: string;
  review?: { id: string } | null;
};

export function reviewIdFromDocumentDecision(decision: DocumentDecisionWithReview): string | null {
  if ("review" in decision && decision.review?.id) return decision.review.id;
  return null;
}

export async function attachPreviewToFinancialDocumentReview(
  reviewId: string,
  preview: Pick<IngestedDocumentPreviewResult, "previewUrl" | "driveUploadStatus">,
): Promise<void> {
  if (!preview.previewUrl) return;
  await prisma.financialDocumentReview.update({
    where: { id: reviewId },
    data: {
      driveFileUrl: preview.previewUrl,
      driveUploadStatus: preview.driveUploadStatus,
    },
  });
}

export async function syncFinancialDocumentReviewPreview(
  decision: DocumentDecisionWithReview,
  preview: IngestedDocumentPreviewResult,
): Promise<void> {
  const reviewId = reviewIdFromDocumentDecision(decision);
  if (!reviewId) return;
  await attachPreviewToFinancialDocumentReview(reviewId, preview);
}
